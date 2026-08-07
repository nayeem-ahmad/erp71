'use client';

import { useMemo, useState } from 'react';
import { formatBDT } from '@/lib/format';
import type { ReferralActivityPoint } from '@/components/admin/referrals/types';
import {
    CHART_BLUE,
    CHART_EMERALD,
    CHART_AXIS_TEXT,
    CHART_GRID,
    compactNumber,
    niceStep,
} from './chart-theme';

export type EarningsLabels = {
    earned: string;
    paid: string;
    empty: string;
    emptyHint: string;
};

const VIEW_W = 620;
const VIEW_H = 220;
const PAD_L = 46;
const PAD_R = 10;
const PAD_T = 10;
const PAD_B = 26;
const PLOT_W = VIEW_W - PAD_L - PAD_R;
const PLOT_H = VIEW_H - PAD_T - PAD_B;
const TICK_COUNT = 4;
/** 2px of surface between the paired columns, per the mark spec. */
const PAIR_GAP = 2;

function monthLabel(month: string, locale: string): string {
    const [year, m] = month.split('-');
    const date = new Date(Number(year), Number(m) - 1, 1);
    return date.toLocaleDateString(locale, { month: 'short' });
}

/**
 * Earned versus paid, per month. Both series are BDT on one shared axis — the
 * whole point is that they are directly comparable, which a second y-scale would
 * destroy.
 */
export default function EarningsChart({
    points,
    locale,
    labels,
}: {
    points: ReferralActivityPoint[];
    locale: string;
    labels: EarningsLabels;
}) {
    const [hovered, setHovered] = useState<number | null>(null);

    const model = useMemo(() => {
        if (points.length === 0) return null;

        const highest = Math.max(...points.flatMap((p) => [p.earned_amount, p.paid_amount]), 0);
        const step = niceStep(highest / TICK_COUNT);
        const top = Math.ceil(highest / step) * step || step;

        const bandWidth = PLOT_W / points.length;
        const barWidth = Math.max(3, (bandWidth - PAIR_GAP) / 2 - 3);

        const ticks: number[] = [];
        for (let value = 0; value <= top + step / 2; value += step) ticks.push(value);

        return {
            top,
            ticks,
            bandWidth,
            barWidth,
            toY: (value: number) => PAD_T + PLOT_H - (value / top) * PLOT_H,
            bandX: (index: number) => PAD_L + bandWidth * index,
        };
    }, [points]);

    const hasMoney = points.some((p) => p.earned_amount !== 0 || p.paid_amount !== 0);

    if (!model || !hasMoney) {
        return (
            <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center">
                <p className="text-xs font-medium text-gray-400">{labels.empty}</p>
                <p className="mt-1 text-xs text-gray-500">{labels.emptyHint}</p>
            </div>
        );
    }

    const money = (value: number) =>
        formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
    const active = hovered != null ? points[hovered] : null;

    return (
        <div>
            <div className="mb-2 flex flex-wrap items-center gap-3 text-[11px] font-medium text-gray-600">
                <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: CHART_EMERALD }} />
                    {labels.earned}
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: CHART_BLUE }} />
                    {labels.paid}
                </span>
            </div>

            <div className="relative" onMouseLeave={() => setHovered(null)}>
                <svg
                    viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
                    className="block w-full overflow-visible"
                    role="img"
                    aria-label={`${labels.earned}, ${labels.paid}`}
                >
                    {model.ticks.map((value) => (
                        <g key={value}>
                            <line
                                x1={PAD_L}
                                x2={VIEW_W - PAD_R}
                                y1={model.toY(value)}
                                y2={model.toY(value)}
                                stroke={CHART_GRID}
                                strokeWidth={1}
                            />
                            <text
                                x={PAD_L - 8}
                                y={model.toY(value) + 3.5}
                                textAnchor="end"
                                fontSize={9.5}
                                fill={CHART_AXIS_TEXT}
                            >
                                {compactNumber(value)}
                            </text>
                        </g>
                    ))}

                    {points.map((point, index) => {
                        const left = model.bandX(index) + (model.bandWidth - model.barWidth * 2 - PAIR_GAP) / 2;
                        return [
                            { value: point.earned_amount, color: CHART_EMERALD, x: left },
                            { value: point.paid_amount, color: CHART_BLUE, x: left + model.barWidth + PAIR_GAP },
                        ].map((bar) => (
                            <rect
                                key={`${point.month}-${bar.color}`}
                                data-testid="earnings-bar"
                                x={bar.x}
                                y={model.toY(bar.value)}
                                width={model.barWidth}
                                height={Math.max(0, PAD_T + PLOT_H - model.toY(bar.value))}
                                rx={2}
                                fill={bar.color}
                            />
                        ));
                    })}

                    {points.map((point, index) => (
                        <text
                            key={point.month}
                            x={model.bandX(index) + model.bandWidth / 2}
                            y={VIEW_H - 8}
                            textAnchor="middle"
                            fontSize={9.5}
                            fill={CHART_AXIS_TEXT}
                        >
                            {monthLabel(point.month, locale)}
                        </text>
                    ))}

                    {points.map((point, index) => (
                        <rect
                            key={`hit-${point.month}`}
                            x={model.bandX(index)}
                            y={PAD_T}
                            width={model.bandWidth}
                            height={PLOT_H}
                            fill="transparent"
                            className="cursor-crosshair"
                            onMouseEnter={() => setHovered(index)}
                        />
                    ))}
                </svg>

                {active ? (
                    <div
                        className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md bg-gray-900 px-2.5 py-2 text-[11px] leading-snug text-white shadow-lg"
                        style={{
                            left: `${((model.bandX(hovered!) + model.bandWidth / 2) / VIEW_W) * 100}%`,
                            top: `${(model.toY(Math.max(active.earned_amount, active.paid_amount)) / VIEW_H) * 100}%`,
                        }}
                    >
                        <p className="font-bold">{monthLabel(active.month, locale)}</p>
                        <p>{labels.earned}: {money(active.earned_amount)}</p>
                        <p>{labels.paid}: {money(active.paid_amount)}</p>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
