import { classifyPaymentMode } from '../sales/classify-payment-mode';

/**
 * How much of a sales return left the cash drawer.
 *
 * A return saved with its refund tenders (`tenders_recorded`) paid only its cash
 * tenders out of the till: bKash, bank and card refunds settle elsewhere, and
 * the part adjusted against the customer's due is never paid at all. A legacy
 * return has no tenders and was always settled in cash, so its whole total
 * counts. Each tender is classified by its canonical `payment_method` (the same
 * rule the cashier session uses for sales), never by the method's display name.
 */
export function returnCashOut(ret: {
  total_refund: unknown;
  tenders_recorded: boolean;
  payments: { payment_method: string; amount: unknown }[];
}): number {
  if (!ret.tenders_recorded) {
    return Number(ret.total_refund ?? 0);
  }
  return (ret.payments ?? [])
    .filter((p) => classifyPaymentMode(p.payment_method) === 'cash')
    .reduce((sum, p) => sum + Number(p.amount ?? 0), 0);
}
