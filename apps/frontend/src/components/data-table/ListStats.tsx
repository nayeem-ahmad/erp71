'use client';

import type { ReactNode } from 'react';
import { useUiStyle } from '@/lib/ui-theme';

/** One figure in the strip above a list. */
export interface ListStat {
    id: string;
    label: string;
    value: string;
    /** A word after the figure — "7 cancelled", "88%". */
    hint?: string;
    /** Amber for money still owed, red for money given back; the figure itself carries the tone. */
    tone?: 'default' | 'warning' | 'danger';
    icon?: ReactNode;
}

const TONE_CLASS: Record<NonNullable<ListStat['tone']>, string> = {
    default: 'text-gray-900',
    warning: 'text-amber-700',
    danger: 'text-red-600',
};

// COLORFUL: each tile takes the next hue for its icon chip and top bar, so neighbours never match.
const CHIP_CLASS = [
    'bg-violet-100 text-violet-600', 'bg-sky-100 text-sky-600', 'bg-emerald-100 text-emerald-600',
    'bg-orange-100 text-orange-600', 'bg-pink-100 text-pink-600', 'bg-teal-100 text-teal-600',
];
const BAR_CLASS = ['bg-violet-500', 'bg-sky-500', 'bg-emerald-500', 'bg-orange-500', 'bg-pink-500', 'bg-teal-500'];

/**
 * A list's figures in one short row of tiles — about 46px, so the rows stay
 * on screen. The figures describe the rows the list's filters match, not the
 * page on screen. On a phone the row scrolls sideways inside itself.
 */
export default function ListStats({ stats, loading = false, label }: { stats: ListStat[]; loading?: boolean; label: string }) {
    const { colorful } = useUiStyle();
    if (colorful) {
        return (
            <section aria-label={label} aria-busy={loading || undefined} className="flex gap-2 overflow-x-auto [scrollbar-width:thin]">
                {stats.map((stat, index) => (
                    <div
                        key={stat.id}
                        className="relative flex min-w-[9.5rem] flex-1 items-center gap-2.5 overflow-hidden rounded-lg border border-gray-200/70 bg-white px-3 py-2"
                    >
                        <span aria-hidden className={`absolute inset-x-0 top-0 h-0.5 ${BAR_CLASS[index % BAR_CLASS.length]}`} />
                        {stat.icon ? (
                            <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg [&>svg]:h-4 [&>svg]:w-4 ${CHIP_CLASS[index % CHIP_CLASS.length]}`}>
                                {stat.icon}
                            </span>
                        ) : null}
                        <div className="min-w-0">
                            <p className="text-[11px] font-medium leading-4 text-gray-500">{stat.label}</p>
                            <StatFigure stat={stat} loading={loading} />
                        </div>
                    </div>
                ))}
            </section>
        );
    }
    return (
        <section aria-label={label} aria-busy={loading || undefined} className="flex gap-2 overflow-x-auto [scrollbar-width:thin]">
            {stats.map((stat) => (
                <div
                    key={stat.id}
                    className="min-w-[8.5rem] flex-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5"
                >
                    <p className="flex items-center gap-1 text-[11px] font-medium leading-4 text-gray-500 [&>svg]:h-3 [&>svg]:w-3">
                        {stat.icon}
                        {stat.label}
                    </p>
                    <StatFigure stat={stat} loading={loading} />
                </div>
            ))}
        </section>
    );
}

function StatFigure({ stat, loading }: { stat: ListStat; loading: boolean }) {
    if (loading) return <span aria-hidden className="mt-0.5 block h-5 w-20 animate-pulse rounded bg-gray-100" />;
    return (
        <p className={`whitespace-nowrap text-sm font-semibold leading-5 tabular-nums ${TONE_CLASS[stat.tone ?? 'default']}`}>
            {stat.value}
            {stat.hint ? <span className="ms-1 text-[11px] font-normal text-gray-400">· {stat.hint}</span> : null}
        </p>
    );
}
