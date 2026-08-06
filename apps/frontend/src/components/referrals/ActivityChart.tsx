'use client';

import { useMemo, useState } from 'react';
import { monotoneCubicPath, type Point } from '@/lib/charts/smooth-path';
import type { ReferralActivityPoint } from '@/components/admin/referrals/types';
import {
    CHART_BLUE,
    CHART_BLUE_FILL,
    CHART_EMERALD,
    CHART_AXIS_TEXT,
    CHART_GRID,
    compactNumber,
    niceStep,
} from './chart-theme';

export type ActivityLabels = {
    clicks: string;
    signups: string;
    empty: string;
    emptyHint: string;
};

const VIEW_W = 620;
const VIEW_H = 260;
const PAD_L = 40;
const PAD_R = 10;
const PAD_B = 24;
/** Vertical gap between the two panels. */
const PANEL_GAP = 18;
const TOP_H = 120;
const BOTTOM_H = 74;
const TOP_Y = 8;
const BOTTOM_Y = TOP_Y + TOP_H + PANEL_GAP;
const PLOT_W = VIEW_W - PAD_L - PAD_R;
const TICK_COUNT = 3;

function monthLabel(month: string): string {
    const [year, m] = month.split('-');
    return new Date(Number(year), Number(m) - 1, 1).toLocaleDateString('en', { month: 'short' });
}

/**
 * Clicks and signups over twelve months.
 *
 * Two panels sharing one x-axis rather than two series on one plot: they are both
 * counts, but a partner with 200 clicks and 3 signups would see the signup series
 * flattened to the baseline on a shared scale. A second y-axis would be the usual
 * fix and is exactly the wrong one — it makes two incomparable scales look
 * comparable. Separate panels state the scales honestly.
 */
export default function ActivityChart({
    points,
    labels,
}: {
    points: ReferralActivityPoint[];
    labels: ActivityLabels;
}) {
    const [hovered, setHovered] = useState<number | null>(null);

    const model = useMemo(() => {
        if (points.length < 2) return null;

        const clickTop = Math.max(...points.map((p) => p.clicks), 0);
        const clickStep = niceStep(clickTop / TICK_COUNT);
        const clickMax = Math.ceil(clickTop / clickStep) * clickStep || clickStep;

        const signupTop = Math.max(...points.map((p) => p.signups), 0);
        const signupMax = Math.max(1, signupTop);

        const toX = (index: number) => PAD_L + (PLOT_W / (points.length - 1)) * index;
        const clickY = (value: number) => TOP_Y + TOP_H - (value / clickMax) * TOP_H;

        const ticks: number[] = [];
        for (let value = 0; value <= clickMax + clickStep / 2; value += clickStep) ticks.push(value);

        const clicksLine = monotoneCubicPath(
            points.map((p, index): Point => ({ x: toX(index), y: clickY(p.clicks) })),
        );

        // The band width is derived from spacing between points, then narrowed so
        // adjacent bars keep a 2px surface gap.
        const band = PLOT_W / (points.length - 1);

        return {
            ticks,
            toX,
            clickY,
            clicksLine,
            clicksArea: `${clicksLine} L ${toX(points.length - 1)} ${TOP_Y + TOP_H} L ${toX(0)} ${TOP_Y + TOP_H} Z`,
            band,
            barWidth: Math.max(3, band * 0.55),
            signupH: (value: number) => (value / signupMax) * BOTTOM_H,
        };
    }, [points]);

    const hasActivity = points.some((p) => p.clicks !== 0 || p.signups !== 0);

    if (!model || !hasActivity) {
        return (
            <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center">
                <p className="text-xs font-medium text-gray-400">{labels.empty}</p>
                <p className="mt-1 text-xs text-gray-500">{labels.emptyHint}</p>
            </div>
        );
    }

    const active = hovered != null ? points[hovered] : null;

    return (
        <div>
            <div className="mb-2 flex flex-wrap items-center gap-3 text-[11px] font-medium text-gray-600">
                <span className="flex items-center gap-1.5">
                    <span className="h-0.5 w-3.5 rounded-sm" style={{ background: CHART_BLUE }} />
                    {labels.clicks}
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: CHART_EMERALD }} />
                    {labels.signups}
                </span>
            </div>

            <div className="relative" onMouseLeave={() => setHovered(null)}>
                <svg
                    viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
                    className="block w-full overflow-visible"
                    role="img"
                    aria-label={`${labels.clicks}, ${labels.signups}`}
                >
                    {model.ticks.map((value) => (
                        <g key={value}>
                            <line
                                x1={PAD_L}
                                x2={VIEW_W - PAD_R}
                                y1={model.clickY(value)}
                                y2={model.clickY(value)}
                                stroke={CHART_GRID}
                                strokeWidth={1}
                            />
                            <text
                                x={PAD_L - 8}
                                y={model.clickY(value) + 3.5}
                                textAnchor="end"
                                fontSize={9.5}
                                fill={CHART_AXIS_TEXT}
                            >
                                {compactNumber(value)}
                            </text>
                        </g>
                    ))}

                    <path d={model.clicksArea} fill={CHART_BLUE_FILL} opacity={0.85} />
                    <path
                        data-testid="activity-clicks-line"
                        d={model.clicksLine}
                        fill="none"
                        stroke={CHART_BLUE}
                        strokeWidth={2}
                        strokeLinecap="round"
                    />

                    <line
                        x1={PAD_L}
                        x2={VIEW_W - PAD_R}
                        y1={BOTTOM_Y + BOTTOM_H}
                        y2={BOTTOM_Y + BOTTOM_H}
                        stroke="#d1d5db"
                        strokeWidth={1}
                    />

                    {points.map((point, index) => {
                        const height = model.signupH(point.signups);
                        return (
                            <rect
                                key={point.month}
                                data-testid="activity-signup-bar"
                                x={model.toX(index) - model.barWidth / 2}
                                y={BOTTOM_Y + BOTTOM_H - height}
                                width={model.barWidth}
                                height={height}
                                rx={2}
                                fill={CHART_EMERALD}
                            />
                        );
                    })}

                    {points.map((point, index) => (
                        <text
                            key={`label-${point.month}`}
                            x={model.toX(index)}
                            y={VIEW_H - 6}
                            textAnchor="middle"
                            fontSize={9}
                            fill={CHART_AXIS_TEXT}
                        >
                            {monthLabel(point.month)}
                        </text>
                    ))}

                    {hovered != null && (
                        <line
                            x1={model.toX(hovered)}
                            x2={model.toX(hovered)}
                            y1={TOP_Y}
                            y2={BOTTOM_Y + BOTTOM_H}
                            stroke="#d1d5db"
                            strokeWidth={1}
                        />
                    )}

                    {points.map((point, index) => (
                        <rect
                            key={`hit-${point.month}`}
                            x={model.toX(index) - model.band / 2}
                            y={TOP_Y}
                            width={model.band}
                            height={BOTTOM_Y + BOTTOM_H - TOP_Y}
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
                            left: `${(model.toX(hovered!) / VIEW_W) * 100}%`,
                            top: `${(model.clickY(active.clicks) / VIEW_H) * 100}%`,
                        }}
                    >
                        <p className="font-bold">{monthLabel(active.month)}</p>
                        <p>{labels.clicks}: {active.clicks}</p>
                        <p>{labels.signups}: {active.signups}</p>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
