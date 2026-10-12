import { MobilePulseService, percentChange } from './mobile-pulse.service';
import { tenderKey } from './tender-key';

describe('MobilePulseService', () => {
    const sale = (net: number, count = 1) => ({
        gross: net,
        returns: 0,
        net,
        count,
        returns_count: 0,
        avg_ticket: count > 0 ? net / count : null,
    });

    let db: any;
    let redis: { get: jest.Mock; set: jest.Mock };
    let sales: any;
    let service: MobilePulseService;

    beforeEach(() => {
        jest.useFakeTimers({ now: new Date('2026-10-07T08:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate'] });
        db = {
            paymentRecord: { groupBy: jest.fn().mockResolvedValue([]) },
            supplier: {
                aggregate: jest.fn().mockResolvedValue({ _sum: { due_balance: 12000 } }),
                count: jest.fn().mockResolvedValue(3),
            },
        };
        redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn() };
        sales = {
            saleWhere: jest.fn((tenantId: string, window: any, storeId?: string) => ({
                tenant_id: tenantId,
                window: window.from,
                ...(storeId ? { store_id: storeId } : {}),
            })),
            getSales: jest.fn(async (_t: string, window: any) =>
                ({ '2026-10-07': sale(6000, 4), '2026-10-06': sale(4000, 2), '2026-09-30': sale(0, 0) })[
                    window.from as string
                ],
            ),
            getMargin: jest.fn().mockResolvedValue({ gross_profit: 1500, margin_pct: 25, costed_items: 4, uncosted_items: 0, units: 6 }),
            getTrends: jest.fn().mockResolvedValue({
                points: [{ date: '2026-10-07', net_sales: 6000, orders: 4, returns: 0 }],
            }),
            getReceivables: jest.fn().mockResolvedValue({ outstanding: 8000, customers_owing: 5 }),
        };
        service = new MobilePulseService(db, redis as any, sales);
    });

    afterEach(() => jest.useRealTimers());

    it("compares today with yesterday and the same weekday last week, in the tenant's days", async () => {
        const pulse = await service.getPulse('t1', 'store-1', 'Asia/Dhaka', { includePayables: true });

        expect(pulse.date).toBe('2026-10-07');
        expect(sales.getSales.mock.calls.map((c: any[]) => [c[1].from, c[1].to, c[2]])).toEqual([
            ['2026-10-07', '2026-10-07', 'store-1'],
            ['2026-10-06', '2026-10-06', 'store-1'],
            ['2026-09-30', '2026-09-30', 'store-1'],
        ]);
        expect(pulse.today).toEqual(expect.objectContaining({ net: 6000, count: 4, date: '2026-10-07' }));
        expect(pulse.last_week.date).toBe('2026-09-30');
        expect(pulse.change).toEqual({ vs_yesterday_pct: 50, vs_last_week_pct: null });
        // Seven days ending today, on the same branch.
        expect(sales.getTrends).toHaveBeenCalledWith(
            't1',
            { from: '2026-10-01', to: '2026-10-07', storeId: 'store-1' },
            'Asia/Dhaka',
        );
        expect(pulse.payables).toEqual({ outstanding: 12000, suppliers_owing: 3 });
    });

    it("groups today's tenders for reading, wallets apart, largest first", async () => {
        db.paymentRecord.groupBy.mockResolvedValue([
            { payment_method: 'Cash', _sum: { amount: 1000 } },
            { payment_method: 'CASH', _sum: { amount: 500 } },
            { payment_method: 'BKASH', _sum: { amount: 2500 } },
            { payment_method: 'Nagad', _sum: { amount: 300 } },
            { payment_method: 'Mobile Wallet', _sum: { amount: 200 } },
            { payment_method: 'Card', _sum: { amount: 0 } },
        ]);

        const pulse = await service.getPulse('t1', undefined, 'Asia/Dhaka', { includePayables: true });

        expect(db.paymentRecord.groupBy).toHaveBeenCalledWith(
            expect.objectContaining({ where: { sale: { tenant_id: 't1', window: '2026-10-07' } } }),
        );
        expect(pulse.tenders).toEqual([
            { key: 'bkash', label: 'bKash', amount: 2500 },
            { key: 'cash', label: 'Cash', amount: 1500 },
            { key: 'nagad', label: 'Nagad', amount: 300 },
            { key: 'wallet', label: 'Mobile wallet', amount: 200 },
        ]);
        expect(pulse.store_id).toBeNull();
    });

    it('caches a fresh build per tenant and branch, and serves the cached copy without re-storing it', async () => {
        const first = await service.getPulse('t1', 'store-1', 'Asia/Dhaka', { includePayables: true });
        expect(redis.get).toHaveBeenCalledWith('mobile:pulse:t1:store-1');
        expect(redis.set).toHaveBeenCalledWith('mobile:pulse:t1:store-1', first, 60);

        redis.get.mockResolvedValue(first);
        redis.set.mockClear();
        sales.getSales.mockClear();
        await service.getPulse('t1', 'store-1', 'Asia/Dhaka', { includePayables: true });
        expect(sales.getSales).not.toHaveBeenCalled();
        // Re-storing would restart the TTL and the figures would never refresh.
        expect(redis.set).not.toHaveBeenCalled();

        await service.getPulse('t1', undefined, 'Asia/Dhaka', { includePayables: true });
        expect(redis.get).toHaveBeenLastCalledWith('mobile:pulse:t1:all');
    });

    it("withholds payables from a caller who may not read purchasing, even from another caller's cached copy", async () => {
        const cached = await service.getPulse('t1', 'store-1', 'Asia/Dhaka', { includePayables: true });
        redis.get.mockResolvedValue(cached);

        const pulse = await service.getPulse('t1', 'store-1', 'Asia/Dhaka', { includePayables: false });

        expect(pulse.payables).toBeNull();
        expect(pulse.receivables).toEqual({ outstanding: 8000, customers_owing: 5 });
        // The cached copy itself is untouched for the next caller.
        expect(cached.payables).not.toBeNull();
    });
});

describe('percentChange', () => {
    it('is null with nothing to compare against, never infinite or zero', () => {
        expect(percentChange(500, 0)).toBeNull();
        expect(percentChange(0, 0)).toBeNull();
        expect(percentChange(150, 100)).toBe(50);
        expect(percentChange(0, 100)).toBe(-100);
        expect(percentChange(1, 3)).toBe(-66.7);
    });
});

describe('tenderKey', () => {
    it.each([
        ['Cash', 'cash'],
        ['CASH', 'cash'],
        ['bKash', 'bkash'],
        ['BKASH', 'bkash'],
        ['Nagad', 'nagad'],
        ['Mobile Wallet', 'wallet'],
        ['Rocket', 'wallet'],
        ['Card', 'card'],
        ['Credit Card', 'card'],
        ['Customer Credit', 'credit'],
        ['Bank', 'bank'],
        ['Bank Transfer', 'bank'],
        ['Cheque', 'bank'],
        // An unrecognised custom method is cash, as the ledger assumes.
        ['Shop voucher', 'cash'],
    ])('%s → %s', (method, key) => {
        expect(tenderKey(method)).toBe(key);
    });
});
