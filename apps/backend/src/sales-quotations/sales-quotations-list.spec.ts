import { SalesQuotationsService } from './sales-quotations.service';
import { SalesQuotationsController } from './sales-quotations.controller';

/**
 * The quotations list's filter row and the stats strip above it. Rows and
 * strip go through one `where`, so the strip always counts the rows shown.
 */
describe('sales quotations list', () => {
    const TZ = 'Asia/Dhaka';
    let db: any;
    const service = () => new SalesQuotationsService(db, {} as any, {} as any, {} as any);

    beforeEach(() => {
        db = {
            quotation: {
                findMany: jest.fn().mockResolvedValue([]),
                count: jest.fn().mockResolvedValue(0),
                aggregate: jest.fn().mockResolvedValue({ _count: { _all: 0 }, _sum: {} }),
            },
        };
    });

    const listWhere = async (opts: Record<string, unknown>) => {
        await service().findAll('t1', 1, 20, { timezone: TZ, ...opts });
        return db.quotation.findMany.mock.calls[0][0].where;
    };

    it('filters valid-until as the document date, the kind, and an inverted status set', async () => {
        const w = await listWhere({
            dateFrom: '2026-11-01',
            dateTo: '2026-11-30',
            docKind: 'PROFORMA',
            statuses: ['REVISED', 'REJECTED'],
            statusExclude: true,
            total: { op: 'gt', value: 5000 },
        });
        expect(w.valid_until).toEqual({ gte: expect.any(Date), lte: expect.any(Date) });
        expect(w.doc_kind).toBe('PROFORMA');
        expect(w.status).toEqual({ notIn: ['REVISED', 'REJECTED'] });
        expect(w.total_amount).toEqual({ gt: 5000 });
    });

    it('matches customers by id and "none" as a walk-in quotation', async () => {
        const w = await listWhere({ customerIds: ['c1', 'none'] });
        expect(w.AND).toEqual([{ OR: [{ customer_id: { in: ['c1'] } }, { customer_id: null }] }]);
    });

    it('searches the number, the notes and the customer', async () => {
        const w = await listWhere({ search: 'karim' });
        expect(w.AND[0].OR).toEqual(
            expect.arrayContaining([
                { quote_number: { contains: 'karim', mode: 'insensitive' } },
                { customer: { name: { contains: 'karim', mode: 'insensitive' } } },
                { customer: { phone: { contains: 'karim', mode: 'insensitive' } } },
            ]),
        );
    });

    it('sorts by a column the server knows, and falls back to newest first', async () => {
        await service().findAll('t1', 1, 20, { timezone: TZ, sortBy: 'customer', sortDir: 'asc' });
        expect(db.quotation.findMany.mock.calls[0][0].orderBy).toEqual({ customer: { name: 'asc' } });
        await service().findAll('t1', 1, 20, { timezone: TZ, sortBy: 'notes; drop', sortDir: 'asc' });
        expect(db.quotation.findMany.mock.calls[1][0].orderBy).toEqual({ created_at: 'desc' });
    });

    it('counts awaiting, accepted, converted and expired quotations, in taka', async () => {
        db.quotation.count
            .mockResolvedValueOnce(9) // all
            .mockResolvedValueOnce(4) // awaiting
            .mockResolvedValueOnce(2) // converted
            .mockResolvedValueOnce(1); // expired
        db.quotation.aggregate
            .mockResolvedValueOnce({ _count: { _all: 6 }, _sum: { total_amount: 7000 } }) // live, in taka
            .mockResolvedValueOnce({ _count: { _all: 1 }, _sum: { total_amount: 1500 } }); // accepted, in taka
        db.quotation.findMany
            // A USD 100 proforma at 120: ৳12,000, never "100" added to taka.
            .mockResolvedValueOnce([{ total_amount: 100, exchange_rate: 120 }])
            .mockResolvedValueOnce([]);

        const summary = await service().summary('t1', { timezone: TZ, customerIds: ['c1'] });

        expect(summary).toEqual({
            count: 9,
            value: 19000,
            awaiting: 4,
            accepted: { count: 1, amount: 1500 },
            converted: 2,
            expired: 1,
        });
        const liveWhere = db.quotation.aggregate.mock.calls[0][0].where;
        expect(liveWhere.AND[1]).toEqual({ currency: 'BDT' });
        expect(liveWhere.AND[0].AND[1]).toEqual({ status: { notIn: ['REJECTED', 'EXPIRED', 'REVISED'] } });
        expect(liveWhere.AND[0].AND[0].AND).toEqual([{ customer_id: { in: ['c1'] } }]);
        const expiredWhere = db.quotation.count.mock.calls[3][0].where.AND[1];
        expect(expiredWhere).toEqual({
            OR: [
                { status: 'EXPIRED' },
                { status: { in: ['DRAFT', 'SENT', 'ACCEPTED'] }, valid_until: { lt: expect.any(Date) } },
            ],
        });
    });

    describe('controller', () => {
        const tenant = { tenantId: 't1', timezone: TZ } as any;
        const branchScope = { resolveStoreId: jest.fn().mockResolvedValue('b1') };

        it('reads the same filters for the list and the summary, allow-listing the kind', async () => {
            const quotations = { findAll: jest.fn(), summary: jest.fn() };
            const controller = new SalesQuotationsController(quotations as any, branchScope as any);
            const query = { page: 1, limit: 20, status: 'SENT', customerId: 'none', docKind: 'HACK', dateTo: '2026-11-30' } as any;

            await controller.findAll(tenant, query);
            await controller.summary(tenant, query);

            const listOpts = quotations.findAll.mock.calls[0][3];
            const summaryOpts = quotations.summary.mock.calls[0][1];
            expect(listOpts).toMatchObject({ statuses: ['SENT'], customerIds: ['none'], storeId: 'b1', dateTo: '2026-11-30' });
            expect(listOpts.docKind).toBeUndefined();
            expect(summaryOpts).toMatchObject({ statuses: ['SENT'], customerIds: ['none'], storeId: 'b1' });
        });
    });
});
