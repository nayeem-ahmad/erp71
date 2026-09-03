/**
 * "What did this item last go out at, and to whom?" — the shape the sale and
 * purchase entry screens read while the operator is deciding a rate.
 *
 * The row mapping and the summary live here rather than in the service so they
 * can be tested without a database, and so a sale row and a purchase row are
 * demonstrably the same shape on the wire.
 */

export type RateHistoryType = 'sale' | 'purchase';

/** How many rows each section returns when the caller does not say. */
export const RATE_HISTORY_DEFAULT_LIMIT = 5;
export const RATE_HISTORY_MAX_LIMIT = 20;

export interface RateHistoryRow {
    documentId: string;
    documentNumber: string;
    /** ISO timestamp of the sale/purchase, not of the line. */
    date: string;
    /** Null on a walk-in sale or a purchase recorded without a supplier. */
    partyId: string | null;
    partyName: string | null;
    quantity: number;
    rate: number;
    lineTotal: number;
}

export interface RateHistorySummary {
    lastRate: number;
    avgRate: number;
    minRate: number;
    maxRate: number;
}

export interface RateHistory {
    type: RateHistoryType;
    /**
     * The selected customer's / supplier's own last few rates. Empty when no
     * party is selected yet — the screen shows `recent` alone in that case.
     */
    forParty: RateHistoryRow[];
    /**
     * The last few rates from everyone else. Disjoint from `forParty` so the
     * two sections can be rendered back to back without de-duplicating.
     */
    recent: RateHistoryRow[];
    /** Over every row returned. Null when the product has never traded. */
    summary: RateHistorySummary | null;
}

/** Prisma serialises Decimal as an object; coerce before any arithmetic. */
function toNumber(value: unknown): number {
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? n : 0;
}

export function clampRateHistoryLimit(limit?: number): number {
    if (!limit || !Number.isFinite(limit) || limit < 1) return RATE_HISTORY_DEFAULT_LIMIT;
    return Math.min(Math.trunc(limit), RATE_HISTORY_MAX_LIMIT);
}

export function mapSaleItemToRateRow(item: any): RateHistoryRow {
    const quantity = toNumber(item.quantity);
    const rate = toNumber(item.price_at_sale);
    return {
        documentId: item.sale.id,
        documentNumber: item.sale.reference_number || item.sale.serial_number,
        date: new Date(item.sale.sale_date).toISOString(),
        partyId: item.sale.customer_id ?? null,
        partyName: item.sale.customer?.name ?? null,
        quantity,
        rate,
        lineTotal: quantity * rate,
    };
}

export function mapPurchaseItemToRateRow(item: any): RateHistoryRow {
    const quantity = toNumber(item.quantity);
    const rate = toNumber(item.unit_cost);
    return {
        documentId: item.purchase.id,
        documentNumber: item.purchase.reference_number || item.purchase.purchase_number,
        date: new Date(item.purchase.created_at).toISOString(),
        partyId: item.purchase.supplier_id ?? null,
        partyName: item.purchase.supplier?.name ?? null,
        quantity,
        // line_total is stored, but deriving it keeps a discounted or
        // freight-loaded line from reading as a unit rate it never was.
        rate,
        lineTotal: quantity * rate,
    };
}

/**
 * Summarises the rows the caller is about to see — deliberately not the whole
 * trading history, so "avg 1,263" always reconciles with the rows on screen.
 * `lastRate` is the newest row, so callers must pass rows newest-first.
 */
export function summariseRates(rows: RateHistoryRow[]): RateHistorySummary | null {
    if (rows.length === 0) return null;

    const rates = rows.map((row) => row.rate);
    const newest = rows.reduce((latest, row) => (row.date > latest.date ? row : latest), rows[0]);

    return {
        lastRate: newest.rate,
        avgRate: rates.reduce((sum, rate) => sum + rate, 0) / rates.length,
        minRate: Math.min(...rates),
        maxRate: Math.max(...rates),
    };
}
