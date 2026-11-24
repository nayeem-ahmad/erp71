import { BadRequestException } from '@nestjs/common';
import { PaymentProviderCatalogService, SECRET_MASK } from './payment-provider-catalog.service';
import { StorefrontPaymentService } from './storefront-payment.service';
import { SslCommerzAdapter } from './adapters/sslcommerz.adapter';
import { encryptValue, decryptValue } from '../platform-settings/crypto.util';

function provider(overrides: Record<string, unknown> = {}) {
    return {
        id: 'provider-1',
        code: 'sslcommerz',
        name: 'SSLCommerz',
        description: null,
        logo_url: null,
        adapter: 'SSLCOMMERZ',
        currency: 'BDT',
        is_active: true,
        sort_order: 10,
        credential_fields: [
            { key: 'store_id', label: 'Store ID', required: true },
            { key: 'store_password', label: 'Store Password', secret: true, required: true },
        ],
        config: {},
        ...overrides,
    };
}

function gateway(overrides: Record<string, unknown> = {}) {
    return {
        id: 'gateway-1',
        tenant_id: 'tenant-1',
        provider_id: 'provider-1',
        enabled: true,
        mode: 'sandbox',
        credentials: { store_id: 'shop-store', store_password: encryptValue('secret-pass') },
        verified_at: null,
        last_error: null,
        last_error_at: null,
        ...overrides,
    };
}

describe('PaymentProviderCatalogService', () => {
    let db: any;
    let service: PaymentProviderCatalogService;

    beforeEach(() => {
        db = {
            storefrontPaymentProvider: {
                findUnique: jest.fn(),
                findMany: jest.fn(),
                create: jest.fn(),
                update: jest.fn(),
                delete: jest.fn(),
            },
            tenantStorefrontGateway: {
                findUnique: jest.fn(),
                findMany: jest.fn(),
                updateMany: jest.fn(),
                upsert: jest.fn(),
                update: jest.fn(),
            },
        };
        service = new PaymentProviderCatalogService(db);
    });

    it('keeps the stored secret when the form sends the mask back', async () => {
        db.storefrontPaymentProvider.findUnique.mockResolvedValue(provider());
        db.tenantStorefrontGateway.findUnique.mockResolvedValue(gateway());
        db.tenantStorefrontGateway.upsert.mockImplementation(async (args: any) => ({
            ...gateway(),
            ...args.update,
        }));

        await service.updateTenantGateway('tenant-1', 'provider-1', {
            credentials: { store_id: 'shop-store', store_password: SECRET_MASK },
        });

        const stored = db.tenantStorefrontGateway.upsert.mock.calls[0][0].update.credentials;
        expect(decryptValue(stored.store_password)).toBe('secret-pass');
        expect(stored.store_id).toBe('shop-store');
    });

    it('refuses to save when a required credential is missing', async () => {
        db.storefrontPaymentProvider.findUnique.mockResolvedValue(provider());
        db.tenantStorefrontGateway.findUnique.mockResolvedValue(null);
        db.tenantStorefrontGateway.upsert.mockImplementation(async () => gateway());

        await expect(
            service.updateTenantGateway('tenant-1', 'provider-1', { credentials: { store_id: 'shop-store' } }),
        ).rejects.toThrow(BadRequestException);
    });

    it('masks secrets when the shop reads its settings', async () => {
        db.storefrontPaymentProvider.findMany.mockResolvedValue([provider()]);
        db.tenantStorefrontGateway.findMany.mockResolvedValue([gateway()]);

        const [view] = await service.listForTenant('tenant-1');

        expect(view.credentials.store_id).toBe('shop-store');
        expect(view.credentials.store_password).toBe(SECRET_MASK);
        expect(view.credential_fields).toHaveLength(2);
    });

    it('rejects a hosted-redirect provider with no validation endpoint', async () => {
        db.storefrontPaymentProvider.findUnique.mockResolvedValue(null);

        await expect(
            service.createProvider({
                code: 'some-gateway',
                name: 'Some Gateway',
                adapter: 'HOSTED_REDIRECT',
                credential_fields: [],
                config: { initiate_url: 'https://pay.example.com/init', field_map: {} },
            } as any),
        ).rejects.toThrow(BadRequestException);
    });

    it('will not resolve a gateway the shop has not switched on', async () => {
        db.storefrontPaymentProvider.findUnique.mockResolvedValue(provider());
        db.tenantStorefrontGateway.findUnique.mockResolvedValue(gateway({ enabled: false }));

        await expect(service.resolveGateway('tenant-1', 'sslcommerz')).rejects.toThrow(BadRequestException);
    });

    it('resolves decrypted credentials for an enabled gateway', async () => {
        db.storefrontPaymentProvider.findUnique.mockResolvedValue(provider());
        db.tenantStorefrontGateway.findUnique.mockResolvedValue(gateway());

        const resolved = await service.resolveGateway('tenant-1', 'sslcommerz');

        expect(resolved.credentials.store_password).toBe('secret-pass');
        expect(resolved.adapter).toBe('SSLCOMMERZ');
        expect(resolved.mode).toBe('sandbox');
    });
});

describe('StorefrontPaymentService', () => {
    let db: any;
    let catalog: any;
    let service: StorefrontPaymentService;
    let lastTx: any;

    const order = {
        id: 'order-1',
        tenantId: 'tenant-1',
        customerName: 'Shopper',
        customerEmail: 'shopper@example.com',
        customerPhone: '01700000000',
        totalAmount: 100,
        status: 'PENDING',
        payment_status: 'UNPAID',
        deliveryAddress: null,
        deliveryArea: null,
    };

    const payment = {
        id: 'payment-1',
        tenantId: 'tenant-1',
        orderId: 'order-1',
        providerCode: 'sslcommerz',
        providerPaymentId: 'sp_abc',
        amount: 100,
        currency: 'BDT',
        status: 'PENDING',
    };

    beforeEach(() => {
        jest.restoreAllMocks();
        db = {
            tenant: { findFirst: jest.fn().mockResolvedValue({ id: 'tenant-1', name: 'Shop' }) },
            storefrontOrder: { findFirst: jest.fn().mockResolvedValue(order), update: jest.fn() },
            storefrontPayment: {
                create: jest.fn().mockResolvedValue(payment),
                update: jest.fn(),
                findFirst: jest.fn().mockResolvedValue(payment),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            $transaction: jest.fn(async (cb: any) => {
                lastTx = {
                    storefrontPayment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
                    storefrontOrder: { update: jest.fn() },
                };
                return cb(lastTx);
            }),
        };
        catalog = {
            resolveGateway: jest.fn().mockResolvedValue({
                providerId: 'provider-1',
                providerCode: 'sslcommerz',
                providerName: 'SSLCommerz',
                adapter: 'SSLCOMMERZ',
                currency: 'BDT',
                config: {},
                credentials: { store_id: 's', store_password: 'p' },
                mode: 'sandbox',
            }),
            resolveGatewayForCallback: jest.fn().mockResolvedValue({
                providerId: 'provider-1',
                providerCode: 'sslcommerz',
                providerName: 'SSLCommerz',
                adapter: 'SSLCOMMERZ',
                currency: 'BDT',
                config: {},
                credentials: { store_id: 's', store_password: 'p' },
                mode: 'sandbox',
            }),
            recordGatewayError: jest.fn(),
        };
        service = new StorefrontPaymentService(db, catalog, {
            billOrder: jest.fn().mockResolvedValue({ saleId: null }),
        } as any);
    });

    it('opens a gateway session and marks the order pending', async () => {
        jest.spyOn(SslCommerzAdapter.prototype, 'initiate').mockResolvedValue({
            redirectUrl: 'https://gateway.example/pay',
            providerReference: 'sp_abc',
            raw: {},
        });

        const result = await service.initiate('shop', 'order-1', 'sslcommerz', 'shopper@example.com');

        expect(result.redirectUrl).toBe('https://gateway.example/pay');
        expect(db.storefrontPayment.create.mock.calls[0][0].data.mode).toBe('sandbox');
        expect(db.storefrontOrder.update).toHaveBeenCalledWith({
            where: { id: 'order-1' },
            data: { payment_method: 'sslcommerz', payment_provider: 'sslcommerz', payment_status: 'PENDING' },
        });
    });

    it('rejects a payment for an order belonging to someone else', async () => {
        await expect(
            service.initiate('shop', 'order-1', 'sslcommerz', 'other@example.com'),
        ).rejects.toThrow(BadRequestException);
    });

    it('marks the payment and order paid on a verified callback', async () => {
        jest.spyOn(SslCommerzAdapter.prototype, 'verify').mockResolvedValue({
            paid: true,
            providerReference: 'provider-txn-9',
            amount: 100,
            currency: 'BDT',
            status: 'VALID',
            raw: {},
        });

        const result = await service.handleCallback('shop', 'sslcommerz', 'success', { tran_id: 'sp_abc' });

        expect(result.status).toBe('paid');
        expect(lastTx.storefrontOrder.update).toHaveBeenCalledWith({
            where: { id: 'order-1' },
            data: expect.objectContaining({ payment_status: 'PAID', gateway_payment_id: 'provider-txn-9' }),
        });
    });

    it('does not mark the order paid when the gateway reports a different amount', async () => {
        jest.spyOn(SslCommerzAdapter.prototype, 'verify').mockResolvedValue({
            paid: true,
            providerReference: 'provider-txn-9',
            amount: 50,
            currency: 'BDT',
            status: 'VALID',
            raw: {},
        });

        const result = await service.handleCallback('shop', 'sslcommerz', 'success', { tran_id: 'sp_abc' });

        expect(result.status).toBe('failed');
        expect(db.$transaction).not.toHaveBeenCalled();
        expect(db.storefrontOrder.update).toHaveBeenCalledWith({
            where: { id: 'order-1' },
            data: { payment_status: 'FAILED' },
        });
    });

    it('redirects to the storefront with cancelled when the shopper backs out', async () => {
        const result = await service.handleCallback('shop', 'sslcommerz', 'cancel', { tran_id: 'sp_abc' });

        expect(result.status).toBe('cancelled');
        expect(result.redirectUrl).toContain('/store/shop/payment/return?status=cancelled');
        expect(db.$transaction).not.toHaveBeenCalled();
    });
});
