import { nextSerialInSeries } from '../common/credit-payment-entry.util';

/**
 * Document-number prefixes per credit-transaction type. A write-off gets its own
 * series rather than sharing the payment one: "CWO-00004" on a customer's
 * statement has to be unmistakably not a receipt, because it is the row that
 * says money stopped being expected rather than that it arrived.
 */
export const CREDIT_TRANSACTION_PREFIXES = {
    PAYMENT: 'CPY-',
    PAYOUT: 'CPO-',
    WRITE_OFF: 'CWO-',
} as const;

/**
 * The legKey of a customer payment's discount voucher. The cash voucher stays
 * keyless, so payments recorded before discounts existed keep their idempotency
 * keys.
 */
export const CUSTOMER_PAYMENT_DISCOUNT_LEG = 'discount';

/**
 * Allocates the next `CustomerCreditTransaction.payment_number`.
 *
 * Extracted out of `CustomersService` because a sale can now take more than its
 * own total — the rest settling what the customer already owed — which writes a
 * PAYMENT row from `SalesService` instead. `payment_number` is
 * `@@unique([tenant_id, payment_number])`, so two generators drifting apart
 * would not produce two numbering schemes — it would produce a constraint
 * violation at the till. The series steps over hand-typed serials; see
 * `nextSerialInSeries`.
 */
export async function nextCustomerCreditNumber(
    tenantId: string,
    tx: any,
    txType: keyof typeof CREDIT_TRANSACTION_PREFIXES,
): Promise<string> {
    return nextSerialInSeries(tx, 'CustomerCreditTransaction', tenantId, CREDIT_TRANSACTION_PREFIXES[txType]);
}
