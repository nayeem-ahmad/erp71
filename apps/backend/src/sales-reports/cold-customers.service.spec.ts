import { ColdCustomersService } from './cold-customers.service';

describe('ColdCustomersService', () => {
    let service: ColdCustomersService;
    let db: {
        sale: { groupBy: jest.Mock };
        customer: { findMany: jest.Mock };
        crmActivity: { findMany: jest.Mock };
    };

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-11-15T06:00:00Z'));

        db = {
            sale: { groupBy: jest.fn().mockResolvedValue([]) },
            customer: { findMany: jest.fn().mockResolvedValue([]) },
            crmActivity: { findMany: jest.fn().mockResolvedValue([]) },
        };
        service = new ColdCustomersService(db as any);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('flags a repeat customer silent for more than factor × their usual gap', async () => {
        // first sale 2026-09-01, last 2026-10-01, 4 orders (gap 10) -> 45 days since > 20 -> listed, avg_gap_days 10, overdue_days 35
        db.sale.groupBy.mockResolvedValue([
            {
                customer_id: 'c1',
                _count: { _all: 4 },
                _min: { sale_date: new Date('2026-09-01T00:00:00Z') },
                _max: { sale_date: new Date('2026-10-01T00:00:00Z') },
                _sum: { total_amount: 5000 },
            },
        ]);
        db.customer.findMany.mockResolvedValue([
            {
                id: 'c1',
                name: 'Rahim',
                phone: '01700000000',
                customer_code: 'CUST-001',
                segment_category: 'VIP',
                last_contacted_at: null,
            },
        ]);

        const res = await service.report('tenant-1', {}, 'Asia/Dhaka');

        expect(res.rows).toHaveLength(1);
        const row = res.rows[0];
        expect(row.customer_id).toBe('c1');
        expect(row.avg_gap_days).toBe(10);
        expect(row.days_since_last).toBe(45);
        expect(row.overdue_days).toBe(35);
        expect(row.orders).toBe(4);
        expect(row.lifetime_spend).toBe(5000);
    });

    it('does not flag a customer inside their rhythm', async () => {
        // gap 30, last sale 2026-10-25 -> absent (21 days since <= 60)
        db.sale.groupBy.mockResolvedValue([
            {
                customer_id: 'c1',
                _count: { _all: 2 },
                _min: { sale_date: new Date('2026-09-25T00:00:00Z') },
                _max: { sale_date: new Date('2026-10-25T00:00:00Z') },
                _sum: { total_amount: 1000 },
            },
        ]);

        const res = await service.report('tenant-1', {}, 'Asia/Dhaka');

        expect(res.rows).toHaveLength(0);
    });

    it('ignores one-time buyers', async () => {
        db.sale.groupBy.mockResolvedValue([
            {
                customer_id: 'c1',
                _count: { _all: 1 },
                _min: { sale_date: new Date('2026-09-01T00:00:00Z') },
                _max: { sale_date: new Date('2026-09-01T00:00:00Z') },
                _sum: { total_amount: 500 },
            },
        ]);

        const res = await service.report('tenant-1', {}, 'Asia/Dhaka');

        expect(db.sale.groupBy).toHaveBeenCalledWith(
            expect.objectContaining({
                having: {
                    customer_id: { _count: { gt: 1 } },
                },
            }),
        );
        expect(res.rows).toHaveLength(0);
    });

    it('floors the usual gap at minGapDays', async () => {
        // 2 orders on 2026-11-12 (gap 0), defaults -> 3 days since, not over 14, so absent
        db.sale.groupBy.mockResolvedValue([
            {
                customer_id: 'c1',
                _count: { _all: 2 },
                _min: { sale_date: new Date('2026-11-12T00:00:00Z') },
                _max: { sale_date: new Date('2026-11-12T00:00:00Z') },
                _sum: { total_amount: 800 },
            },
        ]);

        const res = await service.report('tenant-1', {}, 'Asia/Dhaka');

        expect(res.rows).toHaveLength(0);
    });

    it('counts days on the tenant calendar', async () => {
        // 2 orders, first at 2026-10-01T04:00:00Z and last at 2026-10-14T20:00:00Z (02:00 on 10-15 in Dhaka)
        // -> last_purchase_date '2026-10-15', avg_gap_days 14, days_since_last 31. Dating by UTC would give 32.
        db.sale.groupBy.mockResolvedValue([
            {
                customer_id: 'c1',
                _count: { _all: 2 },
                _min: { sale_date: new Date('2026-10-01T04:00:00Z') },
                _max: { sale_date: new Date('2026-10-14T20:00:00Z') },
                _sum: { total_amount: 1500 },
            },
        ]);
        db.customer.findMany.mockResolvedValue([
            {
                id: 'c1',
                name: 'Karim',
                phone: null,
                customer_code: null,
                segment_category: 'Regular',
                last_contacted_at: null,
            },
        ]);

        const res = await service.report('tenant-1', {}, 'Asia/Dhaka');

        expect(res.rows).toHaveLength(1);
        const row = res.rows[0];
        expect(row.last_purchase_date).toBe('2026-10-15');
        expect(row.avg_gap_days).toBe(14);
        expect(row.days_since_last).toBe(31);
    });

    it('marks customers that already have a planned follow-up', async () => {
        db.sale.groupBy.mockResolvedValue([
            {
                customer_id: 'c1',
                _count: { _all: 3 },
                _min: { sale_date: new Date('2026-09-01T00:00:00Z') },
                _max: { sale_date: new Date('2026-09-10T00:00:00Z') },
                _sum: { total_amount: 2000 },
            },
        ]);
        db.customer.findMany.mockResolvedValue([
            {
                id: 'c1',
                name: 'Customer 1',
                phone: null,
                customer_code: null,
                segment_category: 'Regular',
                last_contacted_at: null,
            },
        ]);
        db.crmActivity.findMany.mockResolvedValue([
            { customer_id: 'c1' },
        ]);

        const res = await service.report('tenant-1', {}, 'Asia/Dhaka');

        expect(res.rows[0].has_open_follow_up).toBe(true);
        expect(db.crmActivity.findMany).toHaveBeenCalledWith({
            where: {
                tenant_id: 'tenant-1',
                status: 'PLANNED',
                customer_id: { in: ['c1'] },
            },
            select: { customer_id: true },
            distinct: ['customer_id'],
        });
    });

    it('keeps the 2000 most valuable and says it truncated', async () => {
        const rows = [];
        for (let i = 1; i <= 2001; i++) {
            rows.push({
                customer_id: `c${i}`,
                _count: { _all: 3 },
                _min: { sale_date: new Date('2026-09-01T00:00:00Z') },
                _max: { sale_date: new Date('2026-09-10T00:00:00Z') },
                _sum: { total_amount: i * 10 }, // highest spend has highest i
            });
        }
        db.sale.groupBy.mockResolvedValue(rows);
        db.customer.findMany.mockImplementation(async ({ where }) => {
            return where.id.in.map((id: string) => ({
                id,
                name: `Name ${id}`,
                phone: null,
                customer_code: null,
                segment_category: 'Regular',
                last_contacted_at: null,
            }));
        });

        const res = await service.report('tenant-1', {}, 'Asia/Dhaka');

        expect(res.rows).toHaveLength(2000);
        expect(res.total).toBe(2001);
        expect(res.truncated).toBe(true);
        expect(res.rows[0].lifetime_spend).toBe(2001 * 10);
    });

    it('scopes to the branch when storeId is given', async () => {
        await service.report('tenant-1', { storeId: 'store-1' }, 'Asia/Dhaka');

        expect(db.sale.groupBy).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    tenant_id: 'tenant-1',
                    store_id: 'store-1',
                }),
            }),
        );
    });
});
