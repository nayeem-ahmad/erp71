import 'reflect-metadata';
import { BadRequestException, ForbiddenException, RequestMethod } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { StorePermission } from '@erp71/shared-types';
import { AccountingController } from './accounting.controller';
import { ListVouchersQueryDto } from './accounting.dto';
import { AccountingService } from './accounting.service';

/**
 * The voucher list's filter row and the stats strip above it. Both go through
 * one `where`, so the strip always counts the vouchers the list shows.
 */
describe('Voucher list filters and summary', () => {
    let db: any;
    let service: AccountingService;

    beforeEach(() => {
        db = {
            voucher: {
                findMany: jest.fn().mockResolvedValue([]),
                count: jest.fn().mockResolvedValue(0),
                groupBy: jest.fn().mockResolvedValue([]),
            },
            voucherDetail: {
                groupBy: jest.fn().mockResolvedValue([]),
                aggregate: jest.fn().mockResolvedValue({ _sum: { debit_amount: null } }),
            },
        };
        service = new AccountingService(db, {} as any, {} as any);
    });

    const listCall = async (query: Record<string, unknown>) => {
        await service.findVouchers('t1', { timezone: 'Asia/Dhaka', ...query } as any);
        return db.voucher.findMany.mock.calls[0][0];
    };
    const listWhere = async (query: Record<string, unknown>) => (await listCall(query)).where;

    it('keeps a single voucher type and approval status as plain equalities', async () => {
        const where = await listWhere({ voucherType: 'cash_payment', approvalStatus: 'PENDING' });
        expect(where.voucher_type).toBe('cash_payment');
        expect(where.approval_status).toBe('PENDING');
    });

    it('matches any of a comma-separated set of types and statuses', async () => {
        const where = await listWhere({ voucherType: 'cash_payment,bank_payment', approvalStatus: 'PENDING,REJECTED' });
        expect(where.voucher_type).toEqual({ in: ['cash_payment', 'bank_payment'] });
        expect(where.approval_status).toEqual({ in: ['PENDING', 'REJECTED'] });
    });

    it('searches the number, reference and narration, ignoring case', async () => {
        const where = await listWhere({ search: '  rent ' });
        expect(where.AND).toEqual([
            {
                OR: [
                    { voucher_number: { contains: 'rent', mode: 'insensitive' } },
                    { reference_number: { contains: 'rent', mode: 'insensitive' } },
                    { description: { contains: 'rent', mode: 'insensitive' } },
                ],
            },
        ]);
    });

    it('tells hand-keyed vouchers from those another module posted', async () => {
        expect((await listWhere({ source: 'manual' })).source_module).toBeNull();
        db.voucher.findMany.mockClear();
        expect((await listWhere({ source: 'system' })).source_module).toEqual({ not: null });
    });

    it("narrows by the voucher's total — the sum of its debit lines — within the other filters", async () => {
        db.voucherDetail.groupBy.mockResolvedValue([{ voucher_id: 'v1' }, { voucher_id: 'v2' }]);

        const where = await listWhere({ storeId: 's1', voucherType: 'journal', amount: 'between:500,100' });

        const grouping = db.voucherDetail.groupBy.mock.calls[0][0];
        expect(grouping.by).toEqual(['voucher_id']);
        expect(grouping.having).toEqual({ debit_amount: { _sum: { gte: 100, lte: 500 } } });
        expect(grouping.where.voucher).toEqual(
            expect.objectContaining({ tenant_id: 't1', store_id: 's1', voucher_type: 'journal' }),
        );
        expect(where.id).toEqual({ in: ['v1', 'v2'] });
    });

    it('does not group the lines when no amount is asked for', async () => {
        await listWhere({});
        expect(db.voucherDetail.groupBy).not.toHaveBeenCalled();
    });

    it('refuses a malformed amount rather than listing every voucher', async () => {
        await expect(service.findVouchers('t1', { timezone: 'Asia/Dhaka', amount: 'big' } as any))
            .rejects.toBeInstanceOf(BadRequestException);
    });

    it('sorts by an allowed column and falls back to newest first otherwise', async () => {
        expect((await listCall({ sortBy: 'voucher_number', sortDir: 'asc' })).orderBy).toEqual({ voucher_number: 'asc' });
        db.voucher.findMany.mockClear();
        expect((await listCall({ sortBy: 'total_amount; drop', sortDir: 'asc' })).orderBy)
            .toEqual([{ date: 'desc' }, { created_at: 'desc' }]);
    });

    it('sums the strip over the same vouchers the list matches', async () => {
        db.voucher.count.mockImplementation(async ({ where }: any) => (where.AND?.[1]?.source_module ? 2 : 5));
        db.voucher.groupBy.mockResolvedValue([
            { approval_status: 'APPROVED', _count: { _all: 3 } },
            { approval_status: 'PENDING', _count: { _all: 2 } },
        ]);
        db.voucherDetail.aggregate.mockResolvedValue({ _sum: { debit_amount: '12500.505' } });

        const summary = await service.getVoucherListSummary('t1', {
            timezone: 'Asia/Dhaka',
            storeId: 's1',
            approvalStatus: 'PENDING,APPROVED',
            search: 'rent',
        } as any);

        expect(summary).toEqual({
            count: 5,
            totalAmount: 12500.51,
            pending: 2,
            approved: 3,
            rejected: 0,
            systemCount: 2,
            manualCount: 3,
        });

        await service.findVouchers('t1', {
            timezone: 'Asia/Dhaka',
            storeId: 's1',
            approvalStatus: 'PENDING,APPROVED',
            search: 'rent',
        } as any);
        const listed = db.voucher.findMany.mock.calls[0][0].where;
        expect(db.voucher.groupBy.mock.calls[0][0].where).toEqual(listed);
        expect(db.voucherDetail.aggregate.mock.calls[0][0].where).toEqual({ voucher: listed });
        expect(db.voucher.count.mock.calls[1][0].where).toEqual({ AND: [listed, { source_module: { not: null } }] });
    });

    describe('ListVouchersQueryDto', () => {
        const parse = (payload: unknown) =>
            validate(plainToInstance(ListVouchersQueryDto, payload), { whitelist: true, forbidNonWhitelisted: true });

        it('accepts the approval-queue link and the filter row', async () => {
            expect(await parse({ approvalStatus: 'PENDING' })).toHaveLength(0);
            expect(await parse({
                search: 'rent',
                voucherType: 'cash_payment,journal',
                approvalStatus: 'PENDING,REJECTED',
                amount: 'gt:100',
                source: 'system',
                sortBy: 'date',
                sortDir: 'desc',
            })).toHaveLength(0);
        });

        it('refuses a type or status outside the known set', async () => {
            expect(await parse({ voucherType: 'cash_payment,bogus' })).not.toHaveLength(0);
            expect(await parse({ approvalStatus: 'PENDING,' })).not.toHaveLength(0);
            expect(await parse({ source: 'robot' })).not.toHaveLength(0);
        });
    });

    describe('GET accounting/vouchers/summary', () => {
        const member = { tenantId: 't1', storeId: 's1', userId: 'u1', userRole: 'MANAGER', timezone: 'Asia/Dhaka' } as any;
        const accounting = { getVoucherListSummary: jest.fn() };
        const branchScope = { resolveStoreId: jest.fn() };
        const controller = new AccountingController(accounting as any, {} as any, branchScope as any);

        beforeEach(() => jest.clearAllMocks());

        it('takes the list\'s branch scope', async () => {
            branchScope.resolveStoreId.mockResolvedValue('s1');
            await controller.getVoucherListSummary(member, { storeId: 's1', voucherType: 'journal' } as any);
            expect(branchScope.resolveStoreId).toHaveBeenCalledWith(member, 's1', {
                permissions: [StorePermission.VIEW_LEDGER],
            });
            expect(accounting.getVoucherListSummary).toHaveBeenCalledWith('t1', {
                storeId: 's1',
                voucherType: 'journal',
                timezone: 'Asia/Dhaka',
            });
        });

        it('refuses a branch the caller cannot use', async () => {
            branchScope.resolveStoreId.mockRejectedValue(new ForbiddenException());
            await expect(controller.getVoucherListSummary(member, { storeId: 'foreign' } as any))
                .rejects.toBeInstanceOf(ForbiddenException);
            expect(accounting.getVoucherListSummary).not.toHaveBeenCalled();
        });

        it('is routed before vouchers/:id, which would take "summary" for an id', () => {
            const getRoutes = Object.getOwnPropertyNames(AccountingController.prototype)
                .map((name) => (AccountingController.prototype as any)[name])
                .filter((handler) => typeof handler === 'function'
                    && Reflect.getMetadata(METHOD_METADATA, handler) === RequestMethod.GET)
                .map((handler) => Reflect.getMetadata(PATH_METADATA, handler));
            expect(getRoutes.indexOf('vouchers/summary')).toBeGreaterThanOrEqual(0);
            expect(getRoutes.indexOf('vouchers/summary')).toBeLessThan(getRoutes.indexOf('vouchers/:id'));
        });
    });
});
