import type { Payment, PaymentInstrument } from '@/lib/hooks/useNewSaleCart';

const INSTRUMENT_KEYS = [
    'bankName',
    'bankBranch',
    'bankAccountNumber',
    'referenceNo',
    'instrumentDate',
] as const satisfies readonly (keyof PaymentInstrument)[];

/**
 * The instrument fields set on a payment, with the empty ones dropped.
 *
 * Deliberately not trimmed: what comes back out of here is fed straight into
 * the boxes the operator is typing in, and trimming mid-word turns "Dutch " +
 * "B" into "DutchB". The backend trims on the way into the column instead.
 */
export function pickInstrument(p: Payment): PaymentInstrument {
    const detail: PaymentInstrument = {};
    for (const key of INSTRUMENT_KEYS) {
        const value = p[key];
        if (value) detail[key] = value;
    }
    return detail;
}

/**
 * The one-line version of a payment's instrument details — "CHQ-889001 · City
 * Bank · 2026-09-25".
 *
 * Shared so the entry strip's collapsed toggle, the recorded-payments list and
 * a printed invoice all name the same cheque the same way; a shop that reads
 * one number on screen and another on paper has to go back to the paper.
 */
export function instrumentSummary(detail: PaymentInstrument | undefined): string {
    if (!detail) return '';
    return [detail.referenceNo, detail.bankName, detail.bankAccountNumber, detail.instrumentDate]
        .map((value) => value?.trim())
        .filter(Boolean)
        .join(' · ');
}

/** `instrumentSummary` straight off a payment, for callers holding the whole row. */
export const paymentInstrumentSummary = (p: Payment): string => instrumentSummary(pickInstrument(p));

/** The instrument columns of a stored payment row — a sale's `PaymentRecord` or a purchase's `PurchasePayment`. */
export interface PaymentInstrumentRecord {
    bank_name?: string | null;
    bank_branch?: string | null;
    bank_account_number?: string | null;
    reference_no?: string | null;
    instrument_date?: string | null;
}

/**
 * A stored payment row's instrument, in the shape the entry form and
 * `instrumentSummary` work in. The date column is a DATE, so the first ten
 * characters of what the API sends are the whole of it — and exactly what the
 * form's date box takes.
 */
export function instrumentFromRecord(record: PaymentInstrumentRecord): PaymentInstrument {
    return {
        bankName: record.bank_name ?? undefined,
        bankBranch: record.bank_branch ?? undefined,
        bankAccountNumber: record.bank_account_number ?? undefined,
        referenceNo: record.reference_no ?? undefined,
        instrumentDate: record.instrument_date ? String(record.instrument_date).slice(0, 10) : undefined,
    };
}
