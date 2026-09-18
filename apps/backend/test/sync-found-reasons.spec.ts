import {
    syncFoundReasons,
    FOUND_REASON_TYPE,
} from '../../../packages/database/prisma/sync-found-reasons';
import { DEFAULT_FOUND_REASONS } from '../../../packages/database/prisma/inventory-reasons.seed';

type Row = Record<string, any>;

/**
 * Minimal Prisma stand-in covering exactly the calls the reconciler makes:
 * `tenant.findMany`, `inventoryReason.count` and `inventoryReason.createMany`
 * with `skipDuplicates` against the real unique key (tenant_id, type, code).
 */
function fakePrisma(tenants: Row[], inventoryReason: Row[] = []) {
    const tables: Record<string, Row[]> = { tenant: [...tenants], inventoryReason: [...inventoryReason] };

    const matches = (row: Row, where: Row = {}): boolean =>
        Object.entries(where).every(([key, value]) => row[key] === value);

    const client = {
        tenant: {
            findMany: async ({ where }: any = {}) => tables.tenant.filter((row) => matches(row, where)),
        },
        inventoryReason: {
            count: async ({ where }: any = {}) => tables.inventoryReason.filter((row) => matches(row, where)).length,
            createMany: async ({ data, skipDuplicates }: any) => {
                const fresh = (data as Row[]).filter(
                    (row) =>
                        !skipDuplicates ||
                        !tables.inventoryReason.some(
                            (existing) =>
                                existing.tenant_id === row.tenant_id &&
                                existing.type === row.type &&
                                existing.code === row.code,
                        ),
                );
                tables.inventoryReason.push(...fresh);
                return { count: fresh.length };
            },
        },
    };

    return { client, tables };
}

const TENANT_A = { id: 't-a', name: 'Alpha Traders', created_at: new Date('2026-01-01') };
const TENANT_B = { id: 't-b', name: 'Beta Stores', created_at: new Date('2026-02-01') };

/** A FOUND row as the tenant-creation seed would have written it. */
const foundRow = (tenantId: string, code: string, overrides: Row = {}) => ({
    tenant_id: tenantId,
    type: FOUND_REASON_TYPE,
    code,
    label: code,
    is_system: true,
    is_active: true,
    display_order: 0,
    ...overrides,
});

describe('syncFoundReasons', () => {
    it('gives a tenant with no FOUND reasons the full default catalogue', async () => {
        const { client, tables } = fakePrisma([TENANT_A]);

        const changed = await syncFoundReasons(client);

        expect(changed).toEqual([
            { tenantId: 't-a', tenantName: 'Alpha Traders', created: DEFAULT_FOUND_REASONS.length },
        ]);
        expect(tables.inventoryReason).toHaveLength(DEFAULT_FOUND_REASONS.length);
        expect(tables.inventoryReason.map((row) => row.code)).toEqual(
            DEFAULT_FOUND_REASONS.map((reason) => reason.code),
        );
    });

    it('writes the rows the entry screen and settings screen depend on', async () => {
        const { client, tables } = fakePrisma([TENANT_A]);

        await syncFoundReasons(client);

        // The service refuses a reason that is not an active FOUND one, and
        // is_system is what stops the settings screen offering to delete it.
        for (const row of tables.inventoryReason) {
            expect(row.tenant_id).toBe('t-a');
            expect(row.type).toBe(FOUND_REASON_TYPE);
            expect(row.is_active).toBe(true);
            expect(row.is_system).toBe(true);
        }
        // display_order drives the picker's order, so it must be distinct and
        // follow the catalogue.
        expect(tables.inventoryReason.map((row) => row.display_order)).toEqual(
            DEFAULT_FOUND_REASONS.map((_, index) => index),
        );
    });

    it('leaves a tenant that already has FOUND reasons completely alone', async () => {
        const existing = [foundRow('t-a', 'MISCOUNT', { label: 'Renamed by the tenant', display_order: 9 })];
        const { client, tables } = fakePrisma([TENANT_A], existing);

        const changed = await syncFoundReasons(client);

        expect(changed).toEqual([]);
        // Not topped up to the full four, and the tenant's own label survives.
        expect(tables.inventoryReason).toHaveLength(1);
        expect(tables.inventoryReason[0].label).toBe('Renamed by the tenant');
        expect(tables.inventoryReason[0].display_order).toBe(9);
    });

    it('does not reactivate a reason switched off on purpose', async () => {
        // A deactivated row still counts as "has a catalogue" — this is the
        // whole reason the guard counts rows rather than active rows.
        const off = DEFAULT_FOUND_REASONS.map((reason) =>
            foundRow('t-a', reason.code, { is_active: false }),
        );
        const { client, tables } = fakePrisma([TENANT_A], off);

        const changed = await syncFoundReasons(client);

        expect(changed).toEqual([]);
        expect(tables.inventoryReason.every((row) => row.is_active === false)).toBe(true);
    });

    it('is idempotent — a second run writes nothing', async () => {
        const { client, tables } = fakePrisma([TENANT_A]);

        await syncFoundReasons(client);
        const afterFirst = tables.inventoryReason.length;
        const changed = await syncFoundReasons(client);

        expect(changed).toEqual([]);
        expect(tables.inventoryReason).toHaveLength(afterFirst);
    });

    it('seeds only the tenants that need it, leaving the others untouched', async () => {
        const { client, tables } = fakePrisma(
            [TENANT_A, TENANT_B],
            [foundRow('t-b', 'MISCOUNT')],
        );

        const changed = await syncFoundReasons(client);

        expect(changed.map((result) => result.tenantId)).toEqual(['t-a']);
        expect(tables.inventoryReason.filter((row) => row.tenant_id === 't-b')).toHaveLength(1);
        expect(tables.inventoryReason.filter((row) => row.tenant_id === 't-a')).toHaveLength(
            DEFAULT_FOUND_REASONS.length,
        );
    });

    it('honours --tenant by touching only that tenant', async () => {
        const { client, tables } = fakePrisma([TENANT_A, TENANT_B]);

        const changed = await syncFoundReasons(client, { tenantId: 't-b' });

        expect(changed.map((result) => result.tenantId)).toEqual(['t-b']);
        expect(tables.inventoryReason.every((row) => row.tenant_id === 't-b')).toBe(true);
    });

    it('reports what it would do on a dry run without writing', async () => {
        const { client, tables } = fakePrisma([TENANT_A]);

        const changed = await syncFoundReasons(client, { dryRun: true });

        expect(changed).toEqual([
            { tenantId: 't-a', tenantName: 'Alpha Traders', created: DEFAULT_FOUND_REASONS.length },
        ]);
        expect(tables.inventoryReason).toHaveLength(0);
    });

    it('is a no-op on a database with no tenants', async () => {
        const { client, tables } = fakePrisma([]);

        await expect(syncFoundReasons(client)).resolves.toEqual([]);
        expect(tables.inventoryReason).toHaveLength(0);
    });

    it('survives losing the insert race to another booting container', async () => {
        // Two containers start at once: the count is taken before the other one
        // writes, so createMany runs against rows that already exist. The unique
        // key is (tenant_id, type, code) and skipDuplicates must absorb it —
        // a throw here would stop the backend booting.
        const { client, tables } = fakePrisma([TENANT_A]);
        const raced = DEFAULT_FOUND_REASONS.map((reason) => foundRow('t-a', reason.code));

        const countBefore = client.inventoryReason.count;
        let firstCall = true;
        client.inventoryReason.count = async (args: any) => {
            if (firstCall) {
                firstCall = false;
                return 0; // the stale read
            }
            return countBefore(args);
        };
        tables.inventoryReason.push(...raced);

        await expect(syncFoundReasons(client)).resolves.toHaveLength(1);
        // No duplicates written despite the stale read.
        expect(tables.inventoryReason).toHaveLength(DEFAULT_FOUND_REASONS.length);
    });
});
