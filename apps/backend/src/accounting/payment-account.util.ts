import { BadRequestException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { availableAt, isAvailableAt } from '../payment-methods/payment-method-branches';
import { classifyPaymentMode, PaymentMode } from '../sales/classify-payment-mode';
import type { TenderLegLine } from './posting.utils';

type Client = PrismaClient | Prisma.TransactionClient;

/** The 400 for a method id that is not the tenant's (or no longer exists). */
export const PAYMENT_METHOD_MISSING = 'That payment method does not exist or is switched off.';
/** The 400 for a new tender on a method not available at the document's branch. */
export const PAYMENT_METHOD_NOT_AT_BRANCH = "That payment method isn't available at this branch.";

/**
 * Resolves the GL account a tenant configured for a payment method, so a posting
 * can send the cash leg there instead of the mode-derived default.
 *
 * This is what makes a custom method work: `classifyPaymentMode('Upay')` falls
 * back to 'cash' and the rule would post to Cash in Hand, but if the tenant set
 * `PaymentMethod.account_id` for "Upay", that account wins. Returns undefined when
 * the method is unknown or has no account, so the caller keeps the rule default.
 */
export async function resolvePaymentMethodAccountId(
    db: Client,
    tenantId: string,
    methodName?: string | null,
): Promise<string | undefined> {
    if (!methodName) return undefined;
    const method = await db.paymentMethod.findFirst({
        where: { tenant_id: tenantId, name: methodName, is_active: true },
        select: { account_id: true },
    });
    return method?.account_id ?? undefined;
}

export interface CreditPaymentMethod {
    id: string;
    name: string;
    account_id: string | null;
}

/**
 * The tender a customer or supplier payment was taken by, checked against the
 * tenant and the party's branch (`storeId`). An unknown, foreign, switched-off
 * or not-offered-here method is a 400 (one message for every miss, as in
 * `resolveTenders`) rather than a quiet fall back to Cash in Hand: the operator
 * picked one, and the money has to land where they think it did.
 */
export async function resolveCreditPaymentMethod(
    db: Client,
    tenantId: string,
    methodId: string,
    storeId: string,
): Promise<CreditPaymentMethod> {
    const method = await db.paymentMethod.findFirst({
        where: { id: methodId, tenant_id: tenantId, ...availableAt([storeId]) },
        select: { id: true, name: true, account_id: true },
    });
    if (!method) {
        throw new BadRequestException(PAYMENT_METHOD_NOT_AT_BRANCH);
    }
    return method;
}

/**
 * The account a payment's stored method is linked to today, for reposting an
 * edit that left the method alone. Deliberately ignores `is_active`: switching
 * a method off stops new payments using it, not old ones posting where they
 * always did.
 */
export async function storedPaymentMethodAccountId(
    db: Client,
    tenantId: string,
    methodId: string | null | undefined,
): Promise<string | undefined> {
    if (!methodId) return undefined;
    const method = await db.paymentMethod.findFirst({
        where: { id: methodId, tenant_id: tenantId },
        select: { account_id: true },
    });
    return method?.account_id ?? undefined;
}

/**
 * Which side of a payment voucher is the cash leg. Every customer and supplier
 * payment rule pairs the party's account with Cash in Hand: money coming in
 * debits cash, money going out credits it. Without an account the rule's own
 * Cash in Hand stands.
 */
export function cashLegOverride(
    flow: 'in' | 'out',
    accountId: string | null | undefined,
): { overrideDebitAccountId?: string; overrideCreditAccountId?: string } {
    if (!accountId) return {};
    return flow === 'in' ? { overrideDebitAccountId: accountId } : { overrideCreditAccountId: accountId };
}

/** A tender as a write submits it. `paymentMethod` is the canonical type string. */
export interface TenderInput {
    paymentMethod: string;
    paymentMethodId?: string | null;
    amount: number;
}

/**
 * A tender row the document already carries (PaymentRecord and its siblings).
 * Passed to `resolveTenders` as `stored`.
 *
 * - With a `payment_method_id`, its `account_id` and `payment_method_name` are
 *   what a kept tender reposts with on an edit.
 * - Without one (a row written before payment methods were linked), the row
 *   names its method only by `payment_method_name ?? payment_method`; see
 *   `resolveTenders` for how that name is matched. Its `account_id` was
 *   client-sent and never posted, so it is ignored.
 */
export interface StoredTender {
    payment_method: string;
    payment_method_id: string | null;
    payment_method_name: string | null;
    account_id: string | null;
    amount: unknown;
}

export interface ResolvedTender {
    /** The canonical string as submitted — what PaymentRecord.payment_method stores. */
    paymentMethod: string;
    methodId: string | null;
    methodName: string | null;
    /**
     * The method's linked account — for a tender the document already carries,
     * the account it was saved with. Null leaves the posting rule's account for `mode`.
     */
    accountId: string | null;
    /** classifyPaymentMode(methodName ?? paymentMethod). */
    mode: PaymentMode;
    amount: number;
}

const TENDER_METHOD_SELECT = {
    id: true,
    name: true,
    account_id: true,
    is_active: true,
    all_branches: true,
    stores: { select: { store_id: true } },
} satisfies Prisma.PaymentMethodSelect;

type TenderMethod = Prisma.PaymentMethodGetPayload<{ select: typeof TENDER_METHOD_SELECT }>;

const LEGACY_METHOD_SELECT = {
    ...TENDER_METHOD_SELECT,
    type: true,
} satisfies Prisma.PaymentMethodSelect;

type LegacyMethod = Prisma.PaymentMethodGetPayload<{ select: typeof LEGACY_METHOD_SELECT }>;

/** The legacy canonical keys that name a method by something other than its own name. */
const LEGACY_KEY_NAMES: Record<string, string> = { BKASH: 'bKash', NAGAD: 'Nagad' };
const LEGACY_CASH_KEY = 'CASH';

/**
 * Turns submitted tenders into method, name, linked account and posting mode,
 * enforcing the branch rule (spec §4). Returns one result per tender, in order.
 *
 * - **With an id:** the tenant's method, or 400. A new tender must be on a
 *   method available at `storeId` and takes the method's current name and
 *   linked account.
 * - **A tender the document already carries** is exempt from the branch and
 *   `is_active` check, so editing an old sale never forces a different tender.
 *   Two kinds of stored row carry a method:
 *   - A row with a `payment_method_id` keeps what it was saved with: its
 *     `account_id` (null stays null, so a deleted account falls back to the
 *     rule's) and its `payment_method_name`, else the method's name. Relinking
 *     or renaming a method changes new tenders, never what an edit reposts for
 *     an old one. With several stored rows on one method, the first answers.
 *   - A legacy row (`payment_method_id` null) carries the method it names:
 *     `payment_method_name ?? payment_method` equal, ignoring case, to a method
 *     name of the tenant — at any branch, active or not — with the canonical
 *     keys `CASH` (the tenant's lowest-`sort_order` method of type Cash),
 *     `BKASH` (bKash) and `NAGAD` (Nagad) mapped as the frontend does. No match,
 *     no exemption. It takes the method's current `account_id` (the row's own
 *     was client-sent and never posted) and the row's `payment_method_name`,
 *     else the method's name. A row with a method id wins over a legacy row
 *     for the same method.
 * - **Without an id** (POS, offline-queued sales, external sync, imports, the
 *   mobile app): a case-insensitive name match among the methods available at
 *   the branch — which is what lets POS's 'BKASH' reach the bKash method —
 *   then the old tenant-wide exact-name match. No match leaves the method
 *   fields null and the posting uses the rule for `mode`.
 *
 * At most two queries, whatever the number of tenders, plus one more for the
 * legacy names, and only when a stored row is legacy and a tender names a
 * method the document does not already carry by id.
 */
export async function resolveTenders(
    db: Client,
    tenantId: string,
    storeId: string,
    tenders: TenderInput[],
    stored: StoredTender[] = [],
): Promise<ResolvedTender[]> {
    const ids = [...new Set(tenders.flatMap((t) => (t.paymentMethodId ? [t.paymentMethodId] : [])))];
    const names = [...new Set(tenders.flatMap((t) => (!t.paymentMethodId && t.paymentMethod ? [t.paymentMethod] : [])))];

    const byId = ids.length
        ? await db.paymentMethod.findMany({
            where: { tenant_id: tenantId, id: { in: ids } },
            select: TENDER_METHOD_SELECT,
        })
        : [];
    // Every active method any name matches case-insensitively: a superset of
    // both the branch match and the tenant-wide exact match, picked apart below.
    const named = names.length
        ? await db.paymentMethod.findMany({
            where: {
                tenant_id: tenantId,
                is_active: true,
                OR: names.map((name) => ({ name: { equals: name, mode: Prisma.QueryMode.insensitive } })),
            },
            select: TENDER_METHOD_SELECT,
            orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
        })
        : [];

    const methodsById = new Map(byId.map((m) => [m.id, m]));
    const storedById = new Map<string, StoredTender>();
    for (const row of stored) {
        if (row.payment_method_id && !storedById.has(row.payment_method_id)) {
            storedById.set(row.payment_method_id, row);
        }
    }
    // Legacy rows (no method id), matched by name to the methods they name. Only
    // worth a query when a tender could use the answer.
    const legacyRows = stored.filter((row) => !row.payment_method_id);
    const legacyById = ids.some((id) => !storedById.has(id)) && legacyRows.length
        ? await matchLegacyRows(db, tenantId, legacyRows)
        : new Map<string, StoredTender>();

    return tenders.map((tender) => {
        let method: TenderMethod | undefined;
        let methodName: string | null;
        let accountId: string | null;
        if (tender.paymentMethodId) {
            method = methodsById.get(tender.paymentMethodId);
            if (!method) throw new BadRequestException(PAYMENT_METHOD_MISSING);
            const kept = storedById.get(method.id);
            const legacy = kept ? undefined : legacyById.get(method.id);
            if (kept) {
                methodName = kept.payment_method_name ?? method.name;
                accountId = kept.account_id;
            } else if (legacy) {
                methodName = legacy.payment_method_name ?? method.name;
                accountId = method.account_id;
            } else {
                if (!isAvailableAt(method, storeId)) throw new BadRequestException(PAYMENT_METHOD_NOT_AT_BRANCH);
                methodName = method.name;
                accountId = method.account_id;
            }
        } else {
            method = matchByName(named, tender.paymentMethod, storeId);
            methodName = method?.name ?? null;
            accountId = method?.account_id ?? null;
        }
        return {
            paymentMethod: tender.paymentMethod,
            methodId: method?.id ?? null,
            methodName,
            accountId,
            mode: classifyPaymentMode(methodName ?? tender.paymentMethod),
            amount: tender.amount,
        };
    });
}

/**
 * Which method each legacy stored row (no `payment_method_id`) names, keyed by
 * method id; the first row that names a method answers for it. One query over
 * the tenant's methods at any branch and `is_active` — a method limited to
 * other branches or switched off since the sale was made still counts.
 */
async function matchLegacyRows(
    db: Client,
    tenantId: string,
    rows: StoredTender[],
): Promise<Map<string, StoredTender>> {
    const keyOf = (row: StoredTender) => row.payment_method_name ?? row.payment_method;
    const wantsCash = rows.some((row) => keyOf(row) === LEGACY_CASH_KEY);
    const names = [...new Set(rows.flatMap((row) => {
        const key = keyOf(row);
        if (!key || key === LEGACY_CASH_KEY) return [];
        return [LEGACY_KEY_NAMES[key] ?? key];
    }))];
    const clauses: Prisma.PaymentMethodWhereInput[] = names.map((name) => ({
        name: { equals: name, mode: Prisma.QueryMode.insensitive },
    }));
    if (wantsCash) clauses.push({ type: 'Cash' });
    if (!clauses.length) return new Map();

    const methods: LegacyMethod[] = await db.paymentMethod.findMany({
        where: { tenant_id: tenantId, OR: clauses },
        select: LEGACY_METHOD_SELECT,
        orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    });

    const matched = new Map<string, StoredTender>();
    for (const row of rows) {
        const key = keyOf(row);
        if (!key) continue;
        let method: LegacyMethod | undefined;
        if (key === LEGACY_CASH_KEY) {
            method = methods.find((m) => m.type === 'Cash');
        } else {
            const name = (LEGACY_KEY_NAMES[key] ?? key).toLowerCase();
            const sameName = methods.filter((m) => m.name.toLowerCase() === name);
            method = sameName.find((m) => m.name === (LEGACY_KEY_NAMES[key] ?? key)) ?? sameName[0];
        }
        if (method && !matched.has(method.id)) matched.set(method.id, row);
    }
    return matched;
}

/**
 * The branch's method by that name, ignoring case (the exact spelling wins a
 * tie), else the tenant's active method of exactly that name — the match
 * `resolvePaymentMethodAccountId` has always made.
 */
function matchByName(candidates: TenderMethod[], name: string, storeId: string): TenderMethod | undefined {
    if (!name) return undefined;
    const lower = name.toLowerCase();
    const sameName = candidates.filter((m) => m.name.toLowerCase() === lower);
    const atBranch = sameName.filter((m) => isAvailableAt(m, storeId));
    return atBranch.find((m) => m.name === name) ?? atBranch[0] ?? sameName.find((m) => m.name === name);
}

/**
 * A document's stored tender rows as inputs, for an edit that sends no
 * payments. Pass the same rows as `resolveTenders`' `stored` so each keeps the
 * account and name it was saved with.
 */
export function storedToTenderInputs(rows: StoredTender[]): TenderInput[] {
    return rows.map((row) => ({
        paymentMethod: row.payment_method,
        paymentMethodId: row.payment_method_id,
        amount: Number(row.amount),
    }));
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

/**
 * Splits tenders across a posting of `amount`, in order: each tender gives
 * `min(remaining, its amount)` to `lines`, and whatever is left of a tender
 * past `amount` goes to `rest` (the overpayment, which posts on its own
 * voucher). Tenders that fall short are padded with an unlinked cash line —
 * the `'cash'` a sale posted with no payments has always used.
 */
export function allocateTenders(
    tenders: ResolvedTender[],
    amount: number,
): { lines: TenderLegLine[]; rest: ResolvedTender[] } {
    const lines: TenderLegLine[] = [];
    const rest: ResolvedTender[] = [];
    let remaining = round2(amount);
    for (const tender of tenders) {
        const tendered = round2(tender.amount);
        const take = round2(Math.max(0, Math.min(remaining, tendered)));
        if (take > 0) {
            lines.push({ accountId: tender.accountId, mode: tender.mode, amount: take });
            remaining = round2(remaining - take);
        }
        const left = round2(tendered - take);
        if (left > 0) rest.push({ ...tender, amount: left });
    }
    if (remaining > 0) lines.push({ accountId: null, mode: 'cash', amount: remaining });
    return { lines, rest };
}

/**
 * Whether two tender lists are the same multiset — same methods, same
 * amounts, in any order. A tender is keyed by its method id, else by its
 * canonical string ignoring case; amounts match within half a paisa.
 */
export function sameTenders(
    a: { methodId: string | null; paymentMethod: string; amount: number }[],
    b: typeof a,
): boolean {
    if (a.length !== b.length) return false;
    const keyOf = (t: (typeof a)[number]) => t.methodId ?? t.paymentMethod.toLowerCase();
    const unmatched = [...b];
    for (const tender of a) {
        const index = unmatched.findIndex(
            (other) => keyOf(other) === keyOf(tender) && Math.abs(other.amount - tender.amount) <= 0.005,
        );
        if (index === -1) return false;
        unmatched.splice(index, 1);
    }
    return true;
}
