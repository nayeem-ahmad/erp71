import { BadRequestException } from '@nestjs/common';
import { SalesOrdersService } from './sales-orders.service';
import { SalesOrdersController } from './sales-orders.controller';

/**
 * The sales-orders list's filter row and the stats strip above it. Rows and
 * strip go through one `where`, so the strip always counts the rows shown.
 */
describe('sales orders list', () => {
    const TZ = 'Asia/Dhaka';
    let db: any;

    beforeEach(() => {
        db = {
            salesOrder: {
                findMany: jest.fn().mockResolvedValue([]),
                count: jest.fn().mockResolvedValue(0),
                aggregate: jest.fn().mockResolvedValue({ _count: { _all: 0 }, _sum: {} }),
            },
        };
    });

    const listWhere = async (opts: Record<string, unknown>) => {
        await new SalesOrdersService(db).findAll('t1', 1, 20, { timezone: TZ, ...opts });
        return db.salesOrder.findMany.mock.calls[0][0].where;
    };

    it('filters the delivery date as the document date, with status, payment state and total', async () => {
        const w = await listWhere({
            dateFrom: '2026-11-01',
            dateTo: '2026-11-30',
            statuses: ['CONFIRMED', 'PROCESSING'],
            paymentStatus: ['UNPAID', 'PARTIAL'],
            total: { op: 'between', value: 100, to: 900 },
            storeId: 'b1',
        });
        expect(w.delivery_date).toEqual({ gte: expect.any(Date), lte: expect.any(Date) });
        expect(w.status).toEqual({ in: ['CONFIRMED', 'PROCESSING'] });
        expect(w.payment_status).toEqual({ in: ['UNPAID', 'PARTIAL'] });
        expect(w.total_amount).toEqual({ gte: 100, lte: 900 });
        expect(w.store_id).toBe('b1');
    });

    it('matches customers by id and "none" as a walk-in order, and searches the customer', async () => {
        const w = await listWhere({ customerIds: ['none'], search: '0171' });
        expect(w.AND).toContainEqual({ customer_id: null });
        expect(w.AND[0].OR).toContainEqual({ customer: { phone: { contains: '0171', mode: 'insensitive' } } });
    });

    it('sorts by a column the server knows', async () => {
        await new SalesOrdersService(db).findAll('t1', 1, 20, { timezone: TZ, sortBy: 'delivery_date', sortDir: 'desc' });
        expect(db.salesOrder.findMany.mock.calls[0][0].orderBy).toEqual({ delivery_date: 'desc' });
    });

    it('counts open, delivered and overdue orders and the advance taken, over the filtered rows', async () => {
        db.salesOrder.count
            .mockResolvedValueOnce(6) // all
            .mockResolvedValueOnce(1) // cancelled
            .mockResolvedValueOnce(2); // overdue
        db.salesOrder.aggregate
            .mockResolvedValueOnce({ _sum: { total_amount: 5000, amount_paid: 1200 } })
            .mockResolvedValueOnce({ _count: { _all: 3 }, _sum: { total_amount: 2000 } })
            .mockResolvedValueOnce({ _count: { _all: 2 }, _sum: { total_amount: 3000 } });

        const summary = await new SalesOrdersService(db).summary('t1', { timezone: TZ, paymentStatus: ['PARTIAL'] });

        expect(summary).toEqual({
            count: 6,
            cancelledCount: 1,
            value: 5000,
            advance: 1200,
            open: { count: 3, amount: 2000 },
            delivered: { count: 2, amount: 3000 },
            overdue: 2,
        });
        expect(db.salesOrder.aggregate.mock.calls[0][0].where.AND).toEqual([
            expect.objectContaining({ payment_status: { in: ['PARTIAL'] } }),
            { status: { not: 'CANCELLED' } },
        ]);
        expect(db.salesOrder.count.mock.calls[2][0].where.AND[1]).toEqual({
            status: { in: ['DRAFT', 'CONFIRMED', 'PROCESSING'] },
            delivery_date: { lt: expect.any(Date) },
        });
    });

    describe('controller', () => {
        const tenant = { tenantId: 't1', timezone: TZ } as any;
        const branchScope = { resolveStoreId: jest.fn().mockResolvedValue('b1') };

        it('reads the payment state for the list and the summary alike', async () => {
            const orders = { findAll: jest.fn(), summary: jest.fn() };
            const controller = new SalesOrdersController(orders as any, branchScope as any);
            const query = { page: 1, limit: 20, paymentStatus: 'unpaid,PAID', statusExclude: 'true', status: 'CANCELLED' } as any;

            await controller.findAll(tenant, query);
            await controller.summary(tenant, query);

            const expected = { paymentStatus: ['UNPAID', 'PAID'], statuses: ['CANCELLED'], statusExclude: true, storeId: 'b1' };
            expect(orders.findAll.mock.calls[0][3]).toMatchObject(expected);
            expect(orders.summary.mock.calls[0][1]).toMatchObject(expected);
        });

        it('refuses a payment state it does not know', async () => {
            const controller = new SalesOrdersController({ findAll: jest.fn() } as any, branchScope as any);
            await expect(controller.findAll(tenant, { page: 1, limit: 20, paymentStatus: 'OVERPAID' } as any)).rejects.toBeInstanceOf(
                BadRequestException,
            );
        });
    });
});
