import { BadRequestException } from '@nestjs/common';
import { Prisma, PartyType } from '@prisma/client';
import { VoucherAttribution, VoucherType } from './accounting.constants';

export type PostingEventType =
    | 'sale'
    | 'sale_return'
    | 'purchase'
    | 'purchase_return'
    | 'inventory_adjustment'
    | 'fund_movement'
    | 'expense'
    | 'loan_disbursement'
    | 'loan_repayment'
    | 'customer_payment'
    | 'supplier_payment'
    | 'depreciation'
    | 'cash_transaction'
    | 'salary_accrual'
    | 'salary_payment'
    | 'asset_acquisition'
    | 'fund_transfer';

export interface AutoPostInput {
    tx: Prisma.TransactionClient;
    tenantId: string;
    eventType: PostingEventType;
    conditionKey?: 'payment_mode' | 'reason_type' | 'transfer_scope' | 'loan_direction' | 'payment_direction' | 'none';
    conditionValue?: string | null;
    sourceModule: string;
    sourceType: string;
    sourceId: string;
    amount: number;
    description?: string;
    referenceNumber?: string;
    date?: Date;
    storeId?: string;
    attribution?: string;
    counterpartyStoreId?: string;
    /**
     * The party this posting concerns. When set, the voucher leg whose account is
     * a control account of this type (Account.party_type === partyType) is tagged
     * with partyId, so the account's balance becomes a per-party subsidiary
     * ledger. Ignored on the leg that is not a matching control account (e.g. the
     * cash or revenue side). No-op if neither leg matches.
     */
    partyType?: PartyType;
    partyId?: string;
    /**
     * Distinguishes a second posting that shares the same source row. A credit
     * sale settled with a partial down-payment posts TWO vouchers off one Sale —
     * the receivable and the cash — which would otherwise collide on the shared
     * `${tenant}:${eventType}:${sourceId}` idempotency key, silently dropping the
     * second. Pass a legKey on the SECONDARY leg only; the primary stays keyless
     * so existing idempotency keys are unchanged.
     */
    legKey?: string;
    /**
     * Override the rule's debit / credit account for THIS posting. Used when a
     * tenant-configured PaymentMethod points at its own account (e.g. a custom
     * "Upay" wallet), so the cash leg posts there instead of the mode-derived
     * default the rule would pick. The caller passes the override on whichever leg
     * is the cash/mode side (debit for a receipt, credit for a payment). Omitted →
     * the rule's account is used, exactly as before. The override account must
     * belong to the tenant or the posting fails AUTO_POSTING_ACCOUNT_INVALID.
     */
    overrideDebitAccountId?: string;
    overrideCreditAccountId?: string;
}

/** The idempotency key for a posting, optionally disambiguated by leg. */
export function postingIdempotencyKey(tenantId: string, eventType: string, sourceId: string, legKey?: string): string {
    const legSuffix = legKey ? `:${legKey}` : '';
    return `${tenantId}:${eventType}:${sourceId}${legSuffix}`;
}

export interface AutoPostResult {
    postingStatus: 'posted' | 'skipped';
    voucherId?: string;
    voucherNumber?: string;
    voucherType?: string;
}

const VOUCHER_PREFIXES: Record<string, string> = {
    [VoucherType.CASH_PAYMENT]: 'CP',
    [VoucherType.CASH_RECEIVE]: 'CR',
    [VoucherType.BANK_PAYMENT]: 'BP',
    [VoucherType.BANK_RECEIVE]: 'BR',
    [VoucherType.FUND_TRANSFER]: 'FT',
    [VoucherType.JOURNAL]: 'JV',
};

const VOUCHER_TYPE_BY_EVENT: Record<PostingEventType, string> = {
    sale: VoucherType.CASH_RECEIVE,
    sale_return: VoucherType.CASH_PAYMENT,
    purchase: VoucherType.CASH_PAYMENT,
    purchase_return: VoucherType.CASH_RECEIVE,
    inventory_adjustment: VoucherType.JOURNAL,
    fund_movement: VoucherType.FUND_TRANSFER,
    expense: VoucherType.CASH_PAYMENT,
    // A single loan event covers both directions (payable/receivable), so a
    // neutral journal voucher is used rather than a cash-in/out specific type.
    loan_disbursement: VoucherType.JOURNAL,
    loan_repayment: VoucherType.JOURNAL,
    customer_payment: VoucherType.CASH_RECEIVE,
    // Paying a supplier is the common case, so cash OUT is the default here and
    // the 'receive' direction is the exception below — the mirror of
    // customer_payment, where money normally comes IN.
    supplier_payment: VoucherType.CASH_PAYMENT,
    // A non-cash internal adjustment (Dr Depreciation Expense / Cr Accumulated
    // Depreciation) — a journal voucher, not a cash movement.
    depreciation: VoucherType.JOURNAL,
    // Cash leaving the till (PAYOUT/LOAN) — a cash-payment voucher.
    cash_transaction: VoucherType.CASH_PAYMENT,
    // Non-cash accrual (Dr Salary & Wages / Cr Salary Payable) — a journal voucher.
    salary_accrual: VoucherType.JOURNAL,
    // Cash settling the payable (Dr Salary Payable / Cr <mode>) — cash payment.
    salary_payment: VoucherType.CASH_PAYMENT,
    // Cash out to buy an asset (Dr Fixed Assets / Cr <mode>) — a cash payment.
    asset_acquisition: VoucherType.CASH_PAYMENT,
    // Inter-branch cash movement (Due from/to Branches vs Cash) — a fund transfer.
    fund_transfer: VoucherType.FUND_TRANSFER,
};

function resolveVoucherType(
    eventType: PostingEventType,
    conditionKey?: AutoPostInput['conditionKey'],
    conditionValue?: string | null,
): string {
    if (eventType === 'customer_payment' && conditionKey === 'payment_direction' && conditionValue === 'pay') {
        return VoucherType.CASH_PAYMENT;
    }
    if (eventType === 'supplier_payment' && conditionKey === 'payment_direction' && conditionValue === 'receive') {
        return VoucherType.CASH_RECEIVE;
    }
    return VOUCHER_TYPE_BY_EVENT[eventType];
}

function voucherSequenceId(tenantId: string, voucherType: string) {
    return `${tenantId}:${voucherType}`;
}

async function generateVoucherNumber(tx: Prisma.TransactionClient, tenantId: string, voucherType: string) {
    const prefix = VOUCHER_PREFIXES[voucherType] ?? 'JV';
    const sequence = await tx.voucherSequence.upsert({
        where: {
            tenant_id_voucher_type: {
                tenant_id: tenantId,
                voucher_type: voucherType,
            },
        },
        update: {},
        create: {
            id: voucherSequenceId(tenantId, voucherType),
            tenant_id: tenantId,
            voucher_type: voucherType,
            prefix,
            next_number: 1,
        },
    });

    const nextNumber = sequence.next_number;

    await tx.voucherSequence.update({
        where: {
            tenant_id_voucher_type: {
                tenant_id: tenantId,
                voucher_type: voucherType,
            },
        },
        data: {
            next_number: {
                increment: 1,
            },
        },
    });

    return `${prefix}-${String(nextNumber).padStart(5, '0')}`;
}

function resolveVoucherAttribution(input: AutoPostInput): string {
    if (input.attribution) {
        return input.attribution;
    }
    return input.storeId ? VoucherAttribution.BRANCH : VoucherAttribution.COMPANY;
}

/**
 * Rejects a posting dated into a locked fiscal period.
 *
 * `is_locked` was previously written by the lock/unlock endpoints and read by
 * nothing, so locking a period did nothing at all.
 *
 * A date with no covering FiscalPeriod row is allowed - most tenants never create
 * periods, and absence must not block posting.
 */
export async function assertFiscalPeriodOpen(
    tx: Prisma.TransactionClient,
    tenantId: string,
    date: Date,
): Promise<void> {
    const period = await tx.fiscalPeriod.findFirst({
        where: {
            tenant_id: tenantId,
            start_date: { lte: date },
            end_date: { gte: date },
        },
        select: { is_locked: true, period_label: true },
    });

    if (period?.is_locked) {
        throw new BadRequestException(
            `FISCAL_PERIOD_LOCKED: ${period.period_label} is locked and cannot accept new postings.`,
        );
    }
}

export async function autoPostFromRules(input: AutoPostInput): Promise<AutoPostResult> {
    const conditionKey = input.conditionKey ?? 'none';
    const conditionValue = input.conditionValue ?? null;
    const idempotencyKey = postingIdempotencyKey(input.tenantId, input.eventType, input.sourceId, input.legKey);

    // Read-only lookup runs before the fiscal-period guard: an already-posted
    // event must short-circuit as a no-op even if its period has since been
    // locked. Retrying a no-op read path must never be blocked by a write guard.
    const existingEvent = await input.tx.postingEvent.findUnique({
        where: {
            tenant_id_idempotency_key: {
                tenant_id: input.tenantId,
                idempotency_key: idempotencyKey,
            },
        },
        include: {
            voucher: true,
        },
    });

    if (existingEvent?.status === 'posted' && existingEvent.voucher) {
        return {
            postingStatus: 'posted',
            voucherId: existingEvent.voucher.id,
            voucherNumber: existingEvent.voucher.voucher_number,
            voucherType: existingEvent.voucher.voucher_type,
        };
    }

    // Guard runs after the no-op short-circuit above, but before any
    // PostingEvent row is created or mutated below.
    await assertFiscalPeriodOpen(input.tx, input.tenantId, input.date ?? new Date());

    const postingEvent = existingEvent
        ? await input.tx.postingEvent.update({
            where: { id: existingEvent.id },
            data: {
                status: 'pending',
                attempt_count: { increment: 1 },
                last_attempt_at: new Date(),
                last_error: null,
            },
        })
        : await input.tx.postingEvent.create({
            data: {
                tenant_id: input.tenantId,
                event_type: input.eventType,
                source_module: input.sourceModule,
                source_type: input.sourceType,
                source_id: input.sourceId,
                idempotency_key: idempotencyKey,
                status: 'pending',
                attempt_count: 1,
                last_attempt_at: new Date(),
            },
        });

    const postingRule = await input.tx.postingRule.findFirst({
        where: {
            tenant_id: input.tenantId,
            event_type: input.eventType,
            is_active: true,
            condition_key: conditionKey,
            condition_value: conditionValue,
        },
        orderBy: [{ priority: 'asc' }, { updated_at: 'desc' }],
    }) ?? await input.tx.postingRule.findFirst({
        where: {
            tenant_id: input.tenantId,
            event_type: input.eventType,
            is_active: true,
            condition_key: 'none',
            condition_value: null,
        },
        orderBy: [{ priority: 'asc' }, { updated_at: 'desc' }],
    });

    if (!postingRule) {
        await input.tx.postingEvent.update({
            where: { id: postingEvent.id },
            data: {
                status: 'skipped',
                last_error: 'POSTING_RULE_NOT_CONFIGURED',
            },
        });
        return { postingStatus: 'skipped' };
    }

    if (input.amount <= 0) {
        await input.tx.postingEvent.update({
            where: { id: postingEvent.id },
            data: {
                status: 'skipped',
                last_error: 'AUTO_POSTING_AMOUNT_INVALID',
            },
        });
        return { postingStatus: 'skipped' };
    }

    // A PaymentMethod override replaces the rule's account on the cash/mode leg.
    const debitAccountId = input.overrideDebitAccountId ?? postingRule.debit_account_id;
    const creditAccountId = input.overrideCreditAccountId ?? postingRule.credit_account_id;

    const accounts = await input.tx.account.findMany({
        where: {
            tenant_id: input.tenantId,
            id: { in: [debitAccountId, creditAccountId] },
        },
        select: { id: true, party_type: true },
    });

    // length !== 2 also catches an override account that is not the tenant's, and
    // === catches an override that collapses both legs onto one account.
    if (accounts.length !== 2 || debitAccountId === creditAccountId) {
        await input.tx.postingEvent.update({
            where: { id: postingEvent.id },
            data: {
                status: 'failed',
                last_error: 'AUTO_POSTING_ACCOUNT_INVALID',
            },
        });
        throw new BadRequestException('AUTO_POSTING_ACCOUNT_INVALID');
    }

    const voucherType = resolveVoucherType(input.eventType, conditionKey, conditionValue);
    const voucherNumber = await generateVoucherNumber(input.tx, input.tenantId, voucherType);

    // Tag whichever leg hits the control account of the passed party type. Only
    // that leg — the cash/revenue side must stay party-less so it does not pollute
    // an unrelated account's subsidiary ledger. If neither account matches (no
    // party passed, or the rule points at a non-control account), both legs are
    // untagged and the posting behaves exactly as before.
    const partyTypeByAccount = new Map(accounts.map((account) => [account.id, account.party_type]));
    const partyFieldsFor = (accountId: string) =>
        input.partyId && input.partyType && partyTypeByAccount.get(accountId) === input.partyType
            ? { party_type: input.partyType, party_id: input.partyId }
            : {};

    const voucher = await input.tx.voucher.create({
        data: {
            tenant_id: input.tenantId,
            voucher_number: voucherNumber,
            voucher_type: voucherType,
            source_module: input.sourceModule,
            source_type: input.sourceType,
            source_id: input.sourceId,
            idempotency_key: idempotencyKey,
            description: input.description,
            reference_number: input.referenceNumber,
            date: input.date,
            store_id: input.storeId ?? null,
            attribution: resolveVoucherAttribution(input),
            counterparty_store_id: input.counterpartyStoreId ?? null,
            details: {
                create: [
                    {
                        account_id: debitAccountId,
                        debit_amount: new Prisma.Decimal(input.amount),
                        credit_amount: new Prisma.Decimal(0),
                        ...partyFieldsFor(debitAccountId),
                    },
                    {
                        account_id: creditAccountId,
                        debit_amount: new Prisma.Decimal(0),
                        credit_amount: new Prisma.Decimal(input.amount),
                        ...partyFieldsFor(creditAccountId),
                    },
                ],
            },
        },
    });

    await input.tx.postingEvent.update({
        where: { id: postingEvent.id },
        data: {
            status: 'posted',
            voucher_id: voucher.id,
            last_error: null,
        },
    });

    return {
        postingStatus: 'posted',
        voucherId: voucher.id,
        voucherNumber: voucher.voucher_number,
        voucherType: voucher.voucher_type,
    };
}

/** Remove auto-posted voucher + posting event so the source can be reposted or deleted. */
export async function voidAutoPostedVoucher(
    tx: Prisma.TransactionClient,
    tenantId: string,
    eventType: PostingEventType,
    sourceId: string,
): Promise<void> {
    const idempotencyKey = `${tenantId}:${eventType}:${sourceId}`;
    const event = await tx.postingEvent.findUnique({
        where: {
            tenant_id_idempotency_key: {
                tenant_id: tenantId,
                idempotency_key: idempotencyKey,
            },
        },
    });

    if (!event) return;

    if (event.voucher_id) {
        await tx.voucherDetail.deleteMany({ where: { voucher_id: event.voucher_id } });
        await tx.voucher.delete({ where: { id: event.voucher_id } });
    }

    await tx.postingEvent.delete({ where: { id: event.id } });
}
