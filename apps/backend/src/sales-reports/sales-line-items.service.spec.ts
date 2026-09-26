import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SalesLineItemsService, salesLineFilter } from './sales-line-items.service';
import { GetSalesLineItemsDto } from './sales-reports.dto';

const TENANT = 'tenant-1';
const TZ = 'Asia/Dhaka';

function mockDb() {
    return {
        saleItem: {
            findMany: jest.fn().mockResolvedValue([]),
            aggregate: jest.fn().mockResolvedValue({ _count: { _all: 0 }, _sum: { quantity: null } }),
            groupBy: jest.fn().mockResolvedValue([]),
        },
        sale: { count: jest.fn().mockResolvedValue(0) },
        salesReturnItem: {
            aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: null, refund_amount: null } }),
        },
        store: { findFirst: jest.fn().mockResolvedValue(null) },
        customer: { findFirst: jest.fn().mockResolvedValue(null) },
        product: { findFirst: jest.fn().mockResolvedValue(null) },
    };
}

describe('salesLineFilter', () => {
    it('scopes to the tenant’s completed sales and nothing else when no filter is given', () => {
        const { sale, line, where } = salesLineFilter(TENANT, {}, TZ);

        expect(sale).toEqual({ tenant_id: TENANT, status: 'COMPLETED' });
        expect(line).toEqual({});
        expect(where).toEqual({ sale: { tenant_id: TENANT, status: 'COMPLETED' } });
    });

    it('reads the dates as whole days in the tenant’s zone', () => {
        const { sale } = salesLineFilter(TENANT, { from: '2026-03-01', to: '2026-03-31' }, TZ);

        // Dhaka is UTC+6: 1 March starts at 18:00 UTC on 28 February, and
        // 31 March ends a millisecond before 18:00 UTC on 31 March.
        expect(sale.sale_date).toEqual({
            gte: new Date('2026-02-28T18:00:00.000Z'),
            lte: new Date('2026-03-31T17:59:59.999Z'),
        });
    });

    it('puts branch and customer on the sale and the product on the line', () => {
        const { sale, line } = salesLineFilter(
            TENANT,
            { storeId: 'store-1', customerId: 'cust-1', productId: 'prod-1' },
            TZ,
        );

        expect(sale).toMatchObject({ store_id: 'store-1', customer_id: 'cust-1' });
        expect(line).toEqual({ product_id: 'prod-1' });
    });

    it('searches product, invoice, reference and customer, case-insensitively, and ignores blank text', () => {
        const { line } = salesLineFilter(TENANT, { search: '  rice  ' }, TZ);

        expect(line.OR).toEqual([
            { product: { name: { contains: 'rice', mode: 'insensitive' } } },
            { product: { sku: { contains: 'rice', mode: 'insensitive' } } },
            { sale: { serial_number: { contains: 'rice', mode: 'insensitive' } } },
            { sale: { reference_number: { contains: 'rice', mode: 'insensitive' } } },
            { sale: { customer: { name: { contains: 'rice', mode: 'insensitive' } } } },
            { sale: { customer: { phone: { contains: 'rice' } } } },
        ]);
        expect(salesLineFilter(TENANT, { search: '   ' }, TZ).line).toEqual({});
    });
});

describe('SalesLineItemsService', () => {
    let db: ReturnType<typeof mockDb>;
    let service: SalesLineItemsService;

    beforeEach(() => {
        db = mockDb();
        service = new SalesLineItemsService(db as any);
    });

    it('pages newest first with the line id as the last sort key', async () => {
        await service.getSalesLineItems(TENANT, {}, TZ);

        expect(db.saleItem.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                orderBy: [{ sale: { sale_date: 'desc' } }, { sale: { serial_number: 'desc' } }, { id: 'asc' }],
                skip: 0,
                take: 25,
            }),
        );
    });

    it('sorts by the requested column and direction, still ending on the line id', async () => {
        await service.getSalesLineItems(TENANT, { sortBy: 'customer', sortDir: 'asc', page: 3, limit: 10 }, TZ);

        expect(db.saleItem.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                orderBy: [{ sale: { customer: { name: 'asc' } } }, { sale: { sale_date: 'desc' } }, { id: 'asc' }],
                skip: 20,
                take: 10,
            }),
        );
    });

    it('asks every summary query under the same filter as the rows', async () => {
        await service.getSalesLineItems(TENANT, { customerId: 'cust-1', productId: 'prod-1' }, TZ);

        const { sale, line, where } = salesLineFilter(TENANT, { customerId: 'cust-1', productId: 'prod-1' }, TZ);
        expect(db.saleItem.findMany.mock.calls[0][0].where).toEqual(where);
        expect(db.saleItem.aggregate.mock.calls[0][0].where).toEqual(where);
        expect(db.saleItem.groupBy.mock.calls[0][0]).toMatchObject({ by: ['price_at_sale'], where });
        // Invoices are counted from the sale's side, so its own tenant scope
        // leads the query.
        expect(db.sale.count).toHaveBeenCalledWith({ where: { ...sale, items: { some: line } } });
        expect(db.salesReturnItem.aggregate.mock.calls[0][0].where).toEqual({ sale_item: { is: where } });
    });

    it('totals the value of every matching line from the price groups, not just the page', async () => {
        db.saleItem.aggregate.mockResolvedValue({ _count: { _all: 60 }, _sum: { quantity: 14 } });
        db.saleItem.groupBy.mockResolvedValue([
            { price_at_sale: new Prisma.Decimal('500.00'), _sum: { quantity: 3 } },
            { price_at_sale: new Prisma.Decimal('180.50'), _sum: { quantity: 11 } },
        ]);
        db.sale.count.mockResolvedValue(9);
        db.salesReturnItem.aggregate.mockResolvedValue({
            _sum: { quantity: 2, refund_amount: new Prisma.Decimal('361.00') },
        });

        const report = await service.getSalesLineItems(TENANT, { limit: 25 }, TZ);

        expect(report.summary).toEqual({
            lineCount: 60,
            invoiceCount: 9,
            quantity: 14,
            amount: 3485.5,
            returnedQuantity: 2,
            returnedAmount: 361,
        });
        expect(report.pagination).toEqual({ page: 1, limit: 25, total: 60, pages: 3 });
    });

    it('reports zero rather than null when nothing matches', async () => {
        const report = await service.getSalesLineItems(TENANT, {}, TZ);

        expect(report.summary).toEqual({
            lineCount: 0,
            invoiceCount: 0,
            quantity: 0,
            amount: 0,
            returnedQuantity: 0,
            returnedAmount: 0,
        });
        expect(report.rows).toEqual([]);
        expect(report.pagination).toEqual({ page: 1, limit: 25, total: 0, pages: 1 });
    });

    it('prices each row at quantity × unit price and sums what came back against it', async () => {
        const saleDate = new Date('2026-03-05T06:00:00Z');
        db.saleItem.findMany.mockResolvedValue([
            {
                id: 'line-1',
                quantity: 3,
                price_at_sale: new Prisma.Decimal('180.35'),
                product: { id: 'prod-1', name: 'Soybean Oil 1L', sku: 'OIL-1', unit_type: 'none' },
                sale: {
                    id: 'sale-1',
                    serial_number: 'S-1001',
                    reference_number: 'INV-77',
                    sale_date: saleDate,
                    store: { id: 'store-1', name: 'Main' },
                    customer: null,
                },
                returns: [
                    { quantity: 1, refund_amount: new Prisma.Decimal('180.35') },
                    { quantity: 1, refund_amount: new Prisma.Decimal('180.35') },
                ],
            },
        ]);

        const report = await service.getSalesLineItems(TENANT, {}, TZ);

        expect(report.rows).toEqual([
            {
                id: 'line-1',
                saleId: 'sale-1',
                invoiceNumber: 'S-1001',
                referenceNumber: 'INV-77',
                date: saleDate,
                store: { id: 'store-1', name: 'Main' },
                customer: null,
                product: { id: 'prod-1', name: 'Soybean Oil 1L', sku: 'OIL-1', unit_type: 'none' },
                quantity: 3,
                unitPrice: 180.35,
                amount: 541.05,
                returnedQuantity: 2,
                returnedAmount: 360.7,
            },
        ]);
    });

    it('names the filters it was given, looked up inside the tenant only', async () => {
        db.customer.findFirst.mockResolvedValue({ id: 'cust-1', name: 'Rahim', phone: null, customer_code: 'C-1' });

        const report = await service.getSalesLineItems(
            TENANT,
            { customerId: 'cust-1', productId: 'prod-x', from: '2026-03-01' },
            TZ,
        );

        expect(db.customer.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 'cust-1', tenant_id: TENANT } }),
        );
        expect(db.product.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 'prod-x', tenant_id: TENANT } }),
        );
        expect(db.store.findFirst).not.toHaveBeenCalled();
        expect(report.filters).toEqual({
            from: '2026-03-01',
            to: null,
            store: null,
            customer: { id: 'cust-1', name: 'Rahim', phone: null, customer_code: 'C-1' },
            product: null,
        });
    });
});

describe('GetSalesLineItemsDto', () => {
    const check = (raw: Record<string, unknown>) =>
        validate(plainToInstance(GetSalesLineItemsDto, raw), { whitelist: true, forbidNonWhitelisted: true });

    it('accepts the full set of filters as the page sends them', async () => {
        const errors = await check({
            from: '2026-03-01',
            to: '2026-03-31',
            storeId: '0b8f8d5e-5d2c-4c43-9d8e-0d9d7a4b2f10',
            customerId: '1c1d6a0e-7f4a-4d4e-8b7a-3b2a9f6c5d11',
            productId: '2d2e7b1f-8a5b-4e5f-9c8b-4c3b0a7d6e12',
            search: 'rice',
            page: '2',
            limit: '100',
            sortBy: 'unitPrice',
            sortDir: 'desc',
        });
        expect(errors).toHaveLength(0);
    });

    it('rejects a timestamp where a calendar day belongs', async () => {
        const errors = await check({ from: '2026-03-01T00:00:00Z' });
        expect(errors.map((error) => error.property)).toEqual(['from']);
    });

    it('rejects a page larger than any list returns, and a sort it cannot do', async () => {
        const errors = await check({ limit: '500', sortBy: 'amount' });
        expect(errors.map((error) => error.property).sort()).toEqual(['limit', 'sortBy']);
    });

    it('rejects the purchase side’s supplier filter', async () => {
        const errors = await check({ supplierId: '0b8f8d5e-5d2c-4c43-9d8e-0d9d7a4b2f10' });
        expect(errors.map((error) => error.property)).toEqual(['supplierId']);
    });
});
