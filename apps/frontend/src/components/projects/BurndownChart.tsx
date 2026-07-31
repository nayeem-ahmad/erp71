'use client';

import { useMemo } from 'react';
import { useI18n } from '@/lib/i18n';

export interface BurndownPoint {
    date: string;
    ideal: number | null;
    actual: number | null;
    committed: number | null;
    isWorkingDay: boolean;
}

const WIDTH = 720;
const HEIGHT = 260;
const PAD = { top: 16, right: 16, bottom: 34, left: 44 };

/**
 * Burndown: ideal against actual remaining, with the committed line on top so
 * scope added mid-sprint is visible rather than silently flattening the slope.
 *
 * Deliberately straight segments, not a spline. A burndown is a series of daily
 * readings, and a curve between them would draw hours that were never measured.
 * Gaps (days with no snapshot) break the line instead of interpolating across.
 */
export default function BurndownChart({ series }: { series: BurndownPoint[] }) {
    const { t } = useI18n();
    const m = t.projects.burndown;

    const geometry = useMemo(() => {
        if (series.length === 0) return null;

        const values = series.flatMap((p) =>
            [p.ideal, p.actual, p.committed].filter((v): v is number => v != null),
        );
        const max = Math.max(...values, 1);

        const innerW = WIDTH - PAD.left - PAD.right;
        const innerH = HEIGHT - PAD.top - PAD.bottom;
        const stepX = series.length > 1 ? innerW / (series.length - 1) : 0;

        const x = (i: number) => PAD.left + i * stepX;
        const y = (value: number) => PAD.top + innerH - (value / max) * innerH;

        /** Splits into runs of consecutive non-null points so gaps stay gaps. */
        const runs = (pick: (p: BurndownPoint) => number | null): string[] => {
            const out: string[] = [];
            let current: string[] = [];
            series.forEach((point, i) => {
                const value = pick(point);
                if (value == null) {
                    if (current.length > 1) out.push(current.join(' '));
                    current = [];
                    return;
                }
                current.push(`${x(i)},${y(value)}`);
            });
            if (current.length > 1) out.push(current.join(' '));
            return out;
        };

        return {
            max,
            x,
            y,
            innerH,
            idealRuns: runs((p) => p.ideal),
            actualRuns: runs((p) => p.actual),
            committedRuns: runs((p) => p.committed),
            weekends: series
                .map((p, i) => ({ ...p, i }))
                .filter((p) => !p.isWorkingDay),
            stepX,
        };
    }, [series]);

    if (!geometry) {
        return <p className="text-sm text-gray-500">{m.noData}</p>;
    }

    const { max, x, y, innerH, idealRuns, actualRuns, committedRuns, weekends, stepX } = geometry;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));

    return (
        <div className="space-y-2">
            <div className="overflow-x-auto">
                <svg
                    viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                    className="h-64 w-full min-w-[560px]"
                    role="img"
                    aria-label={m.title}
                >
                    {/* Non-working days shaded, so a flat stretch reads as a
                        weekend rather than a team that stopped working. */}
                    {weekends.map((day) => (
                        <rect
                            key={day.date}
                            x={x(day.i) - stepX / 2}
                            y={PAD.top}
                            width={stepX}
                            height={innerH}
                            className="fill-gray-100 dark:fill-gray-800/40"
                        />
                    ))}

                    {ticks.map((tick) => (
                        <g key={tick}>
                            <line
                                x1={PAD.left}
                                x2={WIDTH - PAD.right}
                                y1={y(tick)}
                                y2={y(tick)}
                                className="stroke-gray-200 dark:stroke-gray-700"
                                strokeWidth={1}
                            />
                            <text
                                x={PAD.left - 8}
                                y={y(tick) + 4}
                                textAnchor="end"
                                className="fill-gray-500 text-[10px]"
                            >
                                {tick}
                            </text>
                        </g>
                    ))}

                    {committedRuns.map((points, i) => (
                        <polyline
                            key={`committed-${i}`}
                            points={points}
                            fill="none"
                            className="stroke-amber-500"
                            strokeWidth={1.5}
                            strokeDasharray="2 3"
                        />
                    ))}
                    {idealRuns.map((points, i) => (
                        <polyline
                            key={`ideal-${i}`}
                            points={points}
                            fill="none"
                            className="stroke-gray-400"
                            strokeWidth={1.5}
                            strokeDasharray="5 4"
                        />
                    ))}
                    {actualRuns.map((points, i) => (
                        <polyline
                            key={`actual-${i}`}
                            points={points}
                            fill="none"
                            className="stroke-blue-600"
                            strokeWidth={2.5}
                        />
                    ))}

                    {series.map((point, i) =>
                        point.actual == null ? null : (
                            <circle
                                key={point.date}
                                cx={x(i)}
                                cy={y(point.actual)}
                                r={2.5}
                                className="fill-blue-600"
                            >
                                <title>{`${point.date}: ${point.actual}h`}</title>
                            </circle>
                        ),
                    )}

                    {series.map((point, i) =>
                        // Label roughly six dates, whatever the sprint length.
                        i % Math.max(1, Math.ceil(series.length / 6)) === 0 ? (
                            <text
                                key={`label-${point.date}`}
                                x={x(i)}
                                y={HEIGHT - 12}
                                textAnchor="middle"
                                className="fill-gray-500 text-[10px]"
                            >
                                {point.date.slice(5)}
                            </text>
                        ) : null,
                    )}
                </svg>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
                <span className="flex items-center gap-1.5">
                    <span className="inline-block h-0.5 w-4 bg-blue-600" />
                    {m.actual}
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="inline-block h-0.5 w-4 bg-gray-400" />
                    {m.ideal}
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="inline-block h-0.5 w-4 bg-amber-500" />
                    {m.committed}
                </span>
                <span className="text-gray-500">{m.weekendNote}</span>
            </div>
        </div>
    );
}
