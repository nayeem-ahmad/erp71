'use client';

import type { ReactNode } from 'react';
import { useUiStyle } from '@/lib/ui-theme';

export type DashboardRange = 'today' | 'week' | 'month';

/**
 * The today/week/month switcher on its own, so a dashboard embedded under an
 * existing page header (CRM Overview) can offer the same control without the
 * greeting block that would duplicate that header.
 */
export function RangeTabs({
    range,
    onRangeChange,
    labels,
}: {
    range: DashboardRange;
    onRangeChange: (r: DashboardRange) => void;
    labels: Record<DashboardRange, string>;
}) {
    const ranges: DashboardRange[] = ['today', 'week', 'month'];
    const { polished } = useUiStyle();
    if (polished) {
        // One segmented control, so the three options read as one choice.
        return (
            <div className="inline-flex rounded-lg bg-gray-200/60 p-0.5">
                {ranges.map((r) => (
                    <button
                        key={r}
                        type="button"
                        onClick={() => onRangeChange(r)}
                        aria-pressed={r === range}
                        className={`rounded-md px-3 py-1 text-xs font-medium transition-all max-md:min-h-touch ${
                            r === range ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                        }`}
                    >
                        {labels[r]}
                    </button>
                ))}
            </div>
        );
    }
    return (
        <div className="flex gap-1">
            {ranges.map((r) => (
                <button
                    key={r}
                    type="button"
                    onClick={() => onRangeChange(r)}
                    className={`rounded-lg border px-2.5 py-1 text-[10px] font-bold transition-colors ${
                        r === range
                            ? 'border-primary bg-primary text-white'
                            : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                    }`}
                >
                    {labels[r]}
                </button>
            ))}
        </div>
    );
}

export function DashboardHeader({
    greeting,
    tenantName,
    subtitle,
    range,
    onRangeChange,
    labels,
    toolbar,
}: {
    greeting: string;
    tenantName: string;
    subtitle: string;
    range: DashboardRange;
    onRangeChange: (r: DashboardRange) => void;
    labels: Record<DashboardRange, string>;
    /** Extra controls beside the range switcher — see `ModuleDashboard`. */
    toolbar?: ReactNode;
}) {
    const { polished } = useUiStyle();
    return (
        <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
                <h1 className={polished ? 'text-xl font-semibold tracking-tight text-gray-950' : 'text-lg font-extrabold tracking-tight text-gray-900'}>{greeting}</h1>
                <p className={`mt-0.5 ${polished ? 'text-sm' : 'text-[11px]'} text-gray-500`}>
                    {tenantName} · {subtitle}
                </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                {toolbar}
                <RangeTabs range={range} onRangeChange={onRangeChange} labels={labels} />
            </div>
        </div>
    );
}
