import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import {
    bootstrapPlatformAccounting,
    seedPlatformExpenseCategories,
    PLATFORM_ACCOUNT,
    PLATFORM_PAYMENT_ACCOUNTS,
    type PlatformAccountName,
} from '@erp71/database';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { PlatformWorkspaceService } from '../platform-workspace/platform-workspace.service';
import { AccountingService } from '../accounting/accounting.service';
import { AccountCategory, AccountType, VoucherType } from '../accounting/accounting.constants';
import { postMultiLeg, voidAutoPostedVoucher } from '../accounting/posting.utils';
import {
    BILLING_EVENT_POSTINGS,
    PLATFORM_ACCOUNTING_SOURCE_MODULE,
    PROJECTED_BILLING_EVENT_TYPES,
    resolvePlatformCashAccount,
    type BillingEventPosting,
} from './platform-accounting.constants';
import {
    CreatePlatformExpenseCategoryDto,
    CreatePlatformExpenseDto,
    ListPlatformExpensesQueryDto,
    PlatformAccountingOverviewQueryDto,
    SyncPlatformBillingDto,
    UpdatePlatformExpenseCategoryDto,
    UpdatePlatformExpenseDto,
} from './platform-accounting.dto';

/**
 * Gateway statuses that mean the money actually moved.
 *
 * An allow-list, not a deny-list. SSLCommerz spells failure several ways and
 * adds new ones at will; posting revenue for an unrecognised status would be
 * silently wrong, while skipping one shows up as a payment missing from the
 * ledger and gets noticed.
 */
const SUCCESSFUL_GATEWAY_STATUSES = new Set([
    'VALID',
    'VALIDATED',
    'SUCCESS',
    'SUCCESSFUL',
    'SUCCEEDED',
    'COMPLETED',
    'PAID',
    'POSTED',
]);

/** Event types whose `status` comes from the payment gateway rather than from us. */
const GATEWAY_EVENT_TYPES = new Set(['IPN', 'CALLBACK_SUCCESS', 'REFUND']);

const BILLING_SYNC_PAGE_SIZE = 500;

export interface PlatformBillingSyncResult {
    posted: number;
    /** Already posted and still correct — nothing written. */
    unchanged: number;
    /** Posted before, but the source event has since been edited: re-posted. */
    repaired: number;
    /** Posted before, but the source event is gone or no longer bookable: voided. */
    reverted: number;
    /** Events the projection could not post, with the reason. */
    failed: Array<{ eventId: string; reason: string }>;
    scanned: number;
}

interface ExpectedPosting {
    debitAccountId: string;
    creditAccountId: string;
    amount: number;
    date: Date;
    voucherType: string;
    description: string;
    referenceNumber?: string;
}

/**
 * ERP71's own books.
 *
 * The platform sells subscriptions and pays for servers, and until now it could
 * see neither side as accounting: subscription money existed as `BillingEvent`
 * rows with no double entry behind them, and the money going out existed
 * nowhere at all. This module is the platform's general ledger.
 *
 * It is built on the accounting module the product already has rather than
 * beside it. That module is tenant-scoped from the schema up — every account,
 * voucher and report takes a `tenant_id` — and the platform already keeps one
 * internal tenant for exactly this kind of problem (see
 * `PlatformWorkspaceService`, which does the same for project management). So
 * the platform's books are that tenant's books, and the whole engine comes
 * free: double entry, the chart of accounts, vouchers, the ledger, the trial
 * balance, the P&L and the balance sheet, all already written and already
 * tested.
 *
 * What this service adds is the two things the platform has that a shop does
 * not:
 *
 *  1. revenue that posts itself, by projecting `BillingEvent` rows into
 *     vouchers (see `platform-accounting.constants.ts` for the mapping and why
 *     it is a projection rather than inline posting); and
 *  2. platform expenses — the server bill, the SMS gateway invoice, salaries —
 *     which had no home in the product at all.
 *
 * Everything else it exposes is delegation: the same `AccountingService` calls
 * a tenant makes, pointed at the platform tenant, behind a platform-admin guard
 * instead of a store-permission one.
 */
@Injectable()
export class PlatformAccountingService {
    private readonly logger = new Logger(PlatformAccountingService.name);

    /**
     * Cached for the life of the process. The chart of accounts is upserted from
     * a template on the first resolve, which is ~90 queries — fine once per
     * boot, absurd per request. A release that adds an account therefore lands
     * when the backend restarts, which is when it ships anyway.
     */
    private booksTenantId: string | null = null;
    private bootstrapPromise: Promise<string> | null = null;

    constructor(
        private readonly db: DatabaseService,
        private readonly audit: AuditService,
        private readonly platformSettings: PlatformSettingsService,
        private readonly workspace: PlatformWorkspaceService,
        private readonly accounting: AccountingService,
    ) {}

    // ── Books resolution ─────────────────────────────────────────────────────

    async assertEnabled(): Promise<void> {
        if (!(await this.platformSettings.isFeatureEnabled('platformAccounting'))) {
            throw new ForbiddenException(
                'Platform accounting has been switched off by a platform administrator.',
            );
        }
    }

    /**
     * The tenant id the platform's books live in, provisioned and seeded.
     *
     * `userId` is the admin whose visit triggered provisioning — they become the
     * workspace owner if it did not exist yet, exactly as the projects module
     * does it. The scheduled sync has no user, and passes the id of the first
     * platform admin it can find instead.
     */
    async resolveBooks(userId: string): Promise<string> {
        if (this.booksTenantId) return this.booksTenantId;
        // Two admins opening the page at once would otherwise both run the
        // bootstrap. The upserts are idempotent so the result would still be
        // right, but it is 180 wasted queries and two racing writes to the same
        // rows — one promise, shared, costs nothing to avoid that.
        if (!this.bootstrapPromise) {
            this.bootstrapPromise = this.bootstrap(userId).finally(() => {
                this.bootstrapPromise = null;
            });
        }
        return this.bootstrapPromise;
    }

    private async bootstrap(userId: string): Promise<string> {
        const workspace = await this.workspace.provisionFor(userId);
        await bootstrapPlatformAccounting(this.db, workspace.id);
        await seedPlatformExpenseCategories(this.db);
        this.booksTenantId = workspace.id;
        this.logger.log(`Platform books ready (workspace ${workspace.id})`);
        return workspace.id;
    }

    /** Every platform account, by name. The posting code's lookup table. */
    private async accountIdsByName(tenantId: string): Promise<Map<string, { id: string; category: string }>> {
        const accounts = await this.db.account.findMany({
            where: { tenant_id: tenantId },
            select: { id: true, name: true, category: true },
        });
        return new Map(accounts.map((account) => [account.name, { id: account.id, category: account.category }]));
    }

    private requireAccount(
        accounts: Map<string, { id: string; category: string }>,
        name: string,
    ): { id: string; category: string } {
        const account = accounts.get(name);
        if (!account) {
            // Only reachable if an admin deleted or renamed a template account
            // through the chart-of-accounts screens. Naming it is the whole
            // point: "posting failed" would send someone reading logs.
            throw new BadRequestException(
                `The platform account "${name}" is missing from the chart of accounts. Recreate it, or restart the API to re-seed the defaults.`,
            );
        }
        return account;
    }

    /**
     * A receipt into cash is a cash-receive voucher, a payment out of the bank a
     * bank-payment, and anything that moves no cash a journal — the same
     * classification a tenant's vouchers get, so the cashbook and bankbook
     * reports work on the platform's books unchanged.
     */
    private resolveVoucherType(
        debit: { category: string },
        credit: { category: string },
    ): string {
        const isMoney = (category: string) =>
            category === AccountCategory.CASH || category === AccountCategory.BANK;

        if (isMoney(debit.category)) {
            return debit.category === AccountCategory.BANK
                ? VoucherType.BANK_RECEIVE
                : VoucherType.CASH_RECEIVE;
        }
        if (isMoney(credit.category)) {
            return credit.category === AccountCategory.BANK
                ? VoucherType.BANK_PAYMENT
                : VoucherType.CASH_PAYMENT;
        }
        return VoucherType.JOURNAL;
    }

    // ── Billing → ledger projection ──────────────────────────────────────────

    /**
     * Bring the platform's books level with the billing data.
     *
     * Re-runnable by design, and the admin console has a button for it. Each
     * event is posted once (keyed on its id through `PostingEvent`), re-posted
     * if it has since been edited, and voided if it has been deleted or voided
     * upstream — so running it twice changes nothing, and running it after a
     * year of billing history produces the whole year.
     */
    async syncBillingEvents(userId: string, dto: SyncPlatformBillingDto = {}): Promise<PlatformBillingSyncResult> {
        const tenantId = await this.resolveBooks(userId);
        const accounts = await this.accountIdsByName(tenantId);

        const result: PlatformBillingSyncResult = {
            posted: 0,
            unchanged: 0,
            repaired: 0,
            reverted: 0,
            failed: [],
            scanned: 0,
        };

        const createdFilter = this.buildCreatedAtFilter(dto.from, dto.to);
        const where: Prisma.BillingEventWhereInput = {
            event_type: { in: PROJECTED_BILLING_EVENT_TYPES },
            amount: { not: null },
            ...(createdFilter ? { created_at: createdFilter } : {}),
        };

        const seenEventIds = new Set<string>();
        let cursor: string | undefined;

        // Keyset pagination on id: the projection writes vouchers as it goes, but
        // never touches BillingEvent, so the page window cannot shift under it.
        for (;;) {
            const page = await this.db.billingEvent.findMany({
                where,
                orderBy: { id: 'asc' },
                take: BILLING_SYNC_PAGE_SIZE,
                ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
                select: {
                    id: true,
                    tenant_id: true,
                    event_type: true,
                    status: true,
                    amount: true,
                    provider_name: true,
                    reference_id: true,
                    external_event_id: true,
                    payload: true,
                    created_at: true,
                    tenant: { select: { name: true } },
                },
            });

            if (page.length === 0) break;

            for (const event of page) {
                result.scanned += 1;
                seenEventIds.add(event.id);
                try {
                    const outcome = await this.projectBillingEvent(tenantId, accounts, event);
                    result[outcome] += 1;
                } catch (error) {
                    result.failed.push({
                        eventId: event.id,
                        reason: error instanceof Error ? error.message : String(error),
                    });
                }
            }

            cursor = page[page.length - 1].id;
            if (page.length < BILLING_SYNC_PAGE_SIZE) break;
        }

        // Only on a full sync. With a date window the "unseen" set is every event
        // outside it, and reverting those would delete the rest of the ledger.
        if (!dto.from && !dto.to) {
            result.reverted += await this.revertOrphanedProjections(tenantId, seenEventIds);
        }

        this.logger.log(
            `Platform billing sync: ${result.posted} posted, ${result.repaired} repaired, `
            + `${result.reverted} reverted, ${result.unchanged} unchanged, ${result.failed.length} failed`,
        );

        return result;
    }

    private async projectBillingEvent(
        tenantId: string,
        accounts: Map<string, { id: string; category: string }>,
        event: {
            id: string;
            event_type: string;
            status: string;
            amount: Prisma.Decimal | null;
            provider_name: string;
            reference_id: string | null;
            external_event_id: string;
            payload: Prisma.JsonValue;
            created_at: Date;
            tenant: { name: string } | null;
        },
    ): Promise<'posted' | 'unchanged' | 'repaired' | 'reverted'> {
        const expected = this.buildExpectedPosting(accounts, event);

        const existing = await this.db.postingEvent.findUnique({
            where: {
                tenant_id_idempotency_key: {
                    tenant_id: tenantId,
                    idempotency_key: `${tenantId}:platform_billing:${event.id}`,
                },
            },
            include: { voucher: { include: { details: true } } },
        });

        if (!expected) {
            // A gateway callback that failed validation, or a fee an admin has
            // since voided. Nothing to post — and if it was posted before the
            // upstream change, take it back out.
            if (existing?.voucher) {
                await this.db.$transaction((tx) =>
                    voidAutoPostedVoucher(tx, tenantId, 'platform_billing', event.id),
                );
                return 'reverted';
            }
            return 'unchanged';
        }

        if (existing?.status === 'posted' && existing.voucher) {
            if (this.voucherMatches(existing.voucher, expected)) return 'unchanged';
            // The source was edited — an admin corrected a wrong plan price, or
            // moved a payment's date. Void and re-post rather than patch the
            // voucher: the entry may have changed accounts as well as amount.
            await this.db.$transaction(async (tx) => {
                await voidAutoPostedVoucher(tx, tenantId, 'platform_billing', event.id);
                await this.postExpected(tx, tenantId, 'platform_billing', event.id, expected);
            });
            return 'repaired';
        }

        await this.db.$transaction((tx) =>
            this.postExpected(tx, tenantId, 'platform_billing', event.id, expected),
        );
        return 'posted';
    }

    private buildExpectedPosting(
        accounts: Map<string, { id: string; category: string }>,
        event: {
            event_type: string;
            status: string;
            amount: Prisma.Decimal | null;
            provider_name: string;
            reference_id: string | null;
            external_event_id: string;
            payload: Prisma.JsonValue;
            created_at: Date;
            tenant: { name: string } | null;
        },
    ): ExpectedPosting | null {
        const mapping: BillingEventPosting | undefined = BILLING_EVENT_POSTINGS[event.event_type];
        if (!mapping) return null;

        const amount = Math.round(Number(event.amount ?? 0) * 100) / 100;
        if (!Number.isFinite(amount) || amount <= 0) return null;

        if (
            GATEWAY_EVENT_TYPES.has(event.event_type)
            && !SUCCESSFUL_GATEWAY_STATUSES.has(String(event.status ?? '').toUpperCase())
        ) {
            return null;
        }

        let debitName: PlatformAccountName = mapping.debit;
        let creditName: PlatformAccountName = mapping.credit;

        if (mapping.resolveCashLeg) {
            const method = this.readPayloadMethod(event.payload);
            const resolved = resolvePlatformCashAccount(method);
            if (resolved) {
                if (mapping.resolveCashLeg === 'debit') debitName = resolved;
                else creditName = resolved;
            }
        }

        const debit = this.requireAccount(accounts, debitName);
        const credit = this.requireAccount(accounts, creditName);
        const tenantName = event.tenant?.name ?? 'a workspace';

        return {
            debitAccountId: debit.id,
            creditAccountId: credit.id,
            amount,
            date: event.created_at,
            voucherType: this.resolveVoucherType(debit, credit),
            description: `${mapping.label} — ${tenantName}`,
            referenceNumber: event.reference_id ?? event.external_event_id,
        };
    }

    private readPayloadMethod(payload: Prisma.JsonValue): string | null {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
        const method = (payload as Record<string, unknown>).method;
        return typeof method === 'string' ? method : null;
    }

    private buildCreatedAtFilter(from?: string, to?: string): Prisma.DateTimeFilter | null {
        if (!from && !to) return null;
        const filter: Prisma.DateTimeFilter = {};
        if (from) filter.gte = new Date(from);
        if (to) {
            const end = new Date(to);
            end.setHours(23, 59, 59, 999);
            filter.lte = end;
        }
        return filter;
    }

    /** True when the posted voucher still says what the source event says. */
    private voucherMatches(
        voucher: { date: Date; details: Array<{ account_id: string; debit_amount: Prisma.Decimal; credit_amount: Prisma.Decimal }> },
        expected: ExpectedPosting,
    ): boolean {
        if (voucher.details.length !== 2) return false;
        if (voucher.date.getTime() !== expected.date.getTime()) return false;

        const debitLeg = voucher.details.find((detail) => Number(detail.debit_amount) > 0);
        const creditLeg = voucher.details.find((detail) => Number(detail.credit_amount) > 0);
        if (!debitLeg || !creditLeg) return false;

        return debitLeg.account_id === expected.debitAccountId
            && creditLeg.account_id === expected.creditAccountId
            && Number(debitLeg.debit_amount) === expected.amount
            && Number(creditLeg.credit_amount) === expected.amount;
    }

    private postExpected(
        tx: Prisma.TransactionClient,
        tenantId: string,
        eventType: 'platform_billing' | 'platform_expense',
        sourceId: string,
        expected: ExpectedPosting,
    ) {
        return postMultiLeg({
            tx,
            tenantId,
            eventType,
            sourceModule: PLATFORM_ACCOUNTING_SOURCE_MODULE,
            sourceType: eventType === 'platform_billing' ? 'billing_event' : 'platform_expense',
            sourceId,
            voucherType: expected.voucherType,
            date: expected.date,
            description: expected.description,
            referenceNumber: expected.referenceNumber,
            legs: [
                { accountId: expected.debitAccountId, debit: expected.amount },
                { accountId: expected.creditAccountId, credit: expected.amount },
            ],
        });
    }

    /**
     * Take back vouchers whose source billing event no longer exists.
     *
     * An admin deleting a manual payment or fee in Admin › Tenants really
     * deletes the row (only machine-posted subscription fees are tombstoned
     * instead), so without this the platform's books would keep counting revenue
     * the billing ledger no longer shows.
     */
    private async revertOrphanedProjections(tenantId: string, seenEventIds: Set<string>): Promise<number> {
        const posted = await this.db.postingEvent.findMany({
            where: { tenant_id: tenantId, event_type: 'platform_billing', status: 'posted' },
            select: { source_id: true },
        });

        const orphans = posted.filter((event) => !seenEventIds.has(event.source_id));
        for (const orphan of orphans) {
            await this.db.$transaction((tx) =>
                voidAutoPostedVoucher(tx, tenantId, 'platform_billing', orphan.source_id),
            );
        }
        return orphans.length;
    }

    /**
     * Nightly catch-up, an hour after the billing cron posts the day's fees.
     *
     * The admin console has a Sync button for when someone wants it now, but the
     * books should not depend on anyone pressing it — a platform that bills
     * while nobody is looking should have a ledger that does too.
     */
    @Cron(CronExpression.EVERY_DAY_AT_3AM)
    async scheduledSync(): Promise<void> {
        if (!(await this.platformSettings.isFeatureEnabled('platformAccounting'))) return;

        const admin = await this.db.user.findFirst({
            where: { is_platform_admin: true },
            select: { id: true },
            orderBy: { created_at: 'asc' },
        });
        if (!admin) {
            // Nobody to own the workspace yet. Provisioning it against a
            // nonexistent user would fail the foreign key, so wait for the first
            // admin to sign in — and say why, so a silent no-op is explicable.
            this.logger.warn('Skipping the platform billing sync: no platform admin exists yet.');
            return;
        }

        try {
            await this.syncBillingEvents(admin.id);
        } catch (error) {
            this.logger.error(`Scheduled platform billing sync failed: ${error}`);
        }
    }

    // ── Platform expenses ────────────────────────────────────────────────────

    async listCategories(userId: string) {
        await this.resolveBooks(userId);
        return this.db.platformExpenseCategory.findMany({
            orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
            include: { _count: { select: { expenses: true } } },
        });
    }

    async createCategory(userId: string, dto: CreatePlatformExpenseCategoryDto) {
        const tenantId = await this.resolveBooks(userId);
        await this.assertExpenseAccount(tenantId, dto.accountName);

        const code = await this.allocateCategoryCode(dto.name);
        const created = await this.db.platformExpenseCategory.create({
            data: {
                code,
                name: dto.name,
                description: dto.description ?? null,
                account_name: dto.accountName,
                sort_order: 500,
            },
        });

        await this.audit.log('platform.expense_category.create', 'PlatformExpenseCategory', { userId }, created.id, {
            name: created.name,
            account_name: created.account_name,
        });
        return created;
    }

    async updateCategory(userId: string, id: string, dto: UpdatePlatformExpenseCategoryDto) {
        const tenantId = await this.resolveBooks(userId);
        const category = await this.db.platformExpenseCategory.findUnique({ where: { id } });
        if (!category) throw new NotFoundException('Expense category not found.');

        if (dto.accountName) {
            await this.assertExpenseAccount(tenantId, dto.accountName);
        }

        const updated = await this.db.platformExpenseCategory.update({
            where: { id },
            data: {
                ...(dto.name !== undefined ? { name: dto.name } : {}),
                ...(dto.description !== undefined ? { description: dto.description } : {}),
                ...(dto.accountName !== undefined ? { account_name: dto.accountName } : {}),
                ...(dto.isActive !== undefined ? { is_active: dto.isActive } : {}),
            },
        });

        await this.audit.log('platform.expense_category.update', 'PlatformExpenseCategory', { userId }, id, {
            ...dto,
        });
        return updated;
    }

    /**
     * Categories are retired, not deleted, once they have been used. The
     * expenses filed under one are posted vouchers, and a category name is how
     * anyone reading the P&L knows what a line was — deleting it would leave the
     * ledger intact and the story gone.
     */
    async deleteCategory(userId: string, id: string) {
        await this.resolveBooks(userId);
        const category = await this.db.platformExpenseCategory.findUnique({
            where: { id },
            include: { _count: { select: { expenses: true } } },
        });
        if (!category) throw new NotFoundException('Expense category not found.');

        if (category._count.expenses > 0) {
            const retired = await this.db.platformExpenseCategory.update({
                where: { id },
                data: { is_active: false },
            });
            await this.audit.log('platform.expense_category.retire', 'PlatformExpenseCategory', { userId }, id, {
                expenses: category._count.expenses,
            });
            return { deleted: false, retired: true, category: retired };
        }

        await this.db.platformExpenseCategory.delete({ where: { id } });
        await this.audit.log('platform.expense_category.delete', 'PlatformExpenseCategory', { userId }, id, {
            name: category.name,
        });
        return { deleted: true, retired: false };
    }

    private async assertExpenseAccount(tenantId: string, accountName: string): Promise<void> {
        const account = await this.db.account.findUnique({
            where: { tenant_id_name: { tenant_id: tenantId, name: accountName } },
            select: { type: true },
        });
        if (!account) {
            throw new BadRequestException(`"${accountName}" is not an account in the platform chart of accounts.`);
        }
        if (account.type !== AccountType.EXPENSE) {
            throw new BadRequestException(`"${accountName}" is not an expense account.`);
        }
    }

    /** `Server & Hosting (EU)` → `SERVER_HOSTING_EU`, made unique if taken. */
    private async allocateCategoryCode(name: string): Promise<string> {
        const base = name
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 40) || 'CATEGORY';

        for (let suffix = 0; suffix < 100; suffix += 1) {
            const candidate = suffix === 0 ? base : `${base}_${suffix}`;
            const taken = await this.db.platformExpenseCategory.findUnique({
                where: { code: candidate },
                select: { id: true },
            });
            if (!taken) return candidate;
        }
        return `${base}_${Date.now()}`;
    }

    async listExpenses(userId: string, query: ListPlatformExpensesQueryDto) {
        await this.resolveBooks(userId);
        const page = Math.max(1, Number(query.page ?? 1));
        const limit = Math.min(Math.max(1, Number(query.limit ?? 20)), 100);

        const where: Prisma.PlatformExpenseWhereInput = {
            ...(query.categoryId ? { category_id: query.categoryId } : {}),
            ...(query.from || query.to
                ? {
                    expense_date: {
                        ...(query.from ? { gte: new Date(query.from) } : {}),
                        ...(query.to ? { lte: new Date(query.to) } : {}),
                    },
                }
                : {}),
            ...(query.search
                ? {
                    OR: [
                        { vendor: { contains: query.search, mode: 'insensitive' } },
                        { description: { contains: query.search, mode: 'insensitive' } },
                        { reference: { contains: query.search, mode: 'insensitive' } },
                    ],
                }
                : {}),
        };

        const [total, rows, totals] = await Promise.all([
            this.db.platformExpense.count({ where }),
            this.db.platformExpense.findMany({
                where,
                orderBy: [{ expense_date: 'desc' }, { created_at: 'desc' }],
                skip: (page - 1) * limit,
                take: limit,
                include: { category: { select: { id: true, name: true, account_name: true } } },
            }),
            this.db.platformExpense.aggregate({ where, _sum: { amount: true } }),
        ]);

        return {
            data: rows.map((row) => this.mapExpense(row)),
            meta: {
                page,
                limit,
                total,
                totalPages: Math.max(1, Math.ceil(total / limit)),
                /** Total across the WHOLE filter, not just this page — what the header shows. */
                totalAmount: Number(totals._sum.amount ?? 0),
            },
        };
    }

    async createExpense(userId: string, dto: CreatePlatformExpenseDto) {
        const tenantId = await this.resolveBooks(userId);
        const category = await this.db.platformExpenseCategory.findUnique({ where: { id: dto.categoryId } });
        if (!category) throw new NotFoundException('Expense category not found.');
        if (!category.is_active) {
            throw new BadRequestException('That expense category has been retired. Pick an active one.');
        }

        const paidFrom = dto.paidFrom ?? 'BANK';
        const accounts = await this.accountIdsByName(tenantId);

        const expense = await this.db.$transaction(async (tx) => {
            const created = await tx.platformExpense.create({
                data: {
                    category_id: category.id,
                    amount: dto.amount,
                    expense_date: new Date(dto.expenseDate),
                    paid_from: paidFrom,
                    vendor: dto.vendor ?? null,
                    description: dto.description ?? null,
                    reference: dto.reference ?? null,
                    recorded_by: userId,
                },
            });

            const posting = await this.postExpenseVoucher(tx, tenantId, accounts, {
                id: created.id,
                amount: dto.amount,
                expenseDate: created.expense_date,
                paidFrom,
                accountName: category.account_name,
                label: category.name,
                vendor: dto.vendor ?? null,
                description: dto.description ?? null,
                reference: dto.reference ?? null,
            });

            return tx.platformExpense.update({
                where: { id: created.id },
                data: { voucher_id: posting.voucherId ?? null, posting_status: posting.postingStatus },
                include: { category: { select: { id: true, name: true, account_name: true } } },
            });
        });

        await this.audit.log('platform.expense.create', 'PlatformExpense', { userId }, expense.id, {
            amount: dto.amount,
            category: category.name,
            paid_from: paidFrom,
        });

        return this.mapExpense(expense);
    }

    async updateExpense(userId: string, id: string, dto: UpdatePlatformExpenseDto) {
        const tenantId = await this.resolveBooks(userId);
        const existing = await this.db.platformExpense.findUnique({ where: { id } });
        if (!existing) throw new NotFoundException('Expense not found.');

        const categoryId = dto.categoryId ?? existing.category_id;
        const category = await this.db.platformExpenseCategory.findUnique({ where: { id: categoryId } });
        if (!category) throw new NotFoundException('Expense category not found.');

        const amount = dto.amount ?? Number(existing.amount);
        const expenseDate = dto.expenseDate ? new Date(dto.expenseDate) : existing.expense_date;
        const paidFrom = dto.paidFrom ?? existing.paid_from;
        const vendor = dto.vendor !== undefined ? dto.vendor : existing.vendor;
        const description = dto.description !== undefined ? dto.description : existing.description;
        const reference = dto.reference !== undefined ? dto.reference : existing.reference;
        const accounts = await this.accountIdsByName(tenantId);

        const updated = await this.db.$transaction(async (tx) => {
            // Unconditional void-and-repost. Working out whether this particular
            // edit was ledger-relevant is a rule that has to stay in step with
            // the fields above forever; re-posting is two writes and cannot drift.
            await voidAutoPostedVoucher(tx, tenantId, 'platform_expense', id);

            const posting = await this.postExpenseVoucher(tx, tenantId, accounts, {
                id,
                amount,
                expenseDate,
                paidFrom,
                accountName: category.account_name,
                label: category.name,
                vendor,
                description,
                reference,
            });

            return tx.platformExpense.update({
                where: { id },
                data: {
                    category_id: categoryId,
                    amount,
                    expense_date: expenseDate,
                    paid_from: paidFrom,
                    vendor,
                    description,
                    reference,
                    voucher_id: posting.voucherId ?? null,
                    posting_status: posting.postingStatus,
                },
                include: { category: { select: { id: true, name: true, account_name: true } } },
            });
        });

        await this.audit.log('platform.expense.update', 'PlatformExpense', { userId }, id, { ...dto });
        return this.mapExpense(updated);
    }

    async deleteExpense(userId: string, id: string) {
        const tenantId = await this.resolveBooks(userId);
        const existing = await this.db.platformExpense.findUnique({ where: { id } });
        if (!existing) throw new NotFoundException('Expense not found.');

        await this.db.$transaction(async (tx) => {
            await voidAutoPostedVoucher(tx, tenantId, 'platform_expense', id);
            await tx.platformExpense.delete({ where: { id } });
        });

        await this.audit.log('platform.expense.delete', 'PlatformExpense', { userId }, id, {
            amount: Number(existing.amount),
        });
        return { deleted: true };
    }

    private async postExpenseVoucher(
        tx: Prisma.TransactionClient,
        tenantId: string,
        accounts: Map<string, { id: string; category: string }>,
        input: {
            id: string;
            amount: number;
            expenseDate: Date;
            paidFrom: string;
            accountName: string;
            label: string;
            vendor: string | null;
            description: string | null;
            reference: string | null;
        },
    ) {
        const paidFromName = PLATFORM_PAYMENT_ACCOUNTS[input.paidFrom] ?? PLATFORM_ACCOUNT.BANK;
        const debit = this.requireAccount(accounts, input.accountName);
        const credit = this.requireAccount(accounts, paidFromName);

        const detail = input.vendor ?? input.description;
        return this.postExpected(tx, tenantId, 'platform_expense', input.id, {
            debitAccountId: debit.id,
            creditAccountId: credit.id,
            amount: input.amount,
            date: input.expenseDate,
            voucherType: this.resolveVoucherType(debit, credit),
            description: detail ? `${input.label} — ${detail}` : input.label,
            referenceNumber: input.reference ?? undefined,
        });
    }

    private mapExpense(expense: {
        id: string;
        category_id: string;
        amount: Prisma.Decimal;
        expense_date: Date;
        paid_from: string;
        vendor: string | null;
        description: string | null;
        reference: string | null;
        voucher_id: string | null;
        posting_status: string;
        created_at: Date;
        category?: { id: string; name: string; account_name: string } | null;
    }) {
        return {
            id: expense.id,
            category_id: expense.category_id,
            category_name: expense.category?.name ?? null,
            account_name: expense.category?.account_name ?? null,
            amount: Number(expense.amount),
            expense_date: expense.expense_date,
            paid_from: expense.paid_from,
            vendor: expense.vendor,
            description: expense.description,
            reference: expense.reference,
            voucher_id: expense.voucher_id,
            posting_status: expense.posting_status,
            created_at: expense.created_at,
        };
    }

    // ── Overview ─────────────────────────────────────────────────────────────

    /**
     * The module's landing page: what came in, what went out, what is still
     * owed, and whether the ledger is level with billing.
     */
    async getOverview(userId: string, query: PlatformAccountingOverviewQueryDto) {
        const tenantId = await this.resolveBooks(userId);
        const range = this.resolveOverviewRange(query);

        const [accounts, periodTotals, balances, unsynced, recentVouchers, expenseByCategory] = await Promise.all([
            this.db.account.findMany({
                where: { tenant_id: tenantId },
                select: { id: true, name: true, type: true, category: true },
            }),
            this.sumVoucherDetails(tenantId, range.from, range.to),
            this.sumVoucherDetails(tenantId, null, range.to),
            this.countUnsyncedBillingEvents(tenantId),
            this.db.voucher.findMany({
                where: { tenant_id: tenantId },
                orderBy: [{ date: 'desc' }, { created_at: 'desc' }],
                take: 8,
                select: {
                    id: true,
                    voucher_number: true,
                    voucher_type: true,
                    description: true,
                    date: true,
                    details: { select: { debit_amount: true } },
                },
            }),
            this.expenseTotalsByCategory(range.from, range.to),
        ]);

        const byId = new Map(accounts.map((account) => [account.id, account]));
        const signed = (
            totals: Map<string, { debit: number; credit: number }>,
            predicate: (account: { type: string; category: string; name: string }) => boolean,
            /** Revenue and liabilities carry credit balances; assets and expenses debit. */
            side: 'debit' | 'credit',
        ) => {
            let sum = 0;
            for (const [accountId, amounts] of totals) {
                const account = byId.get(accountId);
                if (!account || !predicate(account)) continue;
                sum += side === 'debit'
                    ? amounts.debit - amounts.credit
                    : amounts.credit - amounts.debit;
            }
            return Math.round(sum * 100) / 100;
        };

        const revenue = signed(periodTotals, (a) => a.type === AccountType.REVENUE, 'credit');
        const expenses = signed(periodTotals, (a) => a.type === AccountType.EXPENSE, 'debit');
        const cash = signed(
            balances,
            (a) => a.category === AccountCategory.CASH || a.category === AccountCategory.BANK,
            'debit',
        );
        const receivable = signed(balances, (a) => a.name === PLATFORM_ACCOUNT.SUBSCRIPTION_RECEIVABLE, 'debit');
        const gateway = signed(balances, (a) => a.name === PLATFORM_ACCOUNT.GATEWAY_RECEIVABLE, 'debit');

        const revenueByAccount = accounts
            .filter((account) => account.type === AccountType.REVENUE)
            .map((account) => {
                const amounts = periodTotals.get(account.id) ?? { debit: 0, credit: 0 };
                return { name: account.name, amount: Math.round((amounts.credit - amounts.debit) * 100) / 100 };
            })
            .filter((row) => row.amount !== 0)
            .sort((a, b) => b.amount - a.amount);

        return {
            range: { from: range.from.toISOString().slice(0, 10), to: range.to.toISOString().slice(0, 10) },
            totals: {
                revenue,
                expenses,
                net_profit: Math.round((revenue - expenses) * 100) / 100,
                cash_and_bank: cash,
                subscription_receivable: receivable,
                gateway_receivable: gateway,
            },
            revenue_by_account: revenueByAccount,
            expenses_by_category: expenseByCategory,
            /** Money events billing knows about that the ledger does not — a Sync away. */
            unsynced_billing_events: unsynced,
            recent_vouchers: recentVouchers.map((voucher) => ({
                id: voucher.id,
                voucher_number: voucher.voucher_number,
                voucher_type: voucher.voucher_type,
                description: voucher.description,
                date: voucher.date,
                amount: Math.round(
                    voucher.details.reduce((sum, detail) => sum + Number(detail.debit_amount ?? 0), 0) * 100,
                ) / 100,
            })),
        };
    }

    private resolveOverviewRange(query: PlatformAccountingOverviewQueryDto) {
        const to = query.to ? new Date(query.to) : new Date();
        to.setHours(23, 59, 59, 999);
        // A calendar year to date is the default: a platform's first question is
        // "how are we doing this year", and a month is too short a window to see
        // annual subscriptions in.
        const from = query.from ? new Date(query.from) : new Date(to.getFullYear(), 0, 1);
        from.setHours(0, 0, 0, 0);
        if (from > to) throw new BadRequestException('The start date must not be after the end date.');
        return { from, to };
    }

    private async sumVoucherDetails(tenantId: string, from: Date | null, to: Date) {
        const grouped = await this.db.voucherDetail.groupBy({
            by: ['account_id'],
            where: {
                voucher: {
                    tenant_id: tenantId,
                    date: { ...(from ? { gte: from } : {}), lte: to },
                },
            },
            _sum: { debit_amount: true, credit_amount: true },
        });

        return new Map(
            grouped.map((row) => [
                row.account_id,
                {
                    debit: Number(row._sum.debit_amount ?? 0),
                    credit: Number(row._sum.credit_amount ?? 0),
                },
            ]),
        );
    }

    private async expenseTotalsByCategory(from: Date, to: Date) {
        const grouped = await this.db.platformExpense.groupBy({
            by: ['category_id'],
            where: { expense_date: { gte: from, lte: to } },
            _sum: { amount: true },
        });
        if (grouped.length === 0) return [];

        const categories = await this.db.platformExpenseCategory.findMany({
            where: { id: { in: grouped.map((row) => row.category_id) } },
            select: { id: true, name: true },
        });
        const nameById = new Map(categories.map((category) => [category.id, category.name]));

        return grouped
            .map((row) => ({
                category_id: row.category_id,
                name: nameById.get(row.category_id) ?? 'Uncategorised',
                amount: Number(row._sum.amount ?? 0),
            }))
            .sort((a, b) => b.amount - a.amount);
    }

    /**
     * Billing events that ought to be in the ledger and are not.
     *
     * Counted rather than listed: the number is the signal ("Sync" or "you are
     * up to date"), and the events themselves are already browsable in Admin ›
     * Tenants › Ledger.
     */
    private async countUnsyncedBillingEvents(tenantId: string): Promise<number> {
        const [projectable, posted] = await Promise.all([
            this.db.billingEvent.count({
                where: { event_type: { in: PROJECTED_BILLING_EVENT_TYPES }, amount: { not: null } },
            }),
            this.db.postingEvent.count({
                where: { tenant_id: tenantId, event_type: 'platform_billing', status: 'posted' },
            }),
        ]);
        // A failed gateway callback is projectable-by-type but not bookable, so
        // this can read high by a handful. It is a prompt to press Sync, not a
        // reconciliation figure, and it settles to a stable number once synced.
        return Math.max(0, projectable - posted);
    }

    // ── Reports, delegated to the accounting engine ──────────────────────────

    async getAccounts(userId: string, query: Parameters<AccountingService['findAccounts']>[1]) {
        const tenantId = await this.resolveBooks(userId);
        return this.accounting.findAccounts(tenantId, query);
    }

    async getAccountGroups(userId: string) {
        const tenantId = await this.resolveBooks(userId);
        return this.accounting.findAccountGroups(tenantId);
    }

    async getVouchers(userId: string, query: Parameters<AccountingService['findVouchers']>[1]) {
        const tenantId = await this.resolveBooks(userId);
        return this.accounting.findVouchers(tenantId, query);
    }

    async getLedger(userId: string, accountId: string, query: Parameters<AccountingService['findLedger']>[2]) {
        const tenantId = await this.resolveBooks(userId);
        return this.accounting.findLedger(tenantId, accountId, query);
    }

    async getProfitLoss(userId: string, query: Parameters<AccountingService['getProfitLoss']>[1]) {
        const tenantId = await this.resolveBooks(userId);
        // `true` is the consolidated-report flag. The platform books have no
        // stores, so branch scoping is meaningless here and the company-wide
        // view is the only one that makes sense — a platform admin is by
        // definition entitled to it.
        return this.accounting.getProfitLoss(tenantId, query, true);
    }

    async getBalanceSheet(userId: string, query: Parameters<AccountingService['getBalanceSheet']>[1]) {
        const tenantId = await this.resolveBooks(userId);
        return this.accounting.getBalanceSheet(tenantId, query, true);
    }

    async getTrialBalance(userId: string, query: Parameters<AccountingService['getTrialBalance']>[1]) {
        const tenantId = await this.resolveBooks(userId);
        return this.accounting.getTrialBalance(tenantId, query, true);
    }
}
