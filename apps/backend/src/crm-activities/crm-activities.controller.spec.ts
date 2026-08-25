import { INestApplication, CallHandler, ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CrmActivitiesController } from './crm-activities.controller';
import { CrmActivitiesService } from './crm-activities.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';

/**
 * The list filters reach the service by @Query name. A rename on one side only
 * is invisible to the service spec — the request simply arrives with the filter
 * unset and every activity comes back — so the wiring is asserted here.
 */
describe('CrmActivitiesController — list query wiring', () => {
    let app: INestApplication;

    const service = {
        findAll: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20, pages: 0 }),
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
});
