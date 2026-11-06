import { SalesReturnsService } from './sales-returns.service';
import { readSalesDocumentListFilters } from '../common/sales-document-list-filters';

/**
 * The sales-returns list's filter row and the stats strip above it. Rows and
 * strip go through one `where`, so the strip always counts the rows shown.
 */
describe('sales returns list', () => {
    const TZ = 'Asia/Dhaka';
    const model = () => ({
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _count: { _all: 0 }, _sum: {} }),
    });
    let db: any;

    beforeEach(() => {
        db = {
            salesReturn: model(),
            salesReturnPayment: model(),
            postingEvent: { findMany: jest.fn().mockResolvedValue([]) },
            voucher: { findMany: jest.fn().mockResolvedValue([]) },
        };
    });

    const where = async (opts: Record<string, unknown>) => {
        await new SalesReturnsService(db).findAll('t1', 1, 20, { timezone: TZ, ...opts });
        return db.salesReturn.findMany.mock.calls[0][0].where;
    };

    it('reads customers, the amount condition and the search off the query', () => {
        const filters = readSalesDocumentListFilters(
            { customerId: 'c1,none', total: 'gt:500', search: ' ret-1 ', page: 1, limit: 20 },
            { storeId: 'b1', timezone: TZ },
        );
        expect(filters).toMatchObject({
            customerIds: ['c1', 'none'],
            total: { op: 'gt', value: 500 },
            search: 'ret-1',
            storeId: 'b1',
        });
    });

    it('scopes to the tenant and branch, and narrows the refund amount', async () => {
        const w = await where({ storeId: 'b1', total: { op: 'between', value: 100, to: 900 } });
        expect(w.tenant_id).toBe('t1');
        expect(w.store_id).toBe('b1');
        expect(w.total_refund).toEqual({ gte: 100, lte: 900 });
    });

    it('matches a customer through the sale, and "none" as a walk-in or sale-less return', async () => {
        const w = await where({ customerIds: ['c1', 'none'] });
        expect(w.AND).toEqual([
            {
                OR: [
                    { sale: { customer_id: { in: ['c1'] } } },
                    { sale_id: null },
                    { sale: { customer_id: null } },
                ],
            },
        ]);
    });

    it('searches the number, the receipt and the customer', async () => {
        const w = await where({ search: 'rahim' });
        expect(w.AND[0].OR).toEqual(
            expect.arrayContaining([
                { return_number: { contains: 'rahim', mode: 'insensitive' } },
                { sale: { serial_number: { contains: 'rahim', mode: 'insensitive' } } },
                { sale: { customer: { name: { contains: 'rahim', mode: 'insensitive' } } } },
            ]),
        );
    });

    it('sorts by a column the server knows, and falls back to newest first', async () => {
        await new SalesReturnsService(db).findAll('t1', 1, 20, { timezone: TZ, sortBy: 'total_refund', sortDir: 'asc' });
        expect(db.salesReturn.findMany.mock.calls[0][0].orderBy).toEqual({ total_refund: 'asc' });
        await new SalesReturnsService(db).findAll('t1', 1, 20, { timezone: TZ, sortBy: 'items; DROP', sortDir: 'asc' });
        expect(db.salesReturn.findMany.mock.calls[1][0].orderBy).toEqual({ created_at: 'desc' });
    });

    it('splits the returned value into money refunded and due adjusted, over the same where', async () => {
        db.salesReturn.aggregate
            .mockResolvedValueOnce({ _count: { _all: 4 }, _sum: { total_refund: 1000 } }) // all
            .mockResolvedValueOnce({ _sum: { total_refund: 100 } }); // saved before tenders
        db.salesReturnPayment.aggregate.mockResolvedValue({ _sum: { amount: 300 } });

        const summary = await new SalesReturnsService(db).summary('t1', { timezone: TZ, customerIds: ['c1'] });

        expect(summary).toEqual({ count: 4, amount: 1000, refunded: 400, adjusted: 600, average: 250 });
        const listWhere = db.salesReturn.aggregate.mock.calls[0][0].where;
        expect(listWhere.AND).toEqual([{ sale: { customer_id: { in: ['c1'] } } }]);
        expect(db.salesReturnPayment.aggregate.mock.calls[0][0].where).toEqual({
            return: { AND: [listWhere, { tenders_recorded: true }] },
        });
        expect(db.salesReturn.aggregate.mock.calls[1][0].where).toEqual({ AND: [listWhere, { tenders_recorded: false }] });
    });

    it('reports an empty list as zeros', async () => {
        const summary = await new SalesReturnsService(db).summary('t1', { timezone: TZ });
        expect(summary).toEqual({ count: 0, amount: 0, refunded: 0, adjusted: 0, average: 0 });
    });
});
