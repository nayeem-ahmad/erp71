import { Test, TestingModule } from '@nestjs/testing';
import { CrmLeadConversationsService } from './crm-lead-conversations.service';
import { DatabaseService } from '../database/database.service';

describe('CrmLeadConversationsService', () => {
    let service: CrmLeadConversationsService;
    let db: any;

    beforeEach(async () => {
        db = {
            lead: {
                findFirst: jest.fn(),
                update: jest.fn(),
            },
            leadConversation: {
                findFirst: jest.fn(),
                findMany: jest.fn().mockResolvedValue([]),
                count: jest.fn().mockResolvedValue(0),
                groupBy: jest.fn().mockResolvedValue([]),
                create: jest.fn(),
                update: jest.fn(),
                delete: jest.fn(),
            },
            // The service uses the ARRAY form of $transaction and destructures the result,
            // so a callback-only mock would return undefined and throw on destructure.
            $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CrmLeadConversationsService,
                { provide: DatabaseService, useValue: db },
            ],
        }).compile();

        service = module.get<CrmLeadConversationsService>(CrmLeadConversationsService);
    });

    /** The `where` the service handed to findMany on the most recent findAll call. */
    const lastWhere = () => (db.leadConversation.findMany as jest.Mock).mock.calls[0][0].where;
    const lastArgs = () => (db.leadConversation.findMany as jest.Mock).mock.calls[0][0];

    describe('findAll() tenant scoping', () => {
        it('always scopes to the caller tenant', async () => {
            await service.findAll('tenant-1', {});
            expect(lastWhere()).toEqual({ tenant_id: 'tenant-1' });
        });

        it('counts with the same where clause it queries with', async () => {
            await service.findAll('tenant-1', { type: 'CALL' });
            const countWhere = (db.leadConversation.count as jest.Mock).mock.calls[0][0].where;
            expect(countWhere).toEqual(lastWhere());
        });
    });

    describe('findAll() filters', () => {
        it('filters by type, direction and creator', async () => {
            await service.findAll('tenant-1', {
                type: 'CALL',
                direction: 'INBOUND',
                createdBy: 'user-9',
            });
            expect(lastWhere()).toMatchObject({
                tenant_id: 'tenant-1',
                type: 'CALL',
                direction: 'INBOUND',
                created_by: 'user-9',
            });
        });

        it('searches summary, outcome, lead name and lead mobile', async () => {
            await service.findAll('tenant-1', { search: 'deposit' });
            expect(lastWhere().OR).toEqual([
                { summary: { contains: 'deposit', mode: 'insensitive' } },
                { outcome: { contains: 'deposit', mode: 'insensitive' } },
                { lead: { name: { contains: 'deposit', mode: 'insensitive' } } },
                { lead: { mobile: { contains: 'deposit', mode: 'insensitive' } } },
            ]);
        });

        // Two separate `where.lead = {...}` assignments would silently drop the first
        // filter with no error, so assert both survive together.
        it('merges leadStatus and leadAssignedTo into a single lead filter', async () => {
            await service.findAll('tenant-1', {
                leadStatus: 'QUALIFIED',
                leadAssignedTo: 'user-3',
            });
            expect(lastWhere().lead).toEqual({ status: 'QUALIFIED', assigned_to: 'user-3' });
        });

        it('omits the lead filter entirely when neither lead field is set', async () => {
            await service.findAll('tenant-1', { type: 'SMS' });
            expect(lastWhere().lead).toBeUndefined();
        });

        it('leaves out absent filters rather than sending undefined', async () => {
            await service.findAll('tenant-1', { type: undefined, search: '' });
            expect(lastWhere()).toEqual({ tenant_id: 'tenant-1' });
        });
    });

    describe('findAll() date range', () => {
        it('treats a bare dateTo as inclusive of that whole day', async () => {
            await service.findAll('tenant-1', { dateFrom: '2026-07-01', dateTo: '2026-07-05' });
            const createdAt = lastWhere().created_at;
            expect(createdAt.gte).toEqual(new Date('2026-07-01T00:00:00.000Z'));
            // `lte: 2026-07-05T00:00:00Z` would drop everything logged during the 5th.
            expect(createdAt.lt).toEqual(new Date('2026-07-06T00:00:00.000Z'));
            expect(createdAt.lte).toBeUndefined();
        });

        it('uses the instant as given when dateTo carries a time', async () => {
            await service.findAll('tenant-1', { dateTo: '2026-07-05T09:30:00.000Z' });
            const createdAt = lastWhere().created_at;
            expect(createdAt.lte).toEqual(new Date('2026-07-05T09:30:00.000Z'));
            expect(createdAt.lt).toBeUndefined();
        });

        it('ignores an unparseable date instead of sending Invalid Date to Prisma', async () => {
            await service.findAll('tenant-1', { dateFrom: 'not-a-date' });
            expect(lastWhere().created_at).toBeUndefined();
        });

        it('supports an open-ended lower bound', async () => {
            await service.findAll('tenant-1', { dateFrom: '2026-07-01' });
            expect(lastWhere().created_at).toEqual({ gte: new Date('2026-07-01T00:00:00.000Z') });
        });
    });

    describe('findAll() sorting and paging', () => {
        it('defaults to newest first', async () => {
            await service.findAll('tenant-1', {});
            expect(lastArgs().orderBy).toEqual({ created_at: 'desc' });
        });

        it('honours an allowlisted scalar sort', async () => {
            await service.findAll('tenant-1', { sortBy: 'type', sortDir: 'asc' });
            expect(lastArgs().orderBy).toEqual({ type: 'asc' });
        });

        it('sorts by the lead name through the relation', async () => {
            await service.findAll('tenant-1', { sortBy: 'lead', sortDir: 'desc' });
            expect(lastArgs().orderBy).toEqual({ lead: { name: 'desc' } });
        });

        it('falls back to the default order for a non-allowlisted sort key', async () => {
            await service.findAll('tenant-1', { sortBy: 'summary; DROP TABLE', sortDir: 'asc' });
            expect(lastArgs().orderBy).toEqual({ created_at: 'desc' });
        });

        it('clamps limit to 100 so a caller cannot ask for the whole table', async () => {
            await service.findAll('tenant-1', { limit: 5000 });
            expect(lastArgs().take).toBe(100);
        });

        it('skips by page', async () => {
            await service.findAll('tenant-1', { page: 3, limit: 20 });
            expect(lastArgs().skip).toBe(40);
        });

        it('returns the pagination envelope', async () => {
            db.leadConversation.findMany.mockResolvedValueOnce([{ id: 'c1' }]);
            db.leadConversation.count.mockResolvedValueOnce(41);
            const result = await service.findAll('tenant-1', { page: 1, limit: 20 });
            expect(result).toEqual({ items: [{ id: 'c1' }], total: 41, page: 1, limit: 20, pages: 3 });
        });
    });

    describe('getSummary()', () => {
        it('zero-fills every conversation type so the tiles are stable', async () => {
            db.leadConversation.groupBy.mockResolvedValue([]);
            const result = await service.getSummary('tenant-1', {});
            expect(result.countsByType).toEqual({
                CALL: 0, SMS: 0, WHATSAPP: 0, EMAIL: 0, VISIT: 0, ONLINE_MEETING: 0, NOTE: 0,
            });
        });

        it('maps grouped counts onto the type breakdown', async () => {
            db.leadConversation.groupBy.mockImplementation(({ by }: any) =>
                by[0] === 'type'
                    ? Promise.resolve([
                        { type: 'CALL', _count: { _all: 7 } },
                        { type: 'VISIT', _count: { _all: 2 } },
                    ])
                    : Promise.resolve([]),
            );
            const result = await service.getSummary('tenant-1', {});
            expect(result.countsByType.CALL).toBe(7);
            expect(result.countsByType.VISIT).toBe(2);
            expect(result.countsByType.SMS).toBe(0);
        });

        it('counts distinct leads via GROUP BY rather than fetching every row', async () => {
            db.leadConversation.groupBy.mockImplementation(({ by }: any) =>
                by[0] === 'lead_id'
                    ? Promise.resolve([{ lead_id: 'l1' }, { lead_id: 'l2' }, { lead_id: 'l3' }])
                    : Promise.resolve([]),
            );
            const result = await service.getSummary('tenant-1', {});
            expect(result.leadsTouched).toBe(3);
            expect(db.leadConversation.findMany).not.toHaveBeenCalled();
        });

        it('applies the same filters as the list, so tiles describe the filtered set', async () => {
            await service.getSummary('tenant-1', { type: 'CALL', leadStatus: 'QUALIFIED' });
            const where = (db.leadConversation.count as jest.Mock).mock.calls[0][0].where;
            expect(where).toMatchObject({
                tenant_id: 'tenant-1',
                type: 'CALL',
                lead: { status: 'QUALIFIED' },
            });
        });

        // The 7-day count must never exceed the total above it in the UI.
        it('intersects the 7-day window with an explicit date filter instead of replacing it', async () => {
            await service.getSummary('tenant-1', { dateFrom: '2026-01-01', dateTo: '2026-01-31' });
            const weekWhere = (db.leadConversation.count as jest.Mock).mock.calls[1][0].where;
            expect(weekWhere.created_at).toEqual({
                gte: new Date('2026-01-01T00:00:00.000Z'),
                lt: new Date('2026-02-01T00:00:00.000Z'),
            });
            expect(weekWhere.AND).toEqual([{ created_at: { gte: expect.any(Date) } }]);
        });
    });
});
