'use client';

import { useMemo } from 'react';
import { useI18n } from '@/lib/i18n';

export interface BurndownPoint {
    date: string;
    ideal: number | null;
    actual: number | null;
    committed: number | null;
    /** Tasks not yet done at the end of the day, drawn against the right-hand axis. */
    open?: number | null;
    isWorkingDay: boolean;
}

const FULL = { width: 720, height: 260 };
/**
 * For a side column a few hundred pixels wide. A narrower viewBox rather than
 * the full one scaled down, so the axis text stays the size it is written at.
 */
const COMPACT = { width: 340, height: 220 };
const PAD = { top: 16, right: 16, bottom: 34, left: 44 };
/** Room for the right-hand task-count labels, when there is an open-tasks line. */
const PAD_RIGHT_WITH_OPEN = 32;

/**
 * Burndown: ideal against actual remaining, with the committed line on top so
 * scope added mid-sprint is visible rather than silently flattening the slope.
 *
 * Deliberately straight segments, not a spline. A burndown is a series of daily
 * readings, and a curve between them would draw hours that were never measured.
 * Gaps (days with no snapshot) break the line instead of interpolating across.
 *
 * When the series carries `open` (a sprint's does; a project's does not), the
 * count of tasks not yet done is drawn as its own line against a right-hand
 * axis in tasks. Hours and tasks cannot share a scale, so the second axis is
 * labelled in tasks, the line is styled apart from the hours lines, and its
 * legend entry names the axis — so it is never read off the hours scale. The
 * task axis is rounded to a multiple of four so every hours gridline also
 * lands on a whole number of tasks.
 */
export default function BurndownChart({
    series,
    hideIdeal,
    compact,
}: {
    series: BurndownPoint[];
    /** Draws for a narrow side column instead of a full-width section. */
    compact?: boolean;
    /**
     * A project's `target_end_date` is optional where a sprint's dates are not,
     * so a project without one has no ideal to draw and no legend entry for it
     * — a key for a line that is not on the chart is worse than no key.
     */
    hideIdeal?: boolean;
}) {
    const { t } = useI18n();
    const m = t.projects.burndown;

    const { width: WIDTH, height: HEIGHT } = compact ? COMPACT : FULL;

    const geometry = useMemo(() => {
        if (series.length === 0) return null;

        const values = series.flatMap((p) =>
            [p.ideal, p.actual, p.committed].filter((v): v is number => v != null),
        );
        const max = Math.max(...values, 1);

        const openValues = series.map((p) => p.open).filter((v): v is number => v != null);
        const hasOpen = openValues.length > 0;
        const openMax = Math.ceil(Math.max(...openValues, 4) / 4) * 4;
        const padRight = hasOpen ? PAD_RIGHT_WITH_OPEN : PAD.right;

        const innerW = WIDTH - PAD.left - padRight;
        const innerH = HEIGHT - PAD.top - PAD.bottom;
        const stepX = series.length > 1 ? innerW / (series.length - 1) : 0;

        const x = (i: number) => PAD.left + i * stepX;
        const y = (value: number) => PAD.top + innerH - (value / max) * innerH;
        const yOpen = (value: number) => PAD.top + innerH - (value / openMax) * innerH;

        /** Splits into runs of consecutive non-null points so gaps stay gaps. */
        const runs = (
            pick: (p: BurndownPoint) => number | null | undefined,
            scale: (value: number) => number = y,
        ): string[] => {
            const out: string[] = [];
            let current: string[] = [];
            series.forEach((point, i) => {
                const value = pick(point);
                if (value == null) {
                    if (current.length > 1) out.push(current.join(' '));
                    current = [];
                    return;
                }
                current.push(`${x(i)},${scale(value)}`);
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
            openRuns: hasOpen ? runs((p) => p.open, yOpen) : [],
            hasOpen,
            openMax,
            padRight,
            yOpen,
            weekends: series
                .map((p, i) => ({ ...p, i }))
                .filter((p) => !p.isWorkingDay),
            stepX,
        };
    }, [series, WIDTH, HEIGHT]);

    if (!geometry) {
        return <p className="text-sm text-gray-500">{m.noData}</p>;
    }

    const {
        max,
        x,
        y,
        innerH,
        idealRuns,
        actualRuns,
        committedRuns,
        openRuns,
        hasOpen,
        openMax,
        padRight,
        yOpen,
        weekends,
        stepX,
    } = geometry;
    const fractions = [0, 0.25, 0.5, 0.75, 1];

    return (
        <div className="space-y-2">
            <div className="overflow-x-auto">
                <svg
                    viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                    className={compact ? 'h-56 w-full' : 'h-64 w-full min-w-[560px]'}
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
                            className="fill-gray-100"
                        />
                    ))}

                    {fractions.map((f) => {
                        const at = PAD.top + innerH - f * innerH;
                        return (
                            <g key={f}>
                                <line
                                    x1={PAD.left}
                                    x2={WIDTH - padRight}
                                    y1={at}
                                    y2={at}
                                    className="stroke-gray-200"
                                    strokeWidth={1}
                                />
                                <text
                                    x={PAD.left - 8}
                                    y={at + 4}
                                    textAnchor="end"
                                    className="fill-gray-500 text-[10px]"
                                >
                                    {Math.round(max * f)}
                                </text>
                                {hasOpen && (
                                    <text
                                        x={WIDTH - padRight + 6}
                                        y={at + 4}
                                        textAnchor="start"
                                        className="fill-gray-700 text-[10px]"
                                    >
                                        {openMax * f}
                                    </text>
                                )}
                            </g>
                        );
                    })}
                    {hasOpen && (
                        <>
                            <text x={PAD.left - 8} y={PAD.top - 6} textAnchor="end" className="fill-gray-500 text-[10px]">
                                {m.hoursUnit}
                            </text>
                            <text
                                x={WIDTH - padRight + 6}
                                y={PAD.top - 6}
                                textAnchor="start"
                                className="fill-gray-700 text-[10px]"
                            >
                                {m.tasksUnit}
                            </text>
                        </>
                    )}

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
                    {!hideIdeal &&
                        idealRuns.map((points, i) => (
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

                    {openRuns.map((points, i) => (
                        <polyline
                            key={`open-${i}`}
                            points={points}
                            fill="none"
                            className="stroke-gray-700"
                            strokeWidth={1.5}
                            strokeLinejoin="round"
                        />
                    ))}
                    {series.map((point, i) =>
                        point.open == null ? null : (
                            <circle
                                key={`open-${point.date}`}
                                cx={x(i)}
                                cy={yOpen(point.open)}
                                r={2.5}
                                className="fill-white stroke-gray-700"
                                strokeWidth={1.5}
                                data-testid="open-task-point"
                            >
                                <title>{`${point.date}: ${point.open} ${m.openTasks.toLowerCase()}`}</title>
                            </circle>
                        ),
                    )}

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
                        // Label roughly six dates (four when compact), whatever the sprint length.
                        i % Math.max(1, Math.ceil(series.length / (compact ? 4 : 6))) === 0 ? (
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

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
                <span className="flex items-center gap-1.5">
                    <span className="inline-block h-0.5 w-4 bg-blue-600" />
                    {m.actual}
                </span>
                {!hideIdeal && (
                    <span className="flex items-center gap-1.5">
                        <span className="inline-block h-0.5 w-4 bg-gray-400" />
                        {m.ideal}
                    </span>
                )}
                <span className="flex items-center gap-1.5">
                    <span className="inline-block h-0.5 w-4 bg-amber-500" />
                    {m.committed}
                </span>
                {hasOpen && (
                    <span className="flex items-center gap-1.5">
                        <span className="relative inline-flex h-2 w-4 items-center" aria-hidden>
                            <span className="h-0.5 w-4 bg-gray-700" />
                            <span className="absolute start-1 h-2 w-2 rounded-full border-2 border-gray-700 bg-white" />
                        </span>
                        {m.openTasksRightAxis}
                    </span>
                )}
                <span className="text-gray-500">{m.weekendNote}</span>
            </div>
        </div>
    );
}
