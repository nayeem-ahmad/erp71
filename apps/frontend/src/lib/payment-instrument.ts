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
