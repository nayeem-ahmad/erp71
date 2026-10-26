'use client';

import type { ReactNode } from 'react';

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

/**
 * A list's figures in one short row of tiles — about 46px, so the rows stay
 * on screen. The figures describe the rows the list's filters match, not the
 * page on screen. On a phone the row scrolls sideways inside itself.
 */
export default function ListStats({ stats, loading = false, label }: { stats: ListStat[]; loading?: boolean; label: string }) {
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
                    {loading ? (
                        <span aria-hidden className="mt-0.5 block h-5 w-20 animate-pulse rounded bg-gray-100" />
                    ) : (
                        <p className={`whitespace-nowrap text-sm font-semibold leading-5 tabular-nums ${TONE_CLASS[stat.tone ?? 'default']}`}>
                            {stat.value}
                            {stat.hint ? <span className="ms-1 text-[11px] font-normal text-gray-400">· {stat.hint}</span> : null}
                        </p>
                    )}
                </div>
            ))}
        </section>
    );
}
