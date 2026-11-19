import { CrmRfmService } from './crm-rfm.service';

describe('CrmRfmService', () => {
    let service: CrmRfmService;
    let db: { sale: { groupBy: jest.Mock }; customer: { findMany: jest.Mock } };

    const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-11-15T06:00:00Z'));
        db = {
            sale: { groupBy: jest.fn().mockResolvedValue([]) },
            // Names are cosmetic here; the scoring is what these tests are about.
            customer: { findMany: jest.fn().mockResolvedValue([]) },
        };
        service = new CrmRfmService(db as any);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('reads completed sales per customer, with no exchange filter to get wrong', async () => {
        await service.report('tenant-1');

        expect(db.sale.groupBy).toHaveBeenCalledWith({
            where: {
                tenant_id: 'tenant-1',
                status: 'COMPLETED',
                customer_id: { not: null },
            },
            by: ['customer_id'],
            _count: { _all: true },
            _min: { sale_date: true },
            _max: { sale_date: true },
            _sum: { total_amount: true },
        });
    });

    it('scores recency, frequency and monetary value on a 1–5 scale', async () => {
        // Five customers with deliberately spread figures.
        db.sale.groupBy.mockResolvedValue([
            { customer_id: 'a', _count: { _all: 1 }, _min: { sale_date: day('2026-11-14') }, _max: { sale_date: day('2026-11-14') }, _sum: { total_amount: 100 } },
            { customer_id: 'b', _count: { _all: 2 }, _min: { sale_date: day('2026-10-01') }, _max: { sale_date: day('2026-11-01') }, _sum: { total_amount: 500 } },
            { customer_id: 'c', _count: { _all: 4 }, _min: { sale_date: day('2026-01-01') }, _max: { sale_date: day('2026-10-01') }, _sum: { total_amount: 2000 } },
            { customer_id: 'd', _count: { _all: 8 }, _min: { sale_date: day('2025-01-01') }, _max: { sale_date: day('2026-09-01') }, _sum: { total_amount: 9000 } },
            { customer_id: 'e', _count: { _all: 12 }, _min: { sale_date: day('2024-01-01') }, _max: { sale_date: day('2026-06-01') }, _sum: { total_amount: 40000 } },
        ]);

        const res = await service.report('tenant-1');

        // Most recent, most frequent and highest-spending all score 5.
        expect(res.rows.find((r) => r.customer_id === 'a')?.recency).toBe(5);
        expect(res.rows.find((r) => r.customer_id === 'e')?.frequency).toBe(5);
        expect(res.rows.find((r) => r.customer_id === 'e')?.monetary).toBe(5);
        // Least recent, least frequent and lowest-spending all score 1.
        expect(res.rows.find((r) => r.customer_id === 'e')?.recency).toBe(1);
        expect(res.rows.find((r) => r.customer_id === 'a')?.frequency).toBe(1);
        expect(res.rows.find((r) => r.customer_id === 'a')?.monetary).toBe(1);
    });

    it('names the segment both scores point at', async () => {
        db.sale.groupBy.mockResolvedValue([
            { customer_id: 'champion', _count: { _all: 10 }, _min: { sale_date: day('2025-01-01') }, _max: { sale_date: day('2026-11-14') }, _sum: { total_amount: 50000 } },
            { customer_id: 'lapsed', _count: { _all: 9 }, _min: { sale_date: day('2024-01-01') }, _max: { sale_date: day('2025-06-01') }, _sum: { total_amount: 40000 } },
            { customer_id: 'new', _count: { _all: 1 }, _min: { sale_date: day('2026-11-10') }, _max: { sale_date: day('2026-11-10') }, _sum: { total_amount: 100 } },
        ]);

        const res = await service.report('tenant-1');

        expect(res.rows.find((r) => r.customer_id === 'champion')?.segment).toBe('champion');
        expect(res.rows.find((r) => r.customer_id === 'new')?.segment).toBe('new');
        expect(res.rows.find((r) => r.customer_id === 'lapsed')?.segment).toBe('at_risk');
    });

    it('counts how many customers sit in each segment', async () => {
        db.sale.groupBy.mockResolvedValue([
            // Very recent, very frequent, and the biggest spender in the book.
            { customer_id: 'c1', _count: { _all: 12 }, _min: { sale_date: day('2025-01-01') }, _max: { sale_date: day('2026-11-14') }, _sum: { total_amount: 90000 } },
            { customer_id: 'c2', _count: { _all: 9 }, _min: { sale_date: day('2024-01-01') }, _max: { sale_date: day('2026-11-13') }, _sum: { total_amount: 30000 } },
        ]);

        const res = await service.report('tenant-1');

        const counted = res.by_segment.reduce((sum, row) => sum + row.customers, 0);
        expect(counted).toBe(2);
        expect(res.totals.customers).toBe(2);
        // The larger book is the champion; the other is still worth keeping.
        expect(res.by_segment.find((s) => s.segment === 'champion')?.customers).toBe(1);
        expect(res.by_segment.some((s) => s.segment === 'loyal')).toBe(true);
    });

    it('counts recency on the tenant calendar, not in 24-hour blocks', async () => {
        db.sale.groupBy.mockResolvedValue([
            { customer_id: 'c1', _count: { _all: 1 }, _min: { sale_date: new Date('2026-11-14T20:00:00Z') }, _max: { sale_date: new Date('2026-11-14T20:00:00Z') }, _sum: { total_amount: 100 } },
        ]);

        const res = await service.report('tenant-1');

        // 20:00 UTC on the 14th is 02:00 on the 15th in Dhaka — one day, not two.
        expect(res.rows[0].recency_days).toBe(0);
    });

    it('sorts the list by customer value, highest first', async () => {
        db.sale.groupBy.mockResolvedValue([
            { customer_id: 'small', _count: { _all: 1 }, _min: { sale_date: day('2026-11-14') }, _max: { sale_date: day('2026-11-14') }, _sum: { total_amount: 100 } },
            { customer_id: 'large', _count: { _all: 6 }, _min: { sale_date: day('2025-01-01') }, _max: { sale_date: day('2026-11-14') }, _sum: { total_amount: 30000 } },
        ]);

        const res = await service.report('tenant-1');

        expect(res.rows[0].customer_id).toBe('large');
    });

    it('gives everybody the middle score rather than inventing a spread when all are equal', async () => {
        db.sale.groupBy.mockResolvedValue([
            { customer_id: 'a', _count: { _all: 3 }, _min: { sale_date: day('2026-01-01') }, _max: { sale_date: day('2026-10-01') }, _sum: { total_amount: 1000 } },
            { customer_id: 'b', _count: { _all: 3 }, _min: { sale_date: day('2026-01-01') }, _max: { sale_date: day('2026-10-01') }, _sum: { total_amount: 1000 } },
        ]);

        const res = await service.report('tenant-1');

        for (const row of res.rows) {
            expect(row.recency).toBe(3);
            expect(row.frequency).toBe(3);
            expect(row.monetary).toBe(3);
        }
    });

    it('reports an empty book without dividing by zero', async () => {
        const res = await service.report('tenant-1');

        expect(res.rows).toHaveLength(0);
        expect(res.totals.customers).toBe(0);
        expect(res.totals.revenue).toBe(0);
    });
});
