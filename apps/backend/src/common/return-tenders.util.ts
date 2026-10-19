import type { Prisma } from '@prisma/client';
import {
    resolveTenders,
    storedToTenderInputs,
    type ResolvedTender,
    type StoredTender,
} from '../accounting/payment-account.util';
import { paymentInstrumentData, type PaymentInstrumentColumns } from './payment-instrument.util';
import type { ReturnPaymentDto } from './return-payment.dto';

/**
 * The tenders money moved by on a return — what a sales return refunded, or
 * what a purchase return got back from the supplier. `SalesReturnPayment` and
 * `PurchaseReturnPayment` have the same columns, so both services resolve,
 * compare and save them through these.
 */

/** Below half a paisa two amounts are the same money. */
const EPSILON = 0.005;

/** A return tender as resolved, with the instrument details its row stores. */
export type ReturnTender = ResolvedTender & { instrument: PaymentInstrumentColumns };

/** A saved return payment row, as an edit reads it back. */
export type StoredReturnPayment = StoredTender & PaymentInstrumentColumns;

/** The return payment row a resolved tender is saved as. */
export function returnPaymentRow(returnId: string, tender: ReturnTender) {
    return {
        return_id: returnId,
        payment_method: tender.paymentMethod,
        payment_method_id: tender.methodId,
        payment_method_name: tender.methodName,
        account_id: tender.accountId,
        amount: tender.amount,
        ...tender.instrument,
    };
}

/**
 * Whether the saved rows already say exactly what `tenders` would write, in
 * the same order — method, amount and every instrument detail. Used once the
 * tenders are known to be the same money, to tell a cheque number corrected
 * from nothing changed at all.
 */
export function sameReturnPaymentRows(rows: StoredReturnPayment[], tenders: ReturnTender[]): boolean {
    const time = (date: Date | null) => date?.getTime() ?? null;
    return rows.length === tenders.length && rows.every((row, index) => {
        const tender = tenders[index];
        return row.payment_method === tender.paymentMethod
            && row.payment_method_id === tender.methodId
            && Math.abs(Number(row.amount) - tender.amount) <= EPSILON
            && row.bank_name === tender.instrument.bank_name
            && row.bank_branch === tender.instrument.bank_branch
            && row.bank_account_number === tender.instrument.bank_account_number
            && row.reference_no === tender.instrument.reference_no
            && time(row.instrument_date) === time(tender.instrument.instrument_date);
    });
}

/**
 * The client's return tenders, resolved at `storeId` (see `resolveTenders`):
 * each one's method, name, linked account and posting mode. `stored` is the
 * return's saved tenders on an edit, so the ones it already carries keep what
 * they were saved with.
 */
export async function resolveReturnTenders(
    tx: Prisma.TransactionClient,
    tenantId: string,
    storeId: string,
    payments: ReturnPaymentDto[],
    stored: StoredTender[] = [],
): Promise<ReturnTender[]> {
    const resolved = await resolveTenders(
        tx,
        tenantId,
        storeId,
        payments.map((payment) => ({
            paymentMethod: payment.paymentMethod,
            paymentMethodId: payment.paymentMethodId,
            amount: payment.amount,
        })),
        stored,
    );
    return resolved.map((tender, index) => ({ ...tender, instrument: paymentInstrumentData(payments[index]) }));
}

/**
 * A return's saved tenders, for an edit that sent none: each keeps its
 * method, name, account and instrument details.
 */
export async function resolveStoredReturnTenders(
    tx: Prisma.TransactionClient,
    tenantId: string,
    storeId: string,
    rows: StoredReturnPayment[],
): Promise<ReturnTender[]> {
    const resolved = await resolveTenders(tx, tenantId, storeId, storedToTenderInputs(rows), rows);
    return resolved.map((tender, index) => ({
        ...tender,
        instrument: {
            bank_name: rows[index].bank_name,
            bank_branch: rows[index].bank_branch,
            bank_account_number: rows[index].bank_account_number,
            reference_no: rows[index].reference_no,
            instrument_date: rows[index].instrument_date,
        },
    }));
}
