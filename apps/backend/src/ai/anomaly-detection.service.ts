import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';

/**
 * Deterministic outlier detection over posted sales, purchases and returns.
 *
 * The detection here is SQL, not a model. That is the whole point: an LLM asked
 * to scan raw transactions for "anything unusual" invents patterns it likes the
 * sound of and misses the ones it does not, and neither failure is visible to
 * the person reading the answer. Every flag this service returns carries the
 * observed value, the value it was compared against, the sample the comparison
 * came from, and the taka at stake — so the assistant's job is ranking and
 * explanation, and the arithmetic is reproducible without it.
 *
 * The comparison baseline is a **median**, not a mean. Retail price and quantity
 * distributions are long-tailed and the outlier we are hunting for is itself in
 * the sample; a mean moves toward the thing it is supposed to be catching, and
 * one keying error of ৳50,000 drags the "normal" price up far enough to hide
 * the next one. `percentile_cont` costs a sort and buys a baseline that a single
 * bad row cannot move.
 *
 * Nothing here is tenant-agnostic: every query takes `tenantId` as its first
 * argument and puts it in the `WHERE`, including inside the baseline CTEs.
 *
 * Deliberately reusable outside the chatbot. The eventual weekly scan (see
 * TODO.md) wants exactly this shape — a tenant id, a window, and a ranked list
 * — so it lives as a service rather than inside the tool handler.
 */

export type AnomalyType =
    // Sales
    | 'sold_below_cost'
    | 'zero_price_line'
    | 'price_below_norm'
    | 'price_above_norm'
    | 'quantity_outlier'
    | 'duplicate_invoice'
    | 'backdated_entry'
    // Purchases
    | 'cost_above_selling_price'
    | 'cost_above_norm'
    | 'cost_below_norm'
    | 'zero_cost_line'
    | 'purchase_quantity_outlier'
    | 'duplicate_purchase'
    // Returns
    | 'refund_exceeds_sale';

export const ANOMALY_TYPES: AnomalyType[] = [
    'sold_below_cost',
    'zero_price_line',
    'price_below_norm',
    'price_above_norm',
    'quantity_outlier',
    'duplicate_invoice',
    'backdated_entry',
    'cost_above_selling_price',
    'cost_above_norm',
    'cost_below_norm',
    'zero_cost_line',
    'purchase_quantity_outlier',
    'duplicate_purchase',
    'refund_exceeds_sale',
];

export type AnomalySeverity = 'high' | 'medium' | 'low';
export type AnomalySensitivity = 'high' | 'normal' | 'low';

export interface Anomaly {
    type: AnomalyType;
    severity: AnomalySeverity;
    source: 'sale' | 'purchase' | 'sales_return';
    /** Document number, or a comma-joined list for the duplicate detectors. */
    document: string;
    documentDate: string | null;
    branch: string | null;
    party: string | null;
    product: string | null;
    /** The value that tripped the rule — a unit price, a quantity, a day gap. */
    observed: number;
    /** What it was compared against. Null for rules with no baseline. */
    expected: number | null;
    /** Signed deviation from `expected`, in percent. Null where meaningless. */
    deviationPct: number | null;
    /** How many historical rows the baseline was computed from. */
    baselineSamples: number | null;
    /** Taka at stake if the flag is real. Drives ranking and severity. */
    impact: number;
    /** A complete sentence stating the finding in plain terms. */
    detail: string;
    enteredBy: string | null;
}

export interface AnomalyScanOptions {
    from: string;
    to: string;
    storeId?: string;
    types?: AnomalyType[];
    sensitivity?: AnomalySensitivity;
    minImpact?: number;
    /** Days of history the baselines are computed over, ending at `to`. */
    baselineDays?: number;
}

export interface AnomalyScanResult {
    period: { from: string; to: string };
    baselinePeriod: { from: string; to: string };
    sensitivity: AnomalySensitivity;
    thresholds: {
        priceDeviationPct: number;
        quantityMultiple: number;
        minBaselineSamples: number;
        backdatedDays: number;
        minImpact: number;
    };
    scanned: AnomalyType[];
    totalFlags: number;
    bySeverity: Record<AnomalySeverity, number>;
    byType: Record<string, number>;
    totalImpact: number;
    /** True when a detector hit its fetch cap and the list is incomplete. */
    truncatedDetectors: string[];
    /**
     * Detectors whose query failed. Load-bearing: without it a broken query is
     * indistinguishable from a clean scan, and the caller reports "nothing is
     * wrong" for checks that never ran.
     */
    failedDetectors: string[];
    anomalies: Anomaly[];
}

/**
 * Preset thresholds. "high" sensitivity flags more and is noisier; "low" only
 * surfaces the egregious. These are the knobs a shopkeeper would actually turn,
 * expressed once rather than as six independent numeric parameters the model
 * would have to guess values for.
 */
const SENSITIVITY_PRESETS: Record<
    AnomalySensitivity,
    { priceDeviation: number; quantityMultiple: number; minSamples: number; backdatedDays: number; minImpact: number }
> = {
    high: { priceDeviation: 0.25, quantityMultiple: 3, minSamples: 4, backdatedDays: 3, minImpact: 0 },
    normal: { priceDeviation: 0.4, quantityMultiple: 5, minSamples: 5, backdatedDays: 7, minImpact: 100 },
    low: { priceDeviation: 0.6, quantityMultiple: 8, minSamples: 8, backdatedDays: 14, minImpact: 1000 },
};

/** Days of history each baseline is computed over unless the caller says otherwise. */
const DEFAULT_BASELINE_DAYS = 90;

/**
 * A quantity below this never trips the outlier rule regardless of the median.
 * In a shop where nearly every line is a single unit the median is 1, and
 * without a floor every three-item basket in the window gets flagged.
 */
const MIN_ABSOLUTE_QUANTITY = 5;

/** Candidate rows any one detector will pull back before ranking. */
const CANDIDATE_FETCH_LIMIT = 400;

/** Taka thresholds that lift a flag's severity on materiality alone. */
const HIGH_IMPACT_BDT = 5_000;
const MEDIUM_IMPACT_BDT = 1_000;

/**
 * Rules whose severity cannot fall below this, however small the taka. Selling
 * at zero or refunding more than was charged is not a rounding matter — the
 * amount says how much it cost, not whether it is worth reading.
 */
const SEVERITY_FLOOR: Partial<Record<AnomalyType, AnomalySeverity>> = {
    zero_price_line: 'high',
    refund_exceeds_sale: 'high',
    sold_below_cost: 'medium',
    zero_cost_line: 'medium',
    cost_above_selling_price: 'medium',
    duplicate_invoice: 'medium',
    duplicate_purchase: 'medium',
};

const SEVERITY_RANK: Record<AnomalySeverity, number> = { high: 0, medium: 1, low: 2 };

@Injectable()
export class AnomalyDetectionService {
    private readonly logger = new Logger(AnomalyDetectionService.name);

    constructor(private readonly db: DatabaseService) {}

    async scan(tenantId: string, options: AnomalyScanOptions): Promise<AnomalyScanResult> {
        const sensitivity = options.sensitivity ?? 'normal';
        const preset = SENSITIVITY_PRESETS[sensitivity] ?? SENSITIVITY_PRESETS.normal;
        const minImpact = options.minImpact ?? preset.minImpact;
        const baselineDays = clamp(options.baselineDays ?? DEFAULT_BASELINE_DAYS, 14, 365);

        const windowFrom = startOfDay(options.from);
        const windowTo = endOfDay(options.to);
        const baselineFrom = addDays(windowFrom, -baselineDays);

        const requested = options.types?.length
            ? ANOMALY_TYPES.filter((type) => options.types!.includes(type))
            : ANOMALY_TYPES;
        const wanted = new Set(requested);
        const truncated: string[] = [];
        const failed: string[] = [];

        // Each detector is one round-trip and they do not depend on each other.
        const [salesLines, purchaseLines, dupSales, dupPurchases, backdated, overRefunded] = await Promise.all([
            this.runDetector('sale_lines', truncated, failed, () =>
                anyWanted(wanted, ['sold_below_cost', 'zero_price_line', 'price_below_norm', 'price_above_norm', 'quantity_outlier'])
                    ? this.saleLineAnomalies(tenantId, { windowFrom, windowTo, baselineFrom, storeId: options.storeId, preset })
                    : Promise.resolve([]),
            ),
            this.runDetector('purchase_lines', truncated, failed, () =>
                anyWanted(wanted, ['cost_above_selling_price', 'cost_above_norm', 'cost_below_norm', 'zero_cost_line', 'purchase_quantity_outlier'])
                    ? this.purchaseLineAnomalies(tenantId, { windowFrom, windowTo, baselineFrom, storeId: options.storeId, preset })
                    : Promise.resolve([]),
            ),
            this.runDetector('duplicate_invoice', truncated, failed, () =>
                wanted.has('duplicate_invoice')
                    ? this.duplicateSales(tenantId, windowFrom, windowTo, options.storeId)
                    : Promise.resolve([]),
            ),
            this.runDetector('duplicate_purchase', truncated, failed, () =>
                wanted.has('duplicate_purchase')
                    ? this.duplicatePurchases(tenantId, windowFrom, windowTo, options.storeId)
                    : Promise.resolve([]),
            ),
            this.runDetector('backdated_entry', truncated, failed, () =>
                wanted.has('backdated_entry')
                    ? this.backdatedSales(tenantId, windowFrom, windowTo, options.storeId, preset.backdatedDays)
                    : Promise.resolve([]),
            ),
            this.runDetector('refund_exceeds_sale', truncated, failed, () =>
                wanted.has('refund_exceeds_sale')
                    ? this.overRefundedSales(tenantId, windowFrom, windowTo, options.storeId)
                    : Promise.resolve([]),
            ),
        ]);

        const all = [...salesLines, ...purchaseLines, ...dupSales, ...dupPurchases, ...backdated, ...overRefunded]
            .filter((a) => wanted.has(a.type))
            .filter((a) => a.impact >= minImpact)
            .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.impact - a.impact);

        const bySeverity: Record<AnomalySeverity, number> = { high: 0, medium: 0, low: 0 };
        const byType: Record<string, number> = {};
        let totalImpact = 0;
        for (const anomaly of all) {
            bySeverity[anomaly.severity] += 1;
            byType[anomaly.type] = (byType[anomaly.type] ?? 0) + 1;
            totalImpact += anomaly.impact;
        }

        return {
            period: { from: options.from, to: options.to },
            baselinePeriod: { from: toDateString(baselineFrom), to: options.to },
            sensitivity,
            thresholds: {
                priceDeviationPct: Math.round(preset.priceDeviation * 100),
                quantityMultiple: preset.quantityMultiple,
                minBaselineSamples: preset.minSamples,
                backdatedDays: preset.backdatedDays,
                minImpact,
            },
            scanned: requested,
            totalFlags: all.length,
            bySeverity,
            byType,
            totalImpact: round2(totalImpact),
            truncatedDetectors: truncated,
            failedDetectors: failed,
            anomalies: all,
        };
    }

    /**
     * One failing detector must not cost the caller the other five. A scan that
     * returns five families and names the one that broke is more useful than an
     * exception, and the chatbot has no way to retry a partial failure itself.
     */
    private async runDetector(
        name: string,
        truncated: string[],
        failed: string[],
        run: () => Promise<Anomaly[]>,
    ): Promise<Anomaly[]> {
        try {
            const rows = await run();
            if (rows.length >= CANDIDATE_FETCH_LIMIT) truncated.push(name);
            return rows;
        } catch (error) {
            this.logger.error(`Anomaly detector "${name}" failed: ${(error as Error).message}`);
            failed.push(name);
            return [];
        }
    }

    // ── Sales line items ─────────────────────────────────────────────────────

    /**
     * Price and quantity outliers on individual sale lines, plus the two
     * absolute rules (sold below its own recorded cost, sold at zero).
     *
     * The filtering happens in SQL rather than over fetched rows because the
     * alternative is pulling every line item in the window across the wire to
     * discard 99% of them — a month of a busy shop is tens of thousands of rows,
     * and the interesting ones are a handful.
     */
    private async saleLineAnomalies(
        tenantId: string,
        opts: {
            windowFrom: Date;
            windowTo: Date;
            baselineFrom: Date;
            storeId?: string;
            preset: (typeof SENSITIVITY_PRESETS)['normal'];
        },
    ): Promise<Anomaly[]> {
        const { windowFrom, windowTo, baselineFrom, storeId, preset } = opts;
        const storeFilter = storeId ? Prisma.sql`AND s.store_id = ${storeId}` : Prisma.empty;

        const rows = await this.db.$queryRaw<SaleLineRow[]>`
            WITH baseline AS (
                SELECT
                    si.product_id,
                    count(*)::int AS sample_count,
                    percentile_cont(0.5) WITHIN GROUP (ORDER BY si.price_at_sale::float8) AS median_price,
                    percentile_cont(0.5) WITHIN GROUP (ORDER BY si.quantity::float8)      AS median_qty
                FROM "SaleItem" si
                JOIN "Sale" s ON s.id = si.sale_id
                WHERE s.tenant_id = ${tenantId}
                  AND s.status = 'COMPLETED'
                  AND s.sale_date >= ${baselineFrom}
                  AND s.sale_date <= ${windowTo}
                  ${storeFilter}
                GROUP BY si.product_id
            )
            SELECT
                COALESCE(s.reference_number, s.serial_number)      AS document,
                to_char(s.sale_date, 'YYYY-MM-DD')                 AS document_date,
                st.name                                            AS branch,
                COALESCE(c.name, 'Walk-in customer')               AS party,
                p.name                                             AS product,
                p.price::float8                                    AS list_price,
                si.quantity::float8                                AS quantity,
                si.price_at_sale::float8                           AS unit_price,
                si.unit_cost_at_sale::float8                       AS unit_cost,
                u.name                                             AS entered_by,
                b.sample_count                                     AS sample_count,
                b.median_price                                     AS median_price,
                b.median_qty                                       AS median_qty
            FROM "SaleItem" si
            JOIN "Sale" s      ON s.id = si.sale_id
            JOIN "Store" st    ON st.id = s.store_id
            JOIN "Product" p   ON p.id = si.product_id
            LEFT JOIN "Customer" c ON c.id = s.customer_id
            LEFT JOIN "User" u     ON u.id = s.created_by
            LEFT JOIN baseline b   ON b.product_id = si.product_id
            WHERE s.tenant_id = ${tenantId}
              AND s.status = 'COMPLETED'
              AND s.sale_date >= ${windowFrom}
              AND s.sale_date <= ${windowTo}
              ${storeFilter}
              AND (
                    si.price_at_sale <= 0
                 OR (si.unit_cost_at_sale IS NOT NULL AND si.unit_cost_at_sale > 0
                     AND si.price_at_sale < si.unit_cost_at_sale)
                 OR (b.sample_count >= ${preset.minSamples} AND b.median_price > 0
                     AND abs(si.price_at_sale::float8 - b.median_price) / b.median_price >= ${preset.priceDeviation})
                 OR (b.sample_count >= ${preset.minSamples} AND b.median_qty > 0
                     AND si.quantity::float8 >= b.median_qty * ${preset.quantityMultiple}
                     AND si.quantity >= ${MIN_ABSOLUTE_QUANTITY})
              )
            ORDER BY GREATEST(
                si.quantity::float8 * si.price_at_sale::float8,
                si.quantity::float8 * COALESCE(b.median_price, 0),
                si.quantity::float8 * COALESCE(si.unit_cost_at_sale::float8, 0)
            ) DESC
            LIMIT ${CANDIDATE_FETCH_LIMIT}
        `;

        const anomalies: Anomaly[] = [];
        for (const row of rows) {
            const qty = num(row.quantity);
            const price = num(row.unit_price);
            const cost = row.unit_cost === null ? null : num(row.unit_cost);
            const median = row.median_price === null ? null : num(row.median_price);
            const samples = row.sample_count ?? null;
            const base = {
                source: 'sale' as const,
                document: row.document,
                documentDate: row.document_date,
                branch: row.branch,
                party: row.party,
                product: row.product,
                enteredBy: row.entered_by,
            };

            // At most one price-family flag per line, most specific first. A line
            // sold below cost is also, usually, below the median price; reporting
            // both makes one problem look like two.
            if (price <= 0) {
                // Impact decides whether a flag survives `minImpact` at all, so a
                // giveaway on a product with no sales history must not fall through
                // to zero and vanish. Median first (what it actually sells for),
                // then its recorded cost, then the catalogue price.
                const reference = median || cost || num(row.list_price);
                anomalies.push(
                    finish({
                        ...base,
                        type: 'zero_price_line',
                        observed: price,
                        expected: median,
                        deviationPct: median ? -100 : null,
                        baselineSamples: samples,
                        impact: round2(reference * qty),
                        detail:
                            `${row.product} went out at ৳0 on ${row.document} (${qty} unit${qty === 1 ? '' : 's'})` +
                            (median ? `, against a usual ৳${fmt(median)} a unit.` : '.'),
                    }),
                );
            } else if (cost !== null && cost > 0 && price < cost) {
                anomalies.push(
                    finish({
                        ...base,
                        type: 'sold_below_cost',
                        observed: price,
                        expected: cost,
                        deviationPct: pctChange(price, cost),
                        baselineSamples: samples,
                        impact: round2((cost - price) * qty),
                        detail:
                            `${row.document} sold ${row.product} at ৳${fmt(price)} against a recorded cost of ` +
                            `৳${fmt(cost)} — a loss of ৳${fmt((cost - price) * qty)} over ${qty} unit${qty === 1 ? '' : 's'}.`,
                    }),
                );
            } else if (median !== null && median > 0 && samples && samples >= preset.minSamples) {
                const deviation = (price - median) / median;
                if (Math.abs(deviation) >= preset.priceDeviation) {
                    const below = deviation < 0;
                    anomalies.push(
                        finish({
                            ...base,
                            type: below ? 'price_below_norm' : 'price_above_norm',
                            observed: price,
                            expected: round2(median),
                            deviationPct: pctChange(price, median),
                            baselineSamples: samples,
                            impact: round2(Math.abs(price - median) * qty),
                            detail:
                                `${row.product} was sold at ৳${fmt(price)} on ${row.document}, ` +
                                `${Math.abs(Math.round(deviation * 100))}% ${below ? 'below' : 'above'} its usual ` +
                                `৳${fmt(median)} (median of ${samples} recent sale lines).`,
                        }),
                    );
                }
            }

            // Quantity is a separate axis: the same line can legitimately be both
            // mispriced and an unusual size, and the two mean different things.
            const medianQty = row.median_qty === null ? null : num(row.median_qty);
            if (
                medianQty !== null &&
                medianQty > 0 &&
                samples &&
                samples >= preset.minSamples &&
                qty >= medianQty * preset.quantityMultiple &&
                qty >= MIN_ABSOLUTE_QUANTITY
            ) {
                anomalies.push(
                    finish({
                        ...base,
                        type: 'quantity_outlier',
                        observed: qty,
                        expected: round2(medianQty),
                        deviationPct: pctChange(qty, medianQty),
                        baselineSamples: samples,
                        impact: round2((qty - medianQty) * price),
                        detail:
                            `${row.document} moved ${qty} × ${row.product} on one line, against a usual ` +
                            `${fmt(medianQty)} (median of ${samples} recent sale lines).`,
                    }),
                );
            }
        }
        return anomalies;
    }

    // ── Purchase line items ──────────────────────────────────────────────────

    /**
     * The buying-side mirror. `cost_above_selling_price` has no sales-side twin:
     * a unit bought for more than the shop's own shelf price is either a keying
     * error or a supplier overcharge, and either way it cannot be sold at a
     * profit — worth surfacing regardless of how it compares to past purchases.
     */
    private async purchaseLineAnomalies(
        tenantId: string,
        opts: {
            windowFrom: Date;
            windowTo: Date;
            baselineFrom: Date;
            storeId?: string;
            preset: (typeof SENSITIVITY_PRESETS)['normal'];
        },
    ): Promise<Anomaly[]> {
        const { windowFrom, windowTo, baselineFrom, storeId, preset } = opts;
        const storeFilter = storeId ? Prisma.sql`AND pu.store_id = ${storeId}` : Prisma.empty;

        const rows = await this.db.$queryRaw<PurchaseLineRow[]>`
            WITH baseline AS (
                SELECT
                    pi.product_id,
                    count(*)::int AS sample_count,
                    percentile_cont(0.5) WITHIN GROUP (ORDER BY pi.unit_cost::float8) AS median_cost,
                    percentile_cont(0.5) WITHIN GROUP (ORDER BY pi.quantity::float8)  AS median_qty
                FROM "PurchaseItem" pi
                JOIN "Purchase" pu ON pu.id = pi.purchase_id
                WHERE pu.tenant_id = ${tenantId}
                  AND pu.created_at >= ${baselineFrom}
                  AND pu.created_at <= ${windowTo}
                  ${storeFilter}
                GROUP BY pi.product_id
            )
            SELECT
                pu.purchase_number                        AS document,
                to_char(pu.created_at, 'YYYY-MM-DD')      AS document_date,
                st.name                                   AS branch,
                COALESCE(sup.name, 'Unknown supplier')    AS party,
                p.name                                    AS product,
                p.price::float8                           AS selling_price,
                pi.quantity::float8                       AS quantity,
                pi.unit_cost::float8                      AS unit_cost,
                u.name                                    AS entered_by,
                b.sample_count                            AS sample_count,
                b.median_cost                             AS median_cost,
                b.median_qty                              AS median_qty
            FROM "PurchaseItem" pi
            JOIN "Purchase" pu   ON pu.id = pi.purchase_id
            JOIN "Store" st      ON st.id = pu.store_id
            JOIN "Product" p     ON p.id = pi.product_id
            LEFT JOIN "Supplier" sup ON sup.id = pu.supplier_id
            LEFT JOIN "User" u       ON u.id = pu.created_by
            LEFT JOIN baseline b     ON b.product_id = pi.product_id
            WHERE pu.tenant_id = ${tenantId}
              AND pu.created_at >= ${windowFrom}
              AND pu.created_at <= ${windowTo}
              ${storeFilter}
              AND (
                    pi.unit_cost <= 0
                 OR (p.price > 0 AND pi.unit_cost > p.price)
                 OR (b.sample_count >= ${preset.minSamples} AND b.median_cost > 0
                     AND abs(pi.unit_cost::float8 - b.median_cost) / b.median_cost >= ${preset.priceDeviation})
                 OR (b.sample_count >= ${preset.minSamples} AND b.median_qty > 0
                     AND pi.quantity::float8 >= b.median_qty * ${preset.quantityMultiple}
                     AND pi.quantity >= ${MIN_ABSOLUTE_QUANTITY})
              )
            ORDER BY GREATEST(
                pi.quantity::float8 * pi.unit_cost::float8,
                pi.quantity::float8 * COALESCE(b.median_cost, 0)
            ) DESC
            LIMIT ${CANDIDATE_FETCH_LIMIT}
        `;

        const anomalies: Anomaly[] = [];
        for (const row of rows) {
            const qty = num(row.quantity);
            const cost = num(row.unit_cost);
            const median = row.median_cost === null ? null : num(row.median_cost);
            const selling = row.selling_price === null ? null : num(row.selling_price);
            const samples = row.sample_count ?? null;
            const base = {
                source: 'purchase' as const,
                document: row.document,
                documentDate: row.document_date,
                branch: row.branch,
                party: row.party,
                product: row.product,
                enteredBy: row.entered_by,
            };

            if (cost <= 0) {
                // Same reasoning as the sales side: falling back to the shelf price
                // overstates what a unit cost, but it is the right order of
                // magnitude, and the alternative is the flag being filtered away.
                const reference = median || num(selling);
                anomalies.push(
                    finish({
                        ...base,
                        type: 'zero_cost_line',
                        observed: cost,
                        expected: median,
                        deviationPct: median ? -100 : null,
                        baselineSamples: samples,
                        impact: round2(reference * qty),
                        detail:
                            `${row.document} records ${qty} × ${row.product} at ৳0 a unit` +
                            (median ? `, against a usual ৳${fmt(median)}. Stock valuation will be understated.` : '.'),
                    }),
                );
            } else if (selling !== null && selling > 0 && cost > selling) {
                anomalies.push(
                    finish({
                        ...base,
                        type: 'cost_above_selling_price',
                        observed: cost,
                        expected: selling,
                        deviationPct: pctChange(cost, selling),
                        baselineSamples: samples,
                        impact: round2((cost - selling) * qty),
                        detail:
                            `${row.document} bought ${row.product} at ৳${fmt(cost)} a unit while the shelf price is ` +
                            `৳${fmt(selling)} — every unit sold at list loses ৳${fmt(cost - selling)}.`,
                    }),
                );
            } else if (median !== null && median > 0 && samples && samples >= preset.minSamples) {
                const deviation = (cost - median) / median;
                if (Math.abs(deviation) >= preset.priceDeviation) {
                    const below = deviation < 0;
                    anomalies.push(
                        finish({
                            ...base,
                            type: below ? 'cost_below_norm' : 'cost_above_norm',
                            observed: cost,
                            expected: round2(median),
                            deviationPct: pctChange(cost, median),
                            baselineSamples: samples,
                            impact: round2(Math.abs(cost - median) * qty),
                            detail:
                                `${row.party} charged ৳${fmt(cost)} a unit for ${row.product} on ${row.document}, ` +
                                `${Math.abs(Math.round(deviation * 100))}% ${below ? 'below' : 'above'} the usual ` +
                                `৳${fmt(median)} (median of ${samples} recent purchase lines).`,
                        }),
                    );
                }
            }

            const medianQty = row.median_qty === null ? null : num(row.median_qty);
            if (
                medianQty !== null &&
                medianQty > 0 &&
                samples &&
                samples >= preset.minSamples &&
                qty >= medianQty * preset.quantityMultiple &&
                qty >= MIN_ABSOLUTE_QUANTITY
            ) {
                anomalies.push(
                    finish({
                        ...base,
                        type: 'purchase_quantity_outlier',
                        observed: qty,
                        expected: round2(medianQty),
                        deviationPct: pctChange(qty, medianQty),
                        baselineSamples: samples,
                        impact: round2((qty - medianQty) * cost),
                        detail:
                            `${row.document} received ${qty} × ${row.product} on one line, against a usual ` +
                            `${fmt(medianQty)} (median of ${samples} recent purchase lines).`,
                    }),
                );
            }
        }
        return anomalies;
    }

    // ── Duplicates ───────────────────────────────────────────────────────────

    /**
     * Same customer, same amount, same day, more than once.
     *
     * Walk-in sales are excluded rather than reported: an unnamed customer is
     * the default in retail, and two ৳120 cash sales in one afternoon is a
     * normal Tuesday, not a duplicate. Requiring a named customer is what keeps
     * this rule from burying everything else.
     */
    private async duplicateSales(tenantId: string, windowFrom: Date, windowTo: Date, storeId?: string): Promise<Anomaly[]> {
        const storeFilter = storeId ? Prisma.sql`AND s.store_id = ${storeId}` : Prisma.empty;
        const rows = await this.db.$queryRaw<DuplicateRow[]>`
            SELECT
                to_char(s.sale_date, 'YYYY-MM-DD')  AS document_date,
                st.name                             AS branch,
                c.name                              AS party,
                s.total_amount::float8              AS amount,
                count(*)::int                       AS document_count,
                string_agg(COALESCE(s.reference_number, s.serial_number), ', '
                           ORDER BY s.serial_number) AS documents
            FROM "Sale" s
            JOIN "Store" st   ON st.id = s.store_id
            JOIN "Customer" c ON c.id = s.customer_id
            WHERE s.tenant_id = ${tenantId}
              AND s.status = 'COMPLETED'
              AND s.sale_date >= ${windowFrom}
              AND s.sale_date <= ${windowTo}
              AND s.total_amount > 0
              ${storeFilter}
            GROUP BY to_char(s.sale_date, 'YYYY-MM-DD'), st.id, st.name, c.id, c.name, s.total_amount
            HAVING count(*) > 1
            ORDER BY s.total_amount * (count(*) - 1) DESC
            LIMIT ${CANDIDATE_FETCH_LIMIT}
        `;

        return rows.map((row) => {
            const amount = num(row.amount);
            const copies = row.document_count - 1;
            return finish({
                type: 'duplicate_invoice',
                source: 'sale',
                document: row.documents,
                documentDate: row.document_date,
                branch: row.branch,
                party: row.party,
                product: null,
                observed: row.document_count,
                expected: 1,
                deviationPct: null,
                baselineSamples: null,
                impact: round2(amount * copies),
                detail:
                    `${row.document_count} invoices to ${row.party} for exactly ৳${fmt(amount)} on ${row.document_date} ` +
                    `(${row.documents}). If ${copies} ${copies === 1 ? 'is a' : 'are'} duplicate, revenue is overstated by ৳${fmt(amount * copies)}.`,
                enteredBy: null,
            });
        });
    }

    /** The purchase-side twin. A supplier bill entered twice is paid twice. */
    private async duplicatePurchases(tenantId: string, windowFrom: Date, windowTo: Date, storeId?: string): Promise<Anomaly[]> {
        const storeFilter = storeId ? Prisma.sql`AND pu.store_id = ${storeId}` : Prisma.empty;
        const rows = await this.db.$queryRaw<DuplicateRow[]>`
            SELECT
                to_char(pu.created_at, 'YYYY-MM-DD') AS document_date,
                st.name                              AS branch,
                sup.name                             AS party,
                pu.total_amount::float8              AS amount,
                count(*)::int                        AS document_count,
                string_agg(pu.purchase_number, ', ' ORDER BY pu.purchase_number) AS documents
            FROM "Purchase" pu
            JOIN "Store" st    ON st.id = pu.store_id
            JOIN "Supplier" sup ON sup.id = pu.supplier_id
            WHERE pu.tenant_id = ${tenantId}
              AND pu.created_at >= ${windowFrom}
              AND pu.created_at <= ${windowTo}
              AND pu.total_amount > 0
              ${storeFilter}
            GROUP BY to_char(pu.created_at, 'YYYY-MM-DD'), st.id, st.name, sup.id, sup.name, pu.total_amount
            HAVING count(*) > 1
            ORDER BY pu.total_amount * (count(*) - 1) DESC
            LIMIT ${CANDIDATE_FETCH_LIMIT}
        `;

        return rows.map((row) => {
            const amount = num(row.amount);
            const copies = row.document_count - 1;
            return finish({
                type: 'duplicate_purchase',
                source: 'purchase',
                document: row.documents,
                documentDate: row.document_date,
                branch: row.branch,
                party: row.party,
                product: null,
                observed: row.document_count,
                expected: 1,
                deviationPct: null,
                baselineSamples: null,
                impact: round2(amount * copies),
                detail:
                    `${row.document_count} purchases from ${row.party} for exactly ৳${fmt(amount)} on ${row.document_date} ` +
                    `(${row.documents}). A bill entered twice is a payable ৳${fmt(amount * copies)} too high.`,
                enteredBy: null,
            });
        });
    }

    // ── Timing ───────────────────────────────────────────────────────────────

    /**
     * Sales whose recorded date is far from when the row was actually written.
     *
     * `sale_date` defaults to `now()`, so a gap means somebody set the date by
     * hand. Legitimate reasons exist (catching up on paper invoices), which is
     * why this is reported as a timing fact and not an accusation — but a sale
     * dated into a closed period, or into the future, moves revenue between
     * periods, and nothing else in the system surfaces it.
     */
    private async backdatedSales(
        tenantId: string,
        windowFrom: Date,
        windowTo: Date,
        storeId: string | undefined,
        thresholdDays: number,
    ): Promise<Anomaly[]> {
        const storeFilter = storeId ? Prisma.sql`AND s.store_id = ${storeId}` : Prisma.empty;
        const rows = await this.db.$queryRaw<BackdatedRow[]>`
            SELECT
                COALESCE(s.reference_number, s.serial_number) AS document,
                to_char(s.sale_date, 'YYYY-MM-DD')            AS document_date,
                to_char(s.created_at, 'YYYY-MM-DD')           AS entered_date,
                st.name                                       AS branch,
                COALESCE(c.name, 'Walk-in customer')          AS party,
                s.total_amount::float8                        AS amount,
                (s.created_at::date - s.sale_date::date)::int AS day_gap,
                u.name                                        AS entered_by
            FROM "Sale" s
            JOIN "Store" st ON st.id = s.store_id
            LEFT JOIN "Customer" c ON c.id = s.customer_id
            LEFT JOIN "User" u     ON u.id = s.created_by
            WHERE s.tenant_id = ${tenantId}
              AND s.status = 'COMPLETED'
              AND s.sale_date >= ${windowFrom}
              AND s.sale_date <= ${windowTo}
              AND abs(s.created_at::date - s.sale_date::date) > ${thresholdDays}
              ${storeFilter}
            ORDER BY s.total_amount DESC
            LIMIT ${CANDIDATE_FETCH_LIMIT}
        `;

        return rows.map((row) => {
            const gap = row.day_gap;
            const forward = gap < 0; // sale_date is later than the row's creation
            const amount = num(row.amount);
            return finish({
                type: 'backdated_entry',
                source: 'sale',
                document: row.document,
                documentDate: row.document_date,
                branch: row.branch,
                party: row.party,
                product: null,
                observed: Math.abs(gap),
                expected: 0,
                deviationPct: null,
                baselineSamples: null,
                impact: round2(amount),
                detail: forward
                    ? `${row.document} (৳${fmt(amount)}) is dated ${Math.abs(gap)} days in the future — entered on ` +
                      `${row.entered_date} but dated ${row.document_date}.`
                    : `${row.document} (৳${fmt(amount)}) was entered on ${row.entered_date}, ${gap} days after its ` +
                      `recorded date of ${row.document_date}.`,
                enteredBy: row.entered_by,
            });
        });
    }

    // ── Returns ──────────────────────────────────────────────────────────────

    /**
     * Sales whose refunds add up to more than the sale itself.
     *
     * Aggregated across every return against the sale, not checked one return
     * at a time: three partial refunds each under the invoice total but summing
     * over it is the version that actually happens, and a per-return check
     * misses it entirely. All-time refunds are compared, but only sales touched
     * by a return inside the window are considered — otherwise every scan
     * re-reports the same historical breakage forever.
     */
    private async overRefundedSales(tenantId: string, windowFrom: Date, windowTo: Date, storeId?: string): Promise<Anomaly[]> {
        const storeFilter = storeId ? Prisma.sql`AND sr.store_id = ${storeId}` : Prisma.empty;
        const rows = await this.db.$queryRaw<OverRefundRow[]>`
            SELECT
                COALESCE(s.reference_number, s.serial_number) AS document,
                to_char(s.sale_date, 'YYYY-MM-DD')            AS document_date,
                st.name                                       AS branch,
                COALESCE(c.name, 'Walk-in customer')          AS party,
                s.total_amount::float8                        AS sale_total,
                sum(sr.total_refund)::float8                  AS refunded,
                count(*)::int                                 AS return_count
            FROM "SalesReturn" sr
            JOIN "Sale" s   ON s.id = sr.sale_id
            JOIN "Store" st ON st.id = sr.store_id
            LEFT JOIN "Customer" c ON c.id = s.customer_id
            WHERE sr.tenant_id = ${tenantId}
              AND sr.status <> 'CANCELLED'
              ${storeFilter}
              AND s.id IN (
                  SELECT inner_sr.sale_id
                  FROM "SalesReturn" inner_sr
                  WHERE inner_sr.tenant_id = ${tenantId}
                    AND inner_sr.created_at >= ${windowFrom}
                    AND inner_sr.created_at <= ${windowTo}
              )
            GROUP BY s.id, s.reference_number, s.serial_number, s.sale_date, st.name, c.name, s.total_amount
            HAVING sum(sr.total_refund) > s.total_amount + 0.01
            ORDER BY (sum(sr.total_refund) - s.total_amount) DESC
            LIMIT ${CANDIDATE_FETCH_LIMIT}
        `;

        return rows.map((row) => {
            const refunded = num(row.refunded);
            const total = num(row.sale_total);
            return finish({
                type: 'refund_exceeds_sale',
                source: 'sales_return',
                document: row.document,
                documentDate: row.document_date,
                branch: row.branch,
                party: row.party,
                product: null,
                observed: round2(refunded),
                expected: round2(total),
                deviationPct: pctChange(refunded, total),
                baselineSamples: null,
                impact: round2(refunded - total),
                detail:
                    `${row.document} was invoiced at ৳${fmt(total)} but has ৳${fmt(refunded)} refunded against it across ` +
                    `${row.return_count} return${row.return_count === 1 ? '' : 's'} — ৳${fmt(refunded - total)} more than was ever charged.`,
                enteredBy: null,
            });
        });
    }
}

// ── Row shapes returned by the raw queries ───────────────────────────────────

interface SaleLineRow {
    document: string;
    document_date: string;
    branch: string;
    party: string;
    product: string;
    list_price: number | null;
    quantity: number;
    unit_price: number;
    unit_cost: number | null;
    entered_by: string | null;
    sample_count: number | null;
    median_price: number | null;
    median_qty: number | null;
}

interface PurchaseLineRow {
    document: string;
    document_date: string;
    branch: string;
    party: string;
    product: string;
    selling_price: number | null;
    quantity: number;
    unit_cost: number;
    entered_by: string | null;
    sample_count: number | null;
    median_cost: number | null;
    median_qty: number | null;
}

interface DuplicateRow {
    document_date: string;
    branch: string;
    party: string;
    amount: number;
    document_count: number;
    documents: string;
}

interface BackdatedRow {
    document: string;
    document_date: string;
    entered_date: string;
    branch: string;
    party: string;
    amount: number;
    day_gap: number;
    entered_by: string | null;
}

interface OverRefundRow {
    document: string;
    document_date: string;
    branch: string;
    party: string;
    sale_total: number;
    refunded: number;
    return_count: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fills in the one field the detectors do not set themselves. Severity is a
 * function of the taka at stake and the size of the deviation, with a per-rule
 * floor — deriving it in one place is what keeps "high" meaning the same thing
 * across fourteen rules written months apart.
 */
function finish(anomaly: Omit<Anomaly, 'severity'>): Anomaly {
    const impact = Math.abs(anomaly.impact);
    const deviation = Math.abs(anomaly.deviationPct ?? 0);

    let severity: AnomalySeverity = 'low';
    if (impact >= HIGH_IMPACT_BDT || (deviation >= 75 && impact >= MEDIUM_IMPACT_BDT)) severity = 'high';
    else if (impact >= MEDIUM_IMPACT_BDT || deviation >= 50) severity = 'medium';

    const floor = SEVERITY_FLOOR[anomaly.type];
    if (floor && SEVERITY_RANK[floor] < SEVERITY_RANK[severity]) severity = floor;

    return { ...anomaly, impact: round2(anomaly.impact), severity };
}

/**
 * Prisma returns Postgres `numeric` as a Decimal object even when the column was
 * cast; `float8` casts avoid that, but `count()` and any un-cast aggregate can
 * still arrive as BigInt. One coercion point beats fourteen.
 */
function num(value: unknown): number {
    if (value === null || value === undefined) return 0;
    const parsed = typeof value === 'number' ? value : Number(value.toString());
    return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

/** Signed percentage change of `observed` against `reference`. */
function pctChange(observed: number, reference: number): number | null {
    if (!reference) return null;
    return Math.round(((observed - reference) / reference) * 1000) / 10;
}

/** Money inside a `detail` sentence — grouped, 2dp, no currency symbol. */
function fmt(value: number): string {
    return round2(value).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(Number.isFinite(value) ? value : min, min), max);
}

function startOfDay(value: string): Date {
    return new Date(/^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? `${value.trim()}T00:00:00.000Z` : value);
}

/** A bare date upper bound covers the whole day, not the instant of midnight. */
function endOfDay(value: string): Date {
    return new Date(/^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? `${value.trim()}T23:59:59.999Z` : value);
}

function addDays(date: Date, days: number): Date {
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + days);
    return next;
}

function toDateString(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function anyWanted(wanted: Set<AnomalyType>, types: AnomalyType[]): boolean {
    return types.some((type) => wanted.has(type));
}
