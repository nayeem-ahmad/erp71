import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    syncInventoryReasons,
    SHRINKAGE_REASON_TYPE,
    DISCREPANCY_REASON_TYPE,
} from '../../../packages/database/prisma/sync-inventory-reasons';
import {
    DEFAULT_DISCREPANCY_REASONS,
    DEFAULT_SHRINKAGE_REASONS,
} from '../../../packages/database/prisma/inventory-reasons.seed';

type Row = Record<string, any>;

/**
 * Minimal Prisma stand-in covering the calls the reconciler makes:
 * tenant.findMany, inventoryReason.findMany / createMany / update.
 */
function fakePrisma(tenants: Row[], inventoryReason: Row[] = []) {
    const tables: Record<string, Row[]> = {
        tenant: [...tenants],
        inventoryReason: inventoryReason.map((row) => ({ ...row })),
    };
    let nextId = 1;

    const matches = (row: Row, where: Row = {}): boolean =>
        Object.entries(where).every(([key, value]) => {
            if (value && typeof value === 'object' && !Array.isArray(value) && 'in' in value) {
                return (value.in as unknown[]).includes(row[key]);
            }
            return row[key] === value;
        });

    const client = {
        tenant: {
            findMany: async ({ where }: any = {}) => tables.tenant.filter((row) => matches(row, where)),
        },
        inventoryReason: {
            findMany: async ({ where }: any = {}) =>
                tables.inventoryReason.filter((row) => matches(row, where ?? {})),
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
                tables.inventoryReason.push(
                    ...fresh.map((row) => ({ id: row.id ?? `new-${nextId++}`, ...row })),
                );
                return { count: fresh.length };
            },
            update: async ({ where, data }: any) => {
                const row = tables.inventoryReason.find((entry) => entry.id === where.id);
                if (!row) throw new Error(`inventoryReason ${where.id} not found`);
                Object.assign(row, data);
                return row;
            },
        },
    };

    return { client, tables };
}

const TENANT_A = { id: 't-a', name: 'KH Trading', created_at: new Date('2026-01-01') };
const TENANT_B = { id: 't-b', name: 'Demo Store', created_at: new Date('2026-02-01') };

const blankLoss = (tenantId: string, overrides: Row = {}) => ({
    id: `blank-${tenantId}`,
    tenant_id: tenantId,
    type: SHRINKAGE_REASON_TYPE,
    code: '',
    label: '',
    is_system: false,
    is_active: true,
    display_order: 0,
    ...overrides,
});

describe('syncInventoryReasons', () => {
    it('gives a tenant with only blank Product Lost rows the default catalogue', async () => {
        const { client, tables } = fakePrisma([TENANT_A], [blankLoss('t-a')]);

        const changed = await syncInventoryReasons(client);

        expect(changed).toEqual([
            expect.objectContaining({
                tenantId: 't-a',
                tenantName: 'KH Trading',
                createdShrinkage: DEFAULT_SHRINKAGE_REASONS.length,
            }),
        ]);
        const codes = tables.inventoryReason
            .filter((row) => row.tenant_id === 't-a' && row.type === SHRINKAGE_REASON_TYPE)
            .map((row) => row.code);
        expect(codes).toEqual(expect.arrayContaining(['', ...DEFAULT_SHRINKAGE_REASONS.map((reason) => reason.code)]));
    });

    it('labels a blank Product Lost reason so the entry picker has something to show', async () => {
        const { client, tables } = fakePrisma(
            [TENANT_A],
            [blankLoss('t-a'), blankLoss('t-a', { id: 'code-5', code: '5', label: '   ' })],
        );

        await syncInventoryReasons(client);

        expect(tables.inventoryReason.find((row) => row.id === 'blank-t-a')?.label).toBe('Unspecified');
        expect(tables.inventoryReason.find((row) => row.id === 'code-5')?.label).toBe('5');
    });

    it('adds missing stock-take defaults without touching a renamed row', async () => {
        const existing = {
            id: 'mc',
            tenant_id: 't-a',
            type: DISCREPANCY_REASON_TYPE,
            code: 'MC',
            label: 'Miscount',
            is_system: false,
            is_active: true,
            display_order: 0,
        };
        const { client, tables } = fakePrisma([TENANT_A], [existing]);

        await syncInventoryReasons(client);

        expect(tables.inventoryReason.find((row) => row.id === 'mc')?.label).toBe('Miscount');
        expect(
            tables.inventoryReason
                .filter((row) => row.type === DISCREPANCY_REASON_TYPE)
                .map((row) => row.code),
        ).toEqual(expect.arrayContaining(['MC', ...DEFAULT_DISCREPANCY_REASONS.map((reason) => reason.code)]));
    });

    it('leaves a complete catalogue alone on a second run', async () => {
        const seeded = DEFAULT_SHRINKAGE_REASONS.map((reason, index) => ({
            id: `s-${index}`,
            tenant_id: 't-a',
            type: SHRINKAGE_REASON_TYPE,
            code: reason.code,
            label: reason.label,
            is_system: true,
            is_active: true,
            display_order: index,
        }));
        const { client, tables } = fakePrisma([TENANT_A], seeded);

        const first = await syncInventoryReasons(client);
        const afterFirst = tables.inventoryReason.length;
        const second = await syncInventoryReasons(client);

        expect(first[0].createdShrinkage).toBe(0);
        expect(second).toEqual([]);
        expect(tables.inventoryReason).toHaveLength(afterFirst);
    });

    it('honours --tenant by touching only that tenant', async () => {
        const { client, tables } = fakePrisma([TENANT_A, TENANT_B], [blankLoss('t-a'), blankLoss('t-b')]);

        const changed = await syncInventoryReasons(client, { tenantId: 't-a' });

        expect(changed.map((result) => result.tenantId)).toEqual(['t-a']);
        expect(tables.inventoryReason.find((row) => row.id === 'blank-t-b')?.label).toBe('');
    });

    it('reports what it would do on a dry run without writing', async () => {
        const { client, tables } = fakePrisma([TENANT_A], [blankLoss('t-a')]);

        const changed = await syncInventoryReasons(client, { dryRun: true });

        expect(changed[0].createdShrinkage).toBe(DEFAULT_SHRINKAGE_REASONS.length);
        expect(changed[0].relabelled).toBe(1);
        expect(tables.inventoryReason).toHaveLength(1);
        expect(tables.inventoryReason[0].label).toBe('');
    });
});

describe('sync:inventory-reasons on boot', () => {
    it('runs from db-prepare after found-reasons', () => {
        const prepare = readFileSync(
            resolve(__dirname, '../scripts/db-prepare.sh'),
            'utf8',
        );
        const foundAt = prepare.indexOf('sync:found-reasons');
        const inventoryAt = prepare.indexOf('sync:inventory-reasons');
        expect(foundAt).toBeGreaterThan(-1);
        expect(inventoryAt).toBeGreaterThan(foundAt);
    });
});
