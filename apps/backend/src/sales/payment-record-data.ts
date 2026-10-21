import type { ResolvedTender } from '../accounting/payment-account.util';
import { paymentInstrumentData, type PaymentInstrumentColumns } from '../common/payment-instrument.util';
import { CreatePaymentDto, UpdatePaymentDto } from './sale.dto';

/** What a payment body becomes on its way into a `PaymentRecord` row. */
export interface PaymentRecordData extends PaymentInstrumentColumns {
    payment_method: string;
    payment_method_id: string | null;
    payment_method_name: string | null;
    amount: number;
    account_id: string | null;
}

/**
 * Maps a payment from either sale body onto the row it is stored as. One place,
 * because a sale writes its payments from four directions — posted, parked as a
 * draft, finalized out of one, and edited afterwards — and a field added in
 * three of them is a field the fourth silently drops.
 *
 * The method, its name and the ledger account come from `tender`, the payment
 * as `resolveTenders` resolved it: the account is the one the server worked
 * out, so the client's `accountId` is never stored.
 */
export function paymentRecordData(
    payment: CreatePaymentDto | UpdatePaymentDto,
    tender: ResolvedTender,
): PaymentRecordData {
    return {
        payment_method: payment.paymentMethod,
        payment_method_id: tender.methodId,
        payment_method_name: tender.methodName,
        amount: payment.amount,
        account_id: tender.accountId,
        ...paymentInstrumentData(payment),
    };
}
