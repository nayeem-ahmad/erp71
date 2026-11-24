import { StorefrontOrderBillingService } from './storefront-order-billing.service';

function order(overrides: Record<string, unknown> = {}) {
    return {
        id: 'order-1',
        tenantId: 'tenant-1',
        customerUserId: 'user-shopper',
        payment_status: 'PAID',
        payment_provider: 'sslcommerz',
        payment_method: 'sslcommerz',
        status: 'PENDING',
        totalAmount: 950,
        paid_at: new Date('2026-11-24T10:00:00Z'),
        created_at: new Date('2026-11-24T09:00:00Z'),
        sale_id: null,
        items: [
            { productId: 'product-1', quantity: 2, priceAtOrder: 500 },
        ],
        ...overrides,
    };
}

describe('StorefrontOrderBillingService', () => {
    let db: any;
    let sales: { create: jest.Mock };
    let service: StorefrontOrderBillingService;
    let tx: any;

    beforeEach(() => {
        tx = {
            storefrontOrder: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        };
        db = {
            storefrontOrder: {
                findFirst: jest.fn().mockResolvedValue(order()),
                findUnique: jest.fn().mockResolvedValue({ sale_id: null }),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            tenant: { findUnique: jest.fn().mockResolvedValue({ online_store_id: 'online-store' }) },
            inventorySettings: {
                findUnique: jest.fn().mockResolvedValue({ default_sales_warehouse_id: 'warehouse-1' }),
            },
            salesSettings: { findUnique: jest.fn().mockResolvedValue({ branch_customers_only: true }) },
            warehouse: { findFirst: jest.fn().mockResolvedValue({ store_id: 'branch-1' }) },
            store: { findFirst: jest.fn().mockResolvedValue({ id: 'branch-1' }) },
            customer: { findFirst: jest.fn().mockResolvedValue({ id: 'customer-1' }) },
            storefrontPaymentProvider: {
                findUnique: jest.fn().mockResolvedValue({ code: 'sslcommerz', name: 'SSLCommerz' }),
            },
            paymentMethod: {
                findFirst: jest.fn().mockResolvedValue({
                    id: 'method-1',
                    type: 'Bank',
                    all_branches: true,
                    stores: [],
                }),
            },
        };
        sales = {
            create: jest.fn(async (_tenantId, _userId, _dto, options) => {
                await options?.onCreated?.(tx, { id: 'sale-1' });
                return { id: 'sale-1', serial_number: 'INV-1' };
            }),
        };
        service = new StorefrontOrderBillingService(db as any, sales as any);
    });

    it('bills a paid order as a sale at a physical branch, with a bank tender', async () => {
        const result = await service.billOrder('tenant-1', 'order-1', 'paid');

        expect(result.saleId).toBe('sale-1');
        const [, userId, dto] = sales.create.mock.calls[0];
        expect(userId).toBe('user-shopper');
        expect(dto.storeId).toBe('branch-1');
        expect(dto.warehouseId).toBeUndefined();
        expect(dto.totalAmount).toBe(950);
        // 2 × 500 = 1000 goods, 950 charged: the 50 is the order's discount.
        expect(dto.discountAmount).toBe(50);
        expect(dto.amountPaid).toBe(950);
        expect(dto.payments).toEqual([{ paymentMethod: 'Bank', paymentMethodId: 'method-1', amount: 950 }]);
        // The shopper's record is on the online branch, so it is not attached
        // while `branch_customers_only` is on.
        expect(dto.customerId).toBeUndefined();
        // Linking the sale to the order commits inside the sale's own transaction.
        expect(tx.storefrontOrder.updateMany).toHaveBeenCalledWith({
            where: { id: 'order-1', sale_id: null },
            data: { sale_id: 'sale-1', billing_claimed_at: null },
        });
    });

    it('attaches the shopper when the tenant allows cross-branch customers', async () => {
        db.salesSettings.findUnique.mockResolvedValue({ branch_customers_only: false });

        await service.billOrder('tenant-1', 'order-1', 'paid');

        expect(sales.create.mock.calls[0][2].customerId).toBe('customer-1');
    });

    it('bills a delivered cash-on-delivery order with a cash tender', async () => {
        db.storefrontOrder.findFirst.mockResolvedValue(
            order({ payment_status: 'UNPAID', payment_provider: null, payment_method: 'CASH_ON_DELIVERY', status: 'DELIVERED' }),
        );
        db.storefrontPaymentProvider.findUnique.mockResolvedValue(null);

        const result = await service.billOrder('tenant-1', 'order-1', 'delivered');

        expect(result.saleId).toBe('sale-1');
        expect(sales.create.mock.calls[0][2].payments).toEqual([{ paymentMethod: 'Cash', amount: 950 }]);
    });

    it('does not bill a delivered order twice', async () => {
        db.storefrontOrder.findFirst.mockResolvedValue(order({ status: 'DELIVERED', sale_id: 'sale-existing' }));

        const result = await service.billOrder('tenant-1', 'order-1', 'delivered');

        expect(result.saleId).toBe('sale-existing');
        expect(sales.create).not.toHaveBeenCalled();
    });

    it('leaves an unpaid order alone when a paid callback arrives out of order', async () => {
        db.storefrontOrder.findFirst.mockResolvedValue(order({ payment_status: 'UNPAID' }));

        const result = await service.billOrder('tenant-1', 'order-1', 'paid');

        expect(result.saleId).toBeNull();
        expect(sales.create).not.toHaveBeenCalled();
    });

    it('releases the claim and stays quiet when the sale cannot be written', async () => {
        sales.create.mockRejectedValue(new Error('short of stock'));

        const result = await service.billOrder('tenant-1', 'order-1', 'paid');

        expect(result.saleId).toBeNull();
        expect(result.reason).toContain('short of stock');
        expect(db.storefrontOrder.updateMany).toHaveBeenLastCalledWith({
            where: { id: 'order-1', sale_id: null },
            data: { billing_claimed_at: null },
        });
    });
});
