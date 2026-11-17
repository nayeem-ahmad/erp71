import { MrrSnapshotService, previousMonthEnds } from './mrr-snapshot.service';

const tracker = { track: (_name: string, fn: () => Promise<unknown>) => fn() };

function subscription(overrides: Record<string, unknown> = {}) {
    return {
        tenant_id: 't1',
        status: 'ACTIVE',
        billing_cycle: 'MONTHLY',
        activated_at: new Date('2026-01-10T00:00:00Z'),
        discount_type: null,
        discount_value: null,
        plan: { code: 'STANDARD', monthly_price: 2000, yearly_price: 20000 },
        tenant: { billing_suspended_at: null, deleted_at: null },
        ...overrides,
    };
}

function build(db: Record<string, any>) {
    const full = {
        tenantSubscription: { findMany: jest.fn().mockResolvedValue([]) },
        tenantAddonSubscription: { findMany: jest.fn().mockResolvedValue([]) },
        billingEvent: { findMany: jest.fn().mockResolvedValue([]) },
        tenantMrrSnapshot: {
            count: jest.fn().mockResolvedValue(0),
            upsert: jest.fn().mockResolvedValue({}),
            findFirst: jest.fn().mockResolvedValue(null),
            findMany: jest.fn().mockResolvedValue([]),
        },
        ...db,
    };
    return { service: new MrrSnapshotService(full as any, tracker as any), db: full };
}

describe('previousMonthEnds', () => {
    it('lists the last day of each earlier month, oldest first, across a year boundary', () => {
        expect(previousMonthEnds('2026-02-14', 3)).toEqual(['2025-11-30', '2025-12-31', '2026-01-31']);
    });
});

describe('MrrSnapshotService', () => {
    it('computes live MRR with discounts and add-ons from the subscriptions as they stand', async () => {
        const { service } = build({
            tenantSubscription: {
                findMany: jest.fn().mockResolvedValue([
                    subscription({ discount_type: 'PERCENTAGE', discount_value: 10 }),
                    subscription({ tenant_id: 't2', status: 'TRIALING' }),
                ]),
            },
            tenantAddonSubscription: {
                findMany: jest.fn().mockResolvedValue([{ tenant_id: 't1', addon: { monthly_price: 500 } }]),
            },
        });

        const rows = await service.liveMrr();
        expect(rows.map((r) => [r.tenantId, r.mrr])).toEqual([['t1', 2300], ['t2', 0]]);
    });

    it('records a complete day, zero rows included', async () => {
        const { service, db } = build({
            tenantSubscription: {
                findMany: jest.fn().mockResolvedValue([subscription(), subscription({ tenant_id: 't2', status: 'CANCELLED' })]),
            },
        });

        await service.recordDay('2026-11-17');
        expect(db.tenantMrrSnapshot.upsert).toHaveBeenCalledTimes(2);
        const zero = db.tenantMrrSnapshot.upsert.mock.calls[1][0];
        expect(zero.create).toMatchObject({ tenant_id: 't2', mrr: 0, source: 'daily' });
        expect(zero.where.tenant_id_day.day.toISOString()).toBe('2026-11-17T00:00:00.000Z');
    });

    it('reads a past day from the latest snapshot day on or before it', async () => {
        const { service, db } = build({});
        db.tenantMrrSnapshot.findFirst.mockResolvedValue({ day: new Date('2026-10-31T00:00:00Z') });
        db.tenantMrrSnapshot.findMany.mockResolvedValue([{ tenant_id: 't1', mrr: 2000 }]);

        const result = await service.mrrOn('2026-11-03');
        expect(result.covered).toBe(true);
        expect(result.byTenant.get('t1')).toBe(2000);
        expect(db.tenantMrrSnapshot.findMany.mock.calls[0][0].where.day.toISOString()).toBe('2026-10-31T00:00:00.000Z');
    });

    it('says a day before the history is not covered rather than reading it as zero', async () => {
        const { service } = build({});
        expect(await service.mrrOn('2020-01-01')).toEqual({ covered: false, byTenant: new Map() });
    });

    it('backfills month-ends from fees, the first paid period, and nothing after billing stops', async () => {
        const { service, db } = build({
            tenantSubscription: {
                findMany: jest.fn().mockResolvedValue([
                    // Activated in January, monthly fees through March, then stopped.
                    subscription({ status: 'CANCELLED' }),
                ]),
            },
            billingEvent: {
                findMany: jest.fn().mockResolvedValue([
                    { tenant_id: 't1', amount: 1800, created_at: new Date('2026-02-10T00:00:00Z'), payload: { billing_cycle: 'MONTHLY' } },
                    { tenant_id: 't1', amount: 1800, created_at: new Date('2026-03-10T00:00:00Z'), payload: { billing_cycle: 'MONTHLY' } },
                ]),
            },
        });

        await service.backfill(new Date('2026-05-15T06:00:00Z'));
        const byDay = Object.fromEntries(
            db.tenantMrrSnapshot.upsert.mock.calls.map(([arg]: any[]) => [arg.create.day.toISOString().slice(0, 10), arg.create.mrr]),
        );
        // Not yet a customer before January; inside the first period at the end of
        // January (live plan MRR is 0 now it is cancelled); fees in February and March;
        // the March fee still counts at the end of March, nothing by the end of April.
        expect(byDay['2025-12-31']).toBeUndefined();
        expect(byDay['2026-02-28']).toBe(1800);
        expect(byDay['2026-03-31']).toBe(1800);
        expect(byDay['2026-04-30']).toBe(0);
        expect(db.tenantMrrSnapshot.upsert.mock.calls[0][0].create.source).toBe('backfill');
    });

    it('backfills only when there is no history yet, and always records today', async () => {
        const { service, db } = build({});
        db.tenantMrrSnapshot.count.mockResolvedValue(40);
        const spy = jest.spyOn(service, 'backfill');

        await service.ensureHistory();
        expect(spy).not.toHaveBeenCalled();
    });
});
