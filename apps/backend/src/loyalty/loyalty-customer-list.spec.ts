import { LoyaltyService } from './loyalty.service';
import { LoyaltyController } from './loyalty.controller';
import { loyaltyCustomerWhere, readLoyaltyCustomerListFilters } from './loyalty-customer-list';
import { customerInBranchesWhere } from '../customers/customer-visibility';

/**
 * The loyalty list's filter row and the stats strip above it: one `where` for
 * both, so the strip counts the customers listed.
 */
describe('loyalty customers list', () => {
    const TZ = 'Asia/Dhaka';

    describe('readLoyaltyCustomerListFilters', () => {
        it('reads the balance, the activity days and kinds', () => {
            expect(
                readLoyaltyCustomerListFilters(
                    { search: ' 0171 ', points: 'gt:100', activeFrom: '2026-10-01', activeTo: '2026-10-31', activityType: 'REDEEM,BOGUS' },
                    { timezone: TZ, scope: ['b1'] },
                ),
            ).toEqual({
                search: '0171',
                points: { op: 'gt', value: 100 },
                activeFrom: '2026-10-01',
                activeTo: '2026-10-31',
                activityTypes: ['REDEEM'],
                scope: ['b1'],
                timezone: TZ,
            });
        });

        it('refuses a malformed balance', () => {
            expect(() => readLoyaltyCustomerListFilters({ points: 'lots' }, { timezone: TZ })).toThrow();
        });
    });

    describe('loyaltyCustomerWhere', () => {
        it('keeps to the member\'s branches and the live customers', () => {
            const where = loyaltyCustomerWhere('t1', { timezone: TZ, scope: ['b1'] });
            expect(where).toEqual({ tenant_id: 't1', deleted_at: null, AND: [customerInBranchesWhere(['b1'])] });
        });

        it('narrows by balance and by activity in the tenant\'s days, of the kinds picked', () => {
            const where = loyaltyCustomerWhere('t1', {
                timezone: TZ,
                points: { op: 'between', value: 100, to: 500 },
                activeFrom: '2026-10-01',
                activeTo: '2026-10-31',
                activityTypes: ['REDEEM'],
            });
            expect(where.AND).toEqual([
                { loyalty_points: { gte: 100, lte: 500 } },
                {
                    loyaltyTransactions: {
                        some: {
                            tenantId: 't1',
                            created_at: {
                                gte: new Date('2026-09-30T18:00:00.000Z'),
                                lte: new Date('2026-10-31T17:59:59.999Z'),
                            },
                            type: { in: ['REDEEM'] },
                        },
                    },
                },
            ]);
        });

        it('asks for a kind of activity at any time when no days are picked', () => {
            const where = loyaltyCustomerWhere('t1', { timezone: TZ, activityTypes: ['ADJUST'] });
            expect(where.AND).toEqual([{ loyaltyTransactions: { some: { tenantId: 't1', type: { in: ['ADJUST'] } } } }]);
        });
    });

    describe('summary', () => {
        let db: any;
        let service: LoyaltyService;

        beforeEach(() => {
            db = {
                customer: {
                    count: jest.fn().mockResolvedValue(12),
                    aggregate: jest.fn().mockResolvedValue({ _count: { _all: 9 }, _sum: { loyalty_points: 4200 } }),
                },
                loyaltyTransaction: {
                    aggregate: jest.fn()
                        .mockResolvedValueOnce({ _sum: { points: 800 } })
                        .mockResolvedValueOnce({ _sum: { points: -350 } }),
                },
            };
            service = new LoyaltyService(db);
        });

        it('counts holders and sums this month\'s earning and redeeming over the list\'s where', async () => {
            const filters = { timezone: TZ, points: { op: 'gt' as const, value: 0 } };

            const summary = await service.customerListSummary('t1', filters, new Date('2026-11-06T10:00:00.000Z'));

            expect(summary).toEqual({ count: 12, members: 9, points: 4200, earned: 800, redeemed: 350, windowed: false });
            const where = loyaltyCustomerWhere('t1', filters);
            expect(db.customer.count).toHaveBeenCalledWith({ where });
            expect(db.customer.aggregate.mock.calls[0][0].where).toEqual({ AND: [where, { loyalty_points: { gt: 0 } }] });
            expect(db.loyaltyTransaction.aggregate.mock.calls[0][0].where).toEqual({
                tenantId: 't1',
                type: 'EARN',
                created_at: { gte: new Date('2026-10-31T18:00:00.000Z') },
                customer: where,
            });
            expect(db.loyaltyTransaction.aggregate.mock.calls[1][0].where.type).toBe('REDEEM');
        });

        it('sums the activity days picked instead of the month', async () => {
            const summary = await service.customerListSummary('t1', { timezone: TZ, activeFrom: '2026-10-01', activeTo: '2026-10-01' });

            expect(summary.windowed).toBe(true);
            expect(db.loyaltyTransaction.aggregate.mock.calls[0][0].where.created_at).toEqual({
                gte: new Date('2026-09-30T18:00:00.000Z'),
                lte: new Date('2026-10-01T17:59:59.999Z'),
            });
        });
    });

    describe('controller', () => {
        it('resolves whose customers once and hands list and summary the same filters', async () => {
            const loyalty = { listCustomersWithPoints: jest.fn(), customerListSummary: jest.fn() };
            const scope = { resolve: jest.fn().mockResolvedValue(['b1']) };
            const controller = new LoyaltyController(loyalty as any, scope as any);
            const tenant = { tenantId: 't1', timezone: TZ } as any;
            const query = { storeId: 'b1', points: 'gt:0', page: 2, limit: 50, sortBy: 'name', sortDir: 'asc' } as any;

            await controller.listCustomers(tenant, query);
            await controller.customerListSummary(tenant, query);

            expect(scope.resolve).toHaveBeenCalledWith(tenant, 'b1');
            const filters = expect.objectContaining({ scope: ['b1'], points: { op: 'gt', value: 0 } });
            expect(loyalty.listCustomersWithPoints).toHaveBeenCalledWith('t1', filters, {
                page: 2, limit: 50, sortBy: 'name', sortDir: 'asc',
            });
            expect(loyalty.customerListSummary).toHaveBeenCalledWith('t1', filters);
        });
    });
});
