import { AuditService } from './audit.service';

describe('AuditService', () => {
    let db: any;
    let service: AuditService;

    beforeEach(() => {
        db = {
            auditLog: {
                create: jest.fn().mockResolvedValue({}),
                findMany: jest.fn().mockResolvedValue([]),
                count: jest.fn().mockResolvedValue(0),
            },
            tenantUser: { findMany: jest.fn().mockResolvedValue([]) },
        };
        service = new AuditService(db);
    });

    describe('log', () => {
        it('persists the full context', async () => {
            await service.log(
                'sales.create',
                'sales',
                { userId: 'u1', tenantId: 't1', ipAddress: '1.2.3.4', userAgent: 'Chrome' },
                'sale-1',
                { total: 10 },
            );

            expect(db.auditLog.create).toHaveBeenCalledWith({
                data: {
                    action: 'sales.create',
                    entity: 'sales',
                    entity_id: 'sale-1',
                    user_id: 'u1',
                    tenant_id: 't1',
                    ip_address: '1.2.3.4',
                    user_agent: 'Chrome',
                    payload: { total: 10 },
                },
            });
        });
    });

    describe('logForUserTenants', () => {
        it('writes one row per tenant so each admin can see the event', async () => {
            db.tenantUser.findMany.mockResolvedValue([{ tenant_id: 't1' }, { tenant_id: 't2' }]);

            await service.logForUserTenants('USER_LOGIN', 'User', { userId: 'u1', ipAddress: '1.2.3.4' }, 'u1');

            expect(db.auditLog.create).toHaveBeenCalledTimes(2);
            const tenantIds = db.auditLog.create.mock.calls.map((call: any[]) => call[0].data.tenant_id);
            expect(tenantIds.sort()).toEqual(['t1', 't2']);
            expect(db.auditLog.create.mock.calls[0][0].data).toMatchObject({
                action: 'USER_LOGIN',
                user_id: 'u1',
                ip_address: '1.2.3.4',
            });
        });

        it('excludes deleted tenants', async () => {
            await service.logForUserTenants('USER_LOGIN', 'User', { userId: 'u1' }, 'u1');

            expect(db.tenantUser.findMany).toHaveBeenCalledWith({
                where: { user_id: 'u1', tenant: { deleted_at: null } },
                select: { tenant_id: true },
            });
        });

        it('still records an unscoped row for a user with no memberships', async () => {
            db.tenantUser.findMany.mockResolvedValue([]);

            await service.logForUserTenants('USER_SIGNUP', 'User', { userId: 'u1' }, 'u1');

            expect(db.auditLog.create).toHaveBeenCalledTimes(1);
            expect(db.auditLog.create.mock.calls[0][0].data.tenant_id).toBeNull();
        });
    });

    describe('query', () => {
        it('scopes to the tenant and caps the page size', async () => {
            await service.query({ tenantId: 't1', limit: 5000 });

            const args = db.auditLog.findMany.mock.calls[0][0];
            expect(args.where).toEqual({ tenant_id: 't1' });
            expect(args.take).toBe(200);
            expect(args.orderBy).toEqual({ created_at: 'desc' });
        });

        it('builds a date range from both bounds', async () => {
            const from = new Date('2026-01-01T00:00:00.000Z');
            const to = new Date('2026-01-31T00:00:00.000Z');

            await service.query({ tenantId: 't1', fromDate: from, toDate: to, action: 'sales.create' });

            expect(db.auditLog.findMany.mock.calls[0][0].where).toEqual({
                tenant_id: 't1',
                action: 'sales.create',
                created_at: { gte: from, lte: to },
            });
        });
    });
});
