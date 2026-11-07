'use client';

import { AlertTriangle } from 'lucide-react';
import { formatBDT } from '@/lib/format';

export interface Coverage {
    costedLines: number;
    uncostedLines: number;
    costedRevenue: number;
    uncostedRevenue: number;
    costedRevenuePct: number | null;
}

/**
 * How much of the revenue behind a margin actually has a cost on file.
 *
 * Shown on every gross-profit screen, because a margin computed over a third of
 * the basket is not a margin and a reader has no way to tell from the number
 * alone. Silent below 99.5% would be worse than useless — that is precisely the
 * case where the figure above it is misleading.
 */
export function CoverageNotice({
    coverage,
    locale,
    labels,
}: {
    coverage: Coverage | null | undefined;
    locale: string;
    labels: {
        full: string;
        partial: string;
        none: string;
        fixLink: string;
    };
}) {
    if (!coverage) return null;

    const pct = coverage.costedRevenuePct;

    if (pct === null || coverage.costedLines === 0) {
        return (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{labels.none}</span>
            </div>
        );
    }

    if (pct >= 99.5) {
        return (
            <div className="rounded-lg border border-gray-100 bg-white px-4 py-2.5 text-xs text-gray-500">
                {labels.full}
            </div>
        );
    }

    return (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
                <div>
                    {labels.partial
                        .replace('{pct}', pct.toFixed(1))
                        .replace('{amount}', formatBDT(coverage.uncostedRevenue, { locale }))
                        .replace('{lines}', String(coverage.uncostedLines))}
                </div>
                <div className="mt-1 font-medium">{labels.fixLink}</div>
            </div>
        </div>
    );
}

/**
 * A margin percentage, or an explicit "no cost basis" when there is none.
 *
 * Never renders null as 0% — that reads as "we broke even" rather than "we
 * cannot say", and the two lead to opposite decisions.
 */
export function MarginCell({ value, dash }: { value: number | null | undefined; dash: string }) {
    if (value === null || value === undefined) {
        return <span className="text-gray-400">{dash}</span>;
    }
    const tone = value < 0 ? 'text-red-600' : value < 10 ? 'text-amber-600' : 'text-emerald-600';
    return <span className={`font-semibold ${tone}`}>{value.toFixed(1)}%</span>;
}

/** Money that carries meaning in its sign — a loss is red, not merely negative. */
export function ProfitCell({
    value,
    locale,
    dash,
}: {
    value: number | null | undefined;
    locale: string;
    dash: string;
}) {
    if (value === null || value === undefined) {
        return <span className="text-gray-400">{dash}</span>;
    }
    return (
        <span className={value < 0 ? 'font-semibold text-red-600' : 'font-semibold text-gray-900'}>
            {formatBDT(value, { locale })}
        </span>
    );
}

/**
 * Where a row's margin falls, for the Margin chip: a loss, under 10%, 10% or
 * more, or no cost on file at all — the same bands `MarginCell` colours red,
 * amber and green.
 */
export type MarginBand = 'loss' | 'thin' | 'healthy' | 'noCost';

export const MARGIN_BANDS: readonly MarginBand[] = ['loss', 'thin', 'healthy', 'noCost'];

export function marginBand(marginPct: number | null | undefined): MarginBand {
    if (marginPct === null || marginPct === undefined) return 'noCost';
    if (marginPct < 0) return 'loss';
    return marginPct < 10 ? 'thin' : 'healthy';
}

/** The figures a gross-profit report's rows carry, whatever they are grouped by. */
export interface MarginRowFigures {
    revenue: number;
    cogs: number;
    grossProfit: number | null;
    coverage: Coverage;
}

/**
 * The totals over a set of rows, worked the way the server works its own
 * summary: profit only where a cost is on file, and the margin over the
 * revenue that cost belongs to. So the strip over the rows a chip leaves
 * reads the same as the server's figure when no chip is set.
 */
export function sumMarginRows(rows: readonly MarginRowFigures[]) {
    let revenue = 0;
    let cogs = 0;
    let grossProfit = 0;
    let costedRevenue = 0;
    let costedLines = 0;
    for (const row of rows) {
        revenue += row.revenue;
        cogs += row.cogs;
        if (row.grossProfit !== null) grossProfit += row.grossProfit;
        costedRevenue += row.coverage.costedRevenue;
        costedLines += row.coverage.costedLines;
    }
    const hasBasis = costedLines > 0;
    return {
        revenue,
        cogs,
        grossProfit: hasBasis ? grossProfit : null,
        grossMarginPct: hasBasis && costedRevenue > 0 ? (grossProfit / costedRevenue) * 100 : null,
    };
}
