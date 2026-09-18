import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AccountingService } from './accounting.service';
import { VoucherApprovalStatus, VoucherType } from './accounting.constants';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';
import { assertFiscalPeriodOpen, autoPostFromRules, isFiscalPeriodLockedError, voidAutoPostedVoucher } from './posting.utils';

describe('assertFiscalPeriodOpen', () => {
    const buildTx = (period: unknown) => ({
        fiscalPeriod: { findFirst: jest.fn().mockResolvedValue(period) },
    }) as any;

    it('throws when the date falls in a locked period', async () => {
        const tx = buildTx({ id: 'fp-1', is_locked: true, period_label: 'Jan 2026' });
        await expect(assertFiscalPeriodOpen(tx, 'tenant-1', new Date('2026-01-15')))
            .rejects.toThrow(BadRequestException);
    });

    it('allows an open period', async () => {
        const tx = buildTx({ id: 'fp-1', is_locked: false, period_label: 'Jan 2026' });
        await expect(assertFiscalPeriodOpen(tx, 'tenant-1', new Date('2026-01-15')))
            .resolves.toBeUndefined();
    });

    it('allows a date with no fiscal period at all', async () => {
        // Most tenants never create fiscal periods. Absence must not block posting.
        const tx = buildTx(null);
        await expect(assertFiscalPeriodOpen(tx, 'tenant-1', new Date('2026-01-15')))
            .resolves.toBeUndefined();
    });
});

describe('autoPostFromRules idempotent retry vs fiscal period lock', () => {
    it('short-circuits an already-posted event without throwing, even when its period is locked', async () => {
        // A retry of an already-posted event is a no-op read path: it returns the
        // existing voucher and writes nothing. The fiscal-period guard exists to
        // block new writes, so it must never fire on this path - regardless of
        // whether the period governing the event's date has since been locked.
        const existingEvent = {
            id: 'pe-1',
            status: 'posted',
            voucher: { id: 'v-1', voucher_number: 'CR-00001', voucher_type: 'CASH_RECEIVE' },
        };

        const tx = {
            fiscalPeriod: {
                // If the guard ran, it would see a locked period and throw.
                findFirst: jest.fn().mockResolvedValue({ is_locked: true, period_label: 'Jan 2026' }),
            },
            postingEvent: {
                findUnique: jest.fn().mockResolvedValue(existingEvent),
            },
        } as any;

        const result = await autoPostFromRules({
            tx,
            tenantId: 'tenant-1',
            eventType: 'sale',
            sourceModule: 'sales',
            sourceType: 'invoice',
            sourceId: 'inv-1',
            amount: 100,
            date: new Date('2026-01-15'),
        });

        expect(result).toEqual({
            postingStatus: 'posted',
            voucherId: 'v-1',
            voucherNumber: 'CR-00001',
            voucherType: 'CASH_RECEIVE',
        });
        expect(tx.fiscalPeriod.findFirst).not.toHaveBeenCalled();
    });
});

describe('voidAutoPostedVoucher vs a closed month', () => {
    const buildTx = (event: unknown, period: unknown) => ({
        fiscalPeriod: { findFirst: jest.fn().mockResolvedValue(period) },
        postingEvent: {
            findUnique: jest.fn().mockResolvedValue(event),
            delete: jest.fn().mockResolvedValue(undefined),
        },
        voucher: { delete: jest.fn().mockResolvedValue(undefined) },
        voucherDetail: { deleteMany: jest.fn().mockResolvedValue(undefined) },
    }) as any;

    const postedEvent = {
        id: 'pe-1',
        voucher_id: 'v-1',
        voucher: { date: new Date('2026-01-20') },
    };

    it('refuses to take back a voucher dated into a locked period, and deletes nothing', async () => {
        // Cancelling a January sale in March must not reach into January's books.
        const tx = buildTx(postedEvent, { is_locked: true, period_label: 'January 2026' });

        await expect(voidAutoPostedVoucher(tx, 'tenant-1', 'sale', 'sale-1'))
            .rejects.toThrow(/January 2026 is locked/);

        expect(tx.voucher.delete).not.toHaveBeenCalled();
        expect(tx.voucherDetail.deleteMany).not.toHaveBeenCalled();
        expect(tx.postingEvent.delete).not.toHaveBeenCalled();
    });

    it('reads the voucher date, not today, when deciding which period is at stake', async () => {
        const tx = buildTx(postedEvent, { is_locked: false, period_label: 'January 2026' });

        await voidAutoPostedVoucher(tx, 'tenant-1', 'sale', 'sale-1');

        const asked = tx.fiscalPeriod.findFirst.mock.calls[0][0].where;
        expect(asked.start_date.lte).toEqual(new Date('2026-01-20'));
        expect(tx.voucher.delete).toHaveBeenCalledWith({ where: { id: 'v-1' } });
    });

    it('still drops an event that never reached the ledger', async () => {
        // No voucher means no closed-period figures to protect, so a pending or
        // failed posting event stays removable however the calendar is locked.
        const tx = buildTx({ id: 'pe-2', voucher_id: null, voucher: null }, { is_locked: true, period_label: 'January 2026' });

        await voidAutoPostedVoucher(tx, 'tenant-1', 'sale', 'sale-2');

        expect(tx.fiscalPeriod.findFirst).not.toHaveBeenCalled();
        expect(tx.postingEvent.delete).toHaveBeenCalledWith({ where: { id: 'pe-2' } });
    });
});

/**
 * Closing a month has to hold against every door into the ledger, not just the
 * one that posts new vouchers. Editing, deleting and approving all change what a
 * closed month reports, so each is refused on the *voucher's* own date.
 */
describe('AccountingService — editing a closed month', () => {
    let service: AccountingService;

    const db = {
        account: { findMany: jest.fn(), findFirst: jest.fn() },
        voucher: {
            findFirst: jest.fn(),
            findMany: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
            delete: jest.fn(),
        },
        voucherDetail: { deleteMany: jest.fn() },
        voucherAttachment: { deleteMany: jest.fn(), createMany: jest.fn() },
        fiscalPeriod: { findFirst: jest.fn(), findMany: jest.fn() },
        accountingSettings: { findUnique: jest.fn() },
        $transaction: jest.fn(),
    };

    /** A period covering `month` (1-12) of 2026, locked or not. */
    const period = (month: number, isLocked: boolean) => ({
        is_locked: isLocked,
        period_label: `Month ${month} 2026`,
        start_date: new Date(Date.UTC(2026, month - 1, 1)),
        end_date: new Date(Date.UTC(2026, month, 0, 23, 59, 59, 999)),
    });

    /** Answers the guard from a month -> locked map, so each date can differ. */
    const lockCalendar = (locked: Record<number, boolean>) => {
        db.fiscalPeriod.findFirst.mockImplementation(async (args: any) => {
            const date: Date = args.where.start_date.lte;
            const month = date.getUTCMonth() + 1;
            return month in locked ? period(month, locked[month]) : null;
        });
    };

    const januaryVoucher = {
        id: 'voucher-1',
        voucher_number: 'CP-00001',
        date: new Date('2026-01-20'),
        source_module: null,
        approval_status: VoucherApprovalStatus.PENDING,
    };

    const cashPaymentDto = {
        voucherType: VoucherType.CASH_PAYMENT,
        description: 'Office expense paid in cash',
        details: [
            { accountId: 'account-cash', debitAmount: 0, creditAmount: 50 },
            { accountId: 'account-expense', debitAmount: 50, creditAmount: 0 },
        ],
    } as any;

    beforeEach(async () => {
        jest.resetAllMocks();
        db.$transaction.mockImplementation(async (callback: any) => callback(db));
        db.fiscalPeriod.findFirst.mockResolvedValue(null);
        db.fiscalPeriod.findMany.mockResolvedValue([]);
        db.accountingSettings.findUnique.mockResolvedValue(null);
        db.account.findMany.mockResolvedValue([
            { id: 'account-cash', category: 'cash' },
            { id: 'account-expense', category: 'general' },
        ]);

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AccountingService,
                { provide: DatabaseService, useValue: db },
                { provide: AuditService, useValue: { log: jest.fn().mockResolvedValue(undefined), logForUserTenants: jest.fn() } },
                { provide: JobTrackerService, useValue: { track: (_n: string, fn: () => any) => fn() } },
            ],
        }).compile();

        service = module.get(AccountingService);
    });

    describe('updateVoucher', () => {
        it('refuses to edit a voucher that sits in a locked month', async () => {
            db.voucher.findFirst.mockResolvedValue(januaryVoucher);
            lockCalendar({ 1: true });

            await expect(service.updateVoucher('tenant-1', 'voucher-1', cashPaymentDto, 'user-9'))
                .rejects.toThrow(/Month 1 2026 is locked/);

            expect(db.voucher.update).not.toHaveBeenCalled();
            expect(db.voucherDetail.deleteMany).not.toHaveBeenCalled();
        });

        it('refuses to re-date an open voucher into a locked month', async () => {
            // The voucher's own month is open, so only the destination refuses —
            // backdating into closed books is the other half of the same hole.
            db.voucher.findFirst.mockResolvedValue({ ...januaryVoucher, date: new Date('2026-03-05') });
            lockCalendar({ 3: false, 1: true });

            await expect(service.updateVoucher(
                'tenant-1',
                'voucher-1',
                { ...cashPaymentDto, date: '2026-01-15' },
                'user-9',
            )).rejects.toThrow(/Month 1 2026 is locked/);

            expect(db.voucher.update).not.toHaveBeenCalled();
        });

        it('allows the edit when both months are open', async () => {
            db.voucher.findFirst.mockResolvedValue({ ...januaryVoucher, date: new Date('2026-03-05') });
            lockCalendar({ 3: false, 4: false });
            db.voucher.update.mockResolvedValue({ id: 'voucher-1', voucher_number: 'CP-00001', details: [] });

            await service.updateVoucher('tenant-1', 'voucher-1', { ...cashPaymentDto, date: '2026-04-02' }, 'user-9');

            expect(db.voucher.update).toHaveBeenCalled();
        });
    });

    describe('deleteVoucher', () => {
        it('refuses to delete out of a locked month', async () => {
            db.voucher.findFirst.mockResolvedValue(januaryVoucher);
            lockCalendar({ 1: true });

            await expect(service.deleteVoucher('tenant-1', 'voucher-1', 'user-9'))
                .rejects.toThrow(/Month 1 2026 is locked/);

            expect(db.voucher.delete).not.toHaveBeenCalled();
        });

        it('still deletes from an open month', async () => {
            db.voucher.findFirst.mockResolvedValue(januaryVoucher);
            lockCalendar({ 1: false });

            await expect(service.deleteVoucher('tenant-1', 'voucher-1', 'user-9'))
                .resolves.toEqual({ success: true, id: 'voucher-1' });
            expect(db.voucher.delete).toHaveBeenCalled();
        });
    });

    describe('approveVoucher', () => {
        it('refuses to sign a pending voucher into a locked month', async () => {
            // The voucher predates the lock, but approving is what puts it on the
            // books — doing that to a closed month moves figures already filed.
            db.voucher.findFirst.mockResolvedValue(januaryVoucher);
            lockCalendar({ 1: true });

            await expect(service.approveVoucher('tenant-1', 'voucher-1', 'user-9'))
                .rejects.toThrow(/Month 1 2026 is locked/);

            expect(db.voucher.update).not.toHaveBeenCalled();
        });

        it('still lets the same voucher be rejected', async () => {
            // Rejecting leaves the ledger exactly as the close found it, so the
            // reviewer keeps a way to clear the queue.
            db.voucher.findFirst.mockResolvedValue(januaryVoucher);
            lockCalendar({ 1: true });
            db.voucher.update.mockResolvedValue({ id: 'voucher-1', voucher_number: 'CP-00001', details: [] });

            await service.rejectVoucher('tenant-1', 'voucher-1', { reason: 'wrong month' }, 'user-9');

            expect(db.voucher.update.mock.calls[0][0].data.approval_status).toBe(VoucherApprovalStatus.REJECTED);
        });
    });

    describe('bulkUpdateVoucherApproval', () => {
        it('holds back the rows in a locked month and approves the rest', async () => {
            db.voucher.findMany.mockResolvedValue([
                { id: 'v-jan', approval_status: VoucherApprovalStatus.PENDING, date: new Date('2026-01-20') },
                { id: 'v-mar', approval_status: VoucherApprovalStatus.PENDING, date: new Date('2026-03-04') },
            ]);
            db.fiscalPeriod.findMany.mockResolvedValue([period(1, true)]);
            db.voucher.updateMany.mockResolvedValue({ count: 1 });

            const result = await service.bulkUpdateVoucherApproval(
                'tenant-1',
                { ids: ['v-jan', 'v-mar'] },
                'approve',
                'user-9',
            );

            expect(result).toEqual({ updated: 1, skipped: 0, lockedPeriod: 1, notFound: 0 });
            expect(db.voucher.updateMany.mock.calls[0][0].where.id).toEqual({ in: ['v-mar'] });
        });

        it('leaves a bulk reject alone, whatever is locked', async () => {
            db.voucher.findMany.mockResolvedValue([
                { id: 'v-jan', approval_status: VoucherApprovalStatus.PENDING, date: new Date('2026-01-20') },
            ]);
            db.voucher.updateMany.mockResolvedValue({ count: 1 });

            const result = await service.bulkUpdateVoucherApproval('tenant-1', { ids: ['v-jan'] }, 'reject', 'user-9');

            expect(result).toEqual({ updated: 1, skipped: 0, lockedPeriod: 0, notFound: 0 });
            expect(db.fiscalPeriod.findMany).not.toHaveBeenCalled();
        });
    });
});

describe('isFiscalPeriodLockedError', () => {
    // The nightly platform-billing sweep leans on this to tell a closed month
    // apart from a real failure, so it has to match what the guard actually throws.
    it('recognises the guard\'s own exception', async () => {
        const tx = { fiscalPeriod: { findFirst: jest.fn().mockResolvedValue({ is_locked: true, period_label: 'Jan 2026' }) } } as any;

        const error = await assertFiscalPeriodOpen(tx, 'tenant-1', new Date('2026-01-15')).catch((e) => e);

        expect(isFiscalPeriodLockedError(error)).toBe(true);
    });

    it('does not swallow an unrelated failure', () => {
        expect(isFiscalPeriodLockedError(new Error('connection reset'))).toBe(false);
        expect(isFiscalPeriodLockedError(new BadRequestException('Voucher is already approved.'))).toBe(false);
        expect(isFiscalPeriodLockedError(undefined)).toBe(false);
    });
});
