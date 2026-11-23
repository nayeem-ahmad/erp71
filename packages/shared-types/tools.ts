/**
 * Shared vocabulary for the Tools menu's record-keeping tools — Cheques,
 * Documents and the bill scanner — so the API's validation, the screens'
 * pickers and the reminders all read from one list.
 */

/**
 * Mirrors `AI_TOKENS_PER_CREDIT` in `index.ts`, which re-exports this file —
 * importing it back would be a cycle. `tools.test.ts` holds the two equal.
 */
export const BILL_SCAN_TOKENS_PER_CREDIT = 1000;

// ── Cheques ─────────────────────────────────────────────────────────────────

/** Who wrote the cheque: us (ISSUED) or a customer who paid us with one (RECEIVED). */
export const CHEQUE_DIRECTIONS = ['ISSUED', 'RECEIVED'] as const;
export type ChequeDirection = (typeof CHEQUE_DIRECTIONS)[number];

/**
 * Where a cheque is in its life. DEPOSITED only means something for a
 * received cheque — it is in the bank, not yet cleared — but one list keeps
 * the register's filter simple.
 */
export const CHEQUE_STATUSES = ['PENDING', 'DEPOSITED', 'CLEARED', 'BOUNCED', 'CANCELLED'] as const;
export type ChequeStatus = (typeof CHEQUE_STATUSES)[number];

/** Statuses a cheque can still fall due in — the reminder looks at only these. */
export const OPEN_CHEQUE_STATUSES: readonly ChequeStatus[] = ['PENDING', 'DEPOSITED'];

/**
 * Days before the date written on the cheque that its reminder fires. Two
 * days is enough to move money into the account (or to plan the deposit);
 * the day itself is the last call.
 */
export const CHEQUE_REMINDER_DAYS = [2, 0] as const;

// ── Documents (licence vault) ───────────────────────────────────────────────

/**
 * The papers a Bangladeshi business is asked for most. OTHER covers the rest;
 * the title says what it is.
 */
export const BUSINESS_DOCUMENT_TYPES = [
    'TRADE_LICENSE',
    'TIN',
    'BIN',
    'FIRE_LICENSE',
    'IRC',
    'ERC',
    'ENVIRONMENT',
    'TRADEMARK',
    'INSURANCE',
    'OTHER',
] as const;
export type BusinessDocumentType = (typeof BUSINESS_DOCUMENT_TYPES)[number];

/** Fixed reminder days on top of the document's own `remind_days_before`. */
export const BUSINESS_DOCUMENT_REMINDER_DAYS = [7, 1, 0] as const;

/** The default lead time; a trade licence renewal takes about a month. */
export const DEFAULT_DOCUMENT_REMIND_DAYS = 30;

export type DocumentExpiryState = 'none' | 'valid' | 'expiring' | 'expired';

/**
 * How a document's expiry reads today: no date, comfortably valid, inside its
 * reminder window, or past it. Dates are compared as calendar days, so a
 * document expiring today is `expiring`, not `expired`.
 */
export function documentExpiryState(
    expiryDate: string | Date | null | undefined,
    remindDaysBefore: number,
    today: Date = new Date(),
): { state: DocumentExpiryState; daysLeft: number | null } {
    if (!expiryDate) return { state: 'none', daysLeft: null };
    const expiry = new Date(expiryDate);
    if (Number.isNaN(expiry.getTime())) return { state: 'none', daysLeft: null };
    const dayMs = 24 * 60 * 60 * 1000;
    const startOfDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    const daysLeft = Math.round((startOfDay(expiry) - todayUtc) / dayMs);
    if (daysLeft < 0) return { state: 'expired', daysLeft };
    if (daysLeft <= Math.max(remindDaysBefore, 0)) return { state: 'expiring', daysLeft };
    return { state: 'valid', daysLeft };
}

// ── Bill scan (AI) ──────────────────────────────────────────────────────────

/** What a scanned photo becomes: a purchase bill or an expense receipt. */
export const BILL_SCAN_TARGETS = ['purchase', 'expense'] as const;
export type BillScanTarget = (typeof BILL_SCAN_TARGETS)[number];

/** Longest edge the browser shrinks a photo to before it is sent. */
export const BILL_SCAN_MAX_EDGE_PX = 1600;

/** The model's answer ceiling for a scan; also the worst case the estimate shows. */
export const BILL_SCAN_MAX_OUTPUT_TOKENS = 2000;

/** Instructions and schema sent with every scan, in tokens. Measured, rounded up. */
const BILL_SCAN_PROMPT_TOKENS = 750;

/** What a typical bill of a dozen lines comes back as. */
const BILL_SCAN_TYPICAL_OUTPUT_TOKENS = 700;

/**
 * Vision models bill a picture by its pixels — about one token per 750 —
 * after shrinking it so the long edge is at most ~1568 px. Mirrored here so a
 * caller that has not shrunk the photo still gets an honest figure.
 */
function imageTokens(width: number, height: number): number {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const scale = Math.min(1, 1568 / Math.max(w, h));
    return Math.ceil((w * scale * (h * scale)) / 750);
}

export interface AiCreditEstimate {
    /** The likely charge, in credits, rounded up to a tenth. */
    expected: number;
    /** The most this call can charge: the model writing its full answer budget. */
    max: number;
}

/**
 * What one bill scan is expected to cost, shown before the photo is sent so
 * nobody spends credits without seeing the price first. The real charge is
 * what the model reports afterwards and is shown with the result.
 */
export function estimateBillScanCredits(width: number, height: number): AiCreditEstimate {
    const input = imageTokens(width, height) + BILL_SCAN_PROMPT_TOKENS;
    const round = (tokens: number) => Math.ceil((tokens / BILL_SCAN_TOKENS_PER_CREDIT) * 10) / 10;
    return {
        expected: round(input + BILL_SCAN_TYPICAL_OUTPUT_TOKENS),
        max: round(input + BILL_SCAN_MAX_OUTPUT_TOKENS),
    };
}

/** One line read off a bill, matched to a product when the name was recognised. */
export interface BillScanLine {
    description: string;
    quantity: number;
    unitPrice: number | null;
    lineTotal: number | null;
    product?: { id: string; name: string; sku?: string | null; unit_type?: string | null } | null;
}

/** What the scanner read, for a person to check before anything is saved. */
export interface BillScanResult {
    target: BillScanTarget;
    vendorName: string | null;
    vendorPhone: string | null;
    vendorAddress: string | null;
    billNumber: string | null;
    /** `YYYY-MM-DD` when a date could be read. */
    billDate: string | null;
    lines: BillScanLine[];
    subtotal: number | null;
    discount: number | null;
    tax: number | null;
    /** Delivery, carrying or labour charges on the bill. */
    freight: number | null;
    total: number | null;
    /** A short description of what the expense was for. */
    summary: string | null;
    /** A matched supplier, for a purchase. */
    supplier?: { id: string; name: string; phone?: string | null } | null;
    /** A matched expense head, for an expense. */
    expenseHead?: { id: string; name: string; categoryName?: string | null } | null;
    credits_used: number;
    credits_estimate: AiCreditEstimate;
}
