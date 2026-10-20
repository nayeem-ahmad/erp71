import {
    MARKER_GROUP,
    MARKER_KEY,
    runPaymentMethodAccountSync,
} from '@erp71/database/prisma/sync-payment-method-accounts.utils';

describe('sync-payment-method-accounts — one-shot marker', () => {
    /** Two tenants; tenant "t1" has an unlinked Cash method and a Cash in Hand account. */
    const buildClient = (marker: { value: string } | null, opts: { failOnTransaction?: number } = {}) => {
        const tx = {
            paymentMethod: {
                findMany: jest.fn().mockImplementation(async ({ where }: any) =>
                    where.tenant_id === 't1' ? [{ id: 'pm1', name: 'Cash' }] : [],
                ),
                update: jest.fn().mockResolvedValue({}),
            },
            account: { findMany: jest.fn().mockResolvedValue([{ id: 'a1', name: 'Cash in Hand' }]) },
        };
        const client = {
            platformSetting: {
                findFirst: jest.fn().mockResolvedValue(marker),
                upsert: jest.fn().mockResolvedValue({}),
            },
            tenant: { findMany: jest.fn().mockResolvedValue([{ id: 't1' }, { id: 't2' }]) },
            $transaction: jest.fn().mockImplementation(async (fn: any) => {
                if (client.$transaction.mock.calls.length === opts.failOnTransaction) throw new Error('boom');
                return fn(tx);
            }),
        };
        return { client, tx };
    };

    it('links every tenant and writes the marker on a live run', async () => {
        const { client, tx } = buildClient(null);

        const result = await runPaymentMethodAccountSync(client, { dryRun: false, force: false });

        expect(result).toEqual({
            skipped: false,
            tenants: 2,
            changed: [{ tenantId: 't1', linked: ['Cash'] }],
            markerWritten: true,
        });
        expect(tx.paymentMethod.update).toHaveBeenCalledWith({ where: { id: 'pm1' }, data: { account_id: 'a1' } });
        const upsert = client.platformSetting.upsert.mock.calls[0][0];
        expect(upsert.where).toEqual({ group_key: { group: MARKER_GROUP, key: MARKER_KEY } });
        expect(upsert.create).toMatchObject({ group: 'sync', key: 'payment_method_accounts' });
        expect(new Date(upsert.create.value).toISOString()).toBe(upsert.create.value);
    });

    it('skips without linking when the marker exists, and reports when it ran', async () => {
        const { client, tx } = buildClient({ value: '2026-10-19T10:00:00.000Z' });

        const result = await runPaymentMethodAccountSync(client, { dryRun: false, force: false });

        expect(result).toEqual({ skipped: true, ranAt: '2026-10-19T10:00:00.000Z' });
        expect(client.tenant.findMany).not.toHaveBeenCalled();
        expect(tx.paymentMethod.update).not.toHaveBeenCalled();
        expect(client.platformSetting.upsert).not.toHaveBeenCalled();
    });

    it('runs again with --force even when the marker exists', async () => {
        const { client, tx } = buildClient({ value: '2026-10-19T10:00:00.000Z' });

        const result = await runPaymentMethodAccountSync(client, { dryRun: false, force: true });

        expect(result).toMatchObject({ skipped: false, markerWritten: true });
        expect(tx.paymentMethod.update).toHaveBeenCalledTimes(1);
    });

    it('never writes the marker on a dry run, and rolls the work back', async () => {
        const { client } = buildClient(null);
        const result = await runPaymentMethodAccountSync(client, { dryRun: true, force: false });

        expect(result).toMatchObject({ skipped: false, markerWritten: false, changed: [{ tenantId: 't1', linked: ['Cash'] }] });
        expect(client.platformSetting.upsert).not.toHaveBeenCalled();
    });

    it('does not write the marker for a single-tenant run', async () => {
        const { client } = buildClient(null);

        const result = await runPaymentMethodAccountSync(client, { dryRun: false, force: false, tenantId: 't1' });

        expect(result).toMatchObject({ skipped: false, markerWritten: false });
        expect(client.tenant.findMany.mock.calls[0][0].where).toEqual({ id: 't1' });
        expect(client.platformSetting.upsert).not.toHaveBeenCalled();
    });

    it('leaves the marker unset when a tenant fails', async () => {
        const { client } = buildClient(null, { failOnTransaction: 2 });

        await expect(runPaymentMethodAccountSync(client, { dryRun: false, force: false })).rejects.toThrow('boom');
        expect(client.platformSetting.upsert).not.toHaveBeenCalled();
    });
});
