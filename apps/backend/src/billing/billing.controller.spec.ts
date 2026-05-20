import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import supertest from 'supertest';
import { CallHandler, ExecutionContext } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { DatabaseService } from '../database/database.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';

describe('BillingController — webhook integration', () => {
    let app: INestApplication;

    const billingService = {
        getSummary: jest.fn(),
        createCheckoutSession: jest.fn(),
        confirmCheckout: jest.fn(),
        cancelAtPeriodEnd: jest.fn(),
        handleManualWebhook: jest.fn(),
        handleSslWirelessCallback: jest.fn(),
    };

    class MockJwtAuthGuard {
        canActivate(context: any) {
            const req = context.switchToHttp().getRequest();
            req.user = { userId: req.headers['x-user-id'] || 'user-1', email: 'user@test.com' };
            return true;
        }
    }

    class MockTenantInterceptor {
        intercept(context: ExecutionContext, next: CallHandler) {
            const req = context.switchToHttp().getRequest();
            req.tenantId = req.headers['x-tenant-id'] || 'tenant-1';
            return next.handle();
        }
    }

    beforeEach(async () => {
        jest.resetAllMocks();

        const module: TestingModule = await Test.createTestingModule({
            controllers: [BillingController],
            providers: [
                { provide: BillingService, useValue: billingService },
                // Provide a minimal DatabaseService mock so TenantInterceptor can be resolved
                // before the overrideInterceptor takes effect in the DI container
                { provide: DatabaseService, useValue: { tenantUser: { findUnique: jest.fn() } } },
            ],
        })
            .overrideGuard(JwtAuthGuard).useClass(MockJwtAuthGuard)
            .overrideInterceptor(TenantInterceptor).useClass(MockTenantInterceptor)
            .compile();

        app = module.createNestApplication();
        await app.init();
    });

    afterEach(() => app.close());

    describe('POST /billing/webhooks/manual', () => {
        it('activates subscription with a valid webhook secret', async () => {
            billingService.handleManualWebhook.mockResolvedValue({ tenant: { id: 'tenant-1' }, subscription: { status: 'ACTIVE' } });

            await supertest(app.getHttpServer())
                .post('/billing/webhooks/manual')
                .set('x-billing-webhook-secret', 'valid-secret')
                .send({ tenantId: 'tenant-1', planCode: 'PREMIUM' })
                .expect(201);

            expect(billingService.handleManualWebhook).toHaveBeenCalledWith('valid-secret', expect.objectContaining({ tenantId: 'tenant-1' }));
        });

        it('forwards the webhook secret header to the service', async () => {
            billingService.handleManualWebhook.mockResolvedValue({});

            await supertest(app.getHttpServer())
                .post('/billing/webhooks/manual')
                .set('x-billing-webhook-secret', 'test-secret')
                .send({ tenantId: 'tenant-1', planCode: 'BASIC' })
                .expect(201);

            expect(billingService.handleManualWebhook).toHaveBeenCalledWith('test-secret', expect.objectContaining({ planCode: 'BASIC' }));
        });

        it('returns 401 when the billing service rejects an invalid secret', async () => {
            billingService.handleManualWebhook.mockRejectedValue(new UnauthorizedException('Invalid billing webhook secret'));

            await supertest(app.getHttpServer())
                .post('/billing/webhooks/manual')
                .set('x-billing-webhook-secret', 'wrong')
                .send({ tenantId: 'tenant-1', planCode: 'BASIC' })
                .expect(401);
        });
    });

    describe('ALL /billing/webhooks/ssl-wireless (IPN)', () => {
        it('processes IPN notification and returns subscription data', async () => {
            billingService.handleSslWirelessCallback.mockResolvedValue({ tenant: {}, subscription: { status: 'ACTIVE' } });

            await supertest(app.getHttpServer())
                .post('/billing/webhooks/ssl-wireless')
                .send({ tran_id: 'ref-1', val_id: 'val-1', value_a: 'tenant-1', value_b: 'PREMIUM', value_c: 'MONTHLY' })
                .expect(200);

            expect(billingService.handleSslWirelessCallback).toHaveBeenCalledWith(
                expect.objectContaining({ tran_id: 'ref-1', val_id: 'val-1' }),
                'ipn',
            );
        });
    });

    describe('GET /billing/summary', () => {
        it('returns billing summary for the authenticated tenant', async () => {
            billingService.getSummary.mockResolvedValue({ tenant: { id: 'tenant-1' }, subscription: null, available_plans: [] });

            await supertest(app.getHttpServer())
                .get('/billing/summary')
                .set('x-user-id', 'user-1')
                .set('x-tenant-id', 'tenant-1')
                .expect(200);

            expect(billingService.getSummary).toHaveBeenCalledWith('user-1', 'tenant-1');
        });
    });

    describe('POST /billing/checkout-session', () => {
        it('creates a checkout session and returns gateway URL', async () => {
            billingService.createCheckoutSession.mockResolvedValue({
                provider_name: 'ssl-wireless',
                checkout_url: 'https://gateway.example.com',
                amount: 3999,
            });

            await supertest(app.getHttpServer())
                .post('/billing/checkout-session')
                .set('x-user-id', 'user-1')
                .set('x-tenant-id', 'tenant-1')
                .send({ planCode: 'PREMIUM', billingCycle: 'MONTHLY' })
                .expect(201);

            expect(billingService.createCheckoutSession).toHaveBeenCalledWith(
                'user-1', 'tenant-1',
                expect.objectContaining({ planCode: 'PREMIUM', billingCycle: 'MONTHLY' }),
            );
        });
    });

    describe('POST /billing/cancel-at-period-end', () => {
        it('schedules subscription cancellation at period end', async () => {
            billingService.cancelAtPeriodEnd.mockResolvedValue({ cancel_at_period_end: true });

            await supertest(app.getHttpServer())
                .post('/billing/cancel-at-period-end')
                .set('x-user-id', 'user-1')
                .set('x-tenant-id', 'tenant-1')
                .expect(201);

            expect(billingService.cancelAtPeriodEnd).toHaveBeenCalledWith('user-1', 'tenant-1');
        });
    });
});
