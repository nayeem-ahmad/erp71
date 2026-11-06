import { SalesExchangesService } from './sales-exchanges.service';

/**
 * The exchanges list's filter row and the stats strip above it. Rows and strip
 * go through one `where`, so the strip always counts the rows shown.
 */
describe('sales exchanges list', () => {
    const TZ = 'Asia/Dhaka';
    let db: any;

    beforeEach(() => {
        db = {
            salesExchange: {
                findMany: jest.fn().mockResolvedValue([]),
                count: jest.fn().mockResolvedValue(0),
                aggregate: jest.fn().mockResolvedValue({ _count: { _all: 0 }, _sum: {} }),
            },
            postingEvent: { findMany: jest.fn().mockResolvedValue([]) },
            voucher: { findMany: jest.fn().mockResolvedValue([]) },
        };
    });

    const where = async (opts: Record<string, unknown>) => {
        await new SalesExchangesService(db).findAll('t1', 1, 20, { timezone: TZ, ...opts });
        return db.salesExchange.findMany.mock.calls[0][0].where;
    };

    it('inverts the status set, and narrows the difference and the settlement', async () => {
        const w = await where({
            storeId: 'b1',
            statuses: ['CANCELLED'],
            statusExclude: true,
            total: { op: 'gt', value: 0 },
            settlementModes: ['cash', 'bkash'],
        });
        expect(w).toMatchObject({
            tenant_id: 't1',
            store_id: 'b1',
            status: { notIn: ['CANCELLED'] },
            difference: { gt: 0 },
            settlement_mode: { in: ['cash', 'bkash'] },
        });
    });

    it('matches a customer through the sale, and "none" as a walk-in sale', async () => {
        const w = await where({ customerIds: ['c1', 'none'] });
        expect(w.AND).toEqual([
            { OR: [{ sale: { customer_id: { in: ['c1'] } } }, { sale: { customer_id: null } }] },
        ]);
    });

    it('searches the number, the invoice and the customer', async () => {
        const w = await where({ search: 'INV-9' });
        expect(w.AND[0].OR).toEqual(
            expect.arrayContaining([
                { exchange_number: { contains: 'INV-9', mode: 'insensitive' } },
                { sale: { serial_number: { contains: 'INV-9', mode: 'insensitive' } } },
                { sale: { customer: { name: { contains: 'INV-9', mode: 'insensitive' } } } },
            ]),
        );
    });

    it('sorts by the customer through the sale', async () => {
        await new SalesExchangesService(db).findAll('t1', 1, 20, { timezone: TZ, sortBy: 'customer', sortDir: 'desc' });
        expect(db.salesExchange.findMany.mock.calls[0][0].orderBy).toEqual({ sale: { customer: { name: 'desc' } } });
    });

    it('counts every exchange, and sums goods and difference over the ones that stand', async () => {
        db.salesExchange.count.mockResolvedValueOnce(7).mockResolvedValueOnce(1);
        db.salesExchange.aggregate
            .mockResolvedValueOnce({ _sum: { returned_total: 5000, replacement_total: 5600 } })
            .mockResolvedValueOnce({ _count: { _all: 4 }, _sum: { difference: 900 } })
            .mockResolvedValueOnce({ _count: { _all: 2 }, _sum: { difference: -300 } });

        const summary = await new SalesExchangesService(db).summary('t1', { timezone: TZ, settlementModes: ['cash'] });

        expect(summary).toEqual({
            count: 7,
            cancelledCount: 1,
            returned: 5000,
            replacement: 5600,
            charged: { count: 4, amount: 900 },
            refunded: { count: 2, amount: 300 },
        });
        const listWhere = db.salesExchange.count.mock.calls[0][0].where;
        expect(listWhere.settlement_mode).toEqual({ in: ['cash'] });
        expect(db.salesExchange.count.mock.calls[1][0].where).toEqual({ AND: [listWhere, { status: 'CANCELLED' }] });
        expect(db.salesExchange.aggregate.mock.calls[1][0].where).toEqual({
            AND: [listWhere, { status: { not: 'CANCELLED' } }, { difference: { gt: 0 } }],
        });
        expect(db.salesExchange.aggregate.mock.calls[2][0].where.AND[2]).toEqual({ difference: { lt: 0 } });
    });
});
