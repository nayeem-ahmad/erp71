/**
 * Spreading document-level charges across the lines they belong to.
 *
 * The problem this exists to solve: `Purchase.freight_amount` was captured on
 * the bill, folded into `total_amount`, and then dropped — the receipt passed
 * the raw line cost to `applyInventoryMovement`, so freight never reached
 * `ProductCost.avg_cost`. Every product bought with freight was costed low and
 * its gross margin overstated by the freight share, silently: the purchase
 * total was right and nothing errored.
 *
 * On an LC import the same gap is not a rounding error. Duty, VAT, AIT, C&F
 * agent, port and inland transport routinely add 30–60% to the invoice value,
 * and a landed cost that ignores them is not an approximation of the truth.
 *
 * Deliberately pure — no Prisma, no tenant, no IO. The allocation rules are
 * arithmetic with edge cases worth pinning in tests, and mixing them with the
 * transaction that writes the result makes both harder to reason about.
 */

/** How a charge is spread over the lines. */
export const AllocationBasis = {
    /** Pro-rata on line value. The default, and right for duty and insurance. */
    VALUE: 'VALUE',
    /** Equal per unit. Right for a per-piece inspection or marking fee. */
    QTY: 'QTY',
    /** Pro-rata on weight. Right for sea and air freight. */
    WEIGHT: 'WEIGHT',
    /** Pro-rata on volume. Right for LCL freight, which is billed on CBM. */
    CBM: 'CBM',
} as const;

export type AllocationBasis = (typeof AllocationBasis)[keyof typeof AllocationBasis];

export type LandedCostLine = {
    /** Opaque to this module; echoed back so the caller can match results up. */
    key: string;
    quantity: number;
    /** Line value before any charge, in the currency the result is expressed in. */
    baseAmount: number;
    /** Per-unit figures. Absent is not zero — see the fallback rule below. */
    weightPerUnit?: number | null;
    cbmPerUnit?: number | null;
};

export type LandedCharge = {
    /** Free-form; carried into the result so a cost sheet can name each row. */
    label?: string;
    amount: number;
    basis?: AllocationBasis;
};

export type LandedCostResult = {
    key: string;
    quantity: number;
    baseAmount: number;
    /** Charges allocated to this line. Sums exactly to the charge total. */
    allocatedAmount: number;
    /** baseAmount + allocatedAmount. */
    landedAmount: number;
    /**
     * What to stamp on the inventory movement. Four decimals, matching
     * `ProductCost.avg_cost`: rounding to paisa per unit and multiplying back
     * up is how a 3-paisa-per-unit error becomes a 300-taka error on a
     * 10,000-piece receipt.
     */
    landedUnitCost: number;
};

const round = (value: number, dp: number) => {
    const factor = 10 ** dp;
    // +Number.EPSILON nudges the classic 1.005 case off the binary boundary
    // that would otherwise round it down.
    return Math.round((value + Number.EPSILON) * factor) / factor;
};

/**
 * The weight each line carries for one basis.
 *
 * Returns null when the basis cannot be applied — every weight is zero, or a
 * line is missing the figure the basis needs. A missing weight is not a zero
 * weight: treating it as one would allocate the whole freight bill to the lines
 * that happen to have been measured, which is worse than falling back to value.
 */
function weightsFor(lines: LandedCostLine[], basis: AllocationBasis): number[] | null {
    const pick = (line: LandedCostLine): number | null => {
        switch (basis) {
            case AllocationBasis.QTY:
                return line.quantity;
            case AllocationBasis.WEIGHT:
                return line.weightPerUnit == null ? null : line.weightPerUnit * line.quantity;
            case AllocationBasis.CBM:
                return line.cbmPerUnit == null ? null : line.cbmPerUnit * line.quantity;
            case AllocationBasis.VALUE:
            default:
                return line.baseAmount;
        }
    };

    const weights: number[] = [];
    for (const line of lines) {
        const value = pick(line);
        if (value == null) return null;
        weights.push(value);
    }

    const total = weights.reduce((sum, value) => sum + value, 0);
    // A zero total would divide by zero. Also catches an all-free sample
    // shipment allocated on VALUE.
    return total > 0 ? weights : null;
}

/**
 * Allocates `charges` across `lines` and returns the landed cost of each.
 *
 * Guarantees, all pinned in the spec:
 *
 * - **Allocated amounts sum exactly to the charge total.** Each charge is
 *   spread by weight and the largest-weighted line absorbs the remainder, so
 *   the receipt's inventory debit balances its goods-in-transit credit to the
 *   paisa. Rounding each line independently leaks money on every receipt.
 * - **An inapplicable basis falls back to VALUE**, and VALUE falling back
 *   (every line free) spreads equally by quantity. A charge is never silently
 *   dropped.
 * - **Zero and negative charges are handled.** A negative charge is a credit
 *   note against the shipment and allocates the same way.
 */
export function allocateLandedCost(params: {
    lines: LandedCostLine[];
    charges: LandedCharge[];
}): { lines: LandedCostResult[]; totalCharges: number } {
    const { lines, charges } = params;

    if (lines.length === 0) {
        return { lines: [], totalCharges: 0 };
    }

    const allocated = new Array<number>(lines.length).fill(0);
    let totalCharges = 0;

    for (const charge of charges) {
        const amount = Number(charge.amount) || 0;
        if (amount === 0) continue;
        totalCharges += amount;

        const basis = charge.basis ?? AllocationBasis.VALUE;
        const weights =
            weightsFor(lines, basis) ??
            weightsFor(lines, AllocationBasis.VALUE) ??
            // Last resort: every line has zero value and zero weight. Quantity
            // is the only dimension left, and a line always has one.
            weightsFor(lines, AllocationBasis.QTY) ??
            lines.map(() => 1);

        const totalWeight = weights.reduce((sum, value) => sum + value, 0);

        // The line that absorbs the rounding remainder is the largest-weighted
        // one, not the last: on the last line a repeated remainder is visible
        // as a suspiciously odd figure on whatever happened to be typed in
        // last, whereas on the largest line it is lost in the noise it came
        // from.
        let absorbIndex = 0;
        for (let i = 1; i < weights.length; i++) {
            if (weights[i] > weights[absorbIndex]) absorbIndex = i;
        }

        let distributed = 0;
        for (let i = 0; i < lines.length; i++) {
            if (i === absorbIndex) continue;
            const share = round((amount * weights[i]) / totalWeight, 2);
            allocated[i] += share;
            distributed += share;
        }
        allocated[absorbIndex] += round(amount - distributed, 2);
    }

    return {
        totalCharges: round(totalCharges, 2),
        lines: lines.map((line, index) => {
            const allocatedAmount = round(allocated[index], 2);
            const landedAmount = round(line.baseAmount + allocatedAmount, 2);
            return {
                key: line.key,
                quantity: line.quantity,
                baseAmount: line.baseAmount,
                allocatedAmount,
                landedAmount,
                // A zero-quantity line cannot have a per-unit cost. Returning 0
                // rather than NaN keeps it out of the cost pool without
                // poisoning arithmetic downstream.
                landedUnitCost: line.quantity === 0 ? 0 : round(landedAmount / line.quantity, 4),
            };
        }),
    };
}
