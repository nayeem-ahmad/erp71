import { PLATFORM_ACCOUNT, type PlatformAccountName } from '@erp71/database';

/**
 * How a `BillingEvent` becomes a journal entry in the platform's own books.
 *
 * The platform's revenue already exists as data — every fee charged, payment
 * taken and refund issued is a BillingEvent row, written by the billing cron,
 * the SSL Wireless callback or an admin in Admin › Tenants. What it has never
 * been is *accounting*: there was no double entry, so no P&L, no balance sheet,
 * and no way to put the money coming in next to the money going out.
 *
 * This table is the bridge, and projecting off BillingEvent is deliberate
 * rather than posting inline from each billing call site:
 *
 *  - every money event in the product already lands here, including the ones
 *    written by paths that predate this module, so nothing is missed and
 *    nothing has to be retro-fitted with a posting call;
 *  - the projection is replayable, which is what lets the platform's books be
 *    opened on a system that has been billing for a year and still get the
 *    history right;
 *  - a bug in the ledger cannot break billing, because the ledger is strictly
 *    downstream of it.
 *
 * Signs are fixed against the tenant-facing billing ledger (see
 * `ledgerEventDelta` in admin-tenants): a charge there makes the tenant owe
 * money, which here is a debit to Subscription Receivable; a payment there is a
 * credit to it. So the balance of Subscription Receivable in the platform books
 * is the mirror of the sum of every tenant's ledger balance, and the two can be
 * reconciled against each other.
 *
 * With two known exceptions, both of them gaps in `ledgerEventDelta` rather than
 * here. It has no case for `addon_fee`, nor for the gateway collections `IPN`
 * and `CALLBACK_SUCCESS`, so all three score zero: the admin ledger lists them,
 * but none moves the tenant's balance, their dunning clock or their suspension.
 * The consequences differ — an uncounted add-on charge makes a tenant look like
 * they owe less than they do, an uncounted card payment makes them look like
 * they owe more, and the fee cron charges every subscription regardless of how
 * it pays — but the fix is the same and it belongs to billing.
 *
 * These books stay correct meanwhile: the platform earned the add-on fee and is
 * owed it, and the gateway collection really did settle what was owed, so both
 * post against the receivable like any other charge or payment. Until billing
 * counts them the platform's receivable will differ from the tenant-ledger total
 * by exactly those amounts. `platform-accounting.constants.spec.ts` pins the
 * exceptions, so whoever fixes `ledgerEventDelta` is told to delete this.
 */
export interface BillingEventPosting {
    /** The account debited — where the value went. */
    debit: PlatformAccountName;
    /** The account credited — where the value came from. */
    credit: PlatformAccountName;
    /** Human label for the voucher line, and for the sync report. */
    label: string;
    /**
     * True when the credit leg is a cash/bank account whose real-world pocket
     * depends on how the money arrived, so the projection may swap it for the
     * account matching the event's provider or recorded method.
     */
    resolveCashLeg?: 'debit' | 'credit';
}

/**
 * Event types that carry money into or out of the platform. Anything not listed
 * — the reminder, good-standing and checkout-session events, which are
 * bookkeeping about *notifications* rather than about money — is skipped by the
 * projection, which is why this is an allow-list and not a switch with a
 * default case.
 */
export const BILLING_EVENT_POSTINGS: Record<string, BillingEventPosting> = {
    // ── Charges: revenue earned, tenant now owes it ──────────────────────────
    subscription_fee: {
        debit: PLATFORM_ACCOUNT.SUBSCRIPTION_RECEIVABLE,
        credit: PLATFORM_ACCOUNT.SUBSCRIPTION_REVENUE,
        label: 'Subscription fee',
    },
    addon_fee: {
        debit: PLATFORM_ACCOUNT.SUBSCRIPTION_RECEIVABLE,
        credit: PLATFORM_ACCOUNT.ADDON_REVENUE,
        label: 'Add-on module fee',
    },
    // An admin-entered charge. "Other Platform Revenue" rather than a guess at
    // what it was for: the label is free text, so the only honest bucket is the
    // general one, and an admin who wants it elsewhere can reclassify with a
    // journal voucher.
    manual_fee: {
        debit: PLATFORM_ACCOUNT.SUBSCRIPTION_RECEIVABLE,
        credit: PLATFORM_ACCOUNT.OTHER_REVENUE,
        label: 'Platform fee',
    },

    // ── Receipts: money in, settling what the tenant owed ────────────────────
    manual_payment: {
        debit: PLATFORM_ACCOUNT.BANK,
        credit: PLATFORM_ACCOUNT.SUBSCRIPTION_RECEIVABLE,
        label: 'Tenant payment',
        resolveCashLeg: 'debit',
    },
    // Gateway collections. Both spellings of a successful SSLCommerz round-trip
    // land here: `CALLBACK_SUCCESS` is the browser returning from the payment
    // page, `IPN` the server-to-server notification, and which of the two
    // arrives first is not deterministic. They are separately idempotent —
    // different `external_event_id`s only when the gateway really did charge
    // twice — so both are projected and the duplicate check is the gateway's
    // own event id, exactly as it is in BillingService.
    CALLBACK_SUCCESS: {
        debit: PLATFORM_ACCOUNT.GATEWAY_RECEIVABLE,
        credit: PLATFORM_ACCOUNT.SUBSCRIPTION_RECEIVABLE,
        label: 'Gateway payment',
    },
    IPN: {
        debit: PLATFORM_ACCOUNT.GATEWAY_RECEIVABLE,
        credit: PLATFORM_ACCOUNT.SUBSCRIPTION_RECEIVABLE,
        label: 'Gateway payment',
    },

    // ── Credit sales: money in AND revenue, in one event ─────────────────────
    // These do not touch Subscription Receivable, and that is the point. The
    // credits were granted at the moment of sale — there is no charge event
    // preceding the payment and no balance to settle — so routing them through
    // the receivable would leave every credit sale looking like a tenant
    // overpayment that never clears.
    sms_credit_sale_payment: {
        debit: PLATFORM_ACCOUNT.BANK,
        credit: PLATFORM_ACCOUNT.SMS_REVENUE,
        label: 'SMS credit sale',
        resolveCashLeg: 'debit',
    },
    ai_credit_sale_payment: {
        debit: PLATFORM_ACCOUNT.BANK,
        credit: PLATFORM_ACCOUNT.AI_REVENUE,
        label: 'AI credit sale',
        resolveCashLeg: 'debit',
    },

    // ── Money back ───────────────────────────────────────────────────────────
    // An admin-entered refund against the tenant's billing ledger: cash leaves,
    // and what the tenant is owed goes down with it. Revenue is untouched
    // because the charge it offsets is still on the books — the ledger is an
    // account current, and this is the payment half running backwards.
    manual_refund: {
        debit: PLATFORM_ACCOUNT.SUBSCRIPTION_RECEIVABLE,
        credit: PLATFORM_ACCOUNT.BANK,
        label: 'Refund to tenant',
        resolveCashLeg: 'credit',
    },
    // A gateway refund (BillingService.processRefund). Unlike the manual kind
    // this one never appears in the tenant's billing ledger — `ledgerEventDelta`
    // scores it zero — so it must not move the receivable either, or the two
    // would stop reconciling. It is a reversal of revenue, taken back out of
    // the gateway's balance.
    REFUND: {
        debit: PLATFORM_ACCOUNT.REFUNDS,
        credit: PLATFORM_ACCOUNT.GATEWAY_RECEIVABLE,
        label: 'Gateway refund',
    },
};

export const PROJECTED_BILLING_EVENT_TYPES = Object.keys(BILLING_EVENT_POSTINGS);

/**
 * Where a manually recorded receipt or refund actually moved, from the free-text
 * `method` an admin typed in Admin › Tenants. Unmatched text falls back to the
 * map's default leg (the bank), which is what the platform is paid into most of
 * the time.
 */
export function resolvePlatformCashAccount(method?: string | null): PlatformAccountName | null {
    if (!method) return null;
    const normalized = method.trim().toLowerCase();
    if (!normalized) return null;

    if (normalized.includes('bkash')) return PLATFORM_ACCOUNT.BKASH;
    if (normalized.includes('nagad')) return PLATFORM_ACCOUNT.NAGAD;
    if (normalized.includes('cash')) return PLATFORM_ACCOUNT.CASH;
    if (normalized.includes('bank') || normalized.includes('transfer')) return PLATFORM_ACCOUNT.BANK;
    return null;
}

/** Source module recorded on every voucher this module posts. */
export const PLATFORM_ACCOUNTING_SOURCE_MODULE = 'platform_accounting';
