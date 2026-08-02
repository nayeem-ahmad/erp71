'use client';

export type AgingBuckets = {
    current: number;
    overdue_31_60: number;
    overdue_61_90: number;
    overdue_90_plus: number;
};

export type AgingRow = {
    id: string;
    label: string;
    buckets: AgingBuckets;
};

/**
 * Receivable and payable side by side across the four aging buckets. The oldest
 * column is emphasised because that is the number an accountant acts on — the
 * others are context for it.
 */
export function AgingPanel({
    title,
    rows,
    columnLabels,
    formatAmount,
    emptyLabel,
}: {
    title: string;
    rows: AgingRow[];
    columnLabels: { current: string; d3160: string; d6190: string; d90plus: string };
    formatAmount: (value: number) => string;
    emptyLabel: string;
}) {
    return (
        <div className="rounded-xl border border-gray-100 bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <h3 className="mb-2 text-xs font-bold text-gray-900">{title}</h3>
            {rows.length === 0 ? (
                <p className="py-4 text-center text-[11px] text-gray-400">{emptyLabel}</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-[11px]">
                        <thead>
                            <tr className="text-left text-[10px] font-bold uppercase tracking-wide text-gray-400">
                                <th className="pb-1.5 font-bold" />
                                <th className="pb-1.5 text-right font-bold">{columnLabels.current}</th>
                                <th className="pb-1.5 text-right font-bold">{columnLabels.d3160}</th>
                                <th className="pb-1.5 text-right font-bold">{columnLabels.d6190}</th>
                                <th className="pb-1.5 text-right font-bold">{columnLabels.d90plus}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => (
                                <tr key={row.id} className="border-t border-gray-50">
                                    <td className="py-1.5 pr-2 font-semibold text-gray-900">{row.label}</td>
                                    <td className="py-1.5 text-right tabular-nums text-gray-600">
                                        {formatAmount(row.buckets.current)}
                                    </td>
                                    <td className="py-1.5 text-right tabular-nums text-gray-600">
                                        {formatAmount(row.buckets.overdue_31_60)}
                                    </td>
                                    <td className="py-1.5 text-right tabular-nums text-gray-600">
                                        {formatAmount(row.buckets.overdue_61_90)}
                                    </td>
                                    <td
                                        className={`py-1.5 text-right font-bold tabular-nums ${
                                            row.buckets.overdue_90_plus > 0 ? 'text-danger-text' : 'text-gray-600'
                                        }`}
                                    >
                                        {formatAmount(row.buckets.overdue_90_plus)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
