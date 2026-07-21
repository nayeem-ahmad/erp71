'use client';

import { useMemo, useState } from 'react';
import { formatBDT } from '@/lib/format';
import { monotoneCubicPath, type Point } from '@/lib/charts/smooth-path';

export type CashFlowPoint = {
    date: string;
    cash_inflow: number;
    cash_outflow: number;
};

export type CashFlowLabels = {
    inflow: string;
    outflow: string;
    net: string;
    empty: string;
    emptyHint: string;
};

// Inflow uses the darker success step, not `success` itself: against the second
// series hue the lighter green measures ΔE 6.6 under simulated colour-vision
// deficiency, below the ΔE 8 floor. The darker step clears it at 8.1.
const INFLOW = '#047857';
const OUTFLOW = '#eb6834';
const NET = '#2563eb';
const INFLOW_FILL = '#ecfdf5';
const OUTFLOW_FILL = '#fdece4';

const VIEW_W = 620;
const VIEW_H = 230;
const PAD_L = 44;
const PAD_R = 10;
const PAD_T = 10;
const PAD_B = 26;
const PLOT_W = VIEW_W - PAD_L - PAD_R;
const PLOT_H = VIEW_H - PAD_T - PAD_B;

const MAX_DATE_LABELS = 4;
const TICK_COUNT = 4;

/** Rounds a magnitude up to a 1/2/2.5/5 × 10ⁿ step so axis ticks read cleanly. */
function niceStep(value: number): number {
    if (value <= 0) return 1;
    const magnitude = 10 ** Math.floor(Math.log10(value));
    const normalized = value / magnitude;
    if (normalized <= 1) return magnitude;
    if (normalized <= 2) return 2 * magnitude;
    if (normalized <= 2.5) return 2.5 * magnitude;
    if (normalized <= 5) return 5 * magnitude;
    return 10 * magnitude;
}

function compact(value: number): string {
    const magnitude = Math.abs(value);
    const sign = value < 0 ? '-' : '';
    if (magnitude >= 100_000) {
        const lakh = magnitude / 100_000;
        return `${sign}${lakh.toFixed(magnitude % 100_000 === 0 ? 0 : 1)}L`;
    }
    if (magnitude >= 1_000) return `${sign}${Math.round(magnitude / 1_000)}k`;
    return String(Math.round(value));
}

export function CashFlowChart({
    points,
    locale,
    labels,
}: {
    points: CashFlowPoint[];
    locale: string;
    labels: CashFlowLabels;
}) {
    const [hovered, setHovered] = useState<number | null>(null);

    const model = useMemo(() => {
        if (points.length < 2) return null;

        const net = points.map((point) => point.cash_inflow - point.cash_outflow);
        const highest = Math.max(...points.flatMap((p) => [p.cash_inflow, p.cash_outflow]), ...net, 0);
        const lowest = Math.min(...net, 0);

        // Ticks step outward from zero in both directions so the zero line stays
        // exactly on a gridline and a negative net day is never clipped.
        const step = niceStep(Math.max(highest, Math.abs(lowest)) / TICK_COUNT);
        const top = Math.ceil(highest / step) * step || step;
        const bottom = Math.floor(lowest / step) * step;
        const span = top - bottom || 1;

        const toY = (value: number) => PAD_T + PLOT_H - ((value - bottom) / span) * PLOT_H;
        const toX = (index: number) => PAD_L + (PLOT_W / (points.length - 1)) * index;

        const ticks: number[] = [];
        for (let value = bottom; value <= top + step / 2; value += step) {
            ticks.push(Math.round(value));
        }

        const seriesPath = (values: number[]) =>
            monotoneCubicPath(values.map((value, index): Point => ({ x: toX(index), y: toY(value) })));

        const zeroY = toY(0);
        const areaPath = (values: number[]) =>
            `${seriesPath(values)} L ${toX(points.length - 1)} ${zeroY} L ${toX(0)} ${zeroY} Z`;

        // Evenly spaced, first and last always included. Picking the indices up
        // front (rather than "every Nth, plus the last") is what keeps the count
        // at MAX_DATE_LABELS and stops the final label crowding its neighbour.
        const last = points.length - 1;
        const labelCount = Math.min(MAX_DATE_LABELS, points.length);
        const dateLabelIndices = new Set(
            Array.from({ length: labelCount }, (_, k) =>
                labelCount === 1 ? 0 : Math.round((k * last) / (labelCount - 1)),
            ),
        );

        return {
            net,
            ticks,
            zeroY,
            toX,
            toY,
            dateLabelIndices,
            bandWidth: PLOT_W / (points.length - 1),
            inflowLine: seriesPath(points.map((p) => p.cash_inflow)),
            inflowArea: areaPath(points.map((p) => p.cash_inflow)),
            outflowLine: seriesPath(points.map((p) => p.cash_outflow)),
            outflowArea: areaPath(points.map((p) => p.cash_outflow)),
            netLine: seriesPath(net),
        };
    }, [points]);

    const hasMovement = points.some((point) => point.cash_inflow !== 0 || point.cash_outflow !== 0);

    if (!model || !hasMovement) {
        return (
            <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center">
                <p className="text-xs font-medium text-gray-400">{labels.empty}</p>
                <p className="mt-1 text-xs text-gray-500">{labels.emptyHint}</p>
            </div>
        );
    }

    const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
    const dateLabel = (iso: string) => new Date(iso).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
    const active = hovered != null ? points[hovered] : null;

    return (
        <div>
            <div className="mb-2 flex flex-wrap items-center gap-3 text-[11px] font-medium text-gray-600">
                <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: INFLOW }} />
                    {labels.inflow}
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: OUTFLOW }} />
                    {labels.outflow}
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="h-0.5 w-3.5 rounded-sm" style={{ background: NET }} />
                    {labels.net}
                </span>
            </div>

            <div data-testid="cashflow-plot" className="relative" onMouseLeave={() => setHovered(null)}>
                <svg
                    viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
                    className="block w-full overflow-visible"
                    role="img"
                    aria-label={`${labels.inflow}, ${labels.outflow}, ${labels.net}`}
                >
                    {model.ticks.map((value) => (
                        <g key={value}>
                            <line
                                data-testid={value === 0 ? 'cashflow-zero' : 'cashflow-grid'}
                                x1={PAD_L}
                                x2={VIEW_W - PAD_R}
                                y1={model.toY(value)}
                                y2={model.toY(value)}
                                stroke={value === 0 ? '#d1d5db' : '#f3f4f6'}
                                strokeWidth={1}
                            />
                            <text
                                data-testid="cashflow-tick"
                                data-value={value}
                                x={PAD_L - 8}
                                y={model.toY(value) + 3.5}
                                textAnchor="end"
                                fontSize={9.5}
                                fill="#9ca3af"
                            >
                                {value === 0 ? '0' : compact(value)}
                            </text>
                        </g>
                    ))}

                    <path d={model.inflowArea} fill={INFLOW_FILL} opacity={0.85} />
                    <path
                        data-testid="cashflow-inflow"
                        d={model.inflowLine}
                        fill="none"
                        stroke={INFLOW}
                        strokeWidth={2}
                        strokeLinecap="round"
                    />
                    <path d={model.outflowArea} fill={OUTFLOW_FILL} opacity={0.85} />
                    <path
                        data-testid="cashflow-outflow"
                        d={model.outflowLine}
                        fill="none"
                        stroke={OUTFLOW}
                        strokeWidth={2}
                        strokeLinecap="round"
                    />
                    {/* Net is a line with no fill: it is derived, not a third volume. */}
                    <path
                        data-testid="cashflow-net"
                        d={model.netLine}
                        fill="none"
                        stroke={NET}
                        strokeWidth={2.25}
                        strokeLinecap="round"
                    />

                    {points.map((point, index) => {
                        if (!model.dateLabelIndices.has(index)) return null;
                        const isFirst = index === 0;
                        const isLast = index === points.length - 1;
                        const anchor = isFirst ? 'start' : isLast ? 'end' : 'middle';
                        return (
                            <text
                                key={point.date}
                                data-testid="cashflow-date"
                                x={model.toX(index)}
                                y={VIEW_H - 8}
                                textAnchor={anchor}
                                fontSize={9.5}
                                fill="#9ca3af"
                            >
                                {dateLabel(point.date)}
                            </text>
                        );
                    })}

                    {hovered != null ? (
                        <>
                            <line
                                x1={model.toX(hovered)}
                                x2={model.toX(hovered)}
                                y1={PAD_T}
                                y2={PAD_T + PLOT_H}
                                stroke="#d1d5db"
                                strokeWidth={1}
                            />
                            {[
                                { value: points[hovered].cash_inflow, color: INFLOW },
                                { value: points[hovered].cash_outflow, color: OUTFLOW },
                                { value: model.net[hovered], color: NET },
                            ].map((dot) => (
                                <circle
                                    key={dot.color}
                                    cx={model.toX(hovered)}
                                    cy={model.toY(dot.value)}
                                    r={4}
                                    fill={dot.color}
                                    stroke="#ffffff"
                                    strokeWidth={2}
                                />
                            ))}
                        </>
                    ) : null}

                    {points.map((point, index) => (
                        <rect
                            key={point.date}
                            data-testid="cashflow-hit"
                            x={model.toX(index) - model.bandWidth / 2}
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
                        data-testid="cashflow-tooltip"
                        className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md bg-gray-900 px-2.5 py-2 text-[11px] leading-snug text-white shadow-lg"
                        style={{
                            left: `${(model.toX(hovered!) / VIEW_W) * 100}%`,
                            top: `${(model.toY(Math.max(active.cash_inflow, active.cash_outflow)) / VIEW_H) * 100}%`,
                        }}
                    >
                        <p className="font-bold">{dateLabel(active.date)}</p>
                        {[
                            { label: labels.inflow, value: active.cash_inflow, color: INFLOW },
                            { label: labels.outflow, value: active.cash_outflow, color: OUTFLOW },
                            { label: labels.net, value: model.net[hovered!], color: NET },
                        ].map((line) => (
                            <p key={line.label} className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap">
                                <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: line.color }} />
                                <span className="opacity-75">{line.label}</span>
                                <span className="ml-auto font-bold tabular-nums">{money(line.value)}</span>
                            </p>
                        ))}
                    </div>
                ) : null}
            </div>
        </div>
    );
}
