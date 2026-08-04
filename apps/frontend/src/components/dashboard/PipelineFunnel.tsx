'use client';

import Link from 'next/link';

export type FunnelStage = {
    id: string;
    label: string;
    count: number;
    href: string;
    /** Set on the terminal outcomes, which are drawn apart from the open stages. */
    outcome?: 'won' | 'lost';
};

/**
 * Lead stage counts as horizontal bars.
 *
 * Deliberately not a tapered funnel polygon. The stages here are not nested
 * subsets — a lead can go NEW → LOST without ever being CONTACTED — so a
 * shrinking silhouette would assert a containment that is not true, and it would
 * encode the count in an area nobody can compare. Bars share one baseline.
 *
 * Stage is an *ordinal* dimension, so the open stages step down one hue rather
 * than taking four categorical colors. The two outcomes sit below a rule: won is
 * emerald because it is the good end state, lost is gray because losing a deal is
 * an outcome, not an error.
 */
export function PipelineFunnel({
    title,
    subtitle,
    stages,
    emptyLabel,
    formatCount,
}: {
    title: string;
    subtitle?: string;
    stages: FunnelStage[];
    emptyLabel: string;
    formatCount: (count: number, share: number | null) => string;
}) {
    const max = Math.max(...stages.map((stage) => stage.count), 0);
    const openTotal = stages
        .filter((stage) => !stage.outcome)
        .reduce((sum, stage) => sum + stage.count, 0);
    const hasAny = stages.some((stage) => stage.count > 0);

    const fillFor = (stage: FunnelStage, index: number) => {
        if (stage.outcome === 'won') return 'bg-emerald-500';
        if (stage.outcome === 'lost') return 'bg-gray-300';
        return ['bg-blue-600', 'bg-blue-500', 'bg-blue-400', 'bg-blue-300'][Math.min(index, 3)];
    };

    return (
        <div className="rounded-xl border border-gray-100 bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <h3 className="text-xs font-bold text-gray-900">{title}</h3>
            {subtitle ? <p className="mt-0.5 text-[10px] text-gray-400">{subtitle}</p> : null}

            {!hasAny ? (
                <p className="py-6 text-center text-[11px] text-gray-400">{emptyLabel}</p>
            ) : (
                <ul className="mt-2 space-y-1.5">
                    {stages.map((stage, index) => {
                        const share = stage.outcome || openTotal === 0
                            ? null
                            : Math.round((stage.count / openTotal) * 100);
                        // Widths are relative to the biggest bar, so a pipeline of
                        // 3 / 2 / 1 is still readable rather than three slivers.
                        const width = max === 0 ? 0 : Math.max((stage.count / max) * 100, stage.count > 0 ? 4 : 0);

                        return (
                            <li key={stage.id} className={stage.outcome === 'won' ? 'border-t border-gray-100 pt-2.5' : ''}>
                                <Link
                                    href={stage.href}
                                    className="flex min-h-touch items-center gap-2 rounded-lg px-1 py-1 transition-colors hover:bg-gray-50 md:min-h-0"
                                >
                                    <span className="w-20 shrink-0 truncate text-[11px] font-semibold text-gray-700">
                                        {stage.label}
                                    </span>
                                    <span className="h-4 min-w-0 flex-1 rounded-sm bg-gray-50">
                                        <span
                                            className={`block h-4 rounded-r-[4px] ${fillFor(stage, index)}`}
                                            style={{ width: `${width}%` }}
                                        />
                                    </span>
                                    <span className="w-20 shrink-0 text-right text-[11px] font-bold tabular-nums text-gray-900">
                                        {formatCount(stage.count, share)}
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
