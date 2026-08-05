/**
 * Splits one month's profit across the investors entitled to a share.
 *
 * Pure and side-effect free so the two rules that are easy to get wrong — the
 * rounding residual and the loss carry-forward — can be tested without a
 * database. See investors.service.ts for how the result is persisted and posted.
 */

export interface AllocationInvestor {
    investorId: string;
    /** Agreed share of profit, in percent. */
    sharePct: number;
    /** Unrecovered losses from earlier months, as a positive number. */
    lossCarryForward: number;
}

export interface AllocationLine {
    investorId: string;
    sharePct: number;
    /** This investor's slice of the month's profit. Negative in a loss month. */
    grossShare: number;
    /** Cash accrued for this run — never negative. */
    amount: number;
    /**
     * Movement in the carry-forward: positive when a loss month adds to it,
     * negative when a profitable month pays it down.
     */
    lossApplied: number;
    lossCarryForwardAfter: number;
}

export const roundAmount = (value: number) => {
    const rounded = Math.round(value * 100) / 100;
    // Negating a zero share yields -0, which survives JSON and renders as "-0"
    // on the run sheet. Collapse it.
    return rounded === 0 ? 0 : rounded;
};

/**
 * Rounding residual goes to the largest slice.
 *
 * Three investors on 33.33% each of 1,000.00 round to 333.30 apiece, leaving
 * 0.10 of the 999.90 entitlement unallocated. Dropping it would leave the
 * accrual vouchers a few paisa short of the declared total every month, and the
 * gap compounds across runs. Giving it to the biggest slice keeps the sum exact
 * and puts the sub-paisa noise where it is proportionally smallest.
 */
function allocateGross(profit: number, investors: AllocationInvestor[]): number[] {
    if (investors.length === 0) return [];

    const totalPct = investors.reduce((sum, investor) => sum + investor.sharePct, 0);
    const entitlement = roundAmount((profit * totalPct) / 100);
    const shares = investors.map((investor) => roundAmount((profit * investor.sharePct) / 100));

    const residual = roundAmount(entitlement - shares.reduce((sum, share) => sum + share, 0));
    if (residual !== 0) {
        let largest = 0;
        for (let i = 1; i < investors.length; i += 1) {
            if (investors[i].sharePct > investors[largest].sharePct) largest = i;
        }
        shares[largest] = roundAmount(shares[largest] + residual);
    }

    return shares;
}

/**
 * A loss month accrues nothing and banks each investor's slice of the loss
 * against their future shares — investors are never invoiced for a loss. The
 * next profitable month pays that balance down before any cash is declared.
 */
export function allocateProfit(profit: number, investors: AllocationInvestor[]): AllocationLine[] {
    const gross = allocateGross(profit, investors);

    return investors.map((investor, index) => {
        const grossShare = gross[index];

        if (grossShare <= 0) {
            const lossApplied = roundAmount(-grossShare);
            return {
                investorId: investor.investorId,
                sharePct: investor.sharePct,
                grossShare,
                amount: 0,
                lossApplied,
                lossCarryForwardAfter: roundAmount(investor.lossCarryForward + lossApplied),
            };
        }

        const offset = Math.min(investor.lossCarryForward, grossShare);
        return {
            investorId: investor.investorId,
            sharePct: investor.sharePct,
            grossShare,
            amount: roundAmount(grossShare - offset),
            lossApplied: roundAmount(-offset),
            lossCarryForwardAfter: roundAmount(investor.lossCarryForward - offset),
        };
    });
}

/** UTC month bounds, matching how the accounting reports read `from`/`to`. */
export function monthBounds(year: number, month: number): { from: string; to: string; end: Date } {
    const start = new Date(Date.UTC(year, month - 1, 1));
    // Day 0 of the next month is the last day of this one.
    const end = new Date(Date.UTC(year, month, 0));
    return {
        from: start.toISOString().slice(0, 10),
        to: end.toISOString().slice(0, 10),
        end,
    };
}
