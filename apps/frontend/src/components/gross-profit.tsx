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

/** One headline figure. */
export function StatTile({
    label,
    children,
    tone = 'default',
}: {
    label: string;
    children: React.ReactNode;
    tone?: 'default' | 'primary' | 'danger';
}) {
    const toneClass =
        tone === 'primary' ? 'text-blue-700' : tone === 'danger' ? 'text-red-600' : 'text-gray-900';
    return (
        <div className="bg-white border border-gray-100 rounded-lg p-5">
            <div className="text-xs font-medium text-gray-500">{label}</div>
            <div className={`text-2xl font-bold mt-2 ${toneClass}`}>{children}</div>
        </div>
    );
}
