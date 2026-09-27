import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PurchaseLineItemsService, purchaseLineFilter } from './purchase-line-items.service';
import { GetPurchaseLineItemsDto } from './purchase-reports.dto';

const TENANT = 'tenant-1';
const TZ = 'Asia/Dhaka';

function mockDb() {
    return {
        purchaseItem: {
            findMany: jest.fn().mockResolvedValue([]),
            aggregate: jest
                .fn()
                .mockResolvedValue({ _count: { _all: 0 }, _sum: { quantity: null, line_total: null } }),
        },
        purchase: { count: jest.fn().mockResolvedValue(0) },
        purchaseReturnItem: {
            aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: null, line_total: null } }),
        },
        store: { findFirst: jest.fn().mockResolvedValue(null) },
        supplier: { findFirst: jest.fn().mockResolvedValue(null) },
        product: { findFirst: jest.fn().mockResolvedValue(null) },
    };
}

describe('purchaseLineFilter', () => {
    it('leaves cancelled bills out and scopes to the tenant', () => {
        const { purchase, where } = purchaseLineFilter(TENANT, {}, TZ);

        expect(purchase).toEqual({ tenant_id: TENANT, status: { not: 'CANCELLED' } });
        expect(where).toEqual({ purchase });
    });

    it('reads the dates as whole days in the tenant’s zone, on the date the bill was entered', () => {
        const { purchase } = purchaseLineFilter(TENANT, { from: '2026-03-01', to: '2026-03-01' }, TZ);

        expect(purchase.created_at).toEqual({
            gte: new Date('2026-02-28T18:00:00.000Z'),
            lte: new Date('2026-03-01T17:59:59.999Z'),
        });
    });

    it('puts branch and supplier on the bill, the product on the line, and searches both', () => {
        const { purchase, line } = purchaseLineFilter(
            TENANT,
            { storeId: 'store-1', supplierId: 'sup-1', productId: 'prod-1', search: 'BILL-9' },
            TZ,
        );

        expect(purchase).toMatchObject({ store_id: 'store-1', supplier_id: 'sup-1' });
        expect(line.product_id).toBe('prod-1');
        expect(line.OR).toEqual([
            { product: { name: { contains: 'BILL-9', mode: 'insensitive' } } },
            { product: { sku: { contains: 'BILL-9', mode: 'insensitive' } } },
            { purchase: { purchase_number: { contains: 'BILL-9', mode: 'insensitive' } } },
            { purchase: { reference_number: { contains: 'BILL-9', mode: 'insensitive' } } },
            { purchase: { supplier: { name: { contains: 'BILL-9', mode: 'insensitive' } } } },
            { purchase: { supplier: { phone: { contains: 'BILL-9' } } } },
        ]);
    });
});

describe('PurchaseLineItemsService', () => {
    let db: ReturnType<typeof mockDb>;
    let service: PurchaseLineItemsService;

    beforeEach(() => {
        db = mockDb();
        service = new PurchaseLineItemsService(db as any);
    });

    it('pages newest first with the line id as the last sort key', async () => {
        await service.getPurchaseLineItems(TENANT, {}, TZ);

        expect(db.purchaseItem.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                orderBy: [{ purchase: { created_at: 'desc' } }, { purchase: { purchase_number: 'desc' } }, { id: 'asc' }],
                skip: 0,
                take: 25,
            }),
        );
    });

    it('can sort on the stored line total', async () => {
        await service.getPurchaseLineItems(TENANT, { sortBy: 'amount', sortDir: 'desc', page: 2, limit: 50 }, TZ);

        expect(db.purchaseItem.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                orderBy: [{ line_total: 'desc' }, { purchase: { created_at: 'desc' } }, { id: 'asc' }],
                skip: 50,
                take: 50,
            }),
        );
    });

    it('totals every matching line under the same filter as the rows', async () => {
        db.purchaseItem.aggregate.mockResolvedValue({
            _count: { _all: 3 },
            _sum: { quantity: 35, line_total: new Prisma.Decimal('8525.00') },
        });
        db.purchase.count.mockResolvedValue(2);
        db.purchaseReturnItem.aggregate.mockResolvedValue({
            _sum: { quantity: 2, line_total: new Prisma.Decimal('900.00') },
        });

        const report = await service.getPurchaseLineItems(TENANT, { supplierId: 'sup-1' }, TZ);

        const { purchase, line, where } = purchaseLineFilter(TENANT, { supplierId: 'sup-1' }, TZ);
        expect(db.purchaseItem.aggregate.mock.calls[0][0].where).toEqual(where);
        expect(db.purchase.count).toHaveBeenCalledWith({ where: { ...purchase, items: { some: line } } });
        expect(db.purchaseReturnItem.aggregate.mock.calls[0][0].where).toEqual({ purchaseItem: { is: where } });
        expect(report.summary).toEqual({
            lineCount: 3,
            billCount: 2,
            quantity: 35,
            amount: 8525,
            returnedQuantity: 2,
            returnedAmount: 900,
        });
    });

    it('carries each line’s cost and total as entered, and what went back against it', async () => {
        const createdAt = new Date('2026-03-03T05:00:00Z');
        db.purchaseItem.findMany.mockResolvedValue([
            {
                id: 'line-1',
                quantity: 10,
                unit_cost: new Prisma.Decimal('450.00'),
                line_total: new Prisma.Decimal('4500.00'),
                product: { id: 'prod-1', name: 'Miniket Rice 5kg', sku: 'RICE-5', unit_type: 'none' },
                purchase: {
                    id: 'pur-1',
                    purchase_number: 'P-1',
                    reference_number: 'BILL-9',
                    created_at: createdAt,
                    store: { id: 'store-1', name: 'Main' },
                    supplier: { id: 'sup-1', name: 'Rahman Traders', phone: null },
                },
                returnItems: [{ quantity: 2, line_total: new Prisma.Decimal('900.00') }],
            },
        ]);

        const report = await service.getPurchaseLineItems(TENANT, {}, TZ);

        expect(report.rows).toEqual([
            {
                id: 'line-1',
                purchaseId: 'pur-1',
                purchaseNumber: 'P-1',
                referenceNumber: 'BILL-9',
                date: createdAt,
                store: { id: 'store-1', name: 'Main' },
                supplier: { id: 'sup-1', name: 'Rahman Traders', phone: null },
                product: { id: 'prod-1', name: 'Miniket Rice 5kg', sku: 'RICE-5', unit_type: 'none' },
                quantity: 10,
                unitCost: 450,
                amount: 4500,
                returnedQuantity: 2,
                returnedAmount: 900,
            },
        ]);
    });

    it('names the supplier it was narrowed by, looked up inside the tenant only', async () => {
        db.supplier.findFirst.mockResolvedValue({ id: 'sup-1', name: 'Rahman Traders', phone: null });

        const report = await service.getPurchaseLineItems(TENANT, { supplierId: 'sup-1' }, TZ);

        expect(db.supplier.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 'sup-1', tenant_id: TENANT } }),
        );
        expect(report.filters.supplier).toEqual({ id: 'sup-1', name: 'Rahman Traders', phone: null });
    });
});

describe('GetPurchaseLineItemsDto', () => {
    const check = (raw: Record<string, unknown>) =>
        validate(plainToInstance(GetPurchaseLineItemsDto, raw), { whitelist: true, forbidNonWhitelisted: true });

    it('accepts a supplier and a sort on the line total', async () => {
        const errors = await check({
            supplierId: '0b8f8d5e-5d2c-4c43-9d8e-0d9d7a4b2f10',
            sortBy: 'amount',
            sortDir: 'asc',
            from: '2026-03-01',
        });
        expect(errors).toHaveLength(0);
    });

    it('rejects the sales side’s customer filter', async () => {
        const errors = await check({ customerId: '0b8f8d5e-5d2c-4c43-9d8e-0d9d7a4b2f10' });
        expect(errors.map((error) => error.property)).toEqual(['customerId']);
    });
});
