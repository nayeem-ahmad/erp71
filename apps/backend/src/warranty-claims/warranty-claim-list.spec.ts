import { WarrantyClaimsService } from './warranty-claims.service';
import { readSalesDocumentListFilters } from '../common/sales-document-list-filters';

/**
 * The warranty-claims list's filter row and the stats strip above it. Rows and
 * strip go through one `where`, so the strip always counts the rows shown.
 */
describe('warranty claims list', () => {
    const TZ = 'Asia/Dhaka';
    let db: any;
    let service: WarrantyClaimsService;

    beforeEach(() => {
        db = {
            warrantyClaim: {
                findMany: jest.fn().mockResolvedValue([]),
                count: jest.fn().mockResolvedValue(0),
                groupBy: jest.fn().mockResolvedValue([]),
            },
        };
        service = new WarrantyClaimsService(db);
    });

    const listWhere = async (opts: Record<string, unknown>) => {
        await service.findAll('t1', 1, 20, { timezone: TZ, ...opts });
        return db.warrantyClaim.findMany.mock.calls[0][0].where;
    };

    it('scopes to the tenant and branch, and inverts the status set', async () => {
        const where = await listWhere({ storeId: 'b1', statuses: ['REJECTED', 'COMPLETED'], statusExclude: true });
        expect(where).toMatchObject({ tenant_id: 't1', store_id: 'b1', status: { notIn: ['REJECTED', 'COMPLETED'] } });
    });

    it('matches customers by id and "none" as a walk-in claim', async () => {
        const where = await listWhere({ customerIds: ['c1', 'none'] });
        expect(where.AND).toEqual([{ OR: [{ customer_id: { in: ['c1'] } }, { customer_id: null }] }]);
    });

    it('searches the claim, both serials, the reason, the product and the customer', async () => {
        const where = await listWhere({ search: 'tv' });
        expect(where.AND[0].OR).toEqual(
            expect.arrayContaining([
                { claim_number: { contains: 'tv', mode: 'insensitive' } },
                { replacement_serial_number: { contains: 'tv', mode: 'insensitive' } },
                { product: { name: { contains: 'tv', mode: 'insensitive' } } },
                { customer: { phone: { contains: 'tv', mode: 'insensitive' } } },
            ]),
        );
    });

    it('reads the claim\'s own date as the day it was resolved, in the workspace\'s zone', async () => {
        const where = await listWhere({ dateFrom: '2026-08-19', dateTo: '2026-08-19', createdFrom: '2026-08-01' });
        expect(where.resolved_at).toEqual({
            gte: new Date('2026-08-18T18:00:00.000Z'),
            lte: new Date('2026-08-19T17:59:59.999Z'),
        });
        expect(where.created_at.gte).toEqual(new Date('2026-07-31T18:00:00.000Z'));
    });

    it('sorts only by allowlisted columns', async () => {
        await service.findAll('t1', 1, 20, { timezone: TZ, sortBy: 'product', sortDir: 'asc' });
        expect(db.warrantyClaim.findMany.mock.calls[0][0].orderBy).toEqual({ product: { name: 'asc' } });
        db.warrantyClaim.findMany.mockClear();
        await service.findAll('t1', 1, 20, { timezone: TZ, sortBy: 'tenant_id', sortDir: 'asc' });
        expect(db.warrantyClaim.findMany.mock.calls[0][0].orderBy).toEqual({ created_at: 'desc' });
    });

    it('counts the filtered claims by where they stand, over the same where as the rows', async () => {
        db.warrantyClaim.groupBy.mockResolvedValue([
            { status: 'SUBMITTED', _count: { _all: 3 } },
            { status: 'APPROVED', _count: { _all: 1 } },
            { status: 'REPLACED', _count: { _all: 2 } },
            { status: 'REJECTED', _count: { _all: 1 } },
        ]);

        const summary = await service.summary('t1', { timezone: TZ, storeId: 'b1', customerIds: ['c1'] });

        expect(summary).toEqual({
            count: 7,
            awaiting: 3,
            inProgress: 1,
            repaired: 0,
            replaced: 2,
            completed: 0,
            rejected: 1,
        });
        await service.findAll('t1', 1, 20, { timezone: TZ, storeId: 'b1', customerIds: ['c1'] });
        expect(db.warrantyClaim.groupBy.mock.calls[0][0].where).toEqual(db.warrantyClaim.findMany.mock.calls[0][0].where);
    });

    it('reads the shared query keys', () => {
        expect(
            readSalesDocumentListFilters(
                { page: 1, limit: 20, status: 'SUBMITTED,APPROVED', customerId: 'none', dateFrom: '2026-01-01' },
                { storeId: 'b1', timezone: TZ },
            ),
        ).toMatchObject({ statuses: ['SUBMITTED', 'APPROVED'], customerIds: ['none'], dateFrom: '2026-01-01', storeId: 'b1' });
    });
});
