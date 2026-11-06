import { DeliveryService } from './delivery.service';
import { readDeliveryListFilters } from './delivery.controller';

/**
 * The delivery list's filter row and the stats strip above it. Rows and strip
 * go through one `where`, so the strip always counts the rows shown.
 */
describe('delivery list', () => {
    const TZ = 'Asia/Dhaka';
    let db: any;
    let service: DeliveryService;

    beforeEach(() => {
        db = {
            deliveryOrder: {
                findMany: jest.fn().mockResolvedValue([]),
                count: jest.fn().mockResolvedValue(0),
                groupBy: jest.fn().mockResolvedValue([]),
            },
        };
        service = new DeliveryService(db);
    });

    const listWhere = async (opts: Record<string, unknown>) => {
        await service.listDeliveries('t1', 1, 20, { timezone: TZ, ...opts });
        return db.deliveryOrder.findMany.mock.calls[0][0].where;
    };

    it('reads statuses, the inversion, drivers and both dates off the query', () => {
        expect(
            readDeliveryListFilters(
                {
                    status: 'PENDING,IN_TRANSIT',
                    statusExclude: 'true',
                    driver: 'Karim,none',
                    dateFrom: '2026-08-01',
                    dateTo: '2026-08-31',
                    search: '  dhanmondi ',
                } as any,
                TZ,
            ),
        ).toMatchObject({
            statuses: ['PENDING', 'IN_TRANSIT'],
            statusExclude: true,
            drivers: ['Karim', 'none'],
            scheduledFrom: '2026-08-01',
            scheduledTo: '2026-08-31',
            search: 'dhanmondi',
            timezone: TZ,
        });
    });

    it('inverts the status set and matches "none" as a delivery with no driver', async () => {
        const where = await listWhere({ statuses: ['CANCELLED'], statusExclude: true, drivers: ['Karim', 'none'] });
        expect(where.status).toEqual({ notIn: ['CANCELLED'] });
        expect(where.AND).toEqual([{ OR: [{ driverName: { in: ['Karim'] } }, { driverName: null }] }]);
    });

    it('filters the scheduled day in the workspace\'s zone', async () => {
        const where = await listWhere({ scheduledFrom: '2026-08-19', scheduledTo: '2026-08-19' });
        expect(where.scheduledAt).toEqual({
            gte: new Date('2026-08-18T18:00:00.000Z'),
            lte: new Date('2026-08-19T17:59:59.999Z'),
        });
    });

    it('searches the customer, the address, the driver and the sale\'s invoice', async () => {
        const where = await listWhere({ search: '017' });
        expect(where.AND[0].OR).toEqual(
            expect.arrayContaining([
                { customerPhone: { contains: '017', mode: 'insensitive' } },
                { deliveryAddress: { contains: '017', mode: 'insensitive' } },
                { driverName: { contains: '017', mode: 'insensitive' } },
                { sale: { serial_number: { contains: '017', mode: 'insensitive' } } },
            ]),
        );
    });

    it('counts the filtered deliveries by state, with the late and the driverless open ones', async () => {
        const now = new Date('2026-08-19T06:00:00.000Z');
        db.deliveryOrder.groupBy.mockResolvedValue([
            { status: 'PENDING', _count: { _all: 4 } },
            { status: 'IN_TRANSIT', _count: { _all: 2 } },
            { status: 'DELIVERED', _count: { _all: 5 } },
            { status: 'FAILED', _count: { _all: 1 } },
        ]);
        db.deliveryOrder.count.mockResolvedValueOnce(3).mockResolvedValueOnce(2);

        const summary = await service.summary('t1', { timezone: TZ, drivers: ['Karim'] }, now);

        expect(summary).toEqual({
            count: 12,
            pending: 4,
            inTransit: 2,
            delivered: 5,
            failed: 1,
            cancelled: 0,
            overdue: 3,
            unassigned: 2,
        });
        const listWhereShape = { tenantId: 't1', AND: [{ driverName: { in: ['Karim'] } }] };
        expect(db.deliveryOrder.groupBy.mock.calls[0][0].where).toEqual(listWhereShape);
        const overdueWhere = db.deliveryOrder.count.mock.calls[0][0].where;
        expect(overdueWhere.AND).toEqual([
            listWhereShape,
            { status: { in: ['PENDING', 'IN_TRANSIT'] } },
            { scheduledAt: { lt: now } },
        ]);
        expect(db.deliveryOrder.count.mock.calls[1][0].where.AND[2]).toEqual({ driverName: null });
    });

    it('lists the driver names used so far', async () => {
        db.deliveryOrder.groupBy.mockResolvedValue([{ driverName: 'Karim' }, { driverName: ' ' }, { driverName: 'Selim' }]);
        await expect(service.listDrivers('t1')).resolves.toEqual(['Karim', 'Selim']);
        expect(db.deliveryOrder.groupBy.mock.calls[0][0].where).toEqual({ tenantId: 't1', driverName: { not: null } });
    });
});
