/**
 * The arithmetic behind every gross-profit figure this system reports.
 *
 * Kept as pure functions with no database in sight, because three separate bugs
 * lived in the hand-rolled versions these replace and each was invisible until
 * someone reconciled a report against the till:
 *
 *   1. A line with no cost basis was folded in as `cost: 0`, so uncosted stock
 *      reported a 100% margin and dragged every total up with it.
 *   2. An invoice-level discount reduced `Sale.total_amount` but never reached
 *      `price_at_sale`, so line-level revenue exceeded what was actually
 *      charged — overstating margin on exactly the discounted sales anyone
 *      would want to examine.
 *   3. A return reduced revenue while leaving COGS untouched, so every refund
 *      overstated gross profit by the whole cost of the goods coming back.
 *
 * The model that fixes all three: reduce every revenue-bearing event — sale
 * line or return line — to a signed `MarginLine`, then sum. A return is a
 * negative line, so it needs no special case anywhere downstream.
 */

/**
 * One revenue-bearing line, with the invoice-level discount already spread over
 * it. Negative on both sides for a return.
 */
export interface MarginLine {
    /** Grouping key the caller cares about — product, customer, category, cashier. */
    key: string;
    label: string;
    quantity: number;
    /**
     * Revenue actually charged for this line: list value scaled by the invoice's
     * discount, so the lines of a sale sum to what the customer paid.
     */
    revenue: number;
    /**
     * Cost of the goods on this line, or null when nothing has ever priced
     * them. Null is not zero, and the distinction is the whole point — see
     * `summariseMargin`.
     */
    cost: number | null;
}

/** A sale as the reports read it, with only the fields costing cares about. */
export interface SaleForMargin {
    id: string;
    /** What the customer was actually charged, after discount and loyalty. */
    totalAmount: number;
    items: Array<{
        productId: string;
        quantity: number;
        priceAtSale: number;
        unitCostAtSale: number | null;
    }>;
}

/** A return as the reports read it. */
export interface ReturnForMargin {
    id: string;
    items: Array<{
        productId: string;
        quantity: number;
        refundAmount: number;
        unitCostAtReturn: number | null;
    }>;
}

/**
 * How much of a report's revenue actually has a cost behind it.
 *
 * Reported alongside every margin so a reader can tell "we made 22%" from "we
 * made 22% on the third of the basket anyone has priced". Without it a thin
 * coverage ratio is indistinguishable from a thin margin.
 */
export interface MarginCoverage {
    costedLines: number;
    uncostedLines: number;
    /** Revenue on lines that have a cost — the base the margin is computed over. */
    costedRevenue: number;
    /** Revenue on lines that do not. Real revenue; simply not attributable. */
    uncostedRevenue: number;
    /** costedRevenue / (costedRevenue + uncostedRevenue), or null with no revenue at all. */
    costedRevenuePct: number | null;
}

export interface MarginTotals {
    /** All revenue, costed or not, net of returns. The true top line. */
    netRevenue: number;
    /** Cost of the goods on costed lines, net of returned cost. */
    cogs: number;
    /**
     * Costed revenue less its cost. Null when nothing in range has a cost
     * basis — with no basis there is no margin to state, and zero would read as
     * "we broke even" rather than "we cannot say".
     */
    grossProfit: number | null;
    /** Margin over *costed* revenue, not over netRevenue. Null on no basis. */
    grossMarginPct: number | null;
    coverage: MarginCoverage;
}

/**
 * Two decimal places. Money in, money out; the pool keeps the extra precision.
 *
 * `+ 0` collapses negative zero, which `-units * 0` produces whenever an effect
 * cancels exactly. It compares equal to 0 but renders as "-0", and a bridge
 * chart reading "-0" beside a real figure looks like a defect.
 */
function money(value: number): number {
    return Math.round(value * 100) / 100 + 0;
}

/**
 * Spread an invoice-level discount across a sale's lines, in proportion to what
 * each line contributes to the list total.
 *
 * `Sale.total_amount` is what the customer paid — order discount and loyalty
 * redemption already taken off — while `price_at_sale` stays at list price. So
 * Σ(qty × price) is larger than the invoice, and any report summing lines
 * overstates revenue on every discounted sale. Scaling each line by
 * `totalAmount / listTotal` makes the lines reconcile to the invoice.
 *
 * Returns a ratio of 1 when there is nothing to spread, and when the list total
 * is zero — a giveaway sale has no proportions to divide by, and every line is
 * worth nothing regardless.
 */
export function discountRatio(sale: SaleForMargin): number {
    const listTotal = sale.items.reduce((sum, i) => sum + i.quantity * i.priceAtSale, 0);
    if (listTotal <= 0) {
        return 1;
    }
    return sale.totalAmount / listTotal;
}

/**
 * Turn sales into signed margin lines, keyed and labelled by the caller.
 *
 * `keyOf` decides what the report groups by; everything else here is fixed.
 */
export function saleLines(
    sales: SaleForMargin[],
    keyOf: (item: SaleForMargin['items'][number], sale: SaleForMargin) => { key: string; label: string },
): MarginLine[] {
    const lines: MarginLine[] = [];
    for (const sale of sales) {
        const ratio = discountRatio(sale);
        for (const item of sale.items) {
            const { key, label } = keyOf(item, sale);
            lines.push({
                key,
                label,
                quantity: item.quantity,
                revenue: item.quantity * item.priceAtSale * ratio,
                cost: item.unitCostAtSale === null ? null : item.quantity * item.unitCostAtSale,
            });
        }
    }
    return lines;
}

/**
 * Turn returns into negative margin lines.
 *
 * A refund is already net of whatever discount applied to the original sale —
 * `refund_amount` comes off `price_at_sale` of the line being returned — so
 * unlike a sale it needs no ratio applied.
 */
export function returnLines(
    returns: ReturnForMargin[],
    keyOf: (item: ReturnForMargin['items'][number]) => { key: string; label: string },
): MarginLine[] {
    const lines: MarginLine[] = [];
    for (const ret of returns) {
        for (const item of ret.items) {
            const { key, label } = keyOf(item);
            lines.push({
                key,
                label,
                quantity: -item.quantity,
                revenue: -item.refundAmount,
                cost: item.unitCostAtReturn === null ? null : -(item.quantity * item.unitCostAtReturn),
            });
        }
    }
    return lines;
}

/**
 * Roll lines up into one set of totals.
 *
 * The rule that matters: a line with `cost === null` contributes its revenue to
 * `netRevenue` and to `coverage.uncostedRevenue`, and contributes to *neither*
 * side of the margin. Including its revenue but not its cost is what made
 * uncosted stock look infinitely profitable; excluding it from both keeps the
 * stated margin true of the subset it actually describes.
 */
export function summariseMargin(lines: MarginLine[]): MarginTotals {
    let netRevenue = 0;
    let costedRevenue = 0;
    let uncostedRevenue = 0;
    let cogs = 0;
    let costedLines = 0;
    let uncostedLines = 0;

    for (const line of lines) {
        netRevenue += line.revenue;
        if (line.cost === null) {
            uncostedLines += 1;
            uncostedRevenue += line.revenue;
            continue;
        }
        costedLines += 1;
        costedRevenue += line.revenue;
        cogs += line.cost;
    }

    const hasBasis = costedLines > 0;
    const grossProfit = hasBasis ? costedRevenue - cogs : null;
    const totalRevenue = costedRevenue + uncostedRevenue;

    return {
        netRevenue: money(netRevenue),
        cogs: money(cogs),
        grossProfit: grossProfit === null ? null : money(grossProfit),
        // Over costed revenue, because that is the revenue the cost belongs to.
        // Dividing by netRevenue would quietly dilute the margin by however much
        // uncosted stock happened to sell.
        grossMarginPct:
            grossProfit === null || costedRevenue <= 0 ? null : (grossProfit / costedRevenue) * 100,
        coverage: {
            costedLines,
            uncostedLines,
            costedRevenue: money(costedRevenue),
            uncostedRevenue: money(uncostedRevenue),
            costedRevenuePct: totalRevenue > 0 ? (costedRevenue / totalRevenue) * 100 : null,
        },
    };
}

export interface MarginGroup extends MarginTotals {
    key: string;
    label: string;
    units: number;
}

/**
 * Group lines by their key and summarise each group, sorted by gross profit
 * descending — a group with no basis sorts last, since it makes no claim.
 */
export function groupMargin(lines: MarginLine[]): MarginGroup[] {
    const byKey = new Map<string, MarginLine[]>();
    for (const line of lines) {
        const existing = byKey.get(line.key);
        if (existing) {
            existing.push(line);
        } else {
            byKey.set(line.key, [line]);
        }
    }

    return [...byKey.entries()]
        .map(([key, groupLines]) => ({
            key,
            label: groupLines[0].label,
            units: groupLines.reduce((sum, l) => sum + l.quantity, 0),
            ...summariseMargin(groupLines),
        }))
        .sort((a, b) => (b.grossProfit ?? -Infinity) - (a.grossProfit ?? -Infinity));
}

/**
 * Decompose a change in gross profit between two periods into the four things
 * that can cause it.
 *
 * "Margin fell three points" is not actionable; "margin fell three points
 * because cost rose on the same volume" is. The standard decomposition:
 *
 *   volume — same margin per unit, different number of units
 *   price  — same units and cost, different selling price
 *   cost   — same units and price, different cost
 *   mix    — the residual: which products sold, not how any one of them did
 *
 * Mix is taken as the residual rather than modelled directly, so the four
 * effects always sum exactly to the total change. A separately-computed mix
 * term would leave a rounding gap that readers reasonably treat as a bug.
 */
export interface MarginBridge {
    previousGrossProfit: number;
    currentGrossProfit: number;
    totalChange: number;
    volumeEffect: number;
    priceEffect: number;
    costEffect: number;
    mixEffect: number;
}

export interface BridgeInput {
    units: number;
    revenue: number;
    cogs: number;
}

export function marginBridge(previous: BridgeInput, current: BridgeInput): MarginBridge {
    const prevGp = previous.revenue - previous.cogs;
    const currGp = current.revenue - current.cogs;

    // Per-unit figures are what make the effects separable. With no units in the
    // prior period there is no per-unit baseline to hold constant, so the whole
    // change is volume by construction — a product that did not sell before and
    // sells now grew by appearing, not by repricing.
    if (previous.units <= 0) {
        return {
            previousGrossProfit: money(prevGp),
            currentGrossProfit: money(currGp),
            totalChange: money(currGp - prevGp),
            volumeEffect: money(currGp - prevGp),
            priceEffect: 0,
            costEffect: 0,
            mixEffect: 0,
        };
    }

    const prevPricePerUnit = previous.revenue / previous.units;
    const prevCostPerUnit = previous.cogs / previous.units;
    const currPricePerUnit = current.units > 0 ? current.revenue / current.units : 0;
    const currCostPerUnit = current.units > 0 ? current.cogs / current.units : 0;
    const unitChange = current.units - previous.units;

    // Volume at last period's unit economics: what the extra (or missing) units
    // would have earned if nothing else moved.
    const volumeEffect = unitChange * (prevPricePerUnit - prevCostPerUnit);
    // Price and cost at this period's volume: what the rate changes are worth
    // across everything actually sold.
    const priceEffect = current.units * (currPricePerUnit - prevPricePerUnit);
    // Cost *rising* reduces profit, hence the sign.
    const costEffect = -current.units * (currCostPerUnit - prevCostPerUnit);
    const mixEffect = currGp - prevGp - volumeEffect - priceEffect - costEffect;

    return {
        previousGrossProfit: money(prevGp),
        currentGrossProfit: money(currGp),
        totalChange: money(currGp - prevGp),
        volumeEffect: money(volumeEffect),
        priceEffect: money(priceEffect),
        costEffect: money(costEffect),
        mixEffect: money(mixEffect),
    };
}
