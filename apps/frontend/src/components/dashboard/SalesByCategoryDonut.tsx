'use client';

export type CategoryRow = {
    categoryId: string | null;
    categoryName: string;
    revenue: number;
    share: number;
};

/**
 * Six categorical hues, validated on the white card surface: all inside the
 * lightness band and above the chroma floor, worst adjacent pair ΔE 9.1 under
 * simulated colour-vision deficiency and 19.6 with normal vision.
 *
 * Three of these sit below 3:1 contrast against white, so the legend always
 * prints the share as text — colour never carries the meaning on its own.
 */
export const CATEGORY_PALETTE = ['#2563eb', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'] as const;

const SIZE = 132;
const RADIUS = 52;
const STROKE = 19;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
// Separates neighbouring arcs with the card surface rather than a drawn border.
const GAP = 2;

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

    const total = rows.reduce((sum, row) => sum + row.share, 0) || 100;

    let cursor = 0;
    const arcs = rows.map((row, index) => {
        const length = (row.share / total) * CIRCUMFERENCE;
        const offset = cursor;
        cursor += length;
        return {
            key: row.categoryId ?? row.categoryName,
            color: CATEGORY_PALETTE[index % CATEGORY_PALETTE.length],
            visible: Math.max(1, length - GAP),
            offset,
        };
    });

    return (
        <div className="flex flex-wrap items-center gap-4">
            <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
                <svg
                    viewBox={`0 0 ${SIZE} ${SIZE}`}
                    width={SIZE}
                    height={SIZE}
                    className="-rotate-90"
                    role="img"
                    aria-label={`Revenue share by category, total ${totalLabel}`}
                >
                    {arcs.map((arc) => (
                        <circle
                            key={arc.key}
                            data-testid="donut-arc"
                            cx={SIZE / 2}
                            cy={SIZE / 2}
                            r={RADIUS}
                            fill="none"
                            stroke={arc.color}
                            strokeWidth={STROKE}
                            strokeDasharray={`${arc.visible} ${CIRCUMFERENCE - arc.visible}`}
                            strokeDashoffset={-arc.offset}
                        />
                    ))}
                </svg>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span data-testid="donut-total" className="text-sm font-extrabold tracking-tight text-gray-900">
                        {totalLabel}
                    </span>
                    <span className="text-[9px] font-bold uppercase tracking-wide text-gray-400">Total</span>
                </div>
            </div>
            <ul className="min-w-[150px] flex-1 space-y-1">
                {rows.map((row, index) => (
                    <li key={row.categoryId ?? row.categoryName} className="flex items-center gap-2 text-[11px] text-gray-600">
                        <span
                            className="h-2.5 w-2.5 shrink-0 rounded-sm"
                            style={{ background: CATEGORY_PALETTE[index % CATEGORY_PALETTE.length] }}
                        />
                        <span className="truncate">{row.categoryName}</span>
                        <span className="ml-auto font-extrabold tabular-nums text-gray-900">{Math.round(row.share)}%</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
