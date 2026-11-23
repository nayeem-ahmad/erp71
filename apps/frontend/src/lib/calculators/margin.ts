import { round2 } from './money';

export interface MarginResult {
    /** The selling price before VAT — what the shop keeps of the price. */
    netPrice: number;
    /** The price on the shelf: with VAT when VAT is on. */
    shelfPrice: number;
    profit: number;
    /** Profit as a share of the net price. */
    marginPct: number;
    /** Profit as a share of the cost. */
    markupPct: number;
}

function result(cost: number, netPrice: number, vatRate: number): MarginResult {
    const profit = netPrice - cost;
    return {
        netPrice: round2(netPrice),
        shelfPrice: round2(netPrice * (1 + Math.max(0, vatRate) / 100)),
        profit: round2(profit),
        marginPct: netPrice > 0 ? round2((profit / netPrice) * 100) : 0,
        markupPct: cost > 0 ? round2((profit / cost) * 100) : 0,
    };
}

/**
 * What a cost and a shelf price leave. With `priceIncludesVat` the VAT is
 * taken out of the price first — the mistake this calculator exists to stop
 * is counting the government's 15% as profit.
 */
export function analysePrice(cost: number, price: number, vatRate: number, priceIncludesVat: boolean): MarginResult {
    const netPrice = priceIncludesVat ? price / (1 + Math.max(0, vatRate) / 100) : price;
    return result(cost, netPrice, vatRate);
}

/** The price that earns a margin (share of the selling price). Null at 100% or more: no price does. */
export function priceForMargin(cost: number, marginPct: number, vatRate: number): MarginResult | null {
    if (marginPct >= 100) return null;
    return result(cost, cost / (1 - marginPct / 100), vatRate);
}

/** The price that earns a markup (share of the cost). */
export function priceForMarkup(cost: number, markupPct: number, vatRate: number): MarginResult {
    return result(cost, cost * (1 + markupPct / 100), vatRate);
}
