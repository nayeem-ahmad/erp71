import { nextSerialInSeries } from '../common/credit-payment-entry.util';

export const SUPPLIER_PAYMENT_PREFIXES = {
    PAYMENT: 'SPY-',
    PAYOUT: 'SPO-',
} as const;

/**
 * Allocates the next `SupplierCreditTransaction.payment_number`.
 *
 * Extracted out of `SuppliersService` because a purchase entry can now settle
 * its own bill at the counter, which writes a PAYMENT row from
 * `PurchasesService` instead. `payment_number` is `@@unique([tenant_id,
 * payment_number])`, so two generators drifting apart would not produce two
 * numbering schemes — it would produce a constraint violation at the till.
 * The series steps over hand-typed serials; see `nextSerialInSeries`.
 */
export async function nextSupplierPaymentNumber(
    tenantId: string,
    tx: any,
    txType: keyof typeof SUPPLIER_PAYMENT_PREFIXES,
): Promise<string> {
    return nextSerialInSeries(tx, 'SupplierCreditTransaction', tenantId, SUPPLIER_PAYMENT_PREFIXES[txType]);
}
