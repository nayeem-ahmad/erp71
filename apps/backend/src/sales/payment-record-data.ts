import { CreatePaymentDto, UpdatePaymentDto } from './sale.dto';

/** What a payment body becomes on its way into a `PaymentRecord` row. */
export interface PaymentRecordData {
    payment_method: string;
    amount: number;
    account_id: string | null;
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
 * Maps a payment from either sale body onto the row it is stored as. One place,
 * because a sale writes its payments from four directions — posted, parked as a
 * draft, finalized out of one, and edited afterwards — and a field added in
 * three of them is a field the fourth silently drops.
 */
export function paymentRecordData(payment: CreatePaymentDto | UpdatePaymentDto): PaymentRecordData {
    return {
        payment_method: payment.paymentMethod,
        amount: payment.amount,
        account_id: payment.accountId || null,
        bank_name: trimmedOrNull(payment.bankName),
        bank_branch: trimmedOrNull(payment.bankBranch),
        bank_account_number: trimmedOrNull(payment.bankAccountNumber),
        reference_no: trimmedOrNull(payment.referenceNo),
        instrument_date: instrumentDate(payment.instrumentDate),
    };
}
