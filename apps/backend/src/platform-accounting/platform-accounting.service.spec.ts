import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PLATFORM_ACCOUNT } from '@erp71/database';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { PlatformWorkspaceService } from '../platform-workspace/platform-workspace.service';
import { AccountingService } from '../accounting/accounting.service';
import { PlatformAccountingService } from './platform-accounting.service';

jest.mock('@erp71/database', () => {
    const actual = jest.requireActual('@erp71/database');
    return {
        ...actual,
        // The bootstrap does ~90 upserts against a real chart of accounts; the
        // accounts this suite needs are stubbed on `db.account.findMany` below.
        bootstrapPlatformAccounting: jest.fn().mockResolvedValue(undefined),
        seedPlatformExpenseCategories: jest.fn().mockResolvedValue(undefined),
    };
});

const postMultiLeg = jest.fn();
const voidAutoPostedVoucher = jest.fn();
jest.mock('../accounting/posting.utils', () => ({
    postMultiLeg: (...args: unknown[]) => postMultiLeg(...args),
    voidAutoPostedVoucher: (...args: unknown[]) => voidAutoPostedVoucher(...args),
}));

const WORKSPACE = { id: 'platform-ws', name: 'ERP71 Platform', timezone: 'Asia/Dhaka' };

/** Ids are `acc:<name>` so an assertion reads as the account it means. */
const ACCOUNTS = [
    { name: PLATFORM_ACCOUNT.CASH, type: 'asset', category: 'cash' },
    { name: PLATFORM_ACCOUNT.BANK, type: 'asset', category: 'bank' },
    { name: PLATFORM_ACCOUNT.BKASH, type: 'asset', category: 'cash' },
    { name: PLATFORM_ACCOUNT.NAGAD, type: 'asset', category: 'cash' },
    { name: PLATFORM_ACCOUNT.GATEWAY_RECEIVABLE, type: 'asset', category: 'general' },
    { name: PLATFORM_ACCOUNT.SUBSCRIPTION_RECEIVABLE, type: 'asset', category: 'general' },
    { name: PLATFORM_ACCOUNT.SUBSCRIPTION_REVENUE, type: 'revenue', category: 'general' },
    { name: PLATFORM_ACCOUNT.ADDON_REVENUE, type: 'revenue', category: 'general' },
    { name: PLATFORM_ACCOUNT.OTHER_REVENUE, type: 'revenue', category: 'general' },
    { name: PLATFORM_ACCOUNT.SMS_REVENUE, type: 'revenue', category: 'general' },
    { name: PLATFORM_ACCOUNT.AI_REVENUE, type: 'revenue', category: 'general' },
    // A contra-revenue account: revenue type, debit balance.
    { name: PLATFORM_ACCOUNT.REFUNDS, type: 'revenue', category: 'general' },
    { name: PLATFORM_ACCOUNT.SERVER_HOSTING, type: 'expense', category: 'general' },
].map((account) => ({ ...account, id: `acc:${account.name}` }));

const acc = (name: string) => `acc:${name}`;

function billingEvent(overrides: Record<string, unknown> = {}) {
    return {
        id: 'evt-1',
        tenant_id: 'tenant-1',
        event_type: 'subscription_fee',
        status: 'posted',
        amount: 1500,
        provider_name: 'manual',
        reference_id: 'STANDARD',
        external_event_id: 'subscription_fee:tenant-1:2026-09-01',
        payload: {},
        created_at: new Date('2026-09-01T00:00:00.000Z'),
        tenant: { name: 'Karim Store' },
        ...overrides,
    };
}

describe('PlatformAccountingService', () => {
    let service: PlatformAccountingService;

    const db = {
        account: { findMany: jest.fn(), findUnique: jest.fn() },
        billingEvent: { findMany: jest.fn(), count: jest.fn() },
        postingEvent: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() },
        platformExpense: {
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            findUnique: jest.fn(),
            findMany: jest.fn(),
            count: jest.fn(),
            aggregate: jest.fn(),
            groupBy: jest.fn(),
        },
        platformExpenseCategory: {
            findUnique: jest.fn(),
            findMany: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
        },
        voucher: { findMany: jest.fn() },
        voucherDetail: { groupBy: jest.fn() },
        user: { findFirst: jest.fn() },
        $transaction: jest.fn(),
    };

    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const platformSettings = { isFeatureEnabled: jest.fn().mockResolvedValue(true) };
    const workspace = { provisionFor: jest.fn().mockResolvedValue(WORKSPACE) };
    const accounting = {};

    beforeEach(async () => {
        jest.clearAllMocks();
        platformSettings.isFeatureEnabled.mockResolvedValue(true);
        workspace.provisionFor.mockResolvedValue(WORKSPACE);
        db.account.findMany.mockResolvedValue(ACCOUNTS);
        db.postingEvent.findUnique.mockResolvedValue(null);
        db.postingEvent.findMany.mockResolvedValue([]);
        db.billingEvent.findMany.mockResolvedValue([]);
        // The service always posts inside a transaction; the tx client is the db.
        db.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(db));
        postMultiLeg.mockResolvedValue({ postingStatus: 'posted', voucherId: 'v-1', voucherNumber: 'JV-1' });

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PlatformAccountingService,
                { provide: DatabaseService, useValue: db },
                { provide: AuditService, useValue: audit },
                { provide: PlatformSettingsService, useValue: platformSettings },
                { provide: PlatformWorkspaceService, useValue: workspace },
                { provide: AccountingService, useValue: accounting },
            ],
        }).compile();

        service = module.get(PlatformAccountingService);
    });

    describe('resolveBooks', () => {
        it('provisions and seeds once per process, however many callers ask', async () => {
            await Promise.all([service.resolveBooks('admin-1'), service.resolveBooks('admin-1')]);
            await service.resolveBooks('admin-1');

            // Two concurrent callers share one in-flight bootstrap, and the
            // third is served from the cache — 90 upserts run once, not 270.
            expect(workspace.provisionFor).toHaveBeenCalledTimes(1);
        });
    });

    describe('syncBillingEvents', () => {
        const sync = (events: unknown[]) => {
            db.billingEvent.findMany.mockResolvedValueOnce(events);
            return service.syncBillingEvents('admin-1');
        };

        it('books a subscription fee as revenue the tenant now owes', async () => {
            const result = await sync([billingEvent()]);

            expect(result.posted).toBe(1);
            expect(postMultiLeg).toHaveBeenCalledWith(expect.objectContaining({
                tenantId: WORKSPACE.id,
                eventType: 'platform_billing',
                sourceId: 'evt-1',
                // No cash moved: the tenant owes it, they have not paid it.
                voucherType: 'journal',
                legs: [
                    { accountId: acc(PLATFORM_ACCOUNT.SUBSCRIPTION_RECEIVABLE), debit: 1500 },
                    { accountId: acc(PLATFORM_ACCOUNT.SUBSCRIPTION_REVENUE), credit: 1500 },
                ],
            }));
        });

        it('books a tenant payment against the pocket the admin said it landed in', async () => {
            await sync([billingEvent({
                id: 'evt-pay',
                event_type: 'manual_payment',
                status: 'succeeded',
                amount: 500,
                payload: { method: 'bKash' },
            })]);

            expect(postMultiLeg).toHaveBeenCalledWith(expect.objectContaining({
                // bKash is a cash-category account, so this is a cash receipt.
                voucherType: 'cash_receive',
                legs: [
                    { accountId: acc(PLATFORM_ACCOUNT.BKASH), debit: 500 },
                    { accountId: acc(PLATFORM_ACCOUNT.SUBSCRIPTION_RECEIVABLE), credit: 500 },
                ],
            }));
        });

        it('falls back to the bank when the recorded method means nothing', async () => {
            await sync([billingEvent({
                id: 'evt-sms',
                event_type: 'sms_credit_sale_payment',
                status: 'succeeded',
                amount: 300,
                payload: { method: 'admin_sale' },
            })]);

            expect(postMultiLeg).toHaveBeenCalledWith(expect.objectContaining({
                voucherType: 'bank_receive',
                legs: [
                    { accountId: acc(PLATFORM_ACCOUNT.BANK), debit: 300 },
                    // Straight to revenue: a credit sale has no charge to settle.
                    { accountId: acc(PLATFORM_ACCOUNT.SMS_REVENUE), credit: 300 },
                ],
            }));
        });

        it('skips a gateway callback whose payment never validated', async () => {
            const result = await sync([billingEvent({
                id: 'evt-fail',
                event_type: 'IPN',
                status: 'FAILED',
                amount: 2000,
            })]);

            expect(postMultiLeg).not.toHaveBeenCalled();
            expect(result.posted).toBe(0);
            expect(result.unchanged).toBe(1);
        });

        it('books a gateway callback that did validate', async () => {
            await sync([billingEvent({ id: 'evt-ipn', event_type: 'IPN', status: 'VALID', amount: 2000 })]);

            expect(postMultiLeg).toHaveBeenCalledWith(expect.objectContaining({
                legs: [
                    // Not the bank: the gateway is still holding it.
                    { accountId: acc(PLATFORM_ACCOUNT.GATEWAY_RECEIVABLE), debit: 2000 },
                    { accountId: acc(PLATFORM_ACCOUNT.SUBSCRIPTION_RECEIVABLE), credit: 2000 },
                ],
            }));
        });

        it('skips an event it has already posted unchanged', async () => {
            db.postingEvent.findUnique.mockResolvedValue({
                status: 'posted',
                voucher: {
                    date: new Date('2026-09-01T00:00:00.000Z'),
                    details: [
                        { account_id: acc(PLATFORM_ACCOUNT.SUBSCRIPTION_RECEIVABLE), debit_amount: 1500, credit_amount: 0 },
                        { account_id: acc(PLATFORM_ACCOUNT.SUBSCRIPTION_REVENUE), debit_amount: 0, credit_amount: 1500 },
                    ],
                },
            });

            const result = await sync([billingEvent()]);

            expect(result).toMatchObject({ posted: 0, unchanged: 1, repaired: 0 });
            expect(postMultiLeg).not.toHaveBeenCalled();
            expect(voidAutoPostedVoucher).not.toHaveBeenCalled();
        });

        it('re-posts an event an admin has since corrected', async () => {
            db.postingEvent.findUnique.mockResolvedValue({
                status: 'posted',
                voucher: {
                    date: new Date('2026-09-01T00:00:00.000Z'),
                    details: [
                        // Was charged 900; the admin has fixed it to 1500.
                        { account_id: acc(PLATFORM_ACCOUNT.SUBSCRIPTION_RECEIVABLE), debit_amount: 900, credit_amount: 0 },
                        { account_id: acc(PLATFORM_ACCOUNT.SUBSCRIPTION_REVENUE), debit_amount: 0, credit_amount: 900 },
                    ],
                },
            });

            const result = await sync([billingEvent()]);

            expect(result).toMatchObject({ repaired: 1, posted: 0, unchanged: 0 });
            expect(voidAutoPostedVoucher).toHaveBeenCalledWith(db, WORKSPACE.id, 'platform_billing', 'evt-1');
            expect(postMultiLeg).toHaveBeenCalledWith(expect.objectContaining({
                legs: [
                    { accountId: acc(PLATFORM_ACCOUNT.SUBSCRIPTION_RECEIVABLE), debit: 1500 },
                    { accountId: acc(PLATFORM_ACCOUNT.SUBSCRIPTION_REVENUE), credit: 1500 },
                ],
            }));
        });

        it('takes back a voucher whose billing event has been deleted', async () => {
            db.postingEvent.findMany.mockResolvedValue([{ source_id: 'evt-gone' }]);

            const result = await service.syncBillingEvents('admin-1');

            expect(result.reverted).toBe(1);
            expect(voidAutoPostedVoucher).toHaveBeenCalledWith(db, WORKSPACE.id, 'platform_billing', 'evt-gone');
        });

        it('leaves vouchers outside a narrowed window alone', async () => {
            // The orphan sweep decides by "not seen in this run", so on a windowed
            // sync every event outside the window looks orphaned. Reverting those
            // would delete the rest of the ledger.
            db.postingEvent.findMany.mockResolvedValue([{ source_id: 'evt-older-than-the-window' }]);

            const result = await service.syncBillingEvents('admin-1', { from: '2026-09-01' });

            expect(result.reverted).toBe(0);
            expect(voidAutoPostedVoucher).not.toHaveBeenCalled();
        });

        it('reports a failing event and keeps going', async () => {
            postMultiLeg
                .mockRejectedValueOnce(new Error('FISCAL_PERIOD_LOCKED'))
                .mockResolvedValueOnce({ postingStatus: 'posted', voucherId: 'v-2' });

            const result = await sync([
                billingEvent({ id: 'evt-locked' }),
                billingEvent({ id: 'evt-ok', external_event_id: 'other' }),
            ]);

            expect(result.posted).toBe(1);
            expect(result.failed).toEqual([{ eventId: 'evt-locked', reason: 'FISCAL_PERIOD_LOCKED' }]);
        });

        it('ignores an event whose amount is zero or missing', async () => {
            const result = await sync([billingEvent({ id: 'evt-zero', amount: 0 })]);

            expect(postMultiLeg).not.toHaveBeenCalled();
            expect(result.posted).toBe(0);
        });
    });

    describe('createExpense', () => {
        const category = {
            id: 'cat-1',
            name: 'Server & Hosting',
            account_name: PLATFORM_ACCOUNT.SERVER_HOSTING,
            is_active: true,
        };

        beforeEach(() => {
            db.platformExpenseCategory.findUnique.mockResolvedValue(category);
            db.platformExpense.create.mockResolvedValue({
                id: 'exp-1',
                expense_date: new Date('2026-09-01T00:00:00.000Z'),
            });
            db.platformExpense.update.mockResolvedValue({
                id: 'exp-1',
                category_id: 'cat-1',
                amount: 4500,
                expense_date: new Date('2026-09-01T00:00:00.000Z'),
                paid_from: 'BANK',
                vendor: 'Hostinger',
                description: null,
                reference: null,
                voucher_id: 'v-1',
                posting_status: 'posted',
                created_at: new Date(),
                category,
            });
        });

        it('debits the category account and credits what it was paid from', async () => {
            await service.createExpense('admin-1', {
                categoryId: 'cat-1',
                amount: 4500,
                expenseDate: '2026-09-01',
                paidFrom: 'BANK',
                vendor: 'Hostinger',
            });

            expect(postMultiLeg).toHaveBeenCalledWith(expect.objectContaining({
                eventType: 'platform_expense',
                sourceId: 'exp-1',
                voucherType: 'bank_payment',
                description: 'Server & Hosting — Hostinger',
                legs: [
                    { accountId: acc(PLATFORM_ACCOUNT.SERVER_HOSTING), debit: 4500 },
                    { accountId: acc(PLATFORM_ACCOUNT.BANK), credit: 4500 },
                ],
            }));
        });

        it('refuses a retired category rather than posting to it', async () => {
            db.platformExpenseCategory.findUnique.mockResolvedValue({ ...category, is_active: false });

            await expect(service.createExpense('admin-1', {
                categoryId: 'cat-1',
                amount: 100,
                expenseDate: '2026-09-01',
            })).rejects.toThrow(BadRequestException);
            expect(postMultiLeg).not.toHaveBeenCalled();
        });

        it('names the missing account when the chart of accounts has been edited', async () => {
            db.account.findMany.mockResolvedValue(
                ACCOUNTS.filter((account) => account.name !== PLATFORM_ACCOUNT.SERVER_HOSTING),
            );

            await expect(service.createExpense('admin-1', {
                categoryId: 'cat-1',
                amount: 100,
                expenseDate: '2026-09-01',
            })).rejects.toThrow(/Server & Hosting/);
        });
    });

    describe('updateExpense', () => {
        it('voids the old voucher before posting the corrected one', async () => {
            const category = {
                id: 'cat-1',
                name: 'Server & Hosting',
                account_name: PLATFORM_ACCOUNT.SERVER_HOSTING,
                is_active: true,
            };
            db.platformExpense.findUnique.mockResolvedValue({
                id: 'exp-1',
                category_id: 'cat-1',
                amount: 4500,
                expense_date: new Date('2026-09-01T00:00:00.000Z'),
                paid_from: 'BANK',
                vendor: 'Hostinger',
                description: null,
                reference: null,
            });
            db.platformExpenseCategory.findUnique.mockResolvedValue(category);
            db.platformExpense.update.mockResolvedValue({
                id: 'exp-1',
                category_id: 'cat-1',
                amount: 5200,
                expense_date: new Date('2026-09-01T00:00:00.000Z'),
                paid_from: 'BKASH',
                vendor: 'Hostinger',
                description: null,
                reference: null,
                voucher_id: 'v-2',
                posting_status: 'posted',
                created_at: new Date(),
                category,
            });

            await service.updateExpense('admin-1', 'exp-1', { amount: 5200, paidFrom: 'BKASH' });

            expect(voidAutoPostedVoucher).toHaveBeenCalledWith(db, WORKSPACE.id, 'platform_expense', 'exp-1');
            expect(postMultiLeg).toHaveBeenCalledWith(expect.objectContaining({
                voucherType: 'cash_payment',
                legs: [
                    { accountId: acc(PLATFORM_ACCOUNT.SERVER_HOSTING), debit: 5200 },
                    { accountId: acc(PLATFORM_ACCOUNT.BKASH), credit: 5200 },
                ],
            }));
        });
    });

    describe('deleteCategory', () => {
        it('retires a category that has expenses instead of deleting it', async () => {
            db.platformExpenseCategory.findUnique.mockResolvedValue({
                id: 'cat-1',
                name: 'Server & Hosting',
                _count: { expenses: 12 },
            });
            db.platformExpenseCategory.update.mockResolvedValue({ id: 'cat-1', is_active: false });

            await expect(service.deleteCategory('admin-1', 'cat-1')).resolves.toMatchObject({
                deleted: false,
                retired: true,
            });
            expect(db.platformExpenseCategory.delete).not.toHaveBeenCalled();
        });

        it('deletes one nothing has been filed under', async () => {
            db.platformExpenseCategory.findUnique.mockResolvedValue({
                id: 'cat-2',
                name: 'Unused',
                _count: { expenses: 0 },
            });

            await expect(service.deleteCategory('admin-1', 'cat-2')).resolves.toMatchObject({ deleted: true });
            expect(db.platformExpenseCategory.delete).toHaveBeenCalledWith({ where: { id: 'cat-2' } });
        });
    });

    describe('scheduledSync', () => {
        it('does nothing while the feature is switched off', async () => {
            platformSettings.isFeatureEnabled.mockResolvedValue(false);

            await service.scheduledSync();

            expect(workspace.provisionFor).not.toHaveBeenCalled();
        });

        it('waits rather than provisioning a workspace nobody can own', async () => {
            db.user.findFirst.mockResolvedValue(null);

            await service.scheduledSync();

            expect(workspace.provisionFor).not.toHaveBeenCalled();
        });

        it('swallows a sync failure so the cron keeps running', async () => {
            db.user.findFirst.mockResolvedValue({ id: 'admin-9' });
            db.billingEvent.findMany.mockRejectedValue(new Error('database is down'));

            await expect(service.scheduledSync()).resolves.toBeUndefined();
        });
    });

    describe('getOverview', () => {
        it('reports revenue, spend and what is still owed', async () => {
            db.voucherDetail.groupBy
                // Period totals.
                .mockResolvedValueOnce([
                    { account_id: acc(PLATFORM_ACCOUNT.SUBSCRIPTION_REVENUE), _sum: { debit_amount: 0, credit_amount: 12000 } },
                    { account_id: acc(PLATFORM_ACCOUNT.REFUNDS), _sum: { debit_amount: 1000, credit_amount: 0 } },
                    { account_id: acc(PLATFORM_ACCOUNT.SERVER_HOSTING), _sum: { debit_amount: 4500, credit_amount: 0 } },
                ])
                // Balances as at the period end.
                .mockResolvedValueOnce([
                    { account_id: acc(PLATFORM_ACCOUNT.BANK), _sum: { debit_amount: 9000, credit_amount: 4500 } },
                    { account_id: acc(PLATFORM_ACCOUNT.SUBSCRIPTION_RECEIVABLE), _sum: { debit_amount: 12000, credit_amount: 9000 } },
                ]);
            db.billingEvent.count.mockResolvedValue(10);
            db.postingEvent.count.mockResolvedValue(7);
            db.voucher.findMany.mockResolvedValue([]);
            db.platformExpense.groupBy.mockResolvedValue([]);

            const overview = await service.getOverview('admin-1', {});

            expect(overview.totals).toEqual({
                // A refund is a debit to a revenue account, so it nets off
                // revenue rather than inflating expenses.
                revenue: 11000,
                expenses: 4500,
                net_profit: 6500,
                cash_and_bank: 4500,
                subscription_receivable: 3000,
                gateway_receivable: 0,
            });
            expect(overview.unsynced_billing_events).toBe(3);
        });
    });
});
