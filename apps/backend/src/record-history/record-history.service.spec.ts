import { Prisma } from '@prisma/client';
import { RecordHistoryService } from './record-history.service';

function makeService(settings: Record<string, string | null> = {}) {
    const db = {
        recordHistory: {
            create: jest.fn().mockResolvedValue({}),
            findMany: jest.fn().mockResolvedValue([]),
            count: jest.fn().mockResolvedValue(0),
            deleteMany: jest.fn().mockResolvedValue({ count: 3 }),
        },
        tenant: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const platformSettings = {
        getRawValue: jest.fn(async (_group: string, key: string) => settings[key] ?? null),
    };
    const jobTracker = { track: jest.fn((_name: string, fn: () => Promise<unknown>) => fn()) };
    const service = new RecordHistoryService(db as any, platformSettings as any, jobTracker as any);
    return { service, db, platformSettings };
}

const snap = (data: Record<string, unknown>, label = 'INV-1') => ({ tenantId: 't1', label, data });

describe('RecordHistoryService', () => {
    describe('isEnabled', () => {
        it('is on unless the switch says "false"', async () => {
            const { service, platformSettings } = makeService({ sale: 'false' });

            await expect(service.isEnabled('SALE')).resolves.toBe(false);
            await expect(service.isEnabled('CUSTOMER')).resolves.toBe(true);
            expect(platformSettings.getRawValue).toHaveBeenCalledWith('record_history', 'customer');
        });
    });

    describe('write', () => {
        it('stores both snapshots and the field-level changes of an edit', async () => {
            const { service, db } = makeService();

            await service.write({
                tenantId: 't1',
                entityType: 'SALE',
                entityId: 's1',
                action: 'UPDATE',
                before: snap({ total: 100, note: 'a' }),
                after: snap({ total: 150, note: 'a' }, 'INV-1b'),
                userId: 'u1',
            });

            expect(db.recordHistory.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    tenant_id: 't1',
                    entity_type: 'SALE',
                    entity_id: 's1',
                    entity_label: 'INV-1b',
                    action: 'UPDATE',
                    before: { total: 100, note: 'a' },
                    after: { total: 150, note: 'a' },
                    changes: [{ path: 'total', from: 100, to: 150 }],
                    change_count: 1,
                    user_id: 'u1',
                }),
            });
        });

        it('drops an edit that changed nothing a snapshot shows', async () => {
            const { service, db } = makeService();

            const written = await service.write({
                tenantId: 't1',
                entityType: 'CUSTOMER',
                entityId: 'c1',
                action: 'UPDATE',
                before: snap({ name: 'A' }),
                after: snap({ name: 'A' }),
            });

            expect(written).toBe(false);
            expect(db.recordHistory.create).not.toHaveBeenCalled();
        });

        it('keeps the last known label and null "after" for a hard delete', async () => {
            const { service, db } = makeService();

            await service.write({
                tenantId: 't1',
                entityType: 'CUSTOMER_PAYMENT',
                entityId: 'p1',
                action: 'DELETE',
                before: snap({ amount: 500 }, 'CP-0001'),
                after: null,
            });

            expect(db.recordHistory.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    entity_label: 'CP-0001',
                    after: Prisma.JsonNull,
                    changes: Prisma.JsonNull,
                    change_count: 0,
                }),
            });
        });
    });

    describe('query', () => {
        it('filters, searches by label or id, and summarises changed paths', async () => {
            const { service, db } = makeService();
            db.recordHistory.findMany.mockResolvedValue([
                {
                    id: 'h1',
                    tenant_id: 't1',
                    entity_type: 'SALE',
                    changes: [{ path: 'total' }, { path: 'items[Rice].quantity' }],
                },
            ]);
            db.recordHistory.count.mockResolvedValue(1);
            db.tenant.findMany.mockResolvedValue([{ id: 't1', name: 'KH Trading' }]);

            const result = await service.query({ tenantId: 't1', entityType: 'SALE', q: ' INV-9 ', limit: 999 });

            const where = db.recordHistory.findMany.mock.calls[0][0].where;
            expect(where).toEqual({
                tenant_id: 't1',
                entity_type: 'SALE',
                OR: [{ entity_label: { contains: 'INV-9', mode: 'insensitive' } }, { entity_id: 'INV-9' }],
            });
            expect(db.recordHistory.findMany.mock.calls[0][0].take).toBe(200);
            expect(result.rows).toEqual([
                {
                    id: 'h1',
                    tenant_id: 't1',
                    entity_type: 'SALE',
                    tenant_name: 'KH Trading',
                    changed_paths: ['total', 'items[Rice].quantity'],
                },
            ]);
        });
    });

    describe('retention', () => {
        it('defaults to a year when unset or unreadable', async () => {
            await expect(makeService().service.retentionDays()).resolves.toBe(365);
            await expect(makeService({ retention_days: 'soon' }).service.retentionDays()).resolves.toBe(365);
        });

        it('purges rows older than the retention', async () => {
            const { service, db } = makeService({ retention_days: '30' });
            const now = Date.now();

            await expect(service.purgeExpiredImpl()).resolves.toBe(3);

            const cutoff: Date = db.recordHistory.deleteMany.mock.calls[0][0].where.created_at.lt;
            expect(Math.round((now - cutoff.getTime()) / 86_400_000)).toBe(30);
        });

        it('keeps everything when retention is 0', async () => {
            const { service, db } = makeService({ retention_days: '0' });

            await expect(service.purgeExpiredImpl()).resolves.toBe(0);
            expect(db.recordHistory.deleteMany).not.toHaveBeenCalled();
        });
    });
});
