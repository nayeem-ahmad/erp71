'use client';

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
}: {
    greeting: string;
    tenantName: string;
    subtitle: string;
    range: DashboardRange;
    onRangeChange: (r: DashboardRange) => void;
    labels: Record<DashboardRange, string>;
}) {
    return (
        <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
                <h1 className="text-lg font-extrabold tracking-tight text-gray-900">{greeting}</h1>
                <p className="mt-0.5 text-[11px] text-gray-500">
                    {tenantName} · {subtitle}
                </p>
            </div>
            <RangeTabs range={range} onRangeChange={onRangeChange} labels={labels} />
        </div>
    );
}
