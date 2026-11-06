import { CustomersService } from './customers.service';
import { CustomersController } from './customers.controller';
import { customerListWhere, readCustomerListFilters } from './customer-list-filters';
import { customerInBranchesWhere } from './customer-visibility';

/**
 * The customers list's filter row and the stats strip above it. Rows and strip
 * go through one `where`, so the strip always counts the customers listed.
 */
describe('customers list filters', () => {
    const TZ = 'Asia/Dhaka';

    describe('readCustomerListFilters', () => {
        it('reads segments, the inversion, types, groups, territories and amounts', () => {
            const filters = readCustomerListFilters(
                {
                    search: '  rahim ',
                    segment: 'VIP,At-Risk',
                    segmentExclude: 'true',
                    customerType: 'ORGANIZATION,BOGUS',
                    groupId: 'g1,none',
                    territoryId: 't1',
                    due: 'gt:0',
                    totalSpent: 'between:5000,1000',
                    points: 'lt:10',
                },
                { timezone: TZ, scope: ['b1'] },
            );
            expect(filters).toMatchObject({
                search: 'rahim',
                segments: ['VIP', 'At-Risk'],
                segmentExclude: true,
                // An unknown type cannot match the enum column, so it is dropped.
                customerTypes: ['ORGANIZATION'],
                groupIds: ['g1', 'none'],
                territoryIds: ['t1'],
                due: { op: 'gt', value: 0 },
                totalSpent: { op: 'between', value: 1000, to: 5000 },
                points: { op: 'lt', value: 10 },
                scope: ['b1'],
                timezone: TZ,
            });
        });

        it('refuses a malformed amount rather than listing every customer', () => {
            expect(() => readCustomerListFilters({ due: 'some' }, { timezone: TZ })).toThrow();
        });

        it('reads nothing from an empty query', () => {
            expect(readCustomerListFilters({}, { timezone: TZ })).toMatchObject({
                segments: undefined,
                segmentExclude: false,
                groupIds: undefined,
                due: undefined,
            });
        });
    });

    describe('customerListWhere', () => {
        it('scopes to the tenant\'s live customers and keeps the search OR on top', () => {
            const where = customerListWhere('t1', { timezone: TZ, search: 'rahim', scope: ['b1'] });
            expect(where).toMatchObject({ tenant_id: 't1', deleted_at: null });
            expect(where.OR).toHaveLength(4);
            expect(where.AND).toEqual([customerInBranchesWhere(['b1'])]);
        });

        it('adds each chip after the branch scope, so neither overwrites the other', () => {
            const where = customerListWhere('t1', {
                timezone: TZ,
                scope: ['b1'],
                segments: ['VIP'],
                customerTypes: ['INDIVIDUAL'],
                groupIds: ['g1', 'none'],
                territoryIds: ['none'],
                due: { op: 'gt', value: 0 },
                totalSpent: { op: 'between', value: 100, to: 900 },
                points: { op: 'eq', value: 50 },
            });
            expect(where.AND).toEqual([
                customerInBranchesWhere(['b1']),
                { segment_category: { in: ['VIP'] } },
                { customer_type: { in: ['INDIVIDUAL'] } },
                { OR: [{ customer_group_id: { in: ['g1'] } }, { customer_group_id: null }] },
                { territory_id: null },
                { due_balance: { gt: 0 } },
                { total_spent: { gte: 100, lte: 900 } },
                { loyalty_points: { equals: 50 } },
            ]);
        });

        it('inverts the segment set', () => {
            const where = customerListWhere('t1', { timezone: TZ, segments: ['At-Risk'], segmentExclude: true });
            expect(where.AND).toEqual([{ segment_category: { notIn: ['At-Risk'] } }]);
        });

        it('keeps the table\'s column filters after the chips', () => {
            const where = customerListWhere('t1', {
                timezone: TZ,
                groupIds: ['g1'],
                filters: { owner_name: 'karim' },
            });
            expect(where.AND).toEqual([
                { customer_group_id: { in: ['g1'] } },
                { owner_name: { contains: 'karim', mode: 'insensitive' } },
            ]);
        });

        it('measures the created window on the tenant\'s calendar', () => {
            const where = customerListWhere('t1', { timezone: TZ, createdFrom: '2026-08-19', createdTo: '2026-08-19' });
            expect(where.created_at).toEqual({
                gte: new Date('2026-08-18T18:00:00.000Z'),
                lte: new Date('2026-08-19T17:59:59.999Z'),
            });
        });
    });

    describe('list and summary', () => {
        let db: any;
        let service: CustomersService;

        beforeEach(() => {
            db = {
                customer: {
                    findMany: jest.fn().mockResolvedValue([]),
                    count: jest.fn().mockResolvedValue(0),
                    aggregate: jest.fn(),
                    groupBy: jest.fn().mockResolvedValue([]),
                },
                $queryRaw: jest.fn().mockResolvedValue([]),
            };
            service = new CustomersService(db, { decrypt: (v: string) => v } as any, {} as any);
        });

        it('pages and counts the list through the same where', async () => {
            await service.findAll('t1', { timezone: TZ, due: { op: 'gt', value: 0 } });
            const where = db.customer.findMany.mock.calls[0][0].where;
            expect(where.AND).toEqual([{ due_balance: { gt: 0 } }]);
            expect(db.customer.count).toHaveBeenCalledWith({ where });
        });

        it('counts, sums what is owed, and splits out VIP and at-risk over the list\'s where', async () => {
            db.customer.aggregate
                .mockResolvedValueOnce({ _count: { _all: 40 }, _sum: { total_spent: '125000.456' } })
                .mockResolvedValueOnce({ _count: { _all: 6 }, _sum: { due_balance: '18250.5' } });
            db.customer.count.mockResolvedValueOnce(3);
            db.customer.groupBy.mockResolvedValue([
                { segment_category: 'VIP', _count: { _all: 4 } },
                { segment_category: 'At-Risk', _count: { _all: 7 } },
                { segment_category: 'Regular', _count: { _all: 29 } },
            ]);

            const summary = await service.listSummary(
                't1',
                { timezone: TZ, groupIds: ['g1'] },
                new Date('2026-11-06T10:00:00.000Z'),
            );

            expect(summary).toEqual({
                count: 40,
                newThisMonth: 3,
                withDue: 6,
                receivable: 18250.5,
                totalSpent: 125000.46,
                vip: 4,
                atRisk: 7,
            });
            const listWhere = customerListWhere('t1', { timezone: TZ, groupIds: ['g1'] });
            expect(db.customer.aggregate.mock.calls[0][0].where).toEqual(listWhere);
            // Only money customers owe; an advance held for one is not netted off.
            expect(db.customer.aggregate.mock.calls[1][0].where).toEqual({
                AND: [listWhere, { due_balance: { gt: 0.005 } }],
            });
            // The tenant's month: 1 November in Dhaka began at 18:00 UTC on 31 October.
            expect(db.customer.count.mock.calls[0][0].where).toEqual({
                AND: [listWhere, { created_at: { gte: new Date('2026-10-31T18:00:00.000Z') } }],
            });
            expect(db.customer.groupBy.mock.calls[0][0]).toMatchObject({ by: ['segment_category'], where: listWhere });
        });

        it('reads zero for an empty match', async () => {
            db.customer.aggregate.mockResolvedValue({ _count: { _all: 0 }, _sum: {} });
            const summary = await service.listSummary('t1', { timezone: TZ });
            expect(summary).toEqual({
                count: 0, newThisMonth: 0, withDue: 0, receivable: 0, totalSpent: 0, vip: 0, atRisk: 0,
            });
        });
    });

    describe('controller', () => {
        // `GET :id` declared first would take `summary` for a customer id.
        it('declares GET summary before GET :id', () => {
            const routes = Object.getOwnPropertyNames(CustomersController.prototype)
                .map((name) => Reflect.getMetadata('path', (CustomersController.prototype as any)[name]))
                .filter((path) => path !== undefined);
            expect(routes.indexOf('summary')).toBeGreaterThan(-1);
            expect(routes.indexOf('summary')).toBeLessThan(routes.indexOf(':id'));
        });

        it('resolves the branch once and hands list and summary the same filters', async () => {
            const customers = { findAll: jest.fn(), listSummary: jest.fn() };
            const scope = { resolve: jest.fn().mockResolvedValue(['b2']) };
            const controller = new CustomersController(customers as any, {} as any, scope as any, {} as any);
            const tenant = { tenantId: 't1', timezone: TZ } as any;
            const query = { storeId: 'b2', due: 'gt:0', groupId: 'g1', page: '2', limit: '50' };

            await controller.findAll(tenant, query);
            await controller.listSummary(tenant, query);

            expect(scope.resolve).toHaveBeenCalledWith(tenant, 'b2');
            expect(customers.findAll).toHaveBeenCalledWith('t1', expect.objectContaining({
                scope: ['b2'], due: { op: 'gt', value: 0 }, groupIds: ['g1'], page: 2, limit: 50,
            }));
            expect(customers.listSummary).toHaveBeenCalledWith('t1', expect.objectContaining({
                scope: ['b2'], due: { op: 'gt', value: 0 }, groupIds: ['g1'],
            }));
        });
    });
});
