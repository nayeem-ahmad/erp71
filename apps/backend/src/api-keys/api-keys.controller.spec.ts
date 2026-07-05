import { INestApplication, CallHandler, ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Reflector } from '@nestjs/core';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { DatabaseService } from '../database/database.service';

describe('ApiKeysController — subscription guard', () => {
    let app: INestApplication;

    const apiKeysService = {
        listKeys: jest.fn().mockResolvedValue([]),
        createKey: jest.fn().mockResolvedValue({ id: 'key-1', name: 'Test', keyPreview: 'sk_...abc' }),
        revokeKey: jest.fn().mockResolvedValue({}),
    } as any;

    const db = {
        tenantUser: { findUnique: jest.fn() },
        tenantSubscription: { findUnique: jest.fn() },
        tenantAddonSubscription: { findMany: jest.fn().mockResolvedValue([]) },
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
            controllers: [ApiKeysController],
            providers: [
                { provide: ApiKeysService, useValue: apiKeysService },
                { provide: DatabaseService, useValue: db },
                Reflector,
                SubscriptionAccessGuard,
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

    it('allows access for PREMIUM plan with apiAccess feature', async () => {
        db.tenantUser.findUnique.mockResolvedValue({ tenant_id: 'tenant-1', user_id: 'user-1' });
        db.tenantSubscription.findUnique.mockResolvedValue({
            status: 'ACTIVE',
            plan: { code: 'PREMIUM', features_json: { apiAccess: true } },
        });
        await buildApp();

        const res = await request(app.getHttpServer())
            .get('/api-keys')
            .set('x-tenant-id', 'tenant-1');

        expect(res.status).not.toBe(403);
    });

    it('blocks STANDARD plan (no apiAccess feature) with 403', async () => {
        db.tenantUser.findUnique.mockResolvedValue({ tenant_id: 'tenant-1', user_id: 'user-1' });
        db.tenantSubscription.findUnique.mockResolvedValue({
            status: 'ACTIVE',
            plan: { code: 'STANDARD', features_json: { premiumAccounting: true } },
        });
        await buildApp();

        const res = await request(app.getHttpServer())
            .get('/api-keys')
            .set('x-tenant-id', 'tenant-1');

        expect(res.status).toBe(403);
    });

    it('blocks BASIC plan with 403', async () => {
        db.tenantUser.findUnique.mockResolvedValue({ tenant_id: 'tenant-1', user_id: 'user-1' });
        db.tenantSubscription.findUnique.mockResolvedValue({
            status: 'ACTIVE',
            plan: { code: 'BASIC', features_json: {} },
        });
        await buildApp();

        const res = await request(app.getHttpServer())
            .get('/api-keys')
            .set('x-tenant-id', 'tenant-1');

        expect(res.status).toBe(403);
    });

    it('blocks PAST_DUE subscriptions even with PREMIUM plan with 403', async () => {
        db.tenantUser.findUnique.mockResolvedValue({ tenant_id: 'tenant-1', user_id: 'user-1' });
        db.tenantSubscription.findUnique.mockResolvedValue({
            status: 'PAST_DUE',
            plan: { code: 'PREMIUM', features_json: { apiAccess: true } },
        });
        await buildApp();

        const res = await request(app.getHttpServer())
            .get('/api-keys')
            .set('x-tenant-id', 'tenant-1');

        expect(res.status).toBe(403);
    });

    it('blocks a user who is not a member of the requested tenant with 401', async () => {
        db.tenantUser.findUnique.mockResolvedValue(null);
        db.tenantSubscription.findUnique.mockResolvedValue({
            status: 'ACTIVE',
            plan: { code: 'PREMIUM', features_json: { apiAccess: true } },
        });
        await buildApp();

        const res = await request(app.getHttpServer())
            .get('/api-keys')
            .set('x-tenant-id', 'tenant-1');

        expect(res.status).toBe(401);
    });
});
