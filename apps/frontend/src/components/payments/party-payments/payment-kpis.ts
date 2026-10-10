import type { MoneyFlow, PartyPayment } from './types';

export interface PaymentKpis {
    inTotal: number;
    inCount: number;
    outTotal: number;
    outCount: number;
    /** Discounts settled with primary-direction payments. */
    discountTotal: number;
    discountCount: number;
    /** In minus out for customers (collected), out minus in for suppliers (paid). */
    net: number;
    /** The primary direction by method, largest first; `null` is a payment saved without one. */
    byMethod: { name: string | null; amount: number }[];
}

function money(value: string | number | undefined | null): number {
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? n : 0;
}

/** Rounds to the paisa so a sum of decimals never carries float dust. */
function paisa(value: number): number {
    return Math.round(value * 100) / 100;
}

/**
 * The period's totals for the KPI strip. Kept apart from the netted figure the
 * page used to show alone, which read a week of refunds as a week of income.
 */
export function computePaymentKpis(
    payments: PartyPayment[],
    directionOf: (payment: PartyPayment) => MoneyFlow,
    primary: MoneyFlow,
): PaymentKpis {
    let inTotal = 0;
    let inCount = 0;
    let outTotal = 0;
    let outCount = 0;
    let discountTotal = 0;
    let discountCount = 0;
    const methods = new Map<string | null, number>();

    for (const payment of payments) {
        const flow = directionOf(payment);
        const amount = money(payment.amount);
        if (flow === 'receive') {
            inTotal += amount;
            inCount += 1;
        } else {
            outTotal += amount;
            outCount += 1;
        }
        if (flow !== primary) continue;

        const discount = money(payment.discount_amount);
        if (discount > 0) {
            discountTotal += discount;
            discountCount += 1;
        }
        const method = payment.payment_method_name || null;
        methods.set(method, (methods.get(method) ?? 0) + amount);
    }

    const byMethod = [...methods.entries()]
        .map(([name, amount]) => ({ name, amount: paisa(amount) }))
        .filter((entry) => entry.amount > 0)
        .sort((a, b) => b.amount - a.amount);

    return {
        inTotal: paisa(inTotal),
        inCount,
        outTotal: paisa(outTotal),
        outCount,
        discountTotal: paisa(discountTotal),
        discountCount,
        net: paisa(primary === 'receive' ? inTotal - outTotal : outTotal - inTotal),
        byMethod,
    };
}
