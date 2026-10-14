import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SalesExchangesService } from './sales-exchanges.service';
import { DatabaseService } from '../database/database.service';
import { applyInventoryMovement, resolveEntryWarehouses, usableWarehouseIds } from '../database/inventory.utils';
import { autoPostFromRules, voidAutoPostedVoucher } from '../accounting/posting.utils';
import { resolveProductCosts } from '../database/product-cost.utils';

jest.mock('../database/inventory.utils', () => ({
    applyInventoryMovement: jest.fn(),
    resolveEntryWarehouses: jest.fn(),
    usableWarehouseIds: jest.fn(),
}));

jest.mock('../database/product-cost.utils', () => ({
    resolveProductCosts: jest.fn(),
}));

jest.mock('../accounting/posting.utils', () => ({
    autoPostFromRules: jest.fn(),
    voidAutoPostedVoucher: jest.fn(),
}));

function sale(overrides: Record<string, unknown> = {}) {
    return {
        id: 'sale-1',
        store_id: 'store-1',
        warehouse_id: 'wh-1',
        customer_id: 'cust-1',
        status: 'COMPLETED',
        serial_number: 'SL-1',
        total_amount: 1000,
        amount_paid: 1000,
        payments: [{ payment_method: 'CASH', created_at: new Date(0) }],
        items: [
            {
                id: 'item-1',
                product_id: 'p-old',
                quantity: 1,
                price_at_sale: 500,
                unit_cost_at_sale: 300,
                vat_rate: 15,
                sd_rate: 0,
                warehouse_id: 'wh-1',
                returns: [],
                exchangeLines: [],
            },
        ],
        ...overrides,
    };
}

function line(overrides: Record<string, unknown> = {}) {
    return {
        saleItemId: 'item-1',
        quantity: 1,
        replacementProductId: 'p-new',
        replacementQuantity: 1,
        unitPrice: 500,
        ...overrides,
    };
}

describe('SalesExchangesService', () => {
    let service: SalesExchangesService;
    let db: any;

    beforeEach(async () => {
        jest.clearAllMocks();
        db = {
            $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(db)),
            tenant: { findUnique: jest.fn().mockResolvedValue({ default_vat_rate: 15 }) },
            sale: { findFirst: jest.fn() },
            product: { findMany: jest.fn().mockResolvedValue([{ id: 'p-new', vat_rate: 15, sd_rate: 0 }]) },
            customer: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
            customerCreditTransaction: { create: jest.fn() },
            cashierSession: { findFirst: jest.fn().mockResolvedValue(null) },
            salesExchange: {
                create: jest.fn(async ({ data }: { data: any }) => ({
                    id: 'ex-1',
                    exchange_number: data.exchange_number,
                    ...data,
                    items: data.items.create,
                })),
                findFirst: jest.fn(),
                update: jest.fn(async ({ data }: { data: any }) => ({ id: 'ex-1', ...data })),
            },
            postingEvent: { findMany: jest.fn().mockResolvedValue([]) },
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [SalesExchangesService, { provide: DatabaseService, useValue: db }],
        }).compile();
        service = module.get(SalesExchangesService);

        (usableWarehouseIds as jest.Mock).mockResolvedValue(new Set(['wh-1']));
        (resolveEntryWarehouses as jest.Mock).mockResolvedValue({
            entryWarehouseId: 'wh-1',
            warehouseIdFor: (id?: string | null) => id || 'wh-1',
        });
        (resolveProductCosts as jest.Mock).mockResolvedValue(new Map([['p-new', 40]]));
        (applyInventoryMovement as jest.Mock).mockResolvedValue(1);
        (autoPostFromRules as jest.Mock).mockResolvedValue({ postingStatus: 'posted', voucherId: 'v-1' });
        (voidAutoPostedVoucher as jest.Mock).mockResolvedValue(undefined);
    });

    async function post(dtoOverrides: Record<string, unknown> = {}, saleOverrides: Record<string, unknown> = {}) {
        db.sale.findFirst.mockResolvedValue(sale(saleOverrides));
        return service.create('t1', 'user-1', {
            saleId: 'sale-1',
            lines: [line()],
            ...dtoOverrides,
        } as any);
    }

    it('posts an even swap with no voucher and no drawer movement', async () => {
        const created = await post();
        expect(created.difference).toBe(0);
        expect(created.cash_delta).toBe(0);
        expect(created.due_delta).toBe(0);
        expect(created.posting_status).toBe('skipped');
        expect(autoPostFromRules).not.toHaveBeenCalled();
        expect(db.customer.update).not.toHaveBeenCalled();
        expect(applyInventoryMovement).toHaveBeenCalledWith(
            db,
            expect.objectContaining({
                productId: 'p-old',
                quantityDelta: 1,
                movementType: 'EXCHANGE_IN',
                referenceType: 'SALES_EXCHANGE',
                referenceId: 'ex-1',
            }),
        );
        expect(applyInventoryMovement).toHaveBeenCalledWith(
            db,
            expect.objectContaining({
                productId: 'p-new',
                quantityDelta: -1,
                movementType: 'EXCHANGE_OUT',
                referenceId: 'ex-1',
            }),
        );
    });

    it('collects a higher cash price in cash', async () => {
        await post({ lines: [line({ unitPrice: 700 })] });
        expect(db.salesExchange.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ difference: 200, cash_delta: 200, settlement_mode: 'cash', due_delta: 0 }),
            }),
        );
        expect(autoPostFromRules).toHaveBeenCalledWith(
            expect.objectContaining({ eventType: 'sale', conditionValue: 'cash', amount: 200, sourceType: 'sale_exchange' }),
        );
    });

    it('refunds a lower cash price in cash', async () => {
        await post({ lines: [line({ unitPrice: 300 })] });
        expect(autoPostFromRules).toHaveBeenCalledWith(
            expect.objectContaining({ eventType: 'sale_return', conditionValue: 'cash', amount: 200 }),
        );
        const data = db.salesExchange.create.mock.calls[0][0].data;
        expect(data.cash_delta).toBe(-200);
    });

    it('leaves the drawer still when the original tender was bKash', async () => {
        await post(
            { lines: [line({ unitPrice: 700 })] },
            { payments: [{ payment_method: 'bKash', created_at: new Date(0) }] },
        );
        const data = db.salesExchange.create.mock.calls[0][0].data;
        expect(data.settlement_mode).toBe('bkash');
        expect(data.cash_delta).toBe(0);
        expect(autoPostFromRules).toHaveBeenCalledWith(expect.objectContaining({ conditionValue: 'bkash', amount: 200 }));
    });

    it('adds the whole difference to the due while a balance remains', async () => {
        db.customer.findFirst.mockResolvedValue({ due_balance: 600, credit_limit: 5000, store_id: 'store-1' });
        db.customer.findUnique.mockResolvedValue({ due_balance: 600, store_id: 'store-1' });
        await post(
            { lines: [line({ unitPrice: 700 })] },
            { total_amount: 1000, amount_paid: 400 },
        );
        const data = db.salesExchange.create.mock.calls[0][0].data;
        expect(data).toMatchObject({ difference: 200, due_delta: 200, cash_delta: 0, settlement_mode: 'credit' });
        expect(db.customerCreditTransaction.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ type: 'ADJUSTMENT', amount: 200, reference_type: 'SALES_EXCHANGE' }),
            }),
        );
        expect(autoPostFromRules).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'sale', conditionValue: 'credit' }));
    });

    it('reduces the due when the refund fits inside it', async () => {
        db.customer.findUnique.mockResolvedValue({ due_balance: 600, store_id: 'store-1' });
        await post(
            { lines: [line({ unitPrice: 300 })] },
            { total_amount: 1000, amount_paid: 400 },
        );
        const data = db.salesExchange.create.mock.calls[0][0].data;
        expect(data).toMatchObject({ difference: -200, due_delta: -200, cash_delta: 0 });
        expect(autoPostFromRules).toHaveBeenCalledTimes(1);
        expect(autoPostFromRules).toHaveBeenCalledWith(
            expect.objectContaining({ eventType: 'sale_return', conditionValue: 'credit', legKey: undefined }),
        );
    });

    it('posts two legs when the refund is larger than the due', async () => {
        db.customer.findUnique.mockResolvedValue({ due_balance: 100, store_id: 'store-1' });
        await post(
            { lines: [line({ unitPrice: 0 })] },
            { total_amount: 1000, amount_paid: 900 },
        );
        const data = db.salesExchange.create.mock.calls[0][0].data;
        expect(data).toMatchObject({ difference: -500, due_delta: -100, cash_delta: -400, settlement_mode: 'cash' });
        expect(autoPostFromRules).toHaveBeenCalledWith(
            expect.objectContaining({ eventType: 'sale_return', conditionValue: 'credit', amount: 100, legKey: 'due' }),
        );
        expect(autoPostFromRules).toHaveBeenCalledWith(
            expect.objectContaining({ eventType: 'sale_return', conditionValue: 'cash', amount: 400, legKey: 'tender' }),
        );
    });

    it('settles a fully paid credit-classified invoice in cash', async () => {
        await post(
            { lines: [line({ unitPrice: 700 })] },
            { payments: [{ payment_method: 'CREDIT', created_at: new Date(0) }] },
        );
        const data = db.salesExchange.create.mock.calls[0][0].data;
        expect(data).toMatchObject({ settlement_mode: 'cash', cash_delta: 200, due_delta: 0 });
    });

    it('refuses a return of a unit a completed exchange already took', async () => {
        await expect(
            post({}, {
                items: [{
                    ...(sale().items as any[])[0],
                    quantity: 1,
                    exchangeLines: [{ returned_quantity: 1 }],
                }],
            }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(db.salesExchange.create).not.toHaveBeenCalled();
    });

    it('refuses when rows in this post together exceed what is still open', async () => {
        await expect(
            post({
                lines: [line(), line()],
            }, {
                items: [{ ...(sale().items as any[])[0], quantity: 1 }],
            }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rolls back when the replacement is not in stock and negative stock is off', async () => {
        (applyInventoryMovement as jest.Mock).mockImplementation(async (_tx: unknown, movement: { movementType: string }) => {
            if (movement.movementType === 'EXCHANGE_OUT') {
                throw new BadRequestException('Insufficient stock');
            }
        });
        await expect(post({ lines: [line({ unitPrice: 700 })] })).rejects.toThrow('Insufficient stock');
    });

    it('refuses a due change on a walk-in invoice', async () => {
        await expect(
            post({ lines: [line({ unitPrice: 700 })] }, { customer_id: null, amount_paid: 0 }),
        ).rejects.toThrow(/no customer/);
    });

    it('allows a walk-in cash difference', async () => {
        const created = await post({ lines: [line({ unitPrice: 700 })] }, { customer_id: null });
        expect(created.cash_delta).toBe(200);
        expect(db.customer.update).not.toHaveBeenCalled();
    });

    it('refuses when the extra due would pass the credit limit', async () => {
        db.customer.findFirst.mockResolvedValue({ due_balance: 900, credit_limit: 1000, store_id: 'store-1' });
        await expect(
            post({ lines: [line({ unitPrice: 700 })] }, { amount_paid: 400 }),
        ).rejects.toThrow(/Credit limit exceeded/);
    });

    it('allows a zero replacement price and refuses a negative one', async () => {
        await post({ lines: [line({ unitPrice: 0 })] });
        expect(db.salesExchange.create.mock.calls[0][0].data.difference).toBe(-500);

        await expect(post({ lines: [line({ unitPrice: -1 })] })).rejects.toThrow(/negative/);
    });

    it('refuses a draft or a cancelled sale', async () => {
        await expect(post({}, { status: 'DRAFT' })).rejects.toThrow(/draft or cancelled/i);
        await expect(post({}, { status: 'CANCELLED' })).rejects.toThrow(/draft or cancelled/i);
    });

    it('refuses an empty exchange', async () => {
        await expect(service.create('t1', 'user-1', { saleId: 'sale-1', lines: [] } as any)).rejects.toThrow(/at least one/);
    });

    it('cancel restores stock, due and spend, and voids the posted leg', async () => {
        db.salesExchange.findFirst.mockResolvedValue({
            id: 'ex-1',
            status: 'COMPLETED',
            exchange_number: 'EXC-1',
            difference: 200,
            due_delta: 0,
            cash_delta: 200,
            settlement_mode: 'cash',
            warehouse_id: 'wh-1',
            items: [
                {
                    returned_product_id: 'p-old',
                    returned_quantity: 1,
                    replacement_product_id: 'p-new',
                    replacement_quantity: 1,
                    warehouse_id: 'wh-1',
                },
            ],
            sale: { id: 'sale-1', customer_id: 'cust-1', serial_number: 'SL-1', store_id: 'store-1' },
        });
        db.customer.findUnique.mockResolvedValue({ due_balance: 0, store_id: 'store-1' });

        await service.cancel('t1', 'user-1', 'ex-1', 'Customer changed their mind');

        expect(applyInventoryMovement).toHaveBeenCalledWith(
            db,
            expect.objectContaining({ movementType: 'EXCHANGE_IN_REVERSAL', quantityDelta: -1, productId: 'p-old' }),
        );
        expect(applyInventoryMovement).toHaveBeenCalledWith(
            db,
            expect.objectContaining({ movementType: 'EXCHANGE_OUT_REVERSAL', quantityDelta: 1, productId: 'p-new' }),
        );
        expect(db.customer.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: { total_spent: { increment: -200 } } }),
        );
        expect(voidAutoPostedVoucher).toHaveBeenCalledWith(db, 't1', 'sale', 'ex-1', undefined);
        expect(db.salesExchange.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }),
        );
    });

    it('voids the credit sale leg when cancelling a due increase', async () => {
        db.salesExchange.findFirst.mockResolvedValue({
            id: 'ex-1',
            status: 'COMPLETED',
            exchange_number: 'EXC-1',
            difference: 200,
            due_delta: 200,
            cash_delta: 0,
            settlement_mode: 'credit',
            warehouse_id: 'wh-1',
            items: [],
            sale: { id: 'sale-1', customer_id: 'cust-1', serial_number: 'SL-1', store_id: 'store-1' },
        });
        db.customer.findUnique.mockResolvedValue({ due_balance: 800, store_id: 'store-1' });

        await service.cancel('t1', 'user-1', 'ex-1', 'Posted against the wrong invoice');

        expect(voidAutoPostedVoucher).toHaveBeenCalledWith(db, 't1', 'sale', 'ex-1', undefined);
        expect(voidAutoPostedVoucher).not.toHaveBeenCalledWith(db, 't1', 'sale', 'ex-1', 'tender');
        expect(db.customerCreditTransaction.create).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ amount: -200 }) }),
        );
    });

    it('refuses a second cancel and an empty note', async () => {
        db.salesExchange.findFirst.mockResolvedValue({ id: 'ex-1', status: 'CANCELLED', items: [], sale: {} });
        await expect(service.cancel('t1', 'user-1', 'ex-1', 'Already cancelled once')).rejects.toThrow(/already cancelled/);
        await expect(service.cancel('t1', 'user-1', 'ex-1', 'no')).rejects.toThrow(/note/);
    });
});
