import {
    MARKER_GROUP,
    MARKER_KEY,
    runMemberPrefsLegacySync,
} from '@erp71/database/prisma/sync-member-prefs-legacy.utils';
import { normalizeInvoicePrintPrefs } from '@erp71/shared-types';

describe('sync-member-prefs-legacy — one-shot marker', () => {
    const buildClient = (
        marker: { value: string } | null,
        blobs: { id: string; invoice_print_prefs: unknown }[] = [],
    ) => {
        const order: string[] = [];
        const tx = {
            tenantUser: {
                updateMany: jest.fn().mockImplementation(async () => {
                    order.push('updateMany');
                    return { count: 7 };
                }),
                findMany: jest.fn().mockImplementation(async () => blobs),
                update: jest.fn().mockImplementation(async () => {
                    order.push('update');
                    return {};
                }),
                count: jest.fn().mockResolvedValue(7),
            },
            platformSetting: {
                upsert: jest.fn().mockImplementation(async () => {
                    order.push('marker');
                    return {};
                }),
            },
        };
        const client = {
            platformSetting: {
                findFirst: jest.fn().mockResolvedValue(marker),
                upsert: jest.fn(),
            },
            tenantUser: { count: jest.fn().mockResolvedValue(7), findMany: tx.tenantUser.findMany },
            $transaction: jest.fn().mockImplementation(async (fn: any) => fn(tx)),
        };
        return { client, tx, order };
    };

    it('skips entirely when the marker exists, writing nothing', async () => {
        const { client, tx } = buildClient({ value: '2026-10-22T10:00:00.000Z' });

        const result = await runMemberPrefsLegacySync(client, { dryRun: false });

        expect(result).toEqual({ skipped: true });
        expect(client.$transaction).not.toHaveBeenCalled();
        expect(tx.tenantUser.updateMany).not.toHaveBeenCalled();
        expect(tx.tenantUser.update).not.toHaveBeenCalled();
        expect(tx.platformSetting.upsert).not.toHaveBeenCalled();
    });

    it('gives every TenantUser the three legacy browser sections', async () => {
        const { client, tx } = buildClient(null);

        const result = await runMemberPrefsLegacySync(client, { dryRun: false });

        expect(tx.tenantUser.updateMany).toHaveBeenCalledWith({
            data: { legacy_browser_sections: ['tableView', 'tableColumns', 'sidebar'] },
        });
        expect(result).toEqual({ skipped: false, members: 7, blobs: 0 });
    });

    it('fills out every non-null invoice blob', async () => {
        const { client, tx } = buildClient(null, [
            { id: 'u1', invoice_print_prefs: { version: 1, table_style: 'grid' } },
        ]);

        const result = await runMemberPrefsLegacySync(client, { dryRun: false });

        const expected = normalizeInvoicePrintPrefs({ version: 1, table_style: 'grid' });
        expect(Object.keys(expected)).toHaveLength(13);
        expect(expected.signature_space_mm).toBeNull();
        expect(tx.tenantUser.update).toHaveBeenCalledWith({
            where: { id: 'u1' },
            data: { invoice_print_prefs: expected },
        });
        expect(result).toEqual({ skipped: false, members: 7, blobs: 1 });
    });

    it('only asks for rows whose blob is not null, so a null blob is left null', async () => {
        const { client, tx } = buildClient(null);

        await runMemberPrefsLegacySync(client, { dryRun: false });

        const where = tx.tenantUser.findMany.mock.calls[0][0].where;
        expect(where.invoice_print_prefs).toEqual({ not: expect.anything() });
        expect(tx.tenantUser.update).not.toHaveBeenCalled();
    });

    it('writes the marker last, inside the transaction', async () => {
        const { client, tx, order } = buildClient(null, [
            { id: 'u1', invoice_print_prefs: { version: 1 } },
            { id: 'u2', invoice_print_prefs: { version: 1 } },
        ]);

        await runMemberPrefsLegacySync(client, { dryRun: false });

        expect(order).toEqual(['updateMany', 'update', 'update', 'marker']);
        expect(client.platformSetting.upsert).not.toHaveBeenCalled();
        const upsert = tx.platformSetting.upsert.mock.calls[0][0];
        expect(upsert.where).toEqual({ group_key: { group: MARKER_GROUP, key: MARKER_KEY } });
        expect(upsert.create).toMatchObject({ group: 'sync', key: 'member_prefs_legacy' });
        expect(new Date(upsert.create.value).toISOString()).toBe(upsert.create.value);
    });

    it('writes nothing on a dry run, and reports what it would do', async () => {
        const { client, tx } = buildClient(null, [{ id: 'u1', invoice_print_prefs: { version: 1 } }]);

        const result = await runMemberPrefsLegacySync(client, { dryRun: true });

        expect(result).toEqual({ skipped: false, members: 7, blobs: 1 });
        expect(client.$transaction).not.toHaveBeenCalled();
        expect(tx.tenantUser.updateMany).not.toHaveBeenCalled();
        expect(tx.tenantUser.update).not.toHaveBeenCalled();
        expect(tx.platformSetting.upsert).not.toHaveBeenCalled();
        expect(client.platformSetting.upsert).not.toHaveBeenCalled();
    });
});
