'use client';

import { useMemo, useRef, useState, type PointerEvent } from 'react';
import { useI18n } from '@/lib/i18n';
import {
    DAY_MS,
    dayStart,
    idealVertices,
    nearestIndex,
    sprintWindow,
    stepPath,
    type IdealDay,
    type TimelinePoint,
} from './burndown-steps';

const FULL = { width: 720, height: 260 };
/** For the sprint page's side column: a narrower viewBox, so axis text keeps its size. */
const COMPACT = { width: 340, height: 220 };
const PAD = { top: 16, right: 16, bottom: 34, left: 44 };
/** Room for the open-task labels on the right. */
const PAD_RIGHT_WITH_OPEN = 32;

/** Points that changed what the sprint holds, rather than how much of it is left. */
const SCOPE_CAUSES = new Set(['TASK_ADDED', 'TASK_REMOVED']);

/**
 * A sprint's burndown with every recorded change on a time axis.
 *
 * Each point is the sprint's totals right after something changed, so the
 * lines are steps: a value holds until the next change, then moves. The
 * project burndown, which is daily, keeps `BurndownChart`.
 *
 * Markers are reserved for scope changes — a task joining or leaving — so a
 * jump up reads as work added rather than work undone, and a sprint with
 * hundreds of time logs stays a clean line. Every point is still reachable:
 * hovering (or tapping) anywhere over the plot shows the nearest one, with
 * what caused it and which task.
 */
export default function SprintBurndownChart({
    startDate,
    endDate,
    points,
    ideal,
    compact,
}: {
    startDate: string;
    endDate: string;
    points: TimelinePoint[];
    ideal: IdealDay[];
    compact?: boolean;
}) {
    const { t, locale } = useI18n();
    const m = t.projects.burndown;
    const { width: WIDTH, height: HEIGHT } = compact ? COMPACT : FULL;
    const svgRef = useRef<SVGSVGElement>(null);
    const [hover, setHover] = useState<number | null>(null);

    const geometry = useMemo(() => {
        const { from, to } = sprintWindow(startDate, endDate);
        const clamp = (time: number) => Math.min(Math.max(time, from), to);
        const times = points.map((point) => clamp(Date.parse(point.at)));
        const idealPoints = idealVertices(ideal);

        const max = Math.max(
            ...points.flatMap((point) => [point.remaining, point.committed]),
            ...idealPoints.map((vertex) => vertex.v),
            1,
        );
        const hasOpen = points.length > 0;
        const openMax = Math.ceil(Math.max(...points.map((point) => point.open), 4) / 4) * 4;
        const padRight = hasOpen ? PAD_RIGHT_WITH_OPEN : PAD.right;
        const innerW = WIDTH - PAD.left - padRight;
        const innerH = HEIGHT - PAD.top - PAD.bottom;

        const x = (time: number) => PAD.left + ((time - from) / (to - from)) * innerW;
        const y = (value: number) => PAD.top + innerH - (value / max) * innerH;
        const yOpen = (value: number) => PAD.top + innerH - (value / openMax) * innerH;
        const series = (pick: (point: TimelinePoint) => number) =>
            points.map((point, i) => ({ t: times[i], v: pick(point) }));

        const days = Math.round((to - from) / DAY_MS);
        const labelEvery = Math.max(1, Math.ceil(days / (compact ? 4 : 6)));

        return {
            from,
            to,
            times,
            max,
            hasOpen,
            openMax,
            padRight,
            innerW,
            innerH,
            x,
            y,
            yOpen,
            remainingPath: stepPath(series((point) => point.remaining), x, y),
            committedPath: stepPath(series((point) => point.committed), x, y),
            openPath: stepPath(series((point) => point.open), x, yOpen),
            idealLine: idealPoints.map((vertex) => `${x(vertex.t)},${y(vertex.v)}`).join(' '),
            nonWorking: ideal.filter((day) => !day.isWorkingDay).map((day) => dayStart(day.date)),
            labels: ideal.filter((_, i) => i % labelEvery === 0).map((day) => day.date),
        };
    }, [startDate, endDate, points, ideal, WIDTH, HEIGHT, compact]);

    const { times, max, hasOpen, openMax, padRight, innerH, x, y, yOpen } = geometry;
    const fractions = [0, 0.25, 0.5, 0.75, 1];

    const pick = (event: PointerEvent<SVGRectElement>) => {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect || times.length === 0) return;
        // Pointer position in viewBox units; the SVG scales with its column.
        const svgX = ((event.clientX - rect.left) / (rect.width || WIDTH)) * WIDTH;
        const time = geometry.from + ((svgX - PAD.left) / geometry.innerW) * (geometry.to - geometry.from);
        setHover(nearestIndex(times, time));
    };

    const hovered = hover != null && hover >= 0 && hover < points.length ? points[hover] : null;
    const when = useMemo(
        () =>
            new Intl.DateTimeFormat(locale, {
                timeZone: 'Asia/Dhaka',
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
            }),
        [locale],
    );
    const causeLabel = (cause: string | null) =>
        cause == null ? m.causes.now : ((m.causes as Record<string, string>)[cause] ?? cause);

    return (
        <div className="space-y-2">
            <div className="relative">
                <svg
                    ref={svgRef}
                    viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                    className={compact ? 'h-56 w-full' : 'h-64 w-full'}
                    role="img"
                    aria-label={m.title}
                >
                    {geometry.nonWorking.map((start) => (
                        <rect
                            key={start}
                            x={x(start)}
                            y={PAD.top}
                            width={Math.max(x(start + DAY_MS) - x(start), 0)}
                            height={innerH}
                            className="fill-gray-100"
                            data-testid="non-working-day"
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
                                <text x={PAD.left - 8} y={at + 4} textAnchor="end" className="fill-gray-500 text-[10px]">
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

                    {geometry.idealLine && (
                        <polyline
                            points={geometry.idealLine}
                            fill="none"
                            className="stroke-gray-400"
                            strokeWidth={1.5}
                            strokeDasharray="5 4"
                            data-testid="ideal-line"
                        />
                    )}
                    {hasOpen && (
                        <>
                            <path
                                d={geometry.committedPath}
                                fill="none"
                                className="stroke-amber-500"
                                strokeWidth={1.5}
                                strokeDasharray="2 3"
                                data-testid="committed-line"
                            />
                            <path
                                d={geometry.openPath}
                                fill="none"
                                className="stroke-gray-700"
                                strokeWidth={1.25}
                                strokeLinecap="round"
                                data-testid="open-line"
                            />
                            <path
                                d={geometry.remainingPath}
                                fill="none"
                                className="stroke-blue-600"
                                strokeWidth={2.5}
                                strokeLinecap="round"
                                data-testid="remaining-line"
                            />
                        </>
                    )}

                    {points.map((point, i) =>
                        point.cause && SCOPE_CAUSES.has(point.cause) ? (
                            <circle
                                key={`scope-${point.at}-${i}`}
                                cx={x(times[i])}
                                cy={y(point.remaining)}
                                r={3.5}
                                className="fill-white stroke-amber-500"
                                strokeWidth={1.75}
                                data-testid="scope-point"
                            />
                        ) : null,
                    )}

                    {hovered && (
                        <g pointerEvents="none">
                            <line
                                x1={x(times[hover!])}
                                x2={x(times[hover!])}
                                y1={PAD.top}
                                y2={PAD.top + innerH}
                                className="stroke-gray-300"
                                strokeWidth={1}
                            />
                            <circle cx={x(times[hover!])} cy={y(hovered.remaining)} r={3.5} className="fill-blue-600" />
                            <circle
                                cx={x(times[hover!])}
                                cy={yOpen(hovered.open)}
                                r={3}
                                className="fill-white stroke-gray-700"
                                strokeWidth={1.5}
                            />
                        </g>
                    )}

                    {geometry.labels.map((date) => (
                        <text
                            key={`label-${date}`}
                            x={x(dayStart(date) + DAY_MS / 2)}
                            y={HEIGHT - 12}
                            textAnchor="middle"
                            className="fill-gray-500 text-[10px]"
                        >
                            {date.slice(5)}
                        </text>
                    ))}

                    <rect
                        x={PAD.left}
                        y={PAD.top}
                        width={geometry.innerW}
                        height={innerH}
                        fill="transparent"
                        data-testid="burndown-hover-area"
                        onPointerMove={pick}
                        onPointerDown={pick}
                        // A finger has no "leave": a tap elsewhere on the page
                        // blurs nothing, so the touch reading stays until the next tap.
                        onPointerLeave={(event) => {
                            if (event.pointerType === 'mouse') setHover(null);
                        }}
                    />
                </svg>

                {hovered && (
                    <div
                        role="tooltip"
                        className="pointer-events-none absolute top-0 z-10 w-max max-w-[14rem] -translate-x-1/2 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs shadow-sm"
                        style={{
                            // Kept inside the chart at both ends.
                            left: `${Math.min(Math.max((x(times[hover!]) / WIDTH) * 100, 20), 80)}%`,
                        }}
                    >
                        <div className="text-gray-500">{when.format(new Date(hovered.at))}</div>
                        <div className="font-medium text-gray-900">{causeLabel(hovered.cause)}</div>
                        <div className="tabular-nums text-gray-700">
                            {hovered.remaining}
                            {m.hoursUnit} · {hovered.open} {m.openTasks.toLowerCase()}
                        </div>
                        {hovered.task && (
                            <div className="truncate text-gray-600">
                                {hovered.task.code && <span className="me-1 tabular-nums">{hovered.task.code}</span>}
                                {hovered.task.title}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {points.length === 0 && <p className="text-xs text-gray-500">{m.noPoints}</p>}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
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
                {hasOpen && (
                    <span className="flex items-center gap-1.5">
                        <span className="inline-block h-0.5 w-4 bg-gray-700" />
                        {m.openTasksRightAxis}
                    </span>
                )}
                {hasOpen && (
                    <span className="flex items-center gap-1.5">
                        <span className="inline-block h-2 w-2 rounded-full border-2 border-amber-500 bg-white" />
                        {m.scopeChange}
                    </span>
                )}
                <span className="text-gray-500">{m.weekendNote}</span>
            </div>
        </div>
    );
}
