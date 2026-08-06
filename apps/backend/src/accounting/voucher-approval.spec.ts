import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AccountingService } from './accounting.service';
import { VoucherApprovalStatus, VoucherType } from './accounting.constants';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';
import { autoPostFromRules } from './posting.utils';
import {
    approvalVoucherFilter,
    DEFAULT_ACCOUNTING_APPROVAL_SETTINGS,
    initialApprovalStatus,
    resolveApprovedOnly,
    toApprovalSettings,
} from './voucher-approval.util';

/**
 * Voucher approval (maker-checker). The load-bearing property throughout is that
 * a tenant which never enables approval behaves exactly as it did before the
 * feature existed: everything is APPROVED and no report filters anything out.
 */

const settingsRow = (over: Partial<{
    require_voucher_approval: boolean;
    auto_approve_system_vouchers: boolean;
    reports_approved_only: boolean;
}> = {}) => ({
    require_voucher_approval: false,
    auto_approve_system_vouchers: true,
    reports_approved_only: false,
    ...over,
});

describe('voucher-approval.util', () => {
    describe('initialApprovalStatus', () => {
        it('approves everything while approval is off', () => {
            const settings = DEFAULT_ACCOUNTING_APPROVAL_SETTINGS;
            expect(initialApprovalStatus(settings, 'manual')).toBe(VoucherApprovalStatus.APPROVED);
            expect(initialApprovalStatus(settings, 'system')).toBe(VoucherApprovalStatus.APPROVED);
        });

        it('queues manual entries once approval is required', () => {
            const settings = toApprovalSettings(settingsRow({ require_voucher_approval: true }));
            expect(initialApprovalStatus(settings, 'manual')).toBe(VoucherApprovalStatus.PENDING);
        });

        it('lets vouchers from other modules post straight through by default', () => {
            const settings = toApprovalSettings(settingsRow({ require_voucher_approval: true }));
            expect(initialApprovalStatus(settings, 'system')).toBe(VoucherApprovalStatus.APPROVED);
        });

        it('queues vouchers from other modules when the owner turns auto-approve off', () => {
            const settings = toApprovalSettings(settingsRow({
                require_voucher_approval: true,
                auto_approve_system_vouchers: false,
            }));
            expect(initialApprovalStatus(settings, 'system')).toBe(VoucherApprovalStatus.PENDING);
        });
    });

    describe('resolveApprovedOnly', () => {
        it('falls back to the tenant setting when the request says nothing', () => {
            expect(resolveApprovedOnly(toApprovalSettings(settingsRow({ reports_approved_only: true })))).toBe(true);
            expect(resolveApprovedOnly(DEFAULT_ACCOUNTING_APPROVAL_SETTINGS)).toBe(false);
        });

        it('lets an explicit request override the setting in both directions', () => {
            const on = toApprovalSettings(settingsRow({ reports_approved_only: true }));
            expect(resolveApprovedOnly(on, false)).toBe(false);
            expect(resolveApprovedOnly(DEFAULT_ACCOUNTING_APPROVAL_SETTINGS, true)).toBe(true);
        });
    });

    it('produces an empty — genuinely no-op — filter when unrestricted', () => {
        expect(approvalVoucherFilter(false)).toEqual({});
        expect(approvalVoucherFilter(true)).toEqual({ approval_status: VoucherApprovalStatus.APPROVED });
    });

    it('treats a missing settings row as the pre-feature defaults', () => {
        expect(toApprovalSettings(null)).toEqual(DEFAULT_ACCOUNTING_APPROVAL_SETTINGS);
    });
});

describe('AccountingService — voucher approval', () => {
    let service: AccountingService;

    const db = {
        account: { findMany: jest.fn(), findFirst: jest.fn() },
        voucher: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), count: jest.fn(), findMany: jest.fn() },
        voucherDetail: { aggregate: jest.fn(), findMany: jest.fn(), groupBy: jest.fn(), deleteMany: jest.fn() },
        voucherSequence: { upsert: jest.fn(), update: jest.fn() },
        voucherAttachment: { deleteMany: jest.fn(), createMany: jest.fn() },
        fiscalPeriod: { findFirst: jest.fn() },
        accountingSettings: { findUnique: jest.fn(), upsert: jest.fn() },
        $transaction: jest.fn(),
    };

    const auditLog = jest.fn();

    beforeEach(async () => {
        jest.resetAllMocks();
        db.$transaction.mockImplementation(async (callback: any) => callback(db));
        db.fiscalPeriod.findFirst.mockResolvedValue(null);
        db.accountingSettings.findUnique.mockResolvedValue(null);
        auditLog.mockResolvedValue(undefined);

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AccountingService,
                { provide: DatabaseService, useValue: db },
                { provide: AuditService, useValue: { log: auditLog, logForUserTenants: auditLog } },
                { provide: JobTrackerService, useValue: { track: (_n: string, fn: () => any) => fn() } },
            ],
        }).compile();

        service = module.get(AccountingService);
    });

    const primeVoucherCreate = () => {
        db.account.findMany.mockResolvedValue([
            { id: 'account-cash', category: 'cash' },
            { id: 'account-expense', category: 'general' },
        ]);
        db.voucherSequence.upsert.mockResolvedValue({ prefix: 'CP', next_number: 1 });
        db.voucherSequence.update.mockResolvedValue({ prefix: 'CP', next_number: 2 });
        db.voucher.create.mockResolvedValue({ id: 'voucher-1', voucher_number: 'CP-00001', details: [] });
    };

    const cashPaymentDto = {
        voucherType: VoucherType.CASH_PAYMENT,
        description: 'Office expense paid in cash',
        details: [
            { accountId: 'account-cash', debitAmount: 0, creditAmount: 50 },
            { accountId: 'account-expense', debitAmount: 50, creditAmount: 0 },
        ],
    };

    const createdStatus = () => db.voucher.create.mock.calls[0][0].data.approval_status;

    describe('settings', () => {
        it('reports the pre-feature defaults when no row exists yet, without creating one', async () => {
            const result = await service.getAccountingSettings('tenant-1');

            expect(result).toEqual({
                requireVoucherApproval: false,
                autoApproveSystemVouchers: true,
                reportsApprovedOnly: false,
                updatedAt: null,
            });
            expect(db.accountingSettings.upsert).not.toHaveBeenCalled();
        });

        it('leaves untouched flags at their current value on a partial update', async () => {
            db.accountingSettings.findUnique.mockResolvedValue(settingsRow({
                require_voucher_approval: true,
                auto_approve_system_vouchers: false,
            }));
            db.accountingSettings.upsert.mockImplementation(async ({ update }: any) => ({
                id: 'as-1',
                ...update,
                updated_at: new Date('2026-08-02T00:00:00Z'),
            }));

            await service.updateAccountingSettings('tenant-1', { reportsApprovedOnly: true });

            expect(db.accountingSettings.upsert).toHaveBeenCalledWith(expect.objectContaining({
                update: {
                    require_voucher_approval: true,
                    auto_approve_system_vouchers: false,
                    reports_approved_only: true,
                },
            }));
        });
    });

    describe('createVoucher', () => {
        it('stamps APPROVED while approval is off', async () => {
            primeVoucherCreate();

            await service.createVoucher('tenant-1', cashPaymentDto);

            expect(createdStatus()).toBe(VoucherApprovalStatus.APPROVED);
        });

        it('stamps PENDING once the tenant requires approval', async () => {
            db.accountingSettings.findUnique.mockResolvedValue(settingsRow({ require_voucher_approval: true }));
            primeVoucherCreate();

            await service.createVoucher('tenant-1', cashPaymentDto);

            expect(createdStatus()).toBe(VoucherApprovalStatus.PENDING);
        });
    });

    describe('updateVoucher', () => {
        const primeUpdate = () => {
            db.voucher.findFirst.mockResolvedValue({ id: 'voucher-1', source_module: null });
            db.account.findMany.mockResolvedValue([
                { id: 'account-cash', category: 'cash' },
                { id: 'account-expense', category: 'general' },
            ]);
            db.voucherDetail.deleteMany.mockResolvedValue({ count: 2 });
            db.voucherAttachment.deleteMany.mockResolvedValue({ count: 0 });
            db.voucher.update.mockResolvedValue({ id: 'voucher-1', voucher_number: 'CP-00001', details: [] });
        };

        it('sends an edited voucher back to the queue, clearing the earlier sign-off', async () => {
            db.accountingSettings.findUnique.mockResolvedValue(settingsRow({ require_voucher_approval: true }));
            primeUpdate();

            await service.updateVoucher('tenant-1', 'voucher-1', cashPaymentDto);

            expect(db.voucher.update.mock.calls[0][0].data).toMatchObject({
                approval_status: VoucherApprovalStatus.PENDING,
                approved_by: null,
                approved_at: null,
                rejection_reason: null,
            });
        });

        it('does not touch approval fields while approval is off', async () => {
            primeUpdate();

            await service.updateVoucher('tenant-1', 'voucher-1', cashPaymentDto);

            expect(db.voucher.update.mock.calls[0][0].data).not.toHaveProperty('approval_status');
        });
    });

    describe('approve / reject', () => {
        it('records the approver and clears any rejection reason', async () => {
            db.voucher.findFirst.mockResolvedValue({
                id: 'voucher-1',
                approval_status: VoucherApprovalStatus.PENDING,
            });
            db.voucher.update.mockResolvedValue({ id: 'voucher-1', voucher_number: 'CP-00001', details: [] });

            await service.approveVoucher('tenant-1', 'voucher-1', 'user-9');

            expect(db.voucher.update.mock.calls[0][0].data).toMatchObject({
                approval_status: VoucherApprovalStatus.APPROVED,
                approved_by: 'user-9',
                rejection_reason: null,
            });
        });

        it('refuses to approve a voucher that is already approved', async () => {
            db.voucher.findFirst.mockResolvedValue({
                id: 'voucher-1',
                approval_status: VoucherApprovalStatus.APPROVED,
            });

            await expect(service.approveVoucher('tenant-1', 'voucher-1', 'user-9')).rejects.toBeInstanceOf(
                BadRequestException,
            );
            expect(db.voucher.update).not.toHaveBeenCalled();
        });

        it('404s on a voucher belonging to another tenant', async () => {
            db.voucher.findFirst.mockResolvedValue(null);

            await expect(service.approveVoucher('tenant-1', 'voucher-x', 'user-9')).rejects.toBeInstanceOf(
                NotFoundException,
            );
        });

        it('stores the rejection reason, trimmed, and blanks an empty one', async () => {
            db.voucher.findFirst.mockResolvedValue({
                id: 'voucher-1',
                approval_status: VoucherApprovalStatus.PENDING,
            });
            db.voucher.update.mockResolvedValue({ id: 'voucher-1', voucher_number: 'CP-00001', details: [] });

            await service.rejectVoucher('tenant-1', 'voucher-1', { reason: '  wrong account  ' }, 'user-9');
            expect(db.voucher.update.mock.calls[0][0].data.rejection_reason).toBe('wrong account');

            db.voucher.update.mockClear();
            await service.rejectVoucher('tenant-1', 'voucher-1', { reason: '   ' }, 'user-9');
            expect(db.voucher.update.mock.calls[0][0].data.rejection_reason).toBeNull();
        });
    });

    describe('bulk approval', () => {
        it('approves only the rows that are not already in the target state', async () => {
            db.voucher.findMany.mockResolvedValue([
                { id: 'v-1', approval_status: VoucherApprovalStatus.PENDING },
                { id: 'v-2', approval_status: VoucherApprovalStatus.APPROVED },
            ]);
            db.voucher.updateMany.mockResolvedValue({ count: 1 });

            const result = await service.bulkUpdateVoucherApproval(
                'tenant-1',
                { ids: ['v-1', 'v-2'] },
                'approve',
                'user-9',
            );

            expect(result).toEqual({ updated: 1, skipped: 1, notFound: 0 });
            expect(db.voucher.updateMany.mock.calls[0][0].where.id).toEqual({ in: ['v-1'] });
        });

        it('reports ids belonging to another tenant as notFound instead of failing the batch', async () => {
            db.voucher.findMany.mockResolvedValue([
                { id: 'v-1', approval_status: VoucherApprovalStatus.PENDING },
            ]);
            db.voucher.updateMany.mockResolvedValue({ count: 1 });

            const result = await service.bulkUpdateVoucherApproval(
                'tenant-1',
                { ids: ['v-1', 'v-other'] },
                'approve',
                'user-9',
            );

            expect(result).toEqual({ updated: 1, skipped: 0, notFound: 1 });
        });

        it('does not write at all when every selected voucher is already approved', async () => {
            db.voucher.findMany.mockResolvedValue([
                { id: 'v-1', approval_status: VoucherApprovalStatus.APPROVED },
            ]);

            const result = await service.bulkUpdateVoucherApproval('tenant-1', { ids: ['v-1'] }, 'approve', 'user-9');

            expect(result).toEqual({ updated: 0, skipped: 1, notFound: 0 });
            expect(db.voucher.updateMany).not.toHaveBeenCalled();
        });

        it('carries the reason on a bulk reject and clears it on a bulk approve', async () => {
            db.voucher.findMany.mockResolvedValue([
                { id: 'v-1', approval_status: VoucherApprovalStatus.PENDING },
            ]);
            db.voucher.updateMany.mockResolvedValue({ count: 1 });

            await service.bulkUpdateVoucherApproval('tenant-1', { ids: ['v-1'], reason: '  bad period ' }, 'reject', 'u');
            expect(db.voucher.updateMany.mock.calls[0][0].data.rejection_reason).toBe('bad period');

            db.voucher.updateMany.mockClear();
            await service.bulkUpdateVoucherApproval('tenant-1', { ids: ['v-1'] }, 'approve', 'u');
            expect(db.voucher.updateMany.mock.calls[0][0].data.rejection_reason).toBeNull();
        });
    });

    describe('pending count', () => {
        it('short-circuits to zero without querying vouchers when approval is off', async () => {
            const result = await service.getPendingVoucherCount('tenant-1');

            expect(result).toEqual({ count: 0, approvalEnabled: false });
            expect(db.voucher.count).not.toHaveBeenCalled();
        });

        it('counts pending vouchers once the tenant requires approval', async () => {
            db.accountingSettings.findUnique.mockResolvedValue(settingsRow({ require_voucher_approval: true }));
            db.voucher.count.mockResolvedValue(4);

            const result = await service.getPendingVoucherCount('tenant-1');

            expect(result).toEqual({ count: 4, approvalEnabled: true });
            expect(db.voucher.count.mock.calls[0][0].where).toMatchObject({
                tenant_id: 'tenant-1',
                approval_status: VoucherApprovalStatus.PENDING,
            });
        });
    });

    describe('reports', () => {
        const primeLedger = () => {
            db.account.findFirst.mockResolvedValue({
                id: 'account-cash',
                name: 'Cash',
                code: '110201',
                type: 'asset',
                category: 'cash',
                group: null,
                subgroup: null,
            });
            db.voucherDetail.aggregate.mockResolvedValue({ _sum: { debit_amount: 0, credit_amount: 0 } });
            db.voucherDetail.findMany.mockResolvedValue([]);
        };

        const ledgerVoucherWhere = () => db.voucherDetail.findMany.mock.calls[0][0].where.voucher;

        it('does not restrict anything while the tenant setting is off', async () => {
            primeLedger();

            await service.findLedger('tenant-1', 'account-cash', {});

            expect(ledgerVoucherWhere()).not.toHaveProperty('approval_status');
        });

        it('counts only approved vouchers once the tenant turns the option on', async () => {
            db.accountingSettings.findUnique.mockResolvedValue(settingsRow({ reports_approved_only: true }));
            primeLedger();

            await service.findLedger('tenant-1', 'account-cash', {});

            expect(ledgerVoucherWhere()).toMatchObject({
                approval_status: VoucherApprovalStatus.APPROVED,
            });
        });

        it('lets one request opt back into unapproved figures', async () => {
            db.accountingSettings.findUnique.mockResolvedValue(settingsRow({ reports_approved_only: true }));
            primeLedger();

            await service.findLedger('tenant-1', 'account-cash', { approvedOnly: false });

            expect(ledgerVoucherWhere()).not.toHaveProperty('approval_status');
        });

        it('filters the trial balance the same way', async () => {
            db.accountingSettings.findUnique.mockResolvedValue(settingsRow({ reports_approved_only: true }));
            db.account.findMany.mockResolvedValue([{
                id: 'account-cash',
                name: 'Cash',
                code: '110201',
                type: 'asset',
                group: { id: 'g-1', name: 'Current Assets', code: '11' },
                subgroup: null,
            }]);
            db.voucherDetail.findMany.mockResolvedValue([]);

            await service.getTrialBalance('tenant-1', {}, true);

            expect(db.voucherDetail.findMany.mock.calls[0][0].where.voucher).toMatchObject({
                approval_status: VoucherApprovalStatus.APPROVED,
            });
        });
    });
});

describe('autoPostFromRules — approval', () => {
    const buildTx = (settings: any) => {
        const captured: { data?: any } = {};

        const tx = {
            postingEvent: {
                findUnique: jest.fn().mockResolvedValue(null),
                create: jest.fn().mockResolvedValue({ id: 'pe-1' }),
                update: jest.fn().mockResolvedValue({ id: 'pe-1' }),
            },
            fiscalPeriod: { findFirst: jest.fn().mockResolvedValue(null) },
            postingRule: {
                findFirst: jest.fn().mockResolvedValue({
                    debit_account_id: 'ar',
                    credit_account_id: 'revenue',
                }),
            },
            account: {
                findMany: jest.fn().mockResolvedValue([
                    { id: 'ar', party_type: null },
                    { id: 'revenue', party_type: null },
                ]),
            },
            voucherSequence: {
                upsert: jest.fn().mockResolvedValue({ next_number: 1, prefix: 'CR' }),
                update: jest.fn().mockResolvedValue({}),
            },
            accountingSettings: { findUnique: jest.fn().mockResolvedValue(settings) },
            voucher: {
                create: jest.fn().mockImplementation(async ({ data }: any) => {
                    captured.data = data;
                    return { id: 'v-1', voucher_number: 'CR-00001', voucher_type: data.voucher_type };
                }),
            },
        } as any;

        return { tx, captured };
    };

    const input = (tx: any) => ({
        tx,
        tenantId: 'tenant-1',
        eventType: 'sale' as const,
        conditionKey: 'payment_mode' as const,
        conditionValue: 'credit',
        sourceModule: 'sales',
        sourceType: 'sale',
        sourceId: 'sale-1',
        amount: 500,
    });

    it('posts straight through when the tenant auto-approves system vouchers', async () => {
        const { tx, captured } = buildTx(settingsRow({ require_voucher_approval: true }));

        await autoPostFromRules(input(tx));

        expect(captured.data.approval_status).toBe(VoucherApprovalStatus.APPROVED);
    });

    it('queues the posting when the owner turns auto-approve off', async () => {
        const { tx, captured } = buildTx(settingsRow({
            require_voucher_approval: true,
            auto_approve_system_vouchers: false,
        }));

        await autoPostFromRules(input(tx));

        expect(captured.data.approval_status).toBe(VoucherApprovalStatus.PENDING);
    });

    it('approves as before for a tenant with no settings row', async () => {
        const { tx, captured } = buildTx(null);

        await autoPostFromRules(input(tx));

        expect(captured.data.approval_status).toBe(VoucherApprovalStatus.APPROVED);
    });
});
