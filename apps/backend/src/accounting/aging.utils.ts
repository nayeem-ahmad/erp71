/**
 * The one FIFO ager behind every aging report in the system.
 *
 * An aging report answers "of what is STILL OWED, how old is it". Every ager
 * here got that wrong in the same way: each bucketed the charges and never
 * applied the receipts, so a customer who bought on credit all year and paid
 * every taka of it still showed the whole year's sales as outstanding. Summing
 * charges is not aging — it is a sales report with date columns.
 *
 * The fix is the oldest-first rule every accountant already applies by hand: a
 * receipt settles the oldest open charge, then the next, and only what survives
 * that is aged. Nothing here knows about customers, vouchers or the GL — it
 * takes signed deltas on dates and hands back buckets, so the AR ledger report,
 * the GL-derived AR aging and the AP aging can share it rather than drift into
 * three subtly different answers to the same question.
 *
 * Invoice due dates are not modelled anywhere in this product, so age is
 * measured from the date of the charge rather than from when it fell due. That
 * is the same basis the reports have always used and is what their "aging is
 * based on voucher date" note describes.
 */

/** Amounts below this are rounding dust, not money. Matches customer-credit.utils. */
const EPSILON = 0.005;

export interface AgingEntry {
    /** When this charge or settlement happened. */
    date: Date;
    /**
     * Signed effect on the balance being aged, in the balance's own direction.
     * Positive RAISES what is owed (a credit sale, a bill, a payout to the
     * customer); negative SETTLES it (a receipt, a return, a write-off).
     *
     * Callers pass the sign, because only they know which side of their own
     * account is the increase — a receivable grows on the debit, a payable on
     * the credit.
     */
    delta: number;
}

export interface AgingBuckets {
    /** 0–30 days: not yet old enough to chase. */
    current: number;
    overdue_31_60: number;
    overdue_61_90: number;
    overdue_90_plus: number;
}

export interface AgedBalance {
    buckets: AgingBuckets;
    /**
     * Σ buckets — what is still open after every settlement has been applied.
     * Never negative: a party who has paid more than they owe is owed money,
     * which is not an age, so it comes back as `unapplied_credit` instead.
     */
    outstanding: number;
    /**
     * Settlements that outlived every open charge — the party is in credit by
     * this much (an advance, an overpayment, a return bigger than the due).
     * Reported rather than netted into the buckets so an aging report can never
     * quietly show a negative age band.
     */
    unapplied_credit: number;
}

export function emptyAgingBuckets(): AgingBuckets {
    return { current: 0, overdue_31_60: 0, overdue_61_90: 0, overdue_90_plus: 0 };
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

/**
 * Buckets an amount by how many days old its charge is, using the boundaries
 * every aging surface in this product already shows: 0–30, 31–60, 61–90, 90+.
 */
export function addToAgingBucket(buckets: AgingBuckets, ageDays: number, amount: number): void {
    if (ageDays <= 30) buckets.current += amount;
    else if (ageDays <= 60) buckets.overdue_31_60 += amount;
    else if (ageDays <= 90) buckets.overdue_61_90 += amount;
    else buckets.overdue_90_plus += amount;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Applies every settlement to the oldest open charge first, then ages whatever
 * is left by the date of the charge it belongs to.
 *
 * Entries may arrive in any order — they are sorted by date here, so a caller
 * that merges charges and receipts from two queries does not have to.
 */
export function ageBalance(entries: AgingEntry[], asOf: Date): AgedBalance {
    const ordered = [...entries].sort((a, b) => a.date.getTime() - b.date.getTime());

    /** Open charges, oldest first — the queue a receipt eats from the front of. */
    const open: Array<{ dateMs: number; remaining: number }> = [];
    /** Credit received before the charge it pays for; offsets the next one. */
    let unapplied = 0;

    for (const entry of ordered) {
        if (entry.delta > EPSILON) {
            // A charge. Anything the party had already overpaid comes off it
            // first, which is what makes an advance settle the next invoice.
            let charge = entry.delta;
            const offset = Math.min(unapplied, charge);
            unapplied -= offset;
            charge -= offset;
            if (charge > EPSILON) open.push({ dateMs: entry.date.getTime(), remaining: charge });
            continue;
        }

        if (entry.delta < -EPSILON) {
            let credit = -entry.delta;
            while (credit > EPSILON && open.length > 0) {
                const oldest = open[0];
                const applied = Math.min(oldest.remaining, credit);
                oldest.remaining -= applied;
                credit -= applied;
                if (oldest.remaining <= EPSILON) open.shift();
            }
            // Outlived every open charge: the party is in credit from here.
            if (credit > EPSILON) unapplied += credit;
        }
    }

    const buckets = emptyAgingBuckets();
    const asOfMs = asOf.getTime();
    for (const charge of open) {
        const ageDays = Math.floor((asOfMs - charge.dateMs) / DAY_MS);
        addToAgingBucket(buckets, ageDays, charge.remaining);
    }

    buckets.current = round2(buckets.current);
    buckets.overdue_31_60 = round2(buckets.overdue_31_60);
    buckets.overdue_61_90 = round2(buckets.overdue_61_90);
    buckets.overdue_90_plus = round2(buckets.overdue_90_plus);

    return {
        buckets,
        outstanding: round2(
            buckets.current + buckets.overdue_31_60 + buckets.overdue_61_90 + buckets.overdue_90_plus,
        ),
        unapplied_credit: round2(unapplied),
    };
}
