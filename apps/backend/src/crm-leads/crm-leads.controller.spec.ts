import { INestApplication, CallHandler, ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Reflector } from '@nestjs/core';
import { CrmLeadsController } from './crm-leads.controller';
import { CrmLeadsService } from './crm-leads.service';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { DatabaseService } from '../database/database.service';

describe('CrmLeadsController — subscription guard', () => {
    let app: INestApplication;

    const crmLeadsService = {
        findAll: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 }),
    } as any;

    const db = {
        tenantUser: { findUnique: jest.fn() },
        tenantSubscription: { findUnique: jest.fn() },
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
            controllers: [CrmLeadsController],
            providers: [
                { provide: CrmLeadsService, useValue: crmLeadsService },
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

    it('allows access for PREMIUM plan with premiumCrm feature', async () => {
        db.tenantUser.findUnique.mockResolvedValue({ tenant_id: 'tenant-1', user_id: 'user-1' });
        db.tenantSubscription.findUnique.mockResolvedValue({
            status: 'ACTIVE',
            plan: { code: 'PREMIUM', features_json: { premiumCrm: true } },
        });
        await buildApp();

        const res = await request(app.getHttpServer())
            .get('/crm/leads')
            .set('x-tenant-id', 'tenant-1');

        expect(res.status).not.toBe(403);
    });

    it('blocks STANDARD plan with 403', async () => {
        db.tenantUser.findUnique.mockResolvedValue({ tenant_id: 'tenant-1', user_id: 'user-1' });
        db.tenantSubscription.findUnique.mockResolvedValue({
            status: 'ACTIVE',
            plan: { code: 'STANDARD', features_json: { premiumAccounting: true } },
        });
        await buildApp();

        const res = await request(app.getHttpServer())
            .get('/crm/leads')
            .set('x-tenant-id', 'tenant-1');

        expect(res.status).toBe(403);
    });
});