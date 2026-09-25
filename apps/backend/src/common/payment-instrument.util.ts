import type { PaymentInstrumentDto } from './payment-instrument.dto';

/**
 * The five instrument columns, as `PaymentRecord` (a sale's payments) and
 * `PurchasePayment` (a purchase's) both store them.
 */
export interface PaymentInstrumentColumns {
    bank_name: string | null;
    bank_branch: string | null;
    bank_account_number: string | null;
    reference_no: string | null;
    instrument_date: Date | null;
}

/**
 * Blank arrives from the entry form whenever the details panel was opened and a
 * box left empty, so it is stored as NULL: "no cheque number" has to read the
 * same whether the operator never opened the panel or opened it and typed
 * nothing, or every report filtering on a missing reference gets two answers.
 */
function trimmedOrNull(value?: string | null): string | null {
    const next = value?.trim();
    return next ? next : null;
}

/**
 * The form sends a date-only `YYYY-MM-DD`, and the column is a DATE. Anchoring
 * it to UTC midnight keeps the stored day the one that was typed whatever the
 * server's timezone is — `new Date('2026-09-20T00:00:00')` in Dhaka is the 19th
 * once it reaches a UTC connection.
 */
function instrumentDate(value?: string | null): Date | null {
    if (!value) return null;
    const [year, month, day] = value.slice(0, 10).split('-').map(Number);
    if (!year || !month || !day) return null;
    return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Maps the instrument fields of a payment body onto the columns they are stored
 * in. One place for both sides of the counter, so a cheque recorded on a sale
 * and one written on a purchase are trimmed, blanked and dated the same way.
 */
export function paymentInstrumentData(payment: PaymentInstrumentDto): PaymentInstrumentColumns {
    return {
        bank_name: trimmedOrNull(payment.bankName),
        bank_branch: trimmedOrNull(payment.bankBranch),
        bank_account_number: trimmedOrNull(payment.bankAccountNumber),
        reference_no: trimmedOrNull(payment.referenceNo),
        instrument_date: instrumentDate(payment.instrumentDate),
    };
}
