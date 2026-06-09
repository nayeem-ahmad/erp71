import { BadRequestException, ForbiddenException, InternalServerErrorException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { BillingService } from './billing.service';

describe('BillingService', () => {
    const db = {
        tenantUser: { findUnique: jest.fn(), findFirst: jest.fn() },
        subscriptionPlan: { findMany: jest.fn(), findUnique: jest.fn() },
        tenantSubscription: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() },
        tenant: { findUnique: jest.fn() },
        billingEvent: { findMany: jest.fn(), upsert: jest.fn() },
    } as any;

    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;

    const email = {
        sendBillingInvoice: jest.fn().mockResolvedValue(undefined),
        sendPaymentFailure: jest.fn().mockResolvedValue(undefined),
    } as any;

    let service: BillingService;
    const fetchMock = jest.fn();

    const ownerMembership = {
        role: 'OWNER',
        user: { email: 'owner@example.com' },
    };

    const premiumSubscriptionUpsertResult = {
        status: 'ACTIVE',
        current_period_start: new Date('2026-03-21T00:00:00.000Z'),
        current_period_end: new Date('2026-04-20T00:00:00.000Z'),
        cancel_at_period_end: false,
        provider_name: 'ssl-wireless',
        provider_customer_ref: 'tenant-1',
        provider_subscription_ref: 'bank-ref-1',
        plan: {
            code: 'PREMIUM',
            name: 'Premium',
            description: 'Advanced plan',
            monthly_price: 3999,
            yearly_price: 39990,
            features_json: {},
        },
    };

    beforeEach(() => {
        jest.resetAllMocks();
        audit.log.mockResolvedValue(undefined);
        service = new BillingService(db, audit, email);
        (global as any).fetch = fetchMock;
        process.env.BILLING_PROVIDER = 'SSL_WIRELESS';
        process.env.SSL_WIRELESS_STORE_ID = 'store-id';
        process.env.SSL_WIRELESS_STORE_PASSWORD = 'store-pass';
        process.env.SSL_WIRELESS_API_URL = 'https://sandbox.example.com/init';
        process.env.SSL_WIRELESS_VALIDATION_URL = 'https://sandbox.example.com/validate';
        process.env.FRONTEND_URL = 'http://localhost:3000';
        process.env.BACKEND_PUBLIC_URL = 'http://localhost:4000';
        delete process.env.BILLING_WEBHOOK_SECRET;

        db.tenantUser.findUnique.mockResolvedValue({
            role: 'OWNER',
            tenant: { id: 'tenant-1', name: 'Tenant One' },
            user: { id: 'user-1', email: 'nayeem.ahmad@gmail.com', name: 'Nayeem Ahmad' },
        });
        db.tenantUser.findFirst.mockResolvedValue(ownerMembership);
        db.subscriptionPlan.findMany.mockResolvedValue([]);
        db.subscriptionPlan.findUnique.mockResolvedValue({
            id: 'plan-premium',
            code: 'PREMIUM',
            name: 'Premium',
            description: 'Advanced plan',
            monthly_price: 3999,
            yearly_price: 39990,
            is_active: true,
            features_json: {},
        });
        db.billingEvent.findMany.mockResolvedValue([]);
        db.billingEvent.upsert.mockResolvedValue({ id: 'event-1' });
        db.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', name: 'Tenant One' });
        db.tenantSubscription.upsert.mockResolvedValue(premiumSubscriptionUpsertResult);
    });

    it('creates an SSL Wireless hosted checkout session', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            text: jest.fn().mockResolvedValue(JSON.stringify({
                status: 'SUCCESS',
                GatewayPageURL: 'https://sandbox.sslcommerz.com/gateway',
                sessionkey: 'session-1',
            })),
        });

        const result = await service.createCheckoutSession('user-1', 'tenant-1', {
            planCode: 'PREMIUM',
            billingCycle: 'MONTHLY',
        });

        expect(result.provider_name).toBe('ssl-wireless');
        expect(result.checkout_url).toBe('https://sandbox.sslcommerz.com/gateway');
        expect(db.billingEvent.upsert).toHaveBeenCalled();
    });

    it('bypasses external checkout when selecting Free plan', async () => {
        db.subscriptionPlan.findUnique.mockResolvedValueOnce({
            id: 'plan-free',
            code: 'FREE',
            name: 'Free',
            description: 'Starter plan',
            monthly_price: 0,
            yearly_price: 0,
            is_active: true,
            features_json: {},
        });
        db.tenantSubscription.upsert.mockResolvedValueOnce({
            status: 'ACTIVE',
            current_period_start: new Date('2026-03-21T00:00:00.000Z'),
            current_period_end: new Date('2026-04-20T00:00:00.000Z'),
            cancel_at_period_end: false,
            provider_name: 'manual',
            provider_customer_ref: 'tenant-1',
            provider_subscription_ref: 'free-tenant-1',
            plan: {
                code: 'FREE',
                name: 'Free',
                description: 'Starter plan',
                monthly_price: 0,
                yearly_price: 0,
                features_json: {},
            },
        });

        const result = await service.createCheckoutSession('user-1', 'tenant-1', {
            planCode: 'FREE',
            billingCycle: 'MONTHLY',
        });

        expect(result.requires_confirmation).toBe(false);
        expect(result.amount).toBe(0);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects invalid manual webhook signatures', async () => {
        await expect(service.handleManualWebhook('wrong-secret', {
            tenantId: 'tenant-1',
            planCode: 'PREMIUM',
        })).rejects.toThrow(UnauthorizedException);
    });

    it('updates subscription after SSL Wireless success validation', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            text: jest.fn().mockResolvedValue(JSON.stringify({
                status: 'VALID',
                tran_id: 'sslw_tenant_1',
                val_id: 'val-1',
                bank_tran_id: 'bank-ref-1',
                amount: '3999.00',
                currency: 'BDT',
                value_a: 'tenant-1',
            })),
        });

        const redirectUrl = await service.handleSslWirelessCallback({
            tran_id: 'sslw_tenant_1',
            val_id: 'val-1',
            value_a: 'tenant-1',
            value_b: 'PREMIUM',
            value_c: 'MONTHLY',
        }, 'success');

        expect(db.tenantSubscription.upsert).toHaveBeenCalled();
        expect(redirectUrl).toContain('paymentStatus=success');
    });

    it('marks failed SSL Wireless callbacks as non-active', async () => {
        const redirectUrl = await service.handleSslWirelessCallback({
            tran_id: 'sslw_tenant_1',
            value_a: 'tenant-1',
            value_b: 'PREMIUM',
            value_c: 'MONTHLY',
        }, 'fail');

        expect(db.tenantSubscription.upsert).toHaveBeenCalledWith(expect.objectContaining({
            update: expect.objectContaining({ status: 'PAST_DUE' }),
            create: expect.objectContaining({ status: 'PAST_DUE' }),
        }));
        expect(redirectUrl).toContain('paymentStatus=failed');
    });

    it('throws when SSL Wireless validation lacks a val_id', async () => {
        await expect(service.handleSslWirelessCallback({
            tran_id: 'sslw_tenant_1',
            value_a: 'tenant-1',
            value_b: 'PREMIUM',
            value_c: 'MONTHLY',
        }, 'success')).rejects.toThrow(BadRequestException);
    });

    it('processes SSL Wireless IPN webhook and updates subscription', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            text: jest.fn().mockResolvedValue(JSON.stringify({
                status: 'VALID',
                tran_id: 'sslw_ipn_ref',
                val_id: 'val-ipn',
                bank_tran_id: 'bank-ipn-1',
                amount: '3999.00',
                currency: 'BDT',
                value_a: 'tenant-1',
            })),
        });

        const result = await service.handleSslWirelessCallback({
            tran_id: 'sslw_ipn_ref',
            val_id: 'val-ipn',
            value_a: 'tenant-1',
            value_b: 'PREMIUM',
            value_c: 'MONTHLY',
        }, 'ipn');

        expect(db.tenantSubscription.upsert).toHaveBeenCalledWith(expect.objectContaining({
            update: expect.objectContaining({ status: 'ACTIVE' }),
        }));
        expect(result).toHaveProperty('subscription');
    });

    it('records cancel callback and marks subscription as CANCELLED', async () => {
        const redirectUrl = await service.handleSslWirelessCallback({
            tran_id: 'sslw_tenant_cancel',
            value_a: 'tenant-1',
            value_b: 'PREMIUM',
            value_c: 'MONTHLY',
        }, 'cancel');

        expect(db.tenantSubscription.upsert).toHaveBeenCalledWith(expect.objectContaining({
            update: expect.objectContaining({ status: 'CANCELLED' }),
            create: expect.objectContaining({ status: 'CANCELLED' }),
        }));
        expect(redirectUrl).toContain('paymentStatus=cancel');
    });

    it('applies subscription change with valid manual webhook secret', async () => {
        process.env.BILLING_WEBHOOK_SECRET = 'my-secret';

        const result = await service.handleManualWebhook('my-secret', {
            tenantId: 'tenant-1',
            planCode: 'PREMIUM',
            status: 'ACTIVE',
            billingCycle: 'YEARLY',
        });

        expect(db.tenantSubscription.upsert).toHaveBeenCalledWith(expect.objectContaining({
            update: expect.objectContaining({ status: 'ACTIVE' }),
        }));
        expect(result).toHaveProperty('subscription');
    });

    it('returns billing summary with subscription and available plans', async () => {
        db.subscriptionPlan.findMany.mockResolvedValueOnce([
            { id: 'plan-basic', code: 'BASIC', name: 'Basic', description: 'Entry', monthly_price: 999, yearly_price: 9990, features_json: {} },
        ]);
        db.tenantSubscription.findUnique.mockResolvedValueOnce({
            status: 'ACTIVE',
            current_period_start: new Date('2026-03-21T00:00:00Z'),
            current_period_end: new Date('2026-04-20T00:00:00Z'),
            cancel_at_period_end: false,
            provider_name: 'manual',
            provider_customer_ref: 'tenant-1',
            provider_subscription_ref: 'manual-ref',
            plan: { code: 'BASIC', name: 'Basic', description: 'Entry', monthly_price: 999, yearly_price: 9990, features_json: {} },
        });

        const result = await service.getSummary('user-1', 'tenant-1');

        expect(result.can_manage_billing).toBe(true);
        expect(result.subscription).not.toBeNull();
        expect(result.available_plans).toHaveLength(1);
        expect(result.billing_history).toEqual([]);
    });

    it('cancels subscription at period end', async () => {
        db.tenantSubscription.findUnique.mockResolvedValueOnce({
            status: 'ACTIVE',
            plan: { code: 'PREMIUM', name: 'Premium', description: 'Advanced', monthly_price: 3999, yearly_price: 39990, features_json: {} },
        });
        db.tenantSubscription.update.mockResolvedValueOnce({
            status: 'ACTIVE',
            current_period_start: new Date('2026-03-21T00:00:00Z'),
            current_period_end: new Date('2026-04-20T00:00:00Z'),
            cancel_at_period_end: true,
            provider_name: 'ssl-wireless',
            provider_customer_ref: 'tenant-1',
            provider_subscription_ref: 'bank-ref-1',
            plan: { code: 'PREMIUM', name: 'Premium', description: 'Advanced', monthly_price: 3999, yearly_price: 39990, features_json: {} },
        });

        const result = await service.cancelAtPeriodEnd('user-1', 'tenant-1');

        expect(db.tenantSubscription.update).toHaveBeenCalledWith(expect.objectContaining({
            data: { cancel_at_period_end: true },
        }));
        expect(result?.cancel_at_period_end).toBe(true);
    });

    it('throws NotFoundException when cancelling with no subscription', async () => {
        db.tenantSubscription.findUnique.mockResolvedValueOnce(null);

        await expect(service.cancelAtPeriodEnd('user-1', 'tenant-1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when applying subscription for unknown tenant', async () => {
        db.tenant.findUnique.mockResolvedValueOnce(null);

        await expect(service.applySubscriptionChange({
            tenantId: 'ghost-tenant',
            planCode: 'BASIC',
        })).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when SSL Wireless credentials are missing for checkout', async () => {
        delete process.env.SSL_WIRELESS_STORE_ID;
        delete process.env.SSL_WIRELESS_STORE_PASSWORD;

        await expect(service.createCheckoutSession('user-1', 'tenant-1', {
            planCode: 'PREMIUM',
            billingCycle: 'MONTHLY',
        })).rejects.toThrow(BadRequestException);
    });

    it('throws when SSL Wireless gateway returns an error response', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: false,
            text: jest.fn().mockResolvedValue(JSON.stringify({
                status: 'FAILED',
                failedreason: 'Invalid credentials',
            })),
        });

        await expect(service.createCheckoutSession('user-1', 'tenant-1', {
            planCode: 'PREMIUM',
            billingCycle: 'MONTHLY',
        })).rejects.toThrow(InternalServerErrorException);
    });

    it('throws when SSL Wireless transaction reference mismatches during validation', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            text: jest.fn().mockResolvedValue(JSON.stringify({
                status: 'VALID',
                tran_id: 'different-ref',
                val_id: 'val-mismatch',
                amount: '3999.00',
                currency: 'BDT',
            })),
        });

        await expect(service.handleSslWirelessCallback({
            tran_id: 'sslw_original_ref',
            val_id: 'val-mismatch',
            value_a: 'tenant-1',
            value_b: 'PREMIUM',
            value_c: 'MONTHLY',
        }, 'success')).rejects.toThrow(BadRequestException);
    });

    it('creates yearly billing cycle checkout correctly', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            text: jest.fn().mockResolvedValue(JSON.stringify({
                status: 'SUCCESS',
                GatewayPageURL: 'https://sandbox.sslcommerz.com/gateway',
                sessionkey: 'session-yearly',
            })),
        });

        const result = await service.createCheckoutSession('user-1', 'tenant-1', {
            planCode: 'PREMIUM',
            billingCycle: 'YEARLY',
        });

        expect(result.billing_cycle).toBe('YEARLY');
        expect(result.amount).toBe(39990);
    });

    it('rejects checkout when tenant user is not a billing manager', async () => {
        db.tenantUser.findUnique.mockResolvedValueOnce({
            role: 'CASHIER',
            tenant: { id: 'tenant-1', name: 'Tenant One' },
            user: { id: 'user-cashier', email: 'cashier@example.com', name: 'Cashier' },
        });

        await expect(service.createCheckoutSession('user-cashier', 'tenant-1', {
            planCode: 'PREMIUM',
        })).rejects.toThrow(ForbiddenException);
    });

    it('confirms manual checkout and activates subscription', async () => {
        const result = await service.confirmCheckout('user-1', 'tenant-1', {
            planCode: 'PREMIUM',
            billingCycle: 'MONTHLY',
            reference: 'manual_ref_123',
        });

        expect(db.tenantSubscription.upsert).toHaveBeenCalledWith(expect.objectContaining({
            update: expect.objectContaining({
                provider_name: 'manual',
                provider_subscription_ref: 'manual_ref_123',
            }),
        }));
        expect(result).toHaveProperty('subscription');
    });

    // --- Transactional email tests ---

    it('sends billing invoice email after successful paid plan activation', async () => {
        await service.applySubscriptionChange({
            tenantId: 'tenant-1',
            planCode: 'PREMIUM',
            billingCycle: 'MONTHLY',
            status: 'ACTIVE',
        });

        // Allow the fire-and-forget promise to settle
        await new Promise(process.nextTick);

        expect(db.tenantUser.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: { tenant_id: 'tenant-1', role: 'OWNER' },
        }));
        expect(email.sendBillingInvoice).toHaveBeenCalledWith(
            'owner@example.com',
            'Tenant One',
            3999,
            'BDT',
        );
        expect(email.sendPaymentFailure).not.toHaveBeenCalled();
    });

    it('sends billing invoice with yearly amount for YEARLY billing cycle', async () => {
        await service.applySubscriptionChange({
            tenantId: 'tenant-1',
            planCode: 'PREMIUM',
            billingCycle: 'YEARLY',
            status: 'ACTIVE',
        });

        await new Promise(process.nextTick);

        expect(email.sendBillingInvoice).toHaveBeenCalledWith(
            'owner@example.com',
            'Tenant One',
            39990,
            'BDT',
        );
    });

    it('sends payment failure email when subscription becomes PAST_DUE', async () => {
        db.tenantSubscription.upsert.mockResolvedValueOnce({
            ...premiumSubscriptionUpsertResult,
            status: 'PAST_DUE',
        });

        await service.applySubscriptionChange({
            tenantId: 'tenant-1',
            planCode: 'PREMIUM',
            billingCycle: 'MONTHLY',
            status: 'PAST_DUE',
        });

        await new Promise(process.nextTick);

        expect(email.sendPaymentFailure).toHaveBeenCalledWith(
            'owner@example.com',
            'Tenant One',
            3999,
            'BDT',
        );
        expect(email.sendBillingInvoice).not.toHaveBeenCalled();
    });

    it('does not send invoice email for FREE plan activation', async () => {
        db.subscriptionPlan.findUnique.mockResolvedValueOnce({
            id: 'plan-free',
            code: 'FREE',
            name: 'Free',
            description: 'Starter',
            monthly_price: 0,
            yearly_price: 0,
            is_active: true,
            features_json: {},
        });
        db.tenantSubscription.upsert.mockResolvedValueOnce({
            ...premiumSubscriptionUpsertResult,
            plan: { code: 'FREE', name: 'Free', description: 'Starter', monthly_price: 0, yearly_price: 0, features_json: {} },
        });

        await service.applySubscriptionChange({
            tenantId: 'tenant-1',
            planCode: 'FREE',
            status: 'ACTIVE',
        });

        await new Promise(process.nextTick);

        expect(email.sendBillingInvoice).not.toHaveBeenCalled();
        expect(email.sendPaymentFailure).not.toHaveBeenCalled();
    });

    it('does not send email when no tenant owner is found', async () => {
        db.tenantUser.findFirst.mockResolvedValueOnce(null);

        await service.applySubscriptionChange({
            tenantId: 'tenant-1',
            planCode: 'PREMIUM',
            status: 'ACTIVE',
        });

        await new Promise(process.nextTick);

        expect(email.sendBillingInvoice).not.toHaveBeenCalled();
    });

    it('does not send email when owner has no email address', async () => {
        db.tenantUser.findFirst.mockResolvedValueOnce({ role: 'OWNER', user: { email: null } });

        await service.applySubscriptionChange({
            tenantId: 'tenant-1',
            planCode: 'PREMIUM',
            status: 'ACTIVE',
        });

        await new Promise(process.nextTick);

        expect(email.sendBillingInvoice).not.toHaveBeenCalled();
    });

    it('does not send email for CANCELLED or TRIALING status', async () => {
        db.tenantSubscription.upsert.mockResolvedValueOnce({
            ...premiumSubscriptionUpsertResult,
            status: 'CANCELLED',
        });

        await service.applySubscriptionChange({
            tenantId: 'tenant-1',
            planCode: 'PREMIUM',
            status: 'CANCELLED',
        });

        await new Promise(process.nextTick);

        expect(email.sendBillingInvoice).not.toHaveBeenCalled();
        expect(email.sendPaymentFailure).not.toHaveBeenCalled();
    });

    it('sends invoice email after SSL Wireless IPN confirms payment', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            text: jest.fn().mockResolvedValue(JSON.stringify({
                status: 'VALID',
                tran_id: 'sslw_ipn_ref',
                val_id: 'val-ipn',
                bank_tran_id: 'bank-ipn-1',
                amount: '3999.00',
                currency: 'BDT',
                value_a: 'tenant-1',
            })),
        });

        await service.handleSslWirelessCallback({
            tran_id: 'sslw_ipn_ref',
            val_id: 'val-ipn',
            value_a: 'tenant-1',
            value_b: 'PREMIUM',
            value_c: 'MONTHLY',
        }, 'ipn');

        await new Promise(process.nextTick);

        expect(email.sendBillingInvoice).toHaveBeenCalledWith(
            'owner@example.com',
            'Tenant One',
            3999,
            'BDT',
        );
    });

    it('sends payment failure email after SSL Wireless fail callback', async () => {
        db.tenantSubscription.upsert.mockResolvedValueOnce({
            ...premiumSubscriptionUpsertResult,
            status: 'PAST_DUE',
        });

        await service.handleSslWirelessCallback({
            tran_id: 'sslw_tenant_fail',
            value_a: 'tenant-1',
            value_b: 'PREMIUM',
            value_c: 'MONTHLY',
        }, 'fail');

        await new Promise(process.nextTick);

        expect(email.sendPaymentFailure).toHaveBeenCalledWith(
            'owner@example.com',
            'Tenant One',
            3999,
            'BDT',
        );
    });
});
