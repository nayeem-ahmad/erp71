import { BadRequestException, ForbiddenException, InternalServerErrorException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { BillingService } from './billing.service';
import { CircuitBreakerRegistry } from '../system-health/resilience/circuit-breaker.registry';
import { TenantContext } from '../database/tenant.decorator';

const tenantCtx = (overrides: Partial<TenantContext> = {}): TenantContext => ({ timezone: 'Asia/Dhaka',
    tenantId: 'tenant-1',
    userId: 'user-1',
    userRole: 'OWNER',
    storeId: 'store-1',
    ...overrides,
});

describe('BillingService', () => {
    const db = {
        tenantUser: { findUnique: jest.fn(), findFirst: jest.fn() },
        subscriptionPlan: { findMany: jest.fn(), findUnique: jest.fn() },
        tenantSubscription: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() },
        tenant: { findUnique: jest.fn() },
        billingEvent: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), upsert: jest.fn() },
        userStorePermission: { findFirst: jest.fn() },
        referralSignup: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() },
    } as any;

    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;

    const email = {
        sendBillingInvoice: jest.fn().mockResolvedValue(undefined),
        sendPaymentFailure: jest.fn().mockResolvedValue(undefined),
        sendRefereeCommissionEarned: jest.fn().mockResolvedValue(undefined),
    } as any;

    const notifications = {
        create: jest.fn().mockResolvedValue({ id: 'n-1' }),
    } as any;

    const addonModules = {
        getActiveAddonsByCodes: jest.fn().mockResolvedValue([]),
        grantOrRenewSubscription: jest.fn().mockResolvedValue(undefined),
    } as any;

    let service: BillingService;
    const fetchMock = jest.fn();

    const ownerMembership = {
        role: 'OWNER',
        user: { id: 'owner-user-1', email: 'owner@example.com' },
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
        addonModules.getActiveAddonsByCodes.mockResolvedValue([]);
        addonModules.grantOrRenewSubscription.mockResolvedValue(undefined);
        email.sendRefereeCommissionEarned.mockResolvedValue(undefined);
        service = new BillingService(db, audit, email, notifications, addonModules, new CircuitBreakerRegistry());
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
        db.billingEvent.findUnique.mockResolvedValue(null);
        db.billingEvent.upsert.mockResolvedValue({ id: 'event-1' });
        db.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', name: 'Tenant One' });
        db.tenantSubscription.upsert.mockResolvedValue(premiumSubscriptionUpsertResult);
        // Default: this tenant was not referred. jest.resetAllMocks() above clears the
        // implementation declared on the mock, so state it explicitly here.
        db.referralSignup.findUnique.mockResolvedValue(null);
        db.referralSignup.update.mockResolvedValue({});
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

        const result = await service.createCheckoutSession(tenantCtx(), {
            planCode: 'STANDARD',
            billingCycle: 'MONTHLY',
        });

        expect(result.provider_name).toBe('ssl-wireless');
        expect(result.checkout_url).toBe('https://sandbox.sslcommerz.com/gateway');
        expect(db.billingEvent.upsert).toHaveBeenCalled();
    });

    it('adds selected add-ons to the checkout total and records their codes for the callback', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            text: jest.fn().mockResolvedValue(JSON.stringify({
                status: 'SUCCESS',
                GatewayPageURL: 'https://sandbox.sslcommerz.com/gateway',
                sessionkey: 'session-1',
            })),
        });
        addonModules.getActiveAddonsByCodes.mockResolvedValue([
            { id: 'addon-1', code: 'MANUFACTURING', name: 'Manufacturing', monthly_price: 500, yearly_price: 5000 },
        ]);

        const result = await service.createCheckoutSession(tenantCtx(), {
            planCode: 'STANDARD',
            billingCycle: 'MONTHLY',
            addonCodes: ['manufacturing'],
        });

        expect(addonModules.getActiveAddonsByCodes).toHaveBeenCalledWith(['manufacturing']);
        expect(result.addons).toEqual([{ code: 'MANUFACTURING', name: 'Manufacturing', price: 500 }]);

        const upsertCall = db.billingEvent.upsert.mock.calls[0][0];
        expect(upsertCall.create.amount).toBe(3999 + 500); // mocked plan monthly_price is 3999
        expect(upsertCall.create.payload.addon_codes).toEqual(['MANUFACTURING']);
    });

    it('rejects checkout when selecting the free plan', async () => {
        await expect(service.createCheckoutSession(tenantCtx(), {
            planCode: 'FREE',
            billingCycle: 'MONTHLY',
        })).rejects.toThrow(BadRequestException);
    });

    it('rejects checkout when selecting the coming-soon Premium plan', async () => {
        await expect(service.createCheckoutSession(tenantCtx(), {
            planCode: 'PREMIUM',
            billingCycle: 'MONTHLY',
        })).rejects.toThrow(BadRequestException);
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

    it('recovers add-on codes from the stored CHECKOUT_CREATED event and grants them on success', async () => {
        db.billingEvent.findFirst.mockResolvedValue({
            payload: { addon_codes: ['MANUFACTURING'] },
        });
        addonModules.getActiveAddonsByCodes.mockResolvedValue([
            { id: 'addon-1', code: 'MANUFACTURING', name: 'Manufacturing', monthly_price: 500, yearly_price: 5000 },
        ]);
        fetchMock.mockResolvedValueOnce({
            ok: true,
            text: jest.fn().mockResolvedValue(JSON.stringify({
                status: 'VALID',
                tran_id: 'sslw_tenant_1',
                val_id: 'val-1',
                bank_tran_id: 'bank-ref-1',
                amount: '4499.00',
                currency: 'BDT',
                value_a: 'tenant-1',
            })),
        });

        await service.handleSslWirelessCallback({
            tran_id: 'sslw_tenant_1',
            val_id: 'val-1',
            value_a: 'tenant-1',
            value_b: 'PREMIUM',
            value_c: 'MONTHLY',
        }, 'success');

        expect(db.billingEvent.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    provider_name: 'ssl-wireless',
                    reference_id: 'sslw_tenant_1',
                    event_type: 'CHECKOUT_CREATED',
                }),
            }),
        );
        expect(addonModules.getActiveAddonsByCodes).toHaveBeenCalledWith(['MANUFACTURING']);
        expect(addonModules.grantOrRenewSubscription).toHaveBeenCalledWith(
            expect.objectContaining({ tenantId: 'tenant-1', addonId: 'addon-1', status: 'ACTIVE' }),
        );
    });

    it('does not grant add-ons when the SSL Wireless callback fails', async () => {
        db.billingEvent.findFirst.mockResolvedValue({
            payload: { addon_codes: ['MANUFACTURING'] },
        });

        await service.handleSslWirelessCallback({
            tran_id: 'sslw_tenant_1',
            value_a: 'tenant-1',
            value_b: 'PREMIUM',
            value_c: 'MONTHLY',
        }, 'fail');

        expect(addonModules.grantOrRenewSubscription).not.toHaveBeenCalled();
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
            externalEventId: 'manual:event-1',
        });

        expect(db.tenantSubscription.upsert).toHaveBeenCalledWith(expect.objectContaining({
            update: expect.objectContaining({ status: 'ACTIVE' }),
        }));
        expect(db.billingEvent.upsert).toHaveBeenCalledWith(expect.objectContaining({
            create: expect.objectContaining({ event_type: 'MANUAL_WEBHOOK' }),
        }));
        expect(result).toHaveProperty('subscription');
    });

    it('ignores duplicate manual webhook events with the same idempotency key', async () => {
        process.env.BILLING_WEBHOOK_SECRET = 'my-secret';
        db.billingEvent.findUnique.mockResolvedValueOnce({
            id: 'event-dup',
            tenant_id: 'tenant-1',
            event_type: 'MANUAL_WEBHOOK',
            status: 'ACTIVE',
        });
        db.tenantSubscription.findUnique.mockResolvedValueOnce(premiumSubscriptionUpsertResult);

        const result = await service.handleManualWebhook('my-secret', {
            tenantId: 'tenant-1',
            planCode: 'PREMIUM',
            status: 'ACTIVE',
            externalEventId: 'manual:event-1',
        });

        expect(db.tenantSubscription.upsert).not.toHaveBeenCalled();
        expect(result).toMatchObject({ idempotent_replay: true });
    });

    it('skips duplicate SSL Wireless IPN callbacks', async () => {
        db.billingEvent.findUnique.mockResolvedValueOnce({
            id: 'event-ipn',
            tenant_id: 'tenant-1',
            event_type: 'IPN',
            status: 'VALID',
        });
        db.tenantSubscription.findUnique.mockResolvedValueOnce(premiumSubscriptionUpsertResult);

        const result = await service.handleSslWirelessCallback({
            tran_id: 'sslw_ipn_ref',
            val_id: 'val-ipn',
            value_a: 'tenant-1',
            value_b: 'PREMIUM',
            value_c: 'MONTHLY',
        }, 'ipn');

        expect(fetchMock).not.toHaveBeenCalled();
        expect(db.tenantSubscription.upsert).not.toHaveBeenCalled();
        expect(result).toMatchObject({ idempotent_replay: true });
    });

    it('records a refund and optionally downgrades the tenant', async () => {
        db.tenantSubscription.findUnique.mockResolvedValueOnce({
            ...premiumSubscriptionUpsertResult,
            provider_name: 'ssl-wireless',
        });

        const result = await service.processRefund(tenantCtx(), {
            referenceId: 'bank-ref-1',
            amount: 3999,
            reason: 'Customer request',
            downgradeToFree: true,
            idempotencyKey: 'refund:bank-ref-1',
        });

        expect(result).toMatchObject({ refunded: true, duplicate: false, downgraded: true });
        expect(db.billingEvent.upsert).toHaveBeenCalledWith(expect.objectContaining({
            create: expect.objectContaining({ event_type: 'REFUND', status: 'COMPLETED' }),
        }));
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

        const result = await service.getSummary(tenantCtx());

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

        const result = await service.cancelAtPeriodEnd(tenantCtx());

        expect(db.tenantSubscription.update).toHaveBeenCalledWith(expect.objectContaining({
            data: { cancel_at_period_end: true },
        }));
        expect(result?.cancel_at_period_end).toBe(true);
    });

    it('throws NotFoundException when cancelling with no subscription', async () => {
        db.tenantSubscription.findUnique.mockResolvedValueOnce(null);

        await expect(service.cancelAtPeriodEnd(tenantCtx())).rejects.toThrow(NotFoundException);
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

        await expect(service.createCheckoutSession(tenantCtx(), {
            planCode: 'STANDARD',
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

        await expect(service.createCheckoutSession(tenantCtx(), {
            planCode: 'STANDARD',
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

        const result = await service.createCheckoutSession(tenantCtx(), {
            planCode: 'STANDARD',
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
        db.userStorePermission.findFirst.mockResolvedValueOnce(null);

        await expect(service.createCheckoutSession(tenantCtx({
            userId: 'user-cashier',
            userRole: 'CASHIER',
        }), {
            planCode: 'STANDARD',
        })).rejects.toThrow(ForbiddenException);
    });

    it('rejects sandbox confirmation for the coming-soon Premium plan', async () => {
        await expect(service.confirmCheckout(tenantCtx(), {
            planCode: 'PREMIUM',
            billingCycle: 'MONTHLY',
            reference: 'manual_ref_premium',
        })).rejects.toThrow(BadRequestException);
    });

    it('confirms manual checkout and activates subscription', async () => {
        const result = await service.confirmCheckout(tenantCtx(), {
            planCode: 'STANDARD',
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

    it('confirms manual checkout with add-ons and grants each of them', async () => {
        addonModules.getActiveAddonsByCodes.mockResolvedValue([
            { id: 'addon-1', code: 'MANUFACTURING', name: 'Manufacturing', monthly_price: 500, yearly_price: 5000 },
        ]);

        await service.confirmCheckout(tenantCtx(), {
            planCode: 'STANDARD',
            billingCycle: 'MONTHLY',
            reference: 'manual_ref_123',
            addonCodes: ['MANUFACTURING'],
        });

        expect(addonModules.getActiveAddonsByCodes).toHaveBeenCalledWith(['MANUFACTURING']);
        expect(addonModules.grantOrRenewSubscription).toHaveBeenCalledWith(
            expect.objectContaining({ tenantId: 'tenant-1', addonId: 'addon-1', status: 'ACTIVE' }),
        );
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
        expect(notifications.create).toHaveBeenCalledWith(
            'tenant-1',
            'owner-user-1',
            'PAYMENT_FAILURE',
            'Payment failed',
            expect.stringContaining('Tenant One'),
            '/billing',
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

    // --- Referral discount and commission --------------------------------------

    describe('referral discount at checkout', () => {
        const useManualProvider = () => {
            process.env.BILLING_PROVIDER = 'MANUAL';
            delete process.env.SSL_WIRELESS_STORE_ID;
            delete process.env.SSL_WIRELESS_STORE_PASSWORD;
        };

        beforeEach(useManualProvider);

        it('discounts the plan price for a tenant with a pending referral', async () => {
            db.referralSignup.findUnique.mockResolvedValue({
                id: 'signup-1',
                discount_pct: 10,
                status: 'PENDING',
            });

            const result = await service.createCheckoutSession(tenantCtx(), {
                planCode: 'STANDARD',
                billingCycle: 'MONTHLY',
            });

            expect(result.amount).toBe(3599.1);
        });

        it('charges full price once the referral has already been earned', async () => {
            db.referralSignup.findUnique.mockResolvedValue({
                id: 'signup-1',
                discount_pct: 10,
                status: 'EARNED',
            });

            const result = await service.createCheckoutSession(tenantCtx(), {
                planCode: 'STANDARD',
                billingCycle: 'MONTHLY',
            });

            expect(result.amount).toBe(3999);
        });

        it('charges full price for a tenant that was never referred', async () => {
            const result = await service.createCheckoutSession(tenantCtx(), {
                planCode: 'STANDARD',
                billingCycle: 'MONTHLY',
            });

            expect(result.amount).toBe(3999);
        });

        it('discounts the plan but never the add-ons', async () => {
            db.referralSignup.findUnique.mockResolvedValue({
                id: 'signup-1',
                discount_pct: 10,
                status: 'PENDING',
            });
            addonModules.getActiveAddonsByCodes.mockResolvedValue([
                { id: 'addon-1', code: 'MANUFACTURING', name: 'Manufacturing', monthly_price: 500, yearly_price: 5000 },
            ]);

            const result = await service.createCheckoutSession(tenantCtx(), {
                planCode: 'STANDARD',
                billingCycle: 'MONTHLY',
                addonCodes: ['MANUFACTURING'],
            });

            // 3999 less 10% = 3599.10, plus the add-on at its undiscounted 500.
            expect(result.amount).toBe(4099.1);
        });
    });

    describe('referral clawback on refund', () => {
        const refund = (overrides: Record<string, unknown> = {}) => {
            db.tenantSubscription.findUnique.mockResolvedValueOnce({
                ...premiumSubscriptionUpsertResult,
                provider_name: 'ssl-wireless',
            });
            return service.processRefund(tenantCtx(), {
                referenceId: 'bank-ref-1',
                amount: 3999,
                reason: 'Customer request',
                idempotencyKey: 'refund:bank-ref-1',
                ...overrides,
            } as any);
        };

        it('reverses an earned commission when the tenant is refunded', async () => {
            db.referralSignup.findUnique.mockResolvedValue({ id: 'signup-1', status: 'EARNED' });

            await refund();

            expect(db.referralSignup.update).toHaveBeenCalledWith({
                where: { id: 'signup-1' },
                data: expect.objectContaining({
                    status: 'REVERSED',
                    reversal_reason: 'Customer request',
                    reversed_after_paid: false,
                    reversed_at: expect.any(Date),
                }),
            });
        });

        it('flags a reversal of an already-paid commission so it nets off the next payout', async () => {
            db.referralSignup.findUnique.mockResolvedValue({ id: 'signup-1', status: 'PAID' });

            await refund();

            expect(db.referralSignup.update).toHaveBeenCalledWith({
                where: { id: 'signup-1' },
                data: expect.objectContaining({ status: 'REVERSED', reversed_after_paid: true }),
            });
        });

        it('leaves a PENDING referral alone — nothing was earned to claw back', async () => {
            db.referralSignup.findUnique.mockResolvedValue({ id: 'signup-1', status: 'PENDING' });

            await refund();

            expect(db.referralSignup.update).not.toHaveBeenCalled();
        });

        it('does not reverse the same commission twice', async () => {
            db.referralSignup.findUnique.mockResolvedValue({ id: 'signup-1', status: 'REVERSED' });

            await refund();

            expect(db.referralSignup.update).not.toHaveBeenCalled();
        });

        it('does nothing for a tenant that was never referred', async () => {
            await refund();

            expect(db.referralSignup.update).not.toHaveBeenCalled();
        });

        it('falls back to the reference id when no reason was given', async () => {
            db.referralSignup.findUnique.mockResolvedValue({ id: 'signup-1', status: 'EARNED' });

            await refund({ reason: undefined });

            expect(db.referralSignup.update).toHaveBeenCalledWith({
                where: { id: 'signup-1' },
                data: expect.objectContaining({ reversal_reason: 'Refund bank-ref-1' }),
            });
        });

        it('still completes the refund when the clawback fails', async () => {
            db.referralSignup.findUnique.mockResolvedValue({ id: 'signup-1', status: 'EARNED' });
            db.referralSignup.update.mockRejectedValue(new Error('connection reset'));
            const logError = jest
                .spyOn((service as any).logger, 'error')
                .mockImplementation(() => undefined);

            await expect(refund()).resolves.toMatchObject({ refunded: true });
            expect(logError).toHaveBeenCalledWith(
                expect.stringContaining('Failed to reverse referral commission for tenant tenant-1'),
            );
        });
    });

    describe('referral commission on activation', () => {
        const activatePremium = () =>
            service.applySubscriptionChange({
                tenantId: 'tenant-1',
                planCode: 'PREMIUM',
                billingCycle: 'MONTHLY',
                status: 'ACTIVE',
            });

        it('moves a pending referral to EARNED and records the commission', async () => {
            db.referralSignup.findUnique.mockResolvedValue({
                id: 'signup-1',
                status: 'PENDING',
                commission_pct: 10,
            });

            await activatePremium();
            await new Promise(process.nextTick);

            expect(db.referralSignup.update).toHaveBeenCalledWith({
                where: { id: 'signup-1' },
                data: expect.objectContaining({
                    status: 'EARNED',
                    plan_amount: 3999,
                    commission_amount: 399.9,
                    earned_at: expect.any(Date),
                }),
            });
        });

        it('does not pay a second commission when the referral is already EARNED', async () => {
            db.referralSignup.findUnique.mockResolvedValue({
                id: 'signup-1',
                status: 'EARNED',
                commission_pct: 10,
            });

            await activatePremium();
            await new Promise(process.nextTick);

            expect(db.referralSignup.update).not.toHaveBeenCalled();
        });

        it('does nothing for a tenant that was never referred', async () => {
            await activatePremium();
            await new Promise(process.nextTick);

            expect(db.referralSignup.update).not.toHaveBeenCalled();
        });

        it('does not record a commission when the subscription goes PAST_DUE', async () => {
            db.referralSignup.findUnique.mockResolvedValue({
                id: 'signup-1',
                status: 'PENDING',
                commission_pct: 10,
            });
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

            expect(db.referralSignup.update).not.toHaveBeenCalled();
        });

        it('uses the yearly price as the commission base for a yearly cycle', async () => {
            db.referralSignup.findUnique.mockResolvedValue({
                id: 'signup-1',
                status: 'PENDING',
                commission_pct: 10,
            });

            await service.applySubscriptionChange({
                tenantId: 'tenant-1',
                planCode: 'PREMIUM',
                billingCycle: 'YEARLY',
                status: 'ACTIVE',
            });
            await new Promise(process.nextTick);

            expect(db.referralSignup.update).toHaveBeenCalledWith({
                where: { id: 'signup-1' },
                data: expect.objectContaining({ plan_amount: 39990, commission_amount: 3999 }),
            });
        });

        /**
         * The commission is a share of what the tenant actually paid. A 10% signup
         * discount on a 3999 plan means 3599.10 collected, so a 10% commission is
         * 359.91 — not the 399.90 that a list-price base would have paid out.
         *
         * This assertion replaces one that characterised the old list-price
         * behaviour; the flip is the point of this change, not a regression.
         */
        it('bases the commission on revenue actually collected, not list price', async () => {
            db.referralSignup.findUnique.mockResolvedValue({
                id: 'signup-1',
                status: 'PENDING',
                commission_pct: 10,
                discount_pct: 10,
            });

            await activatePremium();
            await new Promise(process.nextTick);

            expect(db.referralSignup.update).toHaveBeenCalledWith({
                where: { id: 'signup-1' },
                data: expect.objectContaining({ plan_amount: 3599.1, commission_amount: 359.91 }),
            });
        });

        it('uses list price unchanged when the referral carried no discount', async () => {
            db.referralSignup.findUnique.mockResolvedValue({
                id: 'signup-1',
                status: 'PENDING',
                commission_pct: 10,
                discount_pct: 0,
            });

            await activatePremium();
            await new Promise(process.nextTick);

            expect(db.referralSignup.update).toHaveBeenCalledWith({
                where: { id: 'signup-1' },
                data: expect.objectContaining({ plan_amount: 3999, commission_amount: 399.9 }),
            });
        });

        it('matches the discount checkout actually applied, to the cent', async () => {
            // createCheckoutSession computes 3999 * 0.925 = 3699.075 -> 3699.08.
            // The commission base has to be that same figure, not a re-rounding of it.
            db.referralSignup.findUnique.mockResolvedValue({
                id: 'signup-1',
                status: 'PENDING',
                commission_pct: 10,
                discount_pct: 7.5,
            });

            await activatePremium();
            await new Promise(process.nextTick);

            expect(db.referralSignup.update).toHaveBeenCalledWith({
                where: { id: 'signup-1' },
                data: expect.objectContaining({ plan_amount: 3699.08, commission_amount: 369.91 }),
            });
        });

        it('treats a missing discount_pct as no discount rather than NaN', async () => {
            db.referralSignup.findUnique.mockResolvedValue({
                id: 'signup-1',
                status: 'PENDING',
                commission_pct: 10,
            });

            await activatePremium();
            await new Promise(process.nextTick);

            expect(db.referralSignup.update).toHaveBeenCalledWith({
                where: { id: 'signup-1' },
                data: expect.objectContaining({ plan_amount: 3999, commission_amount: 399.9 }),
            });
        });

        it('tells the partner they earned a commission', async () => {
            db.referralSignup.findUnique.mockResolvedValue({
                id: 'signup-1',
                status: 'PENDING',
                commission_pct: 10,
                referee: { name: 'Rahman Traders', email: 'rahman@example.com' },
                tenant: { name: 'Dhaka Retail' },
            });

            await activatePremium();
            await new Promise(process.nextTick);

            expect(email.sendRefereeCommissionEarned).toHaveBeenCalledWith(
                'rahman@example.com',
                'Rahman Traders',
                'Dhaka Retail',
                399.9,
            );
        });

        it('still records the commission when the partner email fails', async () => {
            db.referralSignup.findUnique.mockResolvedValue({
                id: 'signup-1',
                status: 'PENDING',
                commission_pct: 10,
                referee: { name: 'Rahman Traders', email: 'rahman@example.com' },
                tenant: { name: 'Dhaka Retail' },
            });
            email.sendRefereeCommissionEarned.mockRejectedValue(new Error('smtp down'));
            const logWarn = jest
                .spyOn((service as any).logger, 'warn')
                .mockImplementation(() => undefined);

            await activatePremium();
            await new Promise(process.nextTick);

            expect(db.referralSignup.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ status: 'EARNED' }) }),
            );
            expect(logWarn).toHaveBeenCalledWith(
                expect.stringContaining('partner email failed'),
            );
        });

        it('does not email when the referral has no linked partner address', async () => {
            db.referralSignup.findUnique.mockResolvedValue({
                id: 'signup-1',
                status: 'PENDING',
                commission_pct: 10,
                referee: null,
                tenant: { name: 'Dhaka Retail' },
            });

            await activatePremium();
            await new Promise(process.nextTick);

            expect(db.referralSignup.update).toHaveBeenCalled();
            expect(email.sendRefereeCommissionEarned).not.toHaveBeenCalled();
        });

        it('does not treat a REVERSED referral as still pending', async () => {
            db.referralSignup.findUnique.mockResolvedValue({
                id: 'signup-1',
                status: 'REVERSED',
                commission_pct: 10,
            });

            await activatePremium();
            await new Promise(process.nextTick);

            expect(db.referralSignup.update).not.toHaveBeenCalled();
        });

        it('logs a failed commission write instead of swallowing it, and still activates', async () => {
            db.referralSignup.findUnique.mockResolvedValue({
                id: 'signup-1',
                status: 'PENDING',
                commission_pct: 10,
            });
            db.referralSignup.update.mockRejectedValue(new Error('connection reset'));
            const logError = jest
                .spyOn((service as any).logger, 'error')
                .mockImplementation(() => undefined);

            await expect(activatePremium()).resolves.toEqual(
                expect.objectContaining({ tenant: expect.objectContaining({ id: 'tenant-1' }) }),
            );
            await new Promise(process.nextTick);

            expect(logError).toHaveBeenCalledWith(
                expect.stringContaining('Failed to record referral commission for tenant tenant-1'),
            );
        });
    });
});
