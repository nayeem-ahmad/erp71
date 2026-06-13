import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { BillingController } from '../src/billing/billing.controller';
import { BillingService } from '../src/billing/billing.service';
import { DatabaseService } from '../src/database/database.service';
import { AuditService } from '../src/audit/audit.service';
import { EmailService } from '../src/email/email.service';
import { CircuitBreakerRegistry } from '../src/system-health/resilience/circuit-breaker.registry';
import { TransformInterceptor } from '../src/common/transform.interceptor';

describe('Billing webhooks (HTTP)', () => {
    let app: INestApplication;
    const db = {
        tenantUser: { findUnique: jest.fn() },
        subscriptionPlan: { findMany: jest.fn(), findUnique: jest.fn() },
        tenantSubscription: { findUnique: jest.fn(), upsert: jest.fn() },
        tenant: { findUnique: jest.fn() },
        billingEvent: { findMany: jest.fn(), findUnique: jest.fn(), upsert: jest.fn() },
    } as any;

    beforeAll(async () => {
        process.env.BILLING_WEBHOOK_SECRET = 'test-webhook-secret';
        const moduleRef = await Test.createTestingModule({
            controllers: [BillingController],
            providers: [
                BillingService,
                { provide: DatabaseService, useValue: db },
                { provide: AuditService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
                { provide: EmailService, useValue: { sendBillingInvoice: jest.fn(), sendPaymentFailure: jest.fn() } },
                CircuitBreakerRegistry,
            ],
        }).compile();

        app = moduleRef.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
        app.useGlobalInterceptors(new TransformInterceptor());
        await app.init();

        db.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', name: 'Tenant One' });
        db.subscriptionPlan.findUnique.mockResolvedValue({
            id: 'plan-basic',
            code: 'BASIC',
            name: 'Basic',
            monthly_price: 999,
            yearly_price: 9990,
            is_active: true,
            features_json: {},
        });
        db.tenantSubscription.upsert.mockResolvedValue({
            status: 'ACTIVE',
            current_period_start: new Date(),
            current_period_end: new Date(),
            cancel_at_period_end: false,
            provider_name: 'manual',
            plan: { code: 'BASIC', name: 'Basic', monthly_price: 999, yearly_price: 9990, features_json: {} },
        });
        db.billingEvent.findUnique.mockResolvedValue(null);
        db.billingEvent.upsert.mockResolvedValue({ id: 'event-1' });
    });

    afterAll(async () => {
        await app?.close();
    });

    it('rejects manual webhooks without the shared secret', async () => {
        await request(app.getHttpServer())
            .post('/billing/webhooks/manual')
            .send({ tenantId: 'tenant-1', planCode: 'BASIC' })
            .expect(401);
    });

    it('accepts manual webhooks with idempotency key', async () => {
        const response = await request(app.getHttpServer())
            .post('/billing/webhooks/manual')
            .set('x-billing-webhook-secret', 'test-webhook-secret')
            .send({
                tenantId: 'tenant-1',
                planCode: 'BASIC',
                status: 'ACTIVE',
                externalEventId: 'manual:event-http-1',
            });

        expect([200, 201]).toContain(response.status);
        expect(response.body.data).toHaveProperty('subscription');
        expect(db.billingEvent.upsert).toHaveBeenCalled();
    });
});