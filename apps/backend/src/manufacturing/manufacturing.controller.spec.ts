import { INestApplication, CallHandler, ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Reflector } from '@nestjs/core';
import { ManufacturingController } from './manufacturing.controller';
import { ManufacturingService } from './manufacturing.service';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { DatabaseService } from '../database/database.service';
import { PlatformFeatureGuard } from '../platform-settings/platform-feature.guard';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';

describe('ManufacturingController — subscription guard', () => {
    let app: INestApplication;

    const manufacturingService = {
        listBoms: jest.fn().mockResolvedValue([]),
        getBom: jest.fn().mockResolvedValue({}),
        createBom: jest.fn().mockResolvedValue({}),
        updateBom: jest.fn().mockResolvedValue({}),
        deleteBom: jest.fn().mockResolvedValue({}),
        listProductionJobs: jest.fn().mockResolvedValue([]),
        getProductionJob: jest.fn().mockResolvedValue({}),
        createProductionJob: jest.fn().mockResolvedValue({}),
        updateProductionJobStatus: jest.fn().mockResolvedValue({}),
    } as any;

    const db = {
        tenantUser: { findUnique: jest.fn() },
        tenantSubscription: { findUnique: jest.fn() },
        tenantAddonSubscription: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;

    const platformSettings = {
        isFeatureEnabled: jest.fn().mockResolvedValue(true),
    } as any;

    class MockJwtAuthGuard {
        canActivate(context: any) {
            context.switchToHttp().getRequest().user = { userId: 'user-1', email: 'u@example.com' };
            return true;
        }
    }

    class MockTenantInterceptor {
        intercept(_ctx: ExecutionContext, next: CallHandler) { return next.handle(); }
    }

    const buildApp = async () => {
        const module = await Test.createTestingModule({
            controllers: [ManufacturingController],
            providers: [
                { provide: ManufacturingService, useValue: manufacturingService },
                { provide: DatabaseService, useValue: db },
                { provide: PlatformSettingsService, useValue: platformSettings },
                Reflector,
                SubscriptionAccessGuard,
                PlatformFeatureGuard,
            ],
        })
            .overrideGuard(JwtAuthGuard).useClass(MockJwtAuthGuard)
            .overrideInterceptor(TenantInterceptor).useClass(MockTenantInterceptor)
            .compile();

        app = module.createNestApplication();
        await app.init();
        return app;
    };

    afterEach(() => app?.close());

    beforeEach(() => {
        platformSettings.isFeatureEnabled.mockResolvedValue(true);
    });

    it('blocks STANDARD plan subscribers with 403', async () => {
        db.tenantUser.findUnique.mockResolvedValue({ tenant_id: 'tenant-1', user_id: 'user-1' });
        db.tenantSubscription.findUnique.mockResolvedValue({
            status: 'ACTIVE',
            plan: { code: 'STANDARD', features_json: {} },
        });
        await buildApp();

        const res = await request(app.getHttpServer())
            .get('/manufacturing/bom')
            .set('x-tenant-id', 'tenant-1');

        expect(res.status).toBe(403);
    });

    it('allows access for PREMIUM plan', async () => {
        db.tenantUser.findUnique.mockResolvedValue({ tenant_id: 'tenant-1', user_id: 'user-1' });
        db.tenantSubscription.findUnique.mockResolvedValue({
            status: 'ACTIVE',
            plan: { code: 'PREMIUM', features_json: { premiumManufacturing: true } },
        });
        await buildApp();

        const res = await request(app.getHttpServer())
            .get('/manufacturing/bom')
            .set('x-tenant-id', 'tenant-1');

        expect(res.status).not.toBe(403);
    });

    it('blocks BASIC plan subscribers with 403', async () => {
        db.tenantUser.findUnique.mockResolvedValue({ tenant_id: 'tenant-1', user_id: 'user-1' });
        db.tenantSubscription.findUnique.mockResolvedValue({
            status: 'ACTIVE',
            plan: { code: 'BASIC', features_json: {} },
        });
        await buildApp();

        const res = await request(app.getHttpServer())
            .get('/manufacturing/bom')
            .set('x-tenant-id', 'tenant-1');

        expect(res.status).toBe(403);
    });

    it('blocks FREE plan subscribers with 403', async () => {
        db.tenantUser.findUnique.mockResolvedValue({ tenant_id: 'tenant-1', user_id: 'user-1' });
        db.tenantSubscription.findUnique.mockResolvedValue({
            status: 'ACTIVE',
            plan: { code: 'FREE', features_json: {} },
        });
        await buildApp();

        const res = await request(app.getHttpServer())
            .get('/manufacturing/bom')
            .set('x-tenant-id', 'tenant-1');

        expect(res.status).toBe(403);
    });

    it('blocks PAST_DUE subscriptions with 403', async () => {
        db.tenantUser.findUnique.mockResolvedValue({ tenant_id: 'tenant-1', user_id: 'user-1' });
        db.tenantSubscription.findUnique.mockResolvedValue({
            status: 'PAST_DUE',
            plan: { code: 'STANDARD', features_json: {} },
        });
        await buildApp();

        const res = await request(app.getHttpServer())
            .get('/manufacturing/bom')
            .set('x-tenant-id', 'tenant-1');

        expect(res.status).toBe(403);
    });

    it('blocks access with 403 when platform admin disables the manufacturing feature', async () => {
        db.tenantUser.findUnique.mockResolvedValue({ tenant_id: 'tenant-1', user_id: 'user-1' });
        db.tenantSubscription.findUnique.mockResolvedValue({
            status: 'ACTIVE',
            plan: { code: 'PREMIUM', features_json: { premiumManufacturing: true } },
        });
        platformSettings.isFeatureEnabled.mockResolvedValue(false);
        await buildApp();

        const res = await request(app.getHttpServer())
            .get('/manufacturing/bom')
            .set('x-tenant-id', 'tenant-1');

        expect(res.status).toBe(403);
    });

    it('allows a FREE plan tenant with an active Manufacturing add-on', async () => {
        db.tenantUser.findUnique.mockResolvedValue({ tenant_id: 'tenant-1', user_id: 'user-1' });
        db.tenantSubscription.findUnique.mockResolvedValue({
            status: 'ACTIVE',
            plan: { code: 'FREE', features_json: {} },
        });
        db.tenantAddonSubscription.findMany.mockResolvedValueOnce([
            { addon: { features_json: { premiumManufacturing: true } } },
        ]);
        await buildApp();

        const res = await request(app.getHttpServer())
            .get('/manufacturing/bom')
            .set('x-tenant-id', 'tenant-1');

        expect(res.status).not.toBe(403);
    });

    it('blocks a user who is not a member of the requested tenant with 401', async () => {
        db.tenantUser.findUnique.mockResolvedValue(null);
        db.tenantSubscription.findUnique.mockResolvedValue({
            status: 'ACTIVE',
            plan: { code: 'STANDARD', features_json: {} },
        });
        await buildApp();

        const res = await request(app.getHttpServer())
            .get('/manufacturing/bom')
            .set('x-tenant-id', 'tenant-1');

        expect(res.status).toBe(401);
    });
});
