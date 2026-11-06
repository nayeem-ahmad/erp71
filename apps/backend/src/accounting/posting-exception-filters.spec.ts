import 'reflect-metadata';
import { BadRequestException, RequestMethod } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AccountingController } from './accounting.controller';
import { ListPostingExceptionsQueryDto } from './accounting.dto';
import { AccountingService } from './accounting.service';

/**
 * The posting-exceptions list's filter row and the stats strip above it. Both
 * go through one `where`, so the strip always counts the events the list shows.
 */
describe('Posting exception filters and summary', () => {
    let db: any;
    let service: AccountingService;

    beforeEach(() => {
        db = {
            postingEvent: {
                findMany: jest.fn().mockResolvedValue([]),
                count: jest.fn().mockResolvedValue(0),
                groupBy: jest.fn().mockResolvedValue([]),
            },
        };
        service = new AccountingService(db, {} as any, {} as any);
    });

    const listWhere = async (query: Record<string, unknown>) => {
        await service.listPostingExceptions('t1', query as any);
        return db.postingEvent.findMany.mock.calls[0][0].where;
    };

    it('keeps a single status and module as plain equalities', async () => {
        const where = await listWhere({ status: 'failed', module: 'sales' });
        expect(where).toEqual({ tenant_id: 't1', status: 'failed', source_module: 'sales' });
    });

    it('matches any of a comma-separated set of statuses and modules', async () => {
        const where = await listWhere({ status: 'pending,failed', module: 'sales,purchases' });
        expect(where.status).toEqual({ in: ['pending', 'failed'] });
        expect(where.source_module).toEqual({ in: ['sales', 'purchases'] });
    });

    it('inverts the status set with statusExclude', async () => {
        const where = await listWhere({ status: 'posted,skipped', statusExclude: 'true' });
        expect(where.status).toEqual({ notIn: ['posted', 'skipped'] });
    });

    it('searches the source, the error and the voucher number, and the event type by name', async () => {
        const where = await listWhere({ search: '  Sale Return ' });
        const or = where.AND[0].OR;
        const like = { contains: 'Sale Return', mode: 'insensitive' };
        expect(or).toEqual(expect.arrayContaining([
            { source_id: like },
            { source_type: like },
            { source_module: like },
            { last_error: like },
            { voucher: { voucher_number: like } },
            { event_type: { in: ['sale_return'] } },
        ]));
    });

    it('adds no event-type clause when the text names no type', async () => {
        const where = await listWhere({ search: 'Account not found' });
        expect(where.AND[0].OR.some((clause: object) => 'event_type' in clause)).toBe(false);
    });

    it('bounds the last activity by whole days', async () => {
        const where = await listWhere({ from: '2026-06-01', to: '2026-06-30' });
        expect(where.updated_at.gte).toBeInstanceOf(Date);
        expect(where.updated_at.lte).toBeInstanceOf(Date);
        expect(where.updated_at.gte.getTime()).toBeLessThan(where.updated_at.lte.getTime());
    });

    it('refuses a range whose start is after its end', async () => {
        await expect(service.listPostingExceptions('t1', { from: '2026-07-01', to: '2026-06-01' } as any))
            .rejects.toBeInstanceOf(BadRequestException);
        await expect(service.getPostingExceptionSummary('t1', { from: '2026-07-01', to: '2026-06-01' } as any))
            .rejects.toBeInstanceOf(BadRequestException);
    });

    it('counts each status over the same events the list matches', async () => {
        db.postingEvent.groupBy.mockResolvedValue([
            { status: 'pending', _count: { _all: 3 } },
            { status: 'failed', _count: { _all: 2 } },
        ]);
        const query = { status: 'pending,failed', module: 'sales', search: 'INV' };

        const summary = await service.getPostingExceptionSummary('t1', query as any);

        expect(summary).toEqual({ count: 5, pending: 3, failed: 2, posted: 0, skipped: 0 });
        const listed = await listWhere(query);
        const grouped = db.postingEvent.groupBy.mock.calls[0][0];
        expect(grouped.by).toEqual(['status']);
        expect(grouped.where).toEqual(listed);
        expect(db.postingEvent.count.mock.calls[0][0].where).toEqual(listed);
    });

    describe('ListPostingExceptionsQueryDto', () => {
        const parse = (payload: unknown) =>
            validate(plainToInstance(ListPostingExceptionsQueryDto, payload), { whitelist: true, forbidNonWhitelisted: true });

        it('accepts one value or a set, a search and the exclude switch', async () => {
            expect(await parse({ status: 'failed', module: 'sales' })).toHaveLength(0);
            expect(await parse({
                status: 'pending,failed',
                statusExclude: 'true',
                module: 'cashier-sessions,fund_transfers',
                search: 'INV-001',
                from: '2026-06-01',
                to: '2026-06-30',
                page: '2',
                limit: '20',
            })).toHaveLength(0);
        });

        it('refuses an unknown status, a malformed set or an unknown switch value', async () => {
            expect(await parse({ status: 'failed,bogus' })).not.toHaveLength(0);
            expect(await parse({ status: 'failed,' })).not.toHaveLength(0);
            expect(await parse({ module: 'sales;drop' })).not.toHaveLength(0);
            expect(await parse({ statusExclude: 'yes' })).not.toHaveLength(0);
        });
    });

    describe('GET accounting/reconciliation/posting-exceptions/summary', () => {
        it('passes the tenant and the query to the service', async () => {
            const accounting = { getPostingExceptionSummary: jest.fn().mockResolvedValue({ count: 0 }) };
            const controller = new AccountingController(accounting as any, {} as any, {} as any);
            await controller.getPostingExceptionSummary({ tenantId: 't1' } as any, { status: 'failed' } as any);
            expect(accounting.getPostingExceptionSummary).toHaveBeenCalledWith('t1', { status: 'failed' });
        });

        it('is routed before any posting-exceptions/:id route', () => {
            const routes = Object.getOwnPropertyNames(AccountingController.prototype)
                .map((name) => (AccountingController.prototype as any)[name])
                .filter((handler) => typeof handler === 'function' && Reflect.hasMetadata(METHOD_METADATA, handler))
                .map((handler) => ({
                    method: Reflect.getMetadata(METHOD_METADATA, handler),
                    path: Reflect.getMetadata(PATH_METADATA, handler) as string,
                }));
            const summary = routes.findIndex((route) =>
                route.method === RequestMethod.GET && route.path === 'reconciliation/posting-exceptions/summary');
            const firstById = routes.findIndex((route) => route.path.startsWith('reconciliation/posting-exceptions/:id'));
            expect(summary).toBeGreaterThanOrEqual(0);
            expect(summary).toBeLessThan(firstById);
        });
    });
});
