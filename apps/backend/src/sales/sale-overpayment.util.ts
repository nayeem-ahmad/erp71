import { classifyPaymentMode } from './classify-payment-mode';

/** Money is kept to the paisa; float differences of two amounts are not. */
const toPaisa = (value: number) => Math.round(value * 100) / 100;

/** Amounts below this are rounding dust, not money. Matches customer-credit.utils. */
const AMOUNT_EPSILON = 0.005;

/**
 * Where the money paid beyond a sale's total goes.
 *
 * With a customer on the sale it is a payment on their account: it settles what
 * they already owed, and whatever is left over after that is held as an
 * advance (their due goes negative). Nothing about it is refused — the screen
 * warns when it runs past the previous due, and the shop decides.
 *
 * With nobody to hold it — a walk-in, or a till that says it handed the excess
 * back — it is change, which never reaches the books.
 */
export function splitSaleOverpayment(input: {
    total: number;
    amountPaid: number;
    hasCustomer: boolean;
    returnChange?: boolean;
}): { excess: number; changeReturned: number; accountPayment: number } {
    const excess = input.amountPaid - input.total > AMOUNT_EPSILON
        ? toPaisa(input.amountPaid - input.total)
        : 0;
    const isChange = !input.hasCustomer || !!input.returnChange;
    return {
        excess,
        changeReturned: isChange ? excess : 0,
        accountPayment: isChange ? 0 : excess,
    };
}

/**
 * The tenders with the change handed back taken off them, so the payment rows
 * say what the shop kept rather than what crossed the counter: the cashier
 * session counts its expected cash from them, and the payment-method report
 * sums them as revenue.
 *
 * Change comes out of cash first, since that is what it is given in. Only when
 * the cash taken is not enough to cover it — a card swiped for more than the
 * bill — does it come off the other tenders, last one first. A tender taken
 * down to nothing is dropped.
 */
export function netOfChange<T extends { paymentMethod: string; amount: number }>(
    payments: T[] | undefined,
    change: number,
): T[] | undefined {
    if (!payments || change <= AMOUNT_EPSILON) return payments;

    const next = payments.map((payment) => ({ ...payment }));
    let left = change;
    const order = [
        ...next.filter((p) => classifyPaymentMode(p.paymentMethod) === 'cash'),
        ...next.filter((p) => classifyPaymentMode(p.paymentMethod) !== 'cash').reverse(),
    ];
    for (const payment of order) {
        if (left <= AMOUNT_EPSILON) break;
        const taken = Math.min(payment.amount, left);
        payment.amount = toPaisa(payment.amount - taken);
        left = toPaisa(left - taken);
    }

    return next.filter((payment) => payment.amount > AMOUNT_EPSILON);
}
