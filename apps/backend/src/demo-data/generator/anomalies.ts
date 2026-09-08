/**
 * Deliberate oddities planted in the generated trading history.
 *
 * A demo dataset made only of well-behaved transactions is useless for showing
 * what the reports are *for*: nothing is ever below cost, no drawer is ever
 * short, every bill is paid once. So the simulator plants a small, known set of
 * anomalies — the kinds a Bangladeshi retailer actually gets burned by — and
 * writes down exactly what it planted.
 *
 * Two rules keep this honest:
 *
 * 1. **Anomalies are unusual, never the baseline.** Rates are per simulated
 *    month and low enough that a margin or cash-variance report still reads as
 *    "mostly fine, with these exceptions".
 * 2. **An anomaly is never an inconsistency.** Every one of these is written
 *    through the same inventory and posting primitives as an ordinary row, so
 *    the trial balance still balances and stock still ties to its movements. The
 *    data is odd *as business*, not corrupt as data — otherwise the demo would
 *    be showing off a bug.
 *
 * The recorded list is the answer key: it ships back on the batch so whoever is
 * running the demo knows which invoice to open.
 */

import type { Rng } from './rng';

export type AnomalyKind =
    | 'BELOW_COST_SALE'
    | 'DEEP_DISCOUNT_SALE'
    | 'AFTER_HOURS_SALE'
    | 'DUPLICATE_INVOICE'
    | 'ROUND_NUMBER_CASH_SPIKE'
    | 'CREDIT_LIMIT_BREACH'
    | 'RAPID_FULL_RETURN'
    | 'SUPPLIER_PRICE_SPIKE'
    | 'DUPLICATE_SUPPLIER_BILL'
    | 'SUPPLIER_OVERPAYMENT'
    | 'EXPENSE_SPIKE'
    | 'CASH_DRAWER_SHORTAGE'
    | 'LARGE_SHRINKAGE'
    | 'STOCK_TAKE_VARIANCE'
    | 'ROUND_TRIP_TRANSFER'
    | 'STALE_CREDIT_DEBT';

export type AnomalySeverity = 'low' | 'medium' | 'high';

export interface AnomalyKindSpec {
    kind: AnomalyKind;
    /** Which part of the app surfaces it. */
    module: string;
    severity: AnomalySeverity;
    /** Short human label, also used to tag the row's own notes field. */
    label: string;
    /** Where to look in the app to find it. */
    hint: string;
    /** Roughly how many to plant per 30 simulated days. */
    ratePerMonth: number;
    /** Earliest day index this can land on — some need history behind them. */
    minDayIndex: number;
}

export const ANOMALY_KINDS: readonly AnomalyKindSpec[] = [
    {
        kind: 'BELOW_COST_SALE',
        module: 'sales',
        severity: 'high',
        label: 'sold below cost',
        hint: 'Sales → Profit by product: this invoice books a negative gross margin.',
        ratePerMonth: 1.5,
        minDayIndex: 2,
    },
    {
        kind: 'DEEP_DISCOUNT_SALE',
        module: 'sales',
        severity: 'medium',
        label: 'discount far below list price',
        hint: 'Sales report: the line price is ~60% under the product’s list price.',
        ratePerMonth: 2,
        minDayIndex: 2,
    },
    {
        kind: 'AFTER_HOURS_SALE',
        module: 'sales',
        severity: 'medium',
        label: 'sale outside trading hours',
        hint: 'Sales by hour: an invoice stamped around 03:00, when the shop is shut.',
        ratePerMonth: 1,
        minDayIndex: 3,
    },
    {
        kind: 'DUPLICATE_INVOICE',
        module: 'sales',
        severity: 'high',
        label: 'duplicate invoice minutes apart',
        hint: 'Two invoices, same customer, same lines, same total, minutes apart.',
        ratePerMonth: 0.7,
        minDayIndex: 5,
    },
    {
        kind: 'ROUND_NUMBER_CASH_SPIKE',
        module: 'sales',
        severity: 'medium',
        label: 'large round-number cash sale',
        hint: 'A cash sale for an exact round amount, far above the usual basket.',
        ratePerMonth: 0.8,
        minDayIndex: 4,
    },
    {
        kind: 'CREDIT_LIMIT_BREACH',
        module: 'customers',
        severity: 'high',
        label: 'credit sale past the customer’s limit',
        hint: 'Customer ledger: due balance sits above the customer’s credit limit.',
        ratePerMonth: 0.8,
        minDayIndex: 6,
    },
    {
        kind: 'RAPID_FULL_RETURN',
        module: 'sales',
        severity: 'medium',
        label: 'whole invoice returned next day',
        hint: 'Sales returns: an entire invoice comes back the day after it was rung up.',
        ratePerMonth: 0.8,
        minDayIndex: 7,
    },
    {
        kind: 'SUPPLIER_PRICE_SPIKE',
        module: 'purchases',
        severity: 'high',
        label: 'supplier billed far above the usual unit cost',
        hint: 'Purchase report: same SKU, same supplier, ~2.5× the usual unit cost.',
        ratePerMonth: 1,
        minDayIndex: 8,
    },
    {
        kind: 'DUPLICATE_SUPPLIER_BILL',
        module: 'purchases',
        severity: 'high',
        label: 'same bill entered twice',
        hint: 'Two purchases from one supplier, same day, same amount — paid twice.',
        ratePerMonth: 0.5,
        minDayIndex: 10,
    },
    {
        kind: 'SUPPLIER_OVERPAYMENT',
        module: 'suppliers',
        severity: 'medium',
        label: 'supplier paid more than was owed',
        hint: 'Supplier ledger: the payable goes negative — we are now in credit.',
        ratePerMonth: 0.5,
        minDayIndex: 12,
    },
    {
        kind: 'EXPENSE_SPIKE',
        module: 'expenses',
        severity: 'medium',
        label: 'expense far above its usual level',
        hint: 'Expenses by category: one month is several times its neighbours.',
        ratePerMonth: 0.5,
        minDayIndex: 8,
    },
    {
        kind: 'CASH_DRAWER_SHORTAGE',
        module: 'cashier',
        severity: 'high',
        label: 'cash drawer short at close',
        hint: 'Cashier sessions: closing cash lands well below the opening float.',
        ratePerMonth: 0.8,
        minDayIndex: 5,
    },
    {
        kind: 'LARGE_SHRINKAGE',
        module: 'inventory',
        severity: 'high',
        label: 'large single stock write-off',
        hint: 'Shrinkage report: one write-off dwarfs the routine one-or-two-unit losses.',
        ratePerMonth: 0.6,
        minDayIndex: 10,
    },
    {
        kind: 'STOCK_TAKE_VARIANCE',
        module: 'inventory',
        severity: 'medium',
        label: 'stock take off by a large margin',
        hint: 'Stock take: a counted line differs from expected by far more than the usual ±2.',
        ratePerMonth: 0.35,
        minDayIndex: 20,
    },
    {
        kind: 'ROUND_TRIP_TRANSFER',
        module: 'inventory',
        severity: 'low',
        label: 'stock transferred out and straight back',
        hint: 'Transfers: the same quantity leaves and returns the same day.',
        ratePerMonth: 0.5,
        minDayIndex: 14,
    },
    {
        kind: 'STALE_CREDIT_DEBT',
        module: 'customers',
        severity: 'medium',
        label: 'credit sale never settled',
        hint: 'Ageing report: a receivable sitting well past every other open balance.',
        ratePerMonth: 0.6,
        minDayIndex: 3,
    },
];

const SPEC_BY_KIND = new Map<AnomalyKind, AnomalyKindSpec>(ANOMALY_KINDS.map((s) => [s.kind, s]));

export function anomalySpec(kind: AnomalyKind): AnomalyKindSpec {
    const spec = SPEC_BY_KIND.get(kind);
    if (!spec) throw new Error(`Unknown demo anomaly kind: ${kind}`);
    return spec;
}

/**
 * Text stamped into the row's own notes/description column. Anomalies are meant
 * to be *found*, not hidden — a demo where the presenter cannot point at the
 * offending invoice is worthless — so the row says what it is.
 */
export function anomalyNote(kind: AnomalyKind): string {
    return `Demo anomaly — ${anomalySpec(kind).label}`;
}

/** One planted anomaly, as reported back on the batch. */
export interface DemoAnomaly {
    kind: AnomalyKind;
    module: string;
    severity: AnomalySeverity;
    label: string;
    hint: string;
    /** ISO date of the transaction it landed on. */
    occurredAt: string;
    /** Prisma model name of the row, e.g. 'Sale'. */
    entity: string;
    entityId: string;
    /** The document number an operator would search for. */
    reference?: string;
    /** What specifically is odd about this one, with the numbers filled in. */
    detail: string;
}

/** Collects the anomalies actually written, in the order they happened. */
export class AnomalyRecorder {
    private readonly items: DemoAnomaly[] = [];

    record(
        kind: AnomalyKind,
        row: { occurredAt: Date; entity: string; entityId: string; reference?: string; detail: string },
    ): void {
        const spec = anomalySpec(kind);
        this.items.push({
            kind,
            module: spec.module,
            severity: spec.severity,
            label: spec.label,
            hint: spec.hint,
            occurredAt: row.occurredAt.toISOString(),
            entity: row.entity,
            entityId: row.entityId,
            reference: row.reference,
            detail: row.detail,
        });
    }

    get count(): number {
        return this.items.length;
    }

    list(): DemoAnomaly[] {
        return this.items;
    }

    /** Per-kind tallies, for the batch summary. */
    countsByKind(): Record<string, number> {
        const out: Record<string, number> = {};
        for (const item of this.items) out[item.kind] = (out[item.kind] ?? 0) + 1;
        return out;
    }
}

/**
 * A schedule of which anomalies to attempt on which simulated day, drawn up
 * before the run so the spread is even rather than clumping wherever the RNG
 * happened to roll low.
 */
export class AnomalyPlan {
    private readonly byDay = new Map<number, AnomalyKind[]>();

    constructor(entries: Array<{ dayIndex: number; kind: AnomalyKind }> = []) {
        for (const entry of entries) {
            const list = this.byDay.get(entry.dayIndex);
            if (list) list.push(entry.kind);
            else this.byDay.set(entry.dayIndex, [entry.kind]);
        }
    }

    /** Every anomaly scheduled for this day (usually none). */
    forDay(dayIndex: number): readonly AnomalyKind[] {
        return this.byDay.get(dayIndex) ?? [];
    }

    has(dayIndex: number, kind: AnomalyKind): boolean {
        return this.forDay(dayIndex).includes(kind);
    }

    /** Total scheduled — the ceiling on how many can actually be recorded. */
    get size(): number {
        let total = 0;
        for (const kinds of this.byDay.values()) total += kinds.length;
        return total;
    }
}

/** An empty plan — what an `includeAnomalies: false` batch runs with. */
export const NO_ANOMALIES = new AnomalyPlan();

/**
 * Draw up the anomaly schedule for a window of `totalDays`.
 *
 * Counts are `ratePerMonth` scaled by the window, rounded so that a short window
 * still gets at least one of the high-severity kinds — a two-week demo dataset
 * with no anomalies at all would defeat the point.
 */
export function planAnomalies(rng: Rng, totalDays: number): AnomalyPlan {
    const months = totalDays / 30;
    const entries: Array<{ dayIndex: number; kind: AnomalyKind }> = [];

    for (const spec of ANOMALY_KINDS) {
        const expected = spec.ratePerMonth * months;
        // Round probabilistically so a 0.4-expected kind shows up in ~40% of runs
        // instead of never (Math.round) or always (Math.ceil).
        const whole = Math.floor(expected);
        const count = whole + (rng.chance(expected - whole) ? 1 : 0);
        const earliest = Math.min(spec.minDayIndex, Math.max(0, totalDays - 1));

        for (let i = 0; i < count; i++) {
            if (earliest >= totalDays) break;
            entries.push({ dayIndex: rng.int(earliest, totalDays - 1), kind: spec.kind });
        }
    }

    return new AnomalyPlan(entries);
}
