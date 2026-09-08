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
            tenant: { findMany: jest.fn().mockResolvedValue([]) },
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
            await service.query({ timezone: 'Asia/Dhaka', tenantId: 't1', limit: 5000 });

            const args = db.auditLog.findMany.mock.calls[0][0];
            expect(args.where).toEqual({ tenant_id: 't1' });
            expect(args.take).toBe(200);
            expect(args.orderBy).toEqual({ created_at: 'desc' });
        });

        it('builds a date range from both bounds', async () => {
            const from = new Date('2026-01-01T00:00:00.000Z');
            const to = new Date('2026-01-31T00:00:00.000Z');

            await service.query({ timezone: 'Asia/Dhaka', tenantId: 't1', fromDate: from, toDate: to, action: 'sales.create' });

            expect(db.auditLog.findMany.mock.calls[0][0].where).toEqual({
                tenant_id: 't1',
                action: 'sales.create',
                created_at: { gte: from, lte: to },
            });
        });

        it('maps YYYY-MM-DD from/to through the inclusive Dhaka day range', async () => {
            await service.query({ timezone: 'Asia/Dhaka', tenantId: 't1', from: '2026-08-19', to: '2026-08-19' });

            expect(db.auditLog.findMany.mock.calls[0][0].where).toEqual({
                tenant_id: 't1',
                created_at: {
                    gte: new Date('2026-08-18T18:00:00.000Z'),
                    lte: new Date('2026-08-19T17:59:59.999Z'),
                },
            });
        });

        it('leaves rows untouched when tenant names were not asked for', async () => {
            db.auditLog.findMany.mockResolvedValue([{ id: 'a1', tenant_id: 't1' }]);

            const result = await service.query({ timezone: 'Asia/Dhaka', tenantId: 't1' });

            expect(db.tenant.findMany).not.toHaveBeenCalled();
            expect(result.rows[0]).not.toHaveProperty('tenant_name');
        });

        it('names each row\'s workspace in one query, and leaves platform rows null', async () => {
            db.auditLog.findMany.mockResolvedValue([
                { id: 'a1', tenant_id: 't1' },
                { id: 'a2', tenant_id: 't2' },
                { id: 'a3', tenant_id: 't1' },
                { id: 'a4', tenant_id: null },
            ]);
            db.tenant.findMany.mockResolvedValue([
                { id: 't1', name: 'Karim Store' },
                { id: 't2', name: 'Rahim Pharmacy' },
            ]);

            const result = await service.query({ timezone: 'Asia/Dhaka', includeTenantName: true });

            // One lookup for the page, with each tenant asked for only once.
            expect(db.tenant.findMany).toHaveBeenCalledTimes(1);
            expect(db.tenant.findMany.mock.calls[0][0].where).toEqual({ id: { in: ['t1', 't2'] } });
            expect(result.rows.map((row: any) => row.tenant_name)).toEqual([
                'Karim Store',
                'Rahim Pharmacy',
                'Karim Store',
                null,
            ]);
        });

        it('does not query tenants when the page holds only platform rows', async () => {
            db.auditLog.findMany.mockResolvedValue([{ id: 'a1', tenant_id: null }]);

            const result = await service.query({ timezone: 'Asia/Dhaka', includeTenantName: true });

            expect(db.tenant.findMany).not.toHaveBeenCalled();
            expect((result.rows[0] as any).tenant_name).toBeNull();
        });

        it('falls back to null for a tenant that no longer exists', async () => {
            db.auditLog.findMany.mockResolvedValue([{ id: 'a1', tenant_id: 'gone' }]);
            db.tenant.findMany.mockResolvedValue([]);

            const result = await service.query({ timezone: 'Asia/Dhaka', includeTenantName: true });

            expect((result.rows[0] as any).tenant_name).toBeNull();
        });
    });
});
