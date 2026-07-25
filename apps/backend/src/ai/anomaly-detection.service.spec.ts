import { AnomalyDetectionService, ANOMALY_TYPES, type Anomaly } from './anomaly-detection.service';

/**
 * The SQL itself cannot be unit-tested without a database — these suites cover
 * the half that decides what a flag *means*: which rule wins when a row trips
 * several, how impact and severity are derived, and the promises the tool layer
 * makes to the model about tenant scoping and partial failure.
 *
 * The integration-shaped assertions (that `percentile_cont` returns what we
 * think it does) belong with the DB-backed suites and are noted in TODO.md.
 */

/**
 * `$queryRaw` is a tagged template, so a stub receives the string parts as the
 * first argument and the interpolated values as the rest. Queries are handed
 * back in the order the service issues them, which is fixed by the `Promise.all`
 * in `scan`.
 */
function makeDb(results: any[][]) {
    let call = 0;
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const db: any = {
        $queryRaw: jest.fn((strings: TemplateStringsArray, ...params: unknown[]) => {
            calls.push({ sql: strings.join('?'), params });
            return Promise.resolve(results[call++] ?? []);
        }),
    };
    return { db, calls };
}

const WINDOW = { from: '2026-07-01', to: '2026-07-31' };

/** Detector order inside `scan`: sale lines, purchase lines, dup sales, dup purchases, backdated, refunds. */
function only(index: number, rows: any[]): any[][] {
    const results: any[][] = [[], [], [], [], [], []];
    results[index] = rows;
    return results;
}

function saleLine(overrides: Partial<Record<string, any>> = {}) {
    return {
        document: 'INV-1042',
        document_date: '2026-07-14',
        branch: 'Gulshan',
        party: 'Karim Traders',
        product: 'Miniket Rice 5kg',
        list_price: 400,
        quantity: 2,
        unit_price: 400,
        unit_cost: 300,
        entered_by: 'Rina',
        sample_count: 40,
        median_price: 400,
        median_qty: 2,
        ...overrides,
    };
}

function purchaseLine(overrides: Partial<Record<string, any>> = {}) {
    return {
        document: 'PUR-220',
        document_date: '2026-07-09',
        branch: 'Gulshan',
        party: 'Padma Foods',
        product: 'Miniket Rice 5kg',
        selling_price: 400,
        quantity: 10,
        unit_cost: 300,
        entered_by: 'Rina',
        sample_count: 30,
        median_cost: 300,
        median_qty: 10,
        ...overrides,
    };
}

const byType = (anomalies: Anomaly[], type: string) => anomalies.filter((a) => a.type === type);

describe('AnomalyDetectionService — tenant scoping', () => {
    /**
     * The isolation guarantee for this service. Every query, including the
     * baseline CTEs that no caller ever names, must carry the tenant id — a
     * baseline computed across tenants would leak one shop's prices into
     * another's "normal" without ever returning a row of foreign data.
     */
    it('passes the tenant id into every query it issues', async () => {
        const { db, calls } = makeDb([[], [], [], [], [], []]);
        await new AnomalyDetectionService(db).scan('tenant-1', WINDOW);

        expect(calls).toHaveLength(6);
        for (const call of calls) {
            expect(call.params).toContain('tenant-1');
        }
    });

    it('puts the tenant id in the baseline CTE as well as the outer query', async () => {
        const { db, calls } = makeDb([[], [], [], [], [], []]);
        await new AnomalyDetectionService(db).scan('tenant-1', WINDOW);

        // The sale-line query interpolates the tenant twice: once in the CTE,
        // once in the outer WHERE. One occurrence means the CTE is unscoped.
        const saleQuery = calls[0];
        expect(saleQuery.sql).toContain('WITH baseline');
        expect(saleQuery.params.filter((p) => p === 'tenant-1')).toHaveLength(2);
    });

    it('adds a store filter only when a store is requested', async () => {
        const { db, calls } = makeDb([[], [], [], [], [], []]);
        await new AnomalyDetectionService(db).scan('tenant-1', WINDOW);
        expect(calls[0].params).not.toContain('store-9');

        const scoped = makeDb([[], [], [], [], [], []]);
        await new AnomalyDetectionService(scoped.db).scan('tenant-1', { ...WINDOW, storeId: 'store-9' });
        // The filter arrives as a nested `Prisma.sql` fragment rather than a bare
        // value, so it has to be unwrapped — and it must appear in both the
        // baseline CTE and the outer query, or a branch-scoped scan would compare
        // one branch's prices against every branch's history.
        const fragments = scoped.calls[0].params.filter((p: any) => p?.values?.[0] === 'store-9');
        expect(fragments).toHaveLength(2);
    });
});

describe('AnomalyDetectionService — sale line rules', () => {
    const scan = (rows: any[], options: any = {}) =>
        new AnomalyDetectionService(makeDb(only(0, rows)).db).scan('tenant-1', { ...WINDOW, ...options });

    it('flags a line sold below its own recorded cost, with the loss as the impact', async () => {
        const result = await scan([saleLine({ unit_price: 250, unit_cost: 300, quantity: 4 })]);

        const [flag] = byType(result.anomalies, 'sold_below_cost');
        expect(flag).toBeDefined();
        expect(flag.observed).toBe(250);
        expect(flag.expected).toBe(300);
        expect(flag.impact).toBe(200); // (300 - 250) × 4
        expect(flag.severity).toBe('medium'); // floored: small taka, real problem
        expect(flag.detail).toContain('INV-1042');
    });

    /**
     * A line sold below cost is nearly always below the median price too.
     * Emitting both turns one problem into two rows and doubles its apparent
     * weight in the summary counts.
     */
    it('reports only the most specific price rule per line', async () => {
        const result = await scan([saleLine({ unit_price: 250, unit_cost: 300, median_price: 400 })]);

        expect(byType(result.anomalies, 'sold_below_cost')).toHaveLength(1);
        expect(byType(result.anomalies, 'price_below_norm')).toHaveLength(0);
    });

    it('flags a zero-price line as high severity regardless of the deviation', async () => {
        const result = await scan([saleLine({ unit_price: 0, unit_cost: 300, median_price: 400, quantity: 1 })]);

        const [flag] = byType(result.anomalies, 'zero_price_line');
        expect(flag.severity).toBe('high');
        expect(flag.impact).toBe(400);
    });

    /**
     * Impact is what `minImpact` filters on, so a giveaway of a product with no
     * price history must not fall through to zero and disappear. The fallback
     * chain is median, then recorded cost, then the catalogue price.
     */
    it('values a zero-price line off the catalogue price when there is no history', async () => {
        const result = await scan([
            saleLine({ unit_price: 0, unit_cost: null, median_price: null, sample_count: null, list_price: 650, quantity: 2 }),
        ]);

        const [flag] = byType(result.anomalies, 'zero_price_line');
        expect(flag).toBeDefined();
        expect(flag.impact).toBe(1300);
    });

    it('flags a price below the product median and states the sample it used', async () => {
        const result = await scan([saleLine({ unit_price: 200, unit_cost: null, median_price: 400, sample_count: 37 })]);

        const [flag] = byType(result.anomalies, 'price_below_norm');
        expect(flag.deviationPct).toBe(-50);
        expect(flag.baselineSamples).toBe(37);
        expect(flag.detail).toContain('37 recent sale lines');
    });

    it('flags a price above the median as a separate type', async () => {
        const result = await scan([saleLine({ unit_price: 900, unit_cost: null, median_price: 400 })]);
        expect(byType(result.anomalies, 'price_above_norm')).toHaveLength(1);
    });

    /**
     * A baseline of two sales is not a baseline. Without the floor, the second
     * time a product is ever sold at a different price it is an "anomaly".
     */
    it('will not compare against a baseline thinner than the sensitivity requires', async () => {
        const result = await scan([saleLine({ unit_price: 100, unit_cost: null, median_price: 400, sample_count: 2 })]);
        expect(result.anomalies).toHaveLength(0);
    });

    it('reports a quantity outlier alongside a price flag rather than instead of it', async () => {
        const result = await scan([
            saleLine({ unit_price: 100, unit_cost: null, median_price: 400, quantity: 60, median_qty: 2 }),
        ]);

        expect(byType(result.anomalies, 'price_below_norm')).toHaveLength(1);
        expect(byType(result.anomalies, 'quantity_outlier')).toHaveLength(1);
    });

    /**
     * In a shop where the median basket line is one unit, a multiple alone
     * flags every three-item sale. The absolute floor is what makes the rule
     * usable in the shops this product targets.
     */
    it('holds a small quantity below the absolute floor even when the multiple is met', async () => {
        const result = await scan([saleLine({ quantity: 3, median_qty: 1, unit_price: 400, median_price: 400 })]);
        expect(byType(result.anomalies, 'quantity_outlier')).toHaveLength(0);
    });

    it('applies the sensitivity preset to the deviation threshold', async () => {
        const row = saleLine({ unit_price: 520, unit_cost: null, median_price: 400 }); // +30%

        expect((await scan([row], { sensitivity: 'high' })).totalFlags).toBe(1); // 25% threshold
        expect((await scan([row], { sensitivity: 'normal', minImpact: 0 })).totalFlags).toBe(0); // 40%
        expect((await scan([row], { sensitivity: 'low' })).totalFlags).toBe(0); // 60%
    });
});

describe('AnomalyDetectionService — purchase line rules', () => {
    const scan = (rows: any[], options: any = {}) =>
        new AnomalyDetectionService(makeDb(only(1, rows)).db).scan('tenant-1', { ...WINDOW, ...options });

    it('flags stock bought for more than its own shelf price', async () => {
        const result = await scan([purchaseLine({ unit_cost: 450, selling_price: 400, quantity: 10 })]);

        const [flag] = byType(result.anomalies, 'cost_above_selling_price');
        expect(flag.impact).toBe(500); // (450 - 400) × 10
        expect(flag.detail).toContain('shelf price');
    });

    it('flags a supplier charging above the usual unit cost, naming the supplier', async () => {
        const result = await scan([
            purchaseLine({ unit_cost: 600, selling_price: 900, median_cost: 300, quantity: 20 }),
        ]);

        const [flag] = byType(result.anomalies, 'cost_above_norm');
        expect(flag.party).toBe('Padma Foods');
        expect(flag.deviationPct).toBe(100);
        expect(flag.impact).toBe(6000);
        expect(flag.severity).toBe('high');
    });

    /**
     * Buying far below the usual cost is not a loss, but it is the signature of
     * a dropped digit — and an understated unit cost overstates gross margin on
     * every subsequent sale of that stock.
     */
    it('flags an unusually low unit cost as well as an unusually high one', async () => {
        const result = await scan([purchaseLine({ unit_cost: 30, median_cost: 300, selling_price: 400 })]);
        expect(byType(result.anomalies, 'cost_below_norm')).toHaveLength(1);
    });

    it('flags a zero-cost purchase line', async () => {
        const result = await scan([purchaseLine({ unit_cost: 0, median_cost: 300, quantity: 10 })]);

        const [flag] = byType(result.anomalies, 'zero_cost_line');
        expect(flag.impact).toBe(3000);
        expect(flag.detail).toContain('understated');
    });
});

describe('AnomalyDetectionService — duplicates, timing and refunds', () => {
    it('costs a duplicate group at the value of the suspected extra copies', async () => {
        const rows = [
            {
                document_date: '2026-07-14',
                branch: 'Gulshan',
                party: 'Karim Traders',
                amount: 12000,
                document_count: 3,
                documents: 'INV-1042, INV-1043, INV-1044',
            },
        ];
        const result = await new AnomalyDetectionService(makeDb(only(2, rows)).db).scan('tenant-1', WINDOW);

        const [flag] = byType(result.anomalies, 'duplicate_invoice');
        expect(flag.impact).toBe(24000); // two extra copies, not three
        expect(flag.document).toBe('INV-1042, INV-1043, INV-1044');
        expect(flag.severity).toBe('high');
    });

    it('reads a negative day gap as a future-dated entry', async () => {
        const rows = [
            {
                document: 'INV-2000',
                document_date: '2026-07-30',
                entered_date: '2026-07-02',
                branch: 'Gulshan',
                party: 'Walk-in customer',
                amount: 8000,
                day_gap: -28,
                entered_by: 'Rina',
            },
        ];
        const result = await new AnomalyDetectionService(makeDb(only(4, rows)).db).scan('tenant-1', WINDOW);

        const [flag] = byType(result.anomalies, 'backdated_entry');
        expect(flag.observed).toBe(28);
        expect(flag.detail).toContain('in the future');
        expect(flag.enteredBy).toBe('Rina');
    });

    it('costs an over-refund at the excess, not the whole refund', async () => {
        const rows = [
            {
                document: 'INV-900',
                document_date: '2026-06-30',
                branch: 'Gulshan',
                party: 'Karim Traders',
                sale_total: 5000,
                refunded: 6500,
                return_count: 3,
            },
        ];
        const result = await new AnomalyDetectionService(makeDb(only(5, rows)).db).scan('tenant-1', WINDOW);

        const [flag] = byType(result.anomalies, 'refund_exceeds_sale');
        expect(flag.impact).toBe(1500);
        expect(flag.severity).toBe('high');
        expect(flag.detail).toContain('3 returns');
    });
});

describe('AnomalyDetectionService — scan shape', () => {
    it('ranks high severity first and by impact within a severity', async () => {
        // `median_qty: null` keeps the quantity rule out of it — these rows exist
        // to test ranking, and a second flag per row would muddy the order.
        const rows = [
            // ৳170, 42% off the median — trips the rule, but neither material
            // nor extreme, so it sorts last.
            saleLine({ document: 'A', unit_price: 230, unit_cost: null, median_price: 400, quantity: 1, median_qty: null }),
            saleLine({ document: 'B', unit_price: 100, unit_cost: 400, quantity: 50, median_qty: null }), // ৳15,000
            saleLine({ document: 'C', unit_price: 300, unit_cost: 400, quantity: 20, median_qty: null }), // ৳2,000
        ];
        const result = await new AnomalyDetectionService(makeDb(only(0, rows)).db).scan('tenant-1', WINDOW);

        expect(result.anomalies.map((a) => a.document)).toEqual(['B', 'C', 'A']);
        expect(result.bySeverity).toEqual({ high: 1, medium: 1, low: 1 });
    });

    it('drops flags below the minimum impact', async () => {
        const rows = [saleLine({ unit_price: 399, unit_cost: 400, quantity: 1 })]; // ৳1 at stake
        const result = await new AnomalyDetectionService(makeDb(only(0, rows)).db).scan('tenant-1', WINDOW);

        // ৳100 is the `normal` preset's floor, so a one-taka discrepancy is not
        // worth a shopkeeper's attention and does not reach the model at all.
        expect(result.totalFlags).toBe(0);
    });

    it('summarises by type and totals the taka at stake', async () => {
        const rows = [
            saleLine({ document: 'A', unit_price: 100, unit_cost: 400, quantity: 10, median_qty: null }),
            saleLine({ document: 'B', unit_price: 0, unit_cost: 400, median_price: 400, quantity: 5, median_qty: null }),
        ];
        const result = await new AnomalyDetectionService(makeDb(only(0, rows)).db).scan('tenant-1', WINDOW);

        expect(result.byType).toEqual({ sold_below_cost: 1, zero_price_line: 1 });
        expect(result.totalImpact).toBe(5000); // 3,000 + 2,000
    });

    it('runs only the detectors a type filter needs', async () => {
        const { db, calls } = makeDb([[], [], [], [], [], []]);
        await new AnomalyDetectionService(db).scan('tenant-1', { ...WINDOW, types: ['duplicate_invoice'] });

        // Five of the six detectors are skipped entirely rather than filtered
        // after the fact — a scan for one rule should cost one query.
        expect(calls).toHaveLength(1);
        expect(calls[0].sql).toContain('HAVING count(*) > 1');
    });

    it('reports the baseline window it measured "usual" over', async () => {
        const { db } = makeDb([[], [], [], [], [], []]);
        const result = await new AnomalyDetectionService(db).scan('tenant-1', { ...WINDOW, baselineDays: 30 });

        expect(result.baselinePeriod).toEqual({ from: '2026-06-01', to: '2026-07-31' });
    });

    /**
     * A partial scan that names what broke beats an exception: five working
     * detectors are still worth returning, and the chatbot cannot retry.
     */
    it('survives one failing detector and still returns the rest', async () => {
        let call = 0;
        const db: any = {
            $queryRaw: jest.fn(() => {
                if (call++ === 0) return Promise.reject(new Error('statement timeout'));
                // Third query issued is the duplicate-sales detector.
                return Promise.resolve(call === 3 ? [{
                    document_date: '2026-07-14', branch: 'Gulshan', party: 'Karim Traders',
                    amount: 12000, document_count: 2, documents: 'INV-1, INV-2',
                }] : []);
            }),
        };

        const result = await new AnomalyDetectionService(db).scan('tenant-1', WINDOW);

        expect(result.totalFlags).toBe(1);
        expect(result.anomalies[0].type).toBe('duplicate_invoice');
        // Naming the casualty is the point: an empty list from a detector that
        // never ran is indistinguishable from one that found nothing, and the
        // caller would otherwise report a clean bill of health for a broken query.
        expect(result.failedDetectors).toEqual(['sale_lines']);
    });

    it('reports no failures on a scan where every query ran', async () => {
        const { db } = makeDb([[], [], [], [], [], []]);
        const result = await new AnomalyDetectionService(db).scan('tenant-1', WINDOW);
        expect(result.failedDetectors).toEqual([]);
    });

    it('exposes every declared type in ANOMALY_TYPES', () => {
        expect(new Set(ANOMALY_TYPES).size).toBe(ANOMALY_TYPES.length);
        expect(ANOMALY_TYPES).toContain('sold_below_cost');
        expect(ANOMALY_TYPES).toContain('refund_exceeds_sale');
    });
});
