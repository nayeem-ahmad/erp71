import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { DatabaseService } from '../database/database.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';

describe('BillingController', () => {
    let controller: BillingController;
    let module: TestingModule;

    const billingService = {
        getSummary: jest.fn(),
        createCheckoutSession: jest.fn(),
        confirmCheckout: jest.fn(),
        cancelAtPeriodEnd: jest.fn(),
        handleManualWebhook: jest.fn(),
        handleSslWirelessCallback: jest.fn(),
    };

    beforeAll(async () => {
        module = await Test.createTestingModule({
            controllers: [BillingController],
            providers: [
                { provide: BillingService, useValue: billingService },
                { provide: DatabaseService, useValue: { tenantUser: { findUnique: jest.fn() } } },
            ],
        })
            .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
            .overrideInterceptor(TenantInterceptor).useValue({ intercept: (_: any, next: any) => next.handle() })
            .compile();

        controller = module.get<BillingController>(BillingController);
    });

    afterAll(async () => {
        await module.close();
    });

    beforeEach(() => {
        jest.resetAllMocks();
    });

    describe('handleManualWebhook', () => {
        it('passes the webhook secret and body to the service', async () => {
            billingService.handleManualWebhook.mockResolvedValue({ tenant: { id: 'tenant-1' }, subscription: { status: 'ACTIVE' } });

            await controller.handleManualWebhook('valid-secret', { tenantId: 'tenant-1', planCode: 'PREMIUM' } as any);

            expect(billingService.handleManualWebhook).toHaveBeenCalledWith(
                'valid-secret',
                expect.objectContaining({ tenantId: 'tenant-1' }),
            );
        });

        it('forwards the webhook secret header to the service', async () => {
            billingService.handleManualWebhook.mockResolvedValue({});

            await controller.handleManualWebhook('test-secret', { tenantId: 'tenant-1', planCode: 'BASIC' } as any);

            expect(billingService.handleManualWebhook).toHaveBeenCalledWith(
                'test-secret',
                expect.objectContaining({ planCode: 'BASIC' }),
            );
        });

        it('propagates UnauthorizedException when the service rejects an invalid secret', async () => {
            billingService.handleManualWebhook.mockRejectedValue(new UnauthorizedException('Invalid billing webhook secret'));

            await expect(
                controller.handleManualWebhook('wrong', { tenantId: 'tenant-1', planCode: 'BASIC' } as any),
            ).rejects.toThrow(UnauthorizedException);
        });
    });

    describe('handleSslWirelessWebhook', () => {
        it('routes IPN notifications to the service with "ipn" mode', async () => {
            billingService.handleSslWirelessCallback.mockResolvedValue({ tenant: {}, subscription: { status: 'ACTIVE' } });
            const payload = { tran_id: 'ref-1', val_id: 'val-1', value_a: 'tenant-1', value_b: 'PREMIUM', value_c: 'MONTHLY' };

            await controller.handleSslWirelessWebhook(payload as any, {} as any);

            expect(billingService.handleSslWirelessCallback).toHaveBeenCalledWith(
                expect.objectContaining({ tran_id: 'ref-1', val_id: 'val-1' }),
                'ipn',
            );
        });
    });

    describe('getSummary', () => {
        it('calls the service with userId and tenantId from the request context', async () => {
            billingService.getSummary.mockResolvedValue({ tenant: { id: 'tenant-1' }, subscription: null, available_plans: [] });

            await controller.getSummary({ user: { userId: 'user-1' } } as any, { tenantId: 'tenant-1' } as any);

            expect(billingService.getSummary).toHaveBeenCalledWith('user-1', 'tenant-1');
        });
    });

    describe('createCheckoutSession', () => {
        it('delegates to the service with userId, tenantId and the checkout DTO', async () => {
            billingService.createCheckoutSession.mockResolvedValue({
                provider_name: 'ssl-wireless',
                checkout_url: 'https://gateway.example.com',
                amount: 3999,
            });

            await controller.createCheckoutSession(
                { user: { userId: 'user-1' } } as any,
                { tenantId: 'tenant-1' } as any,
                { planCode: 'PREMIUM', billingCycle: 'MONTHLY' } as any,
            );

            expect(billingService.createCheckoutSession).toHaveBeenCalledWith(
                'user-1', 'tenant-1',
                expect.objectContaining({ planCode: 'PREMIUM', billingCycle: 'MONTHLY' }),
            );
        });
    });

    describe('cancelAtPeriodEnd', () => {
        it('schedules cancellation via the service', async () => {
            billingService.cancelAtPeriodEnd.mockResolvedValue({ cancel_at_period_end: true });

            await controller.cancelAtPeriodEnd({ user: { userId: 'user-1' } } as any, { tenantId: 'tenant-1' } as any);

            expect(billingService.cancelAtPeriodEnd).toHaveBeenCalledWith('user-1', 'tenant-1');
        });
    });
});
