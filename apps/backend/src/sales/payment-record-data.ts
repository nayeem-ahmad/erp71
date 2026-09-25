import { paymentInstrumentData, type PaymentInstrumentColumns } from '../common/payment-instrument.util';
import { CreatePaymentDto, UpdatePaymentDto } from './sale.dto';

/** What a payment body becomes on its way into a `PaymentRecord` row. */
export interface PaymentRecordData extends PaymentInstrumentColumns {
    payment_method: string;
    amount: number;
    account_id: string | null;
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
        ...paymentInstrumentData(payment),
    };
}
