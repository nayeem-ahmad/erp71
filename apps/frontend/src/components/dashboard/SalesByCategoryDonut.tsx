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

// Sized so the hole clears ~110px: the total is a taka figure that runs to six
// or seven digits, and at the previous 132/52/19 it overflowed and clipped.
const SIZE = 168;
const RADIUS = 66;
const STROKE = 22;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
// Separates neighbouring arcs with the card surface rather than a drawn border.
const GAP = 2;

export function SalesByCategoryDonut({
    rows,
    totalLabel,
    totalTitle,
    emptyLabel,
}: {
    rows: CategoryRow[];
    totalLabel: string;
    totalTitle?: string;
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

    // h-full only where the grid stretches this card to match the cash-flow card
    // beside it; on mobile the card is auto-height and 100% would push the
    // wrapped legend past the card's own padding.
    return (
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-4 lg:h-full">
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
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-2">
                    <span
                        data-testid="donut-total"
                        title={totalTitle}
                        className="max-w-full truncate text-[13px] font-extrabold tabular-nums tracking-tight text-gray-900"
                    >
                        {totalLabel}
                    </span>
                    <span className="text-[9px] font-bold uppercase tracking-wide text-gray-400">Total</span>
                </div>
            </div>
            {/* Share sits immediately before the name: right-aligned in its own
                narrow column, so the figures still line up for scanning, but a
                short category name never strands its percentage across the card. */}
            <ul className="w-full min-w-[150px] max-w-[280px] flex-1 space-y-1.5">
                {rows.map((row, index) => (
                    <li
                        key={row.categoryId ?? row.categoryName}
                        className="grid grid-cols-[10px_2.25rem_1fr] items-center gap-x-2 text-[11px] text-gray-600"
                    >
                        <span
                            className="h-2.5 w-2.5 rounded-sm"
                            style={{ background: CATEGORY_PALETTE[index % CATEGORY_PALETTE.length] }}
                        />
                        <span className="text-right font-extrabold tabular-nums text-gray-900">
                            {Math.round(row.share)}%
                        </span>
                        <span className="truncate" title={row.categoryName}>{row.categoryName}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
