import { PurchasesService } from './purchases.service';
import { PurchaseReturnsService } from '../purchase-returns/purchase-returns.service';
import { PurchaseOrdersService } from '../purchase-orders/purchase-orders.service';
import { PurchaseQuotationsService } from '../purchase-quotations/purchase-quotations.service';
import { readDocumentListFilters, searchClause } from '../common/document-list-filters';

/**
 * The purchase-side lists' filter row and the stats strip above each. Rows and
 * strip go through one `where`, so the strip always counts the rows shown.
 */
describe('purchase document lists', () => {
    const TZ = 'Asia/Dhaka';
    const model = (aggregate: Record<string, unknown> = {}) => ({
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _count: { _all: 0 }, _sum: {}, ...aggregate }),
    });
    let db: any;

    beforeEach(() => {
        db = {
            purchase: model(),
            purchaseReturn: model(),
            purchaseReturnPayment: model(),
            purchaseOrder: model(),
            purchaseQuotation: model(),
            postingEvent: { findMany: jest.fn().mockResolvedValue([]) },
            voucher: { findMany: jest.fn().mockResolvedValue([]) },
        };
    });

    describe('readDocumentListFilters', () => {
        it('reads statuses, the inversion, suppliers and the amount condition', () => {
            const filters = readDocumentListFilters(
                { status: 'DRAFT,SENT', statusExclude: 'true', supplierId: 's1,none', total: 'gt:500', search: '  po-1 ' },
                { storeId: 'b1', timezone: TZ },
            );
            expect(filters).toMatchObject({
                statuses: ['DRAFT', 'SENT'],
                statusExclude: true,
                supplierIds: ['s1', 'none'],
                total: { op: 'gt', value: 500 },
                search: 'po-1',
                storeId: 'b1',
            });
        });

        it('refuses a malformed amount rather than showing every row', () => {
            expect(() => readDocumentListFilters({ total: 'about:500' }, { timezone: TZ })).toThrow();
        });

        it('nests a relation path into a relation filter', () => {
            expect(searchClause('acme', ['supplier.name'])).toEqual({
                OR: [{ supplier: { name: { contains: 'acme', mode: 'insensitive' } } }],
            });
        });
    });

    describe('purchases', () => {
        const where = async (opts: Record<string, unknown>) => {
            await new PurchasesService(db).findAll('t1', 1, 20, { timezone: TZ, ...opts });
            return db.purchase.findMany.mock.calls[0][0].where;
        };

        it('inverts the status set, and narrows total, paid and payment state', async () => {
            const w = await where({
                statuses: ['CANCELLED'],
                statusExclude: true,
                total: { op: 'between', value: 100, to: 900 },
                paid: { op: 'lt', value: 1 },
                paymentStatus: ['UNPAID', 'PARTIAL'],
            });
            expect(w.status).toEqual({ notIn: ['CANCELLED'] });
            expect(w.total_amount).toEqual({ gte: 100, lte: 900 });
            expect(w.paid_amount).toEqual({ lt: 1 });
            expect(w.payment_status).toEqual({ in: ['UNPAID', 'PARTIAL'] });
        });

        it('matches suppliers by id and "none" as a bill with no supplier', async () => {
            const w = await where({ supplierIds: ['s1', 'none'] });
            expect(w.AND).toEqual([{ OR: [{ supplier_id: { in: ['s1'] } }, { supplier_id: null }] }]);
        });

        it('searches the number, the reference, the supplier and the products', async () => {
            const w = await where({ search: 'rice' });
            expect(w.AND[0].OR).toEqual(
                expect.arrayContaining([
                    { purchase_number: { contains: 'rice', mode: 'insensitive' } },
                    { supplier: { name: { contains: 'rice', mode: 'insensitive' } } },
                    { items: { some: { product: { name: { contains: 'rice', mode: 'insensitive' } } } } },
                ]),
            );
        });

        it('sums live bills and their returns, leaving cancelled bills out of the money', async () => {
            db.purchase.count.mockResolvedValueOnce(5).mockResolvedValueOnce(1);
            db.purchase.aggregate.mockResolvedValue({ _count: { _all: 4 }, _sum: { total_amount: 1000, paid_amount: 600 } });
            db.purchaseReturn.aggregate.mockResolvedValue({ _count: { _all: 2 }, _sum: { total_amount: 150 } });

            const summary = await new PurchasesService(db).summary('t1', { timezone: TZ, supplierIds: ['s1'] });

            expect(summary).toEqual({
                count: 5,
                cancelledCount: 1,
                total: 1000,
                paid: 600,
                due: 400,
                average: 250,
                returns: { count: 2, amount: 150 },
            });
            const aggregateWhere = db.purchase.aggregate.mock.calls[0][0].where;
            expect(aggregateWhere.AND[1]).toEqual({ status: { not: 'CANCELLED' } });
            expect(aggregateWhere.AND[0].AND).toEqual([{ supplier_id: { in: ['s1'] } }]);
        });
    });

    describe('purchase returns', () => {
        it('searches the source bill too, and filters the supplier', async () => {
            await new PurchaseReturnsService(db).findAll('t1', 1, 20, { timezone: TZ, search: 'PB-9', supplierIds: ['none'] });
            const w = db.purchaseReturn.findMany.mock.calls[0][0].where;
            expect(w.AND[0].OR).toContainEqual({ purchase: { purchase_number: { contains: 'PB-9', mode: 'insensitive' } } });
            expect(w.AND[1]).toEqual({ supplier_id: null });
        });

        it('splits the returned value into money refunded and payable adjusted', async () => {
            db.purchaseReturn.aggregate.mockResolvedValue({ _count: { _all: 4 }, _sum: { total_amount: 800 } });
            db.purchaseReturnPayment.aggregate.mockResolvedValue({ _sum: { amount: 300 } });
            const summary = await new PurchaseReturnsService(db).summary('t1', { timezone: TZ });
            expect(summary).toEqual({ count: 4, amount: 800, refunded: 300, adjusted: 500, average: 200 });
        });
    });

    describe('purchase orders', () => {
        it('filters the expected date as the document date', async () => {
            await new PurchaseOrdersService(db).findAll('t1', 1, 20, {
                timezone: TZ,
                dateFrom: '2026-11-01',
                dateTo: '2026-11-30',
                statuses: ['SENT'],
            });
            const w = db.purchaseOrder.findMany.mock.calls[0][0].where;
            expect(w.expected_date).toEqual({ gte: expect.any(Date), lte: expect.any(Date) });
            expect(w.status).toBe('SENT');
        });

        it('sorts by a column the server knows', async () => {
            await new PurchaseOrdersService(db).findAll('t1', 1, 20, { timezone: TZ, sortBy: 'total_amount', sortDir: 'asc' });
            expect(db.purchaseOrder.findMany.mock.calls[0][0].orderBy).toEqual({ total_amount: 'asc' });
        });

        it('counts open, received and overdue orders over the filtered rows', async () => {
            db.purchaseOrder.count
                .mockResolvedValueOnce(6) // all
                .mockResolvedValueOnce(1) // cancelled
                .mockResolvedValueOnce(2); // overdue
            db.purchaseOrder.aggregate
                .mockResolvedValueOnce({ _sum: { total_amount: 5000 } })
                .mockResolvedValueOnce({ _count: { _all: 3 }, _sum: { total_amount: 2000 } })
                .mockResolvedValueOnce({ _count: { _all: 2 }, _sum: { total_amount: 3000 } });

            const summary = await new PurchaseOrdersService(db).summary('t1', { timezone: TZ });

            expect(summary).toEqual({
                count: 6,
                cancelledCount: 1,
                value: 5000,
                open: { count: 3, amount: 2000 },
                received: { count: 2, amount: 3000 },
                overdue: 2,
            });
            const overdueWhere = db.purchaseOrder.count.mock.calls[2][0].where.AND[1];
            expect(overdueWhere).toEqual({ status: { in: ['DRAFT', 'SENT'] }, expected_date: { lt: expect.any(Date) } });
        });
    });

    describe('purchase quotations', () => {
        it('filters the valid-until date as the document date', async () => {
            await new PurchaseQuotationsService(db).findAll('t1', 1, 20, { timezone: TZ, dateTo: '2026-11-30' });
            expect(db.purchaseQuotation.findMany.mock.calls[0][0].where.valid_until).toEqual({ lte: expect.any(Date) });
        });

        it('counts pending, accepted, converted and expired quotations', async () => {
            db.purchaseQuotation.count
                .mockResolvedValueOnce(9) // all
                .mockResolvedValueOnce(4) // pending
                .mockResolvedValueOnce(2) // converted
                .mockResolvedValueOnce(1); // expired
            db.purchaseQuotation.aggregate
                .mockResolvedValueOnce({ _sum: { total_amount: 7000 } })
                .mockResolvedValueOnce({ _count: { _all: 2 }, _sum: { total_amount: 1500 } });

            const summary = await new PurchaseQuotationsService(db).summary('t1', { timezone: TZ });

            expect(summary).toEqual({
                count: 9,
                value: 7000,
                pending: 4,
                accepted: { count: 2, amount: 1500 },
                converted: 2,
                expired: 1,
            });
            expect(db.purchaseQuotation.aggregate.mock.calls[0][0].where.AND[1]).toEqual({
                status: { notIn: ['CANCELLED', 'REJECTED'] },
            });
        });
    });
});
