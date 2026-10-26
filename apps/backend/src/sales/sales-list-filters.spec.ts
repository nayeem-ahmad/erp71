import { SalesService } from './sales.service';

/**
 * The sales list's filter row and the stats strip above it. Both go through
 * one `where`, so the strip always counts the rows the list shows.
 */
describe('SalesService list filters and summary', () => {
    const TOTAL_REF = { modelName: 'Sale', name: 'total_amount' };
    let db: any;
    let service: SalesService;

    beforeEach(() => {
        db = {
            sale: {
                findMany: jest.fn().mockResolvedValue([]),
                count: jest.fn().mockResolvedValue(0),
                aggregate: jest.fn().mockResolvedValue({ _count: { _all: 0 }, _sum: { total_amount: null, amount_paid: null } }),
                fields: { total_amount: TOTAL_REF },
            },
            salesReturn: {
                aggregate: jest.fn().mockResolvedValue({ _count: { _all: 0 }, _sum: { total_refund: null } }),
            },
            paymentMethod: { findMany: jest.fn().mockResolvedValue([]) },
            postingEvent: { findMany: jest.fn().mockResolvedValue([]) },
            voucher: { findMany: jest.fn().mockResolvedValue([]) },
        };
        service = new SalesService(db, {} as any, {} as any, {} as any);
    });

    const listWhere = async (opts: Record<string, unknown>) => {
        await service.findAll('t1', { timezone: 'Asia/Dhaka', ...opts } as any);
        return db.sale.findMany.mock.calls[0][0].where;
    };

    it('excludes the chosen statuses when statusExclude is set', async () => {
        const where = await listWhere({ status: 'CANCELLED,DRAFT', statusExclude: true });
        expect(where.status).toEqual({ notIn: ['CANCELLED', 'DRAFT'] });
    });

    it('narrows the total and the amount paid by their conditions', async () => {
        const where = await listWhere({
            total: { op: 'between', value: 1000, to: 5000 },
            paid: { op: 'lt', value: 100 },
        });
        expect(where.total_amount).toEqual({ gte: 1000, lte: 5000 });
        expect(where.amount_paid).toEqual({ lt: 100 });
    });

    it('matches customers by id, and "none" as a walk-in sale', async () => {
        const where = await listWhere({ customerIds: ['c1', 'c2', 'none'] });
        expect(where.AND).toEqual([
            { OR: [{ customer_id: { in: ['c1', 'c2'] } }, { customer_id: null }] },
        ]);
    });

    it('matches walk-in sales alone without an empty id list', async () => {
        const where = await listWhere({ customerIds: ['none'] });
        expect(where.AND).toEqual([{ customer_id: null }]);
    });

    it('matches sales reps the same way', async () => {
        const where = await listWhere({ salesRepIds: ['r1'] });
        expect(where.AND).toEqual([{ sales_rep_id: { in: ['r1'] } }]);
    });

    it('matches a tender by its method id or, for an older tender, its name', async () => {
        db.paymentMethod.findMany.mockResolvedValue([{ id: 'pm-bkash', name: 'bKash Account' }]);
        const where = await listWhere({ paymentMethodIds: ['pm-bkash'] });
        expect(db.paymentMethod.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { tenant_id: 't1', id: { in: ['pm-bkash'] } } }),
        );
        expect(where.AND).toEqual([
            {
                payments: {
                    some: {
                        OR: [
                            { payment_method_id: { in: ['pm-bkash'] } },
                            { payment_method_name: { in: ['bKash Account'] } },
                        ],
                    },
                },
            },
        ]);
    });

    it('matches nothing for a payment method this tenant does not have', async () => {
        const where = await listWhere({ paymentMethodIds: ['someone-elses'] });
        expect(where.AND).toEqual([{ id: { in: [] } }]);
    });

    it('compares amount paid with the sale\'s own total for payment status', async () => {
        const where = await listWhere({ paymentStatus: ['partial', 'unpaid'] });
        expect(where.AND).toEqual([
            {
                OR: [
                    { amount_paid: { gt: 0, lt: TOTAL_REF } },
                    { amount_paid: { lte: 0 }, total_amount: { gt: 0 } },
                ],
            },
        ]);
    });

    it('keeps the search OR and the new clauses apart, column filters after them', async () => {
        const where = await listWhere({
            search: 'INV',
            salesRepIds: ['r1'],
            filters: { serial_number: '42' },
        });
        expect(where.OR).toHaveLength(4);
        expect(where.AND).toEqual([
            { sales_rep_id: { in: ['r1'] } },
            { serial_number: { contains: '42', mode: 'insensitive' } },
        ]);
    });

    describe('summary()', () => {
        it('counts every matching sale but sums only the ones that took money', async () => {
            db.sale.count.mockResolvedValueOnce(248).mockResolvedValueOnce(7);
            db.sale.aggregate.mockResolvedValue({
                _count: { _all: 240 },
                _sum: { total_amount: '1245300.00', amount_paid: '1098750.00' },
            });
            db.salesReturn.aggregate.mockResolvedValue({ _count: { _all: 6 }, _sum: { total_refund: '38400.00' } });

            const result = await service.summary('t1', { timezone: 'Asia/Dhaka', status: 'COMPLETED,CANCELLED' });

            expect(result).toEqual({
                count: 248,
                cancelledCount: 7,
                revenueCount: 240,
                gross: 1245300,
                collected: 1098750,
                due: 146550,
                average: 5188.75,
                returns: { count: 6, amount: 38400 },
            });

            const listWhere = db.sale.count.mock.calls[0][0].where;
            expect(listWhere).toEqual({ tenant_id: 't1', status: { in: ['COMPLETED', 'CANCELLED'] } });
            const revenueWhere = { AND: [listWhere, { status: { notIn: ['CANCELLED', 'DRAFT'] } }] };
            expect(db.sale.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: revenueWhere }));
            expect(db.salesReturn.aggregate).toHaveBeenCalledWith(expect.objectContaining({
                where: { tenant_id: 't1', status: { not: 'CANCELLED' }, sale: revenueWhere },
            }));
        });

        it('reports zeros, not NaN, when nothing matches', async () => {
            const result = await service.summary('t1', { timezone: 'Asia/Dhaka' });
            expect(result).toEqual({
                count: 0,
                cancelledCount: 0,
                revenueCount: 0,
                gross: 0,
                collected: 0,
                due: 0,
                average: 0,
                returns: { count: 0, amount: 0 },
            });
        });

        it('never reports a negative due when a sale was overpaid', async () => {
            db.sale.aggregate.mockResolvedValue({ _count: { _all: 1 }, _sum: { total_amount: '100', amount_paid: '120' } });
            const result = await service.summary('t1', { timezone: 'Asia/Dhaka' });
            expect(result.due).toBe(0);
        });
    });
});
