import { INestApplication, CallHandler, ExecutionContext, CanActivate } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { StorePermission } from '@erp71/shared-types';
import { CrmActivitiesController } from './crm-activities.controller';
import { CrmActivitiesService } from './crm-activities.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { STORE_PERMISSIONS_KEY } from '../auth/store-permission.decorator';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { DatabaseService } from '../database/database.service';
import { AuthCacheService } from '../database/auth-cache.service';

/**
 * The list filters reach the service by @Query name. A rename on one side only
 * is invisible to the service spec — the request simply arrives with the filter
 * unset and every activity comes back — so the wiring is asserted here.
 */
describe('CrmActivitiesController — list query wiring', () => {
    let app: INestApplication;

    const service = {
        findAll: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20, pages: 0 }),
        setApproval: jest.fn().mockResolvedValue({ id: 'a1', is_approved: true }),
        summary: jest.fn().mockResolvedValue({ dueToday: 0, overdue: 0, total: 0 }),
        approvalsInbox: jest.fn().mockResolvedValue({ items: [] }),
    } as any;

    class AllowAll {
        canActivate() { return true; }
    }

    class MockTenantInterceptor {
        intercept(ctx: ExecutionContext, next: CallHandler) {
            const req = ctx.switchToHttp().getRequest();
            req.tenantId = 'tenant-1';
            req.user = { userId: 'user-1' };
            return next.handle();
        }
    }

    beforeEach(async () => {
        service.findAll.mockClear();
        service.setApproval.mockClear();
        service.summary.mockClear();
        service.approvalsInbox.mockClear();
        const module = await Test.createTestingModule({
            controllers: [CrmActivitiesController],
            providers: [{ provide: CrmActivitiesService, useValue: service }],
        })
            .overrideGuard(JwtAuthGuard).useClass(AllowAll)
            .overrideGuard(StorePermissionGuard).useClass(AllowAll)
            .overrideGuard(SubscriptionAccessGuard).useClass(AllowAll)
            .overrideInterceptor(TenantInterceptor).useClass(MockTenantInterceptor)
            .compile();

        app = module.createNestApplication();
        await app.init();
    });

    afterEach(() => app?.close());

    it('passes the lead owner filter through', async () => {
        await request(app.getHttpServer()).get('/crm/activities?leadOwner=user-9').expect(200);

        expect(service.findAll).toHaveBeenCalledWith(
            'tenant-1',
            expect.objectContaining({ leadOwner: 'user-9' }),
        );
    });

    it('passes the due date range through', async () => {
        await request(app.getHttpServer())
            .get('/crm/activities?dueFrom=2026-08-01&dueTo=2026-08-25')
            .expect(200);

        expect(service.findAll).toHaveBeenCalledWith(
            'tenant-1',
            expect.objectContaining({ dueFrom: '2026-08-01', dueTo: '2026-08-25' }),
        );
    });

    it('passes the activity assignee filter through', async () => {
        await request(app.getHttpServer()).get('/crm/activities?assignedTo=user-3').expect(200);

        expect(service.findAll).toHaveBeenCalledWith(
            'tenant-1',
            expect.objectContaining({ assignedTo: 'user-3' }),
        );
    });

    it('passes the approval filter through', async () => {
        await request(app.getHttpServer()).get('/crm/activities?approval=pending').expect(200);

        expect(service.findAll).toHaveBeenCalledWith(
            'tenant-1',
            expect.objectContaining({ approval: 'pending' }),
        );
    });

    it('routes the approval switch to setApproval with the reviewer', async () => {
        await request(app.getHttpServer())
            .patch('/crm/activities/a1/approval')
            .send({ approved: true })
            .expect(200);

        expect(service.setApproval).toHaveBeenCalledWith('tenant-1', 'user-1', 'a1', true);
    });

    /**
     * The "only mine" scope. The caller's id is resolved here rather than sent,
     * so these assert that the session's user — not the query string — is what
     * reaches the service.
     */
    it('resolves mine=true to the caller own id', async () => {
        await request(app.getHttpServer()).get('/crm/activities?mine=true').expect(200);

        expect(service.findAll).toHaveBeenCalledWith(
            'tenant-1',
            expect.objectContaining({ assignedTo: 'user-1' }),
        );
    });

    it('lets the scope override a stale assignee filter', async () => {
        await request(app.getHttpServer())
            .get('/crm/activities?mine=true&assignedTo=user-3')
            .expect(200);

        expect(service.findAll).toHaveBeenCalledWith(
            'tenant-1',
            expect.objectContaining({ assignedTo: 'user-1' }),
        );
    });

    it('leaves the assignee alone for anything but the literal true', async () => {
        await request(app.getHttpServer())
            .get('/crm/activities?mine=false&assignedTo=user-3')
            .expect(200);

        expect(service.findAll).toHaveBeenCalledWith(
            'tenant-1',
            expect.objectContaining({ assignedTo: 'user-3' }),
        );
    });

    it('scopes the summary tiles the same way, so they cannot disagree with the list', async () => {
        await request(app.getHttpServer()).get('/crm/activities/summary?mine=true').expect(200);

        expect(service.summary).toHaveBeenCalledWith('tenant-1', expect.any(String), 'user-1');
    });

    it('loads the approvals inbox for the caller tenant', async () => {
        await request(app.getHttpServer()).get('/crm/activities/approvals-inbox').expect(200);

        expect(service.approvalsInbox).toHaveBeenCalledWith('tenant-1', expect.any(String));
    });

    it('leaves the summary tiles counting everybody when the scope is off', async () => {
        await request(app.getHttpServer()).get('/crm/activities/summary').expect(200);

        expect(service.summary).toHaveBeenCalledWith('tenant-1', expect.any(String), undefined);
    });

    it('passes the caller through when an activity is edited', async () => {
        service.update = jest.fn().mockResolvedValue({ id: 'a1' });

        await request(app.getHttpServer())
            .patch('/crm/activities/a1')
            .send({ notes: 'Corrected the note' })
            .expect(200);

        expect(service.update).toHaveBeenCalledWith(
            'tenant-1',
            'a1',
            { notes: 'Corrected the note' },
            expect.any(String),
            'user-1',
        );
    });
});

/**
 * The edit route keeps the permission it already had for planned work.
 * A member who can view CRM but cannot manage tasks is refused before the
 * service runs, and a caller who is not in the business named by the header
 * is refused the same way.
 */
describe('CrmActivitiesController — edit authorization', () => {
    let app: INestApplication;
    const service = { update: jest.fn() };
    const db = {
        $queryRaw: jest.fn(),
        userStorePermission: { findMany: jest.fn() },
        userStoreAccess: { findMany: jest.fn() },
    };

    class StampUser implements CanActivate {
        canActivate(ctx: ExecutionContext) {
            const req = ctx.switchToHttp().getRequest();
            req.user = { userId: 'user-1' };
            return true;
        }
    }

    class AllowAll implements CanActivate {
        canActivate() { return true; }
    }

    const membership = (role: string) => [{
        tenant_id: 'tenant-1',
        user_id: 'user-1',
        role,
        tenant_deleted_at: null,
        tenant_timezone: 'Asia/Dhaka',
        roles: [],
    }];

    beforeEach(async () => {
        service.update.mockReset();
        db.$queryRaw.mockReset();
        db.userStorePermission.findMany.mockReset();
        db.userStoreAccess.findMany.mockReset();

        const module = await Test.createTestingModule({
            controllers: [CrmActivitiesController],
            providers: [
                { provide: CrmActivitiesService, useValue: service },
                { provide: DatabaseService, useValue: db },
                { provide: AuthCacheService, useValue: new AuthCacheService({ ttlMs: 0 }) },
                StorePermissionGuard,
            ],
        })
            .overrideGuard(JwtAuthGuard).useClass(StampUser)
            .overrideGuard(SubscriptionAccessGuard).useClass(AllowAll)
            .overrideInterceptor(TenantInterceptor).useValue({ intercept: (_ctx: ExecutionContext, next: CallHandler) => next.handle() })
            .compile();

        app = module.createNestApplication();
        await app.init();
    });

    afterEach(() => app?.close());

    it('keeps PATCH behind MANAGE_CRM_TASKS, the same permission as editing a plan', () => {
        expect(Reflect.getMetadata(STORE_PERMISSIONS_KEY, CrmActivitiesController.prototype.update)).toEqual([
            StorePermission.MANAGE_CRM_TASKS,
        ]);
    });

    it('403s a member who can view CRM but cannot manage tasks', async () => {
        db.$queryRaw.mockResolvedValue(membership('CASHIER'));
        db.userStoreAccess.findMany.mockResolvedValue([{ store_id: 'store-1', access_level: 'FULL' }]);
        db.userStorePermission.findMany.mockResolvedValue([
            { store_id: 'store-1', permission: StorePermission.VIEW_CRM_INTERACTIONS },
        ]);

        await request(app.getHttpServer())
            .patch('/crm/activities/a1')
            .set('x-tenant-id', 'tenant-1')
            .send({ notes: 'should not land' })
            .expect(403);

        expect(service.update).not.toHaveBeenCalled();
    });

    it('lets a member who can manage tasks through to the service', async () => {
        db.$queryRaw.mockResolvedValue(membership('CASHIER'));
        db.userStoreAccess.findMany.mockResolvedValue([{ store_id: 'store-1', access_level: 'FULL' }]);
        db.userStorePermission.findMany.mockResolvedValue([
            { store_id: 'store-1', permission: StorePermission.MANAGE_CRM_TASKS },
        ]);
        service.update.mockResolvedValue({ id: 'a1', status: 'DONE' });

        await request(app.getHttpServer())
            .patch('/crm/activities/a1')
            .set('x-tenant-id', 'tenant-1')
            .send({ notes: 'Corrected' })
            .expect(200);

        expect(service.update).toHaveBeenCalled();
    });

    it('403s a caller who is not a member of the business in the header', async () => {
        db.$queryRaw.mockResolvedValue([]);

        await request(app.getHttpServer())
            .patch('/crm/activities/a1')
            .set('x-tenant-id', 'other-business')
            .send({ notes: 'cross' })
            .expect(403);

        expect(service.update).not.toHaveBeenCalled();
    });
});
