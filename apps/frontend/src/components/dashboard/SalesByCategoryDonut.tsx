'use client';

export type CategoryRow = {
    categoryId: string | null;
    categoryName: string;
    revenue: number;
    share: number;
};

const PALETTE = ['#6366f1', '#22c55e', '#f59e0b', '#06b6d4', '#ec4899', '#e2e8f0'];

export function SalesByCategoryDonut({
    rows,
    totalLabel,
    emptyLabel,
}: {
    rows: CategoryRow[];
    totalLabel: string;
    emptyLabel: string;
}) {
    if (!rows.length) {
        return (
            <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-xs font-medium text-gray-400">
                {emptyLabel}
            </div>
        );
    }

    let cursor = 0;
    const stops = rows
        .map((row, i) => {
            const start = cursor;
            cursor += row.share;
            return `${PALETTE[i % PALETTE.length]} ${start}% ${cursor}%`;
        })
        .join(', ');

    return (
        <div className="flex items-center gap-4">
            <div
                className="relative h-24 w-24 shrink-0 rounded-full"
                style={{ background: `conic-gradient(${stops})` }}
                aria-hidden="true"
            >
                <div className="absolute inset-6 flex flex-col items-center justify-center rounded-full bg-white">
                    <span className="text-xs font-extrabold text-slate-900">{totalLabel}</span>
                </div>
            </div>
            <ul className="min-w-0 flex-1 space-y-1">
                {rows.map((row, i) => (
                    <li key={row.categoryId ?? row.categoryName} className="flex items-center gap-2 text-[11px] text-slate-700">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
                        <span className="truncate">{row.categoryName}</span>
                        <span className="ml-auto font-extrabold text-slate-900">{Math.round(row.share)}%</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
