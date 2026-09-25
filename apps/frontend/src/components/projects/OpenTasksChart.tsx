'use client';

import { useMemo } from 'react';
import { useI18n } from '@/lib/i18n';
import type { BurndownPoint } from './BurndownChart';

const WIDTH = 340;
const HEIGHT = 200;
const PAD = { top: 14, right: 16, bottom: 30, left: 32 };

/**
 * Tasks not yet done at the end of each sprint day — the count beside the
 * burndown's hours. Hours can fall while nothing finishes; this is the line
 * that shows whether work is actually closing.
 *
 * Read from the same daily snapshots as the burndown, so both charts share
 * their days, their gaps and their weekend shading. A single series: the
 * heading names it, so there is no legend.
 */
export default function OpenTasksChart({ series }: { series: BurndownPoint[] }) {
    const { t } = useI18n();
    const m = t.projects.sprint;

    const geometry = useMemo(() => {
        const values = series.map((p) => p.open).filter((v): v is number => v != null);
        if (series.length === 0 || values.length === 0) return null;

        // Whole tasks, so the scale steps in whole numbers: at least 4, and
        // rounded up to an even count so the midpoint tick is an integer too.
        const peak = Math.max(...values, 4);
        const max = peak % 2 === 0 ? peak : peak + 1;
        const innerW = WIDTH - PAD.left - PAD.right;
        const innerH = HEIGHT - PAD.top - PAD.bottom;
        const stepX = series.length > 1 ? innerW / (series.length - 1) : 0;
        const x = (i: number) => PAD.left + i * stepX;
        const y = (value: number) => PAD.top + innerH - (value / max) * innerH;

        // Runs of consecutive readings, so a day without a snapshot is a gap
        // rather than a line drawn across hours nobody measured.
        const runs: string[] = [];
        let current: string[] = [];
        series.forEach((point, i) => {
            if (point.open == null) {
                if (current.length > 1) runs.push(current.join(' '));
                current = [];
                return;
            }
            current.push(`${x(i)},${y(point.open)}`);
        });
        if (current.length > 1) runs.push(current.join(' '));

        return { max, x, y, innerH, stepX, runs };
    }, [series]);

    if (!geometry) return <p className="text-sm text-gray-500">{m.openTasksNoData}</p>;

    const { max, x, y, innerH, stepX, runs } = geometry;
    const ticks = [0, max / 2, max];
    const labelEvery = Math.max(1, Math.ceil(series.length / 4));

    return (
        <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="h-52 w-full"
            role="img"
            aria-label={m.openTasksChart}
            data-testid="open-tasks-chart"
        >
            {series.map((point, i) =>
                point.isWorkingDay ? null : (
                    <rect
                        key={`off-${point.date}`}
                        x={x(i) - stepX / 2}
                        y={PAD.top}
                        width={stepX}
                        height={innerH}
                        className="fill-gray-100"
                    />
                ),
            )}

            {ticks.map((tick) => (
                <g key={tick}>
                    <line
                        x1={PAD.left}
                        x2={WIDTH - PAD.right}
                        y1={y(tick)}
                        y2={y(tick)}
                        className="stroke-gray-200"
                        strokeWidth={1}
                    />
                    <text x={PAD.left - 6} y={y(tick) + 4} textAnchor="end" className="fill-gray-500 text-[10px]">
                        {tick}
                    </text>
                </g>
            ))}

            {runs.map((points, i) => (
                <polyline
                    key={`open-${i}`}
                    points={points}
                    fill="none"
                    className="stroke-blue-600"
                    strokeWidth={2}
                    strokeLinejoin="round"
                />
            ))}

            {series.map((point, i) =>
                point.open == null ? null : (
                    <g key={`dot-${point.date}`}>
                        <circle cx={x(i)} cy={y(point.open)} r={3} className="fill-blue-600 stroke-white" strokeWidth={1.5} />
                        {/* A wider invisible target than the dot, so the reading
                            is easy to hover on a dense sprint. */}
                        <circle cx={x(i)} cy={y(point.open)} r={8} className="fill-transparent">
                            <title>{`${point.date}: ${point.open}`}</title>
                        </circle>
                    </g>
                ),
            )}

            {series.map((point, i) =>
                i % labelEvery === 0 ? (
                    <text
                        key={`label-${point.date}`}
                        x={x(i)}
                        y={HEIGHT - 10}
                        textAnchor="middle"
                        className="fill-gray-500 text-[10px]"
                    >
                        {point.date.slice(5)}
                    </text>
                ) : null,
            )}
        </svg>
    );
}
