/**
 * Monthly activity buckets for the referral partner portal's charts.
 *
 * Kept free of Prisma and Nest on purpose: the date-boundary rules are the part
 * that is easy to get subtly wrong, and they are worth testing without a mocked
 * database in the way.
 *
 * Buckets use the server's local timezone, matching the rest of the platform's
 * date handling.
 */

export const ACTIVITY_MONTHS = 12;

export type ReferralActivityPoint = {
    /** 'YYYY-MM' */
    month: string;
    clicks: number;
    signups: number;
    /** BDT commission that became earned in this month. */
    earned_amount: number;
    /** BDT actually paid out in this month. */
    paid_amount: number;
};

export type ActivityInput = {
    clicks: Array<{ occurred_at: Date }>;
    signups: Array<{
        signed_up_at: Date;
        earned_at: Date | null;
        status: string;
        commission_amount: unknown;
    }>;
    payments: Array<{ paid_at: Date; amount: unknown }>;
};

/** Money is stored to two decimals; float sums drift without this. */
function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

function monthKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * First day of the earliest bucket, at midnight. `getLedger` uses this to bound
 * the click query rather than fetching a partner's entire click history.
 */
export function activityWindowStart(now: Date): Date {
    return new Date(now.getFullYear(), now.getMonth() - (ACTIVITY_MONTHS - 1), 1, 0, 0, 0, 0);
}

export function buildActivity(input: ActivityInput, now: Date): ReferralActivityPoint[] {
    const buckets = new Map<string, ReferralActivityPoint>();

    for (let offset = ACTIVITY_MONTHS - 1; offset >= 0; offset -= 1) {
        const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
        const month = monthKey(date);
        buckets.set(month, { month, clicks: 0, signups: 0, earned_amount: 0, paid_amount: 0 });
    }

    const add = (date: Date | null, apply: (point: ReferralActivityPoint) => void) => {
        if (!date) return;
        const point = buckets.get(monthKey(date));
        // Rows outside the window are dropped, not folded into the first bucket —
        // an old click is not September's traffic.
        if (point) apply(point);
    };

    for (const click of input.clicks) {
        add(click.occurred_at, (point) => { point.clicks += 1; });
    }

    for (const signup of input.signups) {
        add(signup.signed_up_at, (point) => { point.signups += 1; });

        // REVERSED is excluded deliberately, matching getLedger's total_earned_amount:
        // a clawed-back commission was never earned.
        if (signup.status === 'EARNED' || signup.status === 'PAID') {
            add(signup.earned_at, (point) => {
                point.earned_amount += Number(signup.commission_amount ?? 0);
            });
        }
    }

    for (const payment of input.payments) {
        add(payment.paid_at, (point) => { point.paid_amount += Number(payment.amount ?? 0); });
    }

    return [...buckets.values()].map((point) => ({
        ...point,
        earned_amount: round2(point.earned_amount),
        paid_amount: round2(point.paid_amount),
    }));
}
