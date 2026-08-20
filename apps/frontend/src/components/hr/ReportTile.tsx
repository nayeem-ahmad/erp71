'use client';

/**
 * One KPI on an HR report.
 *
 * Lifted out of the hour-log report's page-local `Tile` because eight report
 * pages copying the same twelve lines is how a KPI row ends up looking
 * different on every screen in the module.
 */
export default function ReportTile({
    label,
    value,
    hint,
    accent,
}: {
    label: string;
    value: string;
    hint?: string | null;
    accent?: boolean;
}) {
    return (
        <div className="rounded-lg border border-gray-100 bg-white p-3">
            <div className="text-xs font-medium text-gray-500">{label}</div>
            <div
                className={`mt-1 text-xl font-semibold tabular-nums ${accent ? 'text-blue-600' : 'text-gray-900'}`}
            >
                {value}
            </div>
            {hint ? <div className="mt-0.5 text-xs text-gray-400">{hint}</div> : null}
        </div>
    );
}
