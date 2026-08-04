'use client';

import Link from 'next/link';

export type OrdinalBar = {
    id: string;
    label: string;
    count: number;
    href: string;
    /** Drawn below a rule, in its own colour, and left out of the share base. */
    outcome?: 'won' | 'lost';
};

/** Monotone steps, because the dimension is ordinal — not four categorical hues. */
const STEPS = ['bg-blue-600', 'bg-blue-500', 'bg-blue-400', 'bg-blue-300', 'bg-blue-200'];

/**
 * Counts across an *ordinal* dimension — lead stages, stock age — as horizontal
 * bars sharing one baseline.
 *
 * Deliberately not a tapered funnel polygon. These rows are not nested subsets —
 * a lead can go NEW → LOST without ever being CONTACTED, and stock does not pass
 * through 31-60 days on its way to 0-30 — so a shrinking silhouette would assert
 * a containment that is not true, and it would encode the count in an area nobody
 * can compare.
 */
export function OrdinalBars({
    title,
    subtitle,
    bars,
    emptyLabel,
    formatCount,
}: Readonly<{
    title: string;
    subtitle?: string;
    bars: OrdinalBar[];
    emptyLabel: string;
    formatCount: (count: number, share: number | null) => string;
}>) {
    const max = Math.max(...bars.map((bar) => bar.count), 0);
    const shareBase = bars
        .filter((bar) => !bar.outcome)
        .reduce((sum, bar) => sum + bar.count, 0);
    const hasAny = bars.some((bar) => bar.count > 0);

    const fillFor = (bar: OrdinalBar, index: number) => {
        if (bar.outcome === 'won') return 'bg-emerald-500';
        // An outcome, not an error state — losing a deal never gets red.
        if (bar.outcome === 'lost') return 'bg-gray-300';
        return STEPS[Math.min(index, STEPS.length - 1)];
    };

    return (
        <div className="rounded-xl border border-gray-100 bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <h3 className="text-xs font-bold text-gray-900">{title}</h3>
            {subtitle ? <p className="mt-0.5 text-[10px] text-gray-400">{subtitle}</p> : null}

            {!hasAny ? (
                <p className="py-6 text-center text-[11px] text-gray-400">{emptyLabel}</p>
            ) : (
                <ul className="mt-2 space-y-1.5">
                    {bars.map((bar, index) => {
                        const share = bar.outcome || shareBase === 0
                            ? null
                            : Math.round((bar.count / shareBase) * 100);
                        // Widths are relative to the biggest bar, so 3 / 2 / 1 is
                        // still readable rather than three slivers.
                        const width = max === 0 ? 0 : Math.max((bar.count / max) * 100, bar.count > 0 ? 4 : 0);

                        return (
                            <li key={bar.id} className={bar.outcome === 'won' ? 'border-t border-gray-100 pt-2.5' : ''}>
                                <Link
                                    href={bar.href}
                                    className="flex min-h-touch items-center gap-2 rounded-lg px-1 py-1 transition-colors hover:bg-gray-50 md:min-h-0"
                                >
                                    <span className="w-20 shrink-0 truncate text-[11px] font-semibold text-gray-700">
                                        {bar.label}
                                    </span>
                                    <span className="h-4 min-w-0 flex-1 rounded-sm bg-gray-50">
                                        <span
                                            className={`block h-4 rounded-r-[4px] ${fillFor(bar, index)}`}
                                            style={{ width: `${width}%` }}
                                        />
                                    </span>
                                    <span className="w-20 shrink-0 text-right text-[11px] font-bold tabular-nums text-gray-900">
                                        {formatCount(bar.count, share)}
                                    </span>
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
