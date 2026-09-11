'use client';

import { useMemo } from 'react';
import { getActiveTimeZone } from '@/lib/format';

/** One row of `GET /project-tasks/:id/remaining-history`, as the panel holds it. */
export interface RemainingPoint {
    id: string;
    previous_hours?: string | null;
    new_hours: string;
    delta: string;
    source: string;
    changed_at: string;
}

export interface RemainingChartLabels {
    title: string;
    remaining: string;
    estimate: string;
    now: string;
    upNote: string;
}

const WIDTH = 720;
const HEIGHT = 220;
const PAD = { top: 14, right: 58, bottom: 28, left: 40 };

/** A change is only worth a chart once there are two of them. */
const MIN_ROWS = 2;

const num = (value: unknown): number => (value == null ? 0 : Number(value));
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

interface Reading {
    /** Epoch ms. */
    t: number;
    hours: number;
    /** The log row this reading came from; absent for the opening and closing ones. */
    row?: RemainingPoint;
}

/**
 * Remaining hours against the clock, drawn as a step.
 *
 * **Why a step and not a line between points.** `ProjectTaskRemainingLog` records
 * the moments the figure *changed*; between two rows it did not drift towards the
 * next value, it sat still. Sloping from one reading to the next would draw a
 * fortnight of imaginary progress across a task nobody touched, which is the
 * opposite of what someone opens this chart to find out. `BurndownChart` makes the
 * milder version of the same argument for its daily readings ("a curve between
 * them would draw hours that were never measured"); here we know more than that —
 * we know the value held — so the honest mark is a flat run and a vertical jump.
 *
 * **The x axis is real time, not the row index.** The writes are irregular by
 * nature: four in an afternoon, then nothing for three weeks. Spacing them evenly
 * would hide exactly that.
 *
 * The series is closed off at "now" rather than at the last write, so a task that
 * has been sitting at 12h since March reads as a long flat run instead of ending
 * the moment someone last touched it.
 */
export default function RemainingHoursChart({
    history,
    estimate,
    labels,
    dateLocale,
}: {
    /** Newest first, the order the API returns. */
    history: RemainingPoint[];
    estimate?: number | null;
    labels: RemainingChartLabels;
    dateLocale: string;
}) {
    const axisFormat = useMemo(
        () =>
            new Intl.DateTimeFormat(dateLocale, {
                timeZone: getActiveTimeZone(),
                day: '2-digit',
                month: '2-digit',
            }),
        [dateLocale],
    );

    const fullFormat = useMemo(
        () =>
            new Intl.DateTimeFormat(dateLocale, {
                timeZone: getActiveTimeZone(),
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
            }),
        [dateLocale],
    );

    const geometry = useMemo(() => {
        if (history.length < MIN_ROWS) return null;

        const rows = [...history]
            .map((row) => ({ row, t: new Date(row.changed_at).getTime() }))
            .filter((entry) => Number.isFinite(entry.t))
            .sort((a, b) => a.t - b.t);
        if (rows.length < MIN_ROWS) return null;

        const readings: Reading[] = [];

        // Where the figure stood before the first recorded change. Absent on a
        // task whose first row is its creation, which has nothing before it.
        const opening = rows[0].row.previous_hours;
        if (opening != null) readings.push({ t: rows[0].t, hours: num(opening) });

        for (const { row, t } of rows) readings.push({ t, hours: num(row.new_hours), row });

        const last = readings[readings.length - 1];
        const now = Date.now();
        if (now > last.t) readings.push({ t: now, hours: last.hours });

        if (readings.length < 2) return null;

        const t0 = readings[0].t;
        const t1 = readings[readings.length - 1].t;
        // Everything on one instant (several writes in the same second) would
        // divide by zero; give it a nominal span so the run still draws.
        const span = t1 - t0 || 1;

        const estimateLine = estimate != null && estimate > 0 ? estimate : null;
        const top = Math.max(...readings.map((r) => r.hours), estimateLine ?? 0, 1);

        const innerW = WIDTH - PAD.left - PAD.right;
        const innerH = HEIGHT - PAD.top - PAD.bottom;
        const x = (t: number) => PAD.left + ((t - t0) / span) * innerW;
        const y = (hours: number) => PAD.top + innerH - (hours / top) * innerH;

        // Step-after: hold the previous value across to the next timestamp, then
        // jump. Each segment is emitted only if it goes anywhere — a reading at
        // the same instant contributes no run, and one at the same figure (the
        // tail out to "now", most often) contributes no jump.
        const step: string[] = [`M ${x(readings[0].t)} ${y(readings[0].hours)}`];
        for (let i = 1; i < readings.length; i += 1) {
            if (readings[i].t !== readings[i - 1].t) {
                step.push(`L ${x(readings[i].t)} ${y(readings[i - 1].hours)}`);
            }
            if (readings[i].hours !== readings[i - 1].hours) {
                step.push(`L ${x(readings[i].t)} ${y(readings[i].hours)}`);
            }
        }
        const line = step.join(' ');
        const baseline = PAD.top + innerH;
        const area = `${line} L ${x(t1)} ${baseline} L ${x(t0)} ${baseline} Z`;

        return {
            x,
            y,
            top,
            line,
            area,
            t0,
            estimateLine,
            // Only the rows get a marker — the opening reading and the "now" tail
            // are inferred, and a dot on them would claim a write that never was.
            marks: readings
                .filter((r): r is Reading & { row: RemainingPoint } => Boolean(r.row))
                .map((mark) => ({
                    ...mark,
                    // Amber means the figure grew *after* there was one. A task
                    // created with eight hours on it has a positive delta and is
                    // not a warning about anything.
                    opened: mark.row.previous_hours != null,
                    up: mark.row.previous_hours != null && num(mark.row.delta) > 0,
                })),
            current: last.hours,
            midpoint: t0 + span / 2,
        };
    }, [history, estimate]);

    if (!geometry) return null;

    const { x, y, top, line, area, t0, midpoint, estimateLine, marks, current } = geometry;
    const ticks = [0, 0.5, 1].map((fraction) => round2(top * fraction));

    return (
        // `dir="ltr"` on the plot, per docs/rtl-guidelines.md: a chart axis
        // describes something physical rather than reading order, so time runs
        // left to right in Arabic and Urdu too. The legend below is left in the
        // document's own direction.
        <figure className="m-0 space-y-2">
            <div className="overflow-x-auto" dir="ltr">
                <svg
                    viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                    className="h-52 w-full min-w-[420px]"
                    role="img"
                    aria-label={labels.title}
                >
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
                            <text
                                x={PAD.left - 6}
                                y={y(tick) + 3.5}
                                textAnchor="end"
                                className="fill-gray-500 text-[10px] tabular-nums"
                            >
                                {tick}
                            </text>
                        </g>
                    ))}

                    {/* The estimate the task opened on. Dashed because it is a
                        threshold rather than a reading — the grid above stays
                        solid so the two never read as the same kind of thing. */}
                    {estimateLine != null && (
                        <line
                            data-testid="remaining-estimate"
                            x1={PAD.left}
                            x2={WIDTH - PAD.right}
                            y1={y(estimateLine)}
                            y2={y(estimateLine)}
                            className="stroke-gray-400"
                            strokeWidth={1.5}
                            strokeDasharray="5 4"
                        />
                    )}

                    <path
                        data-testid="remaining-area"
                        d={area}
                        className="fill-blue-600"
                        fillOpacity={0.1}
                    />
                    <path
                        data-testid="remaining-line"
                        d={line}
                        fill="none"
                        className="stroke-blue-600"
                        strokeWidth={2}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                    />

                    {marks.map(({ row, t, hours, opened, up }) => (
                            <g key={row.id}>
                                <circle
                                    data-testid="remaining-mark"
                                    cx={x(t)}
                                    cy={y(hours)}
                                    r={4}
                                    // Amber for a figure that went up: the work grew
                                    // after it was estimated, which is the one thing
                                    // on this chart worth interrupting someone for.
                                    // Never colour alone — the row beneath carries
                                    // the same distinction as a badge and an arrow.
                                    className={up ? 'fill-amber-600' : 'fill-blue-600'}
                                    stroke="white"
                                    strokeWidth={2.5}
                                />
                                {/* Hit target, not a mark: a 4px dot is not something
                                    to ask a thumb to land on. */}
                                <circle cx={x(t)} cy={y(hours)} r={16} fill="transparent">
                                    <title>
                                        {`${fullFormat.format(t)} · ${
                                            opened
                                                ? `${num(row.previous_hours)}h → ${num(row.new_hours)}h`
                                                : `${num(row.new_hours)}h`
                                        }`}
                                    </title>
                                </circle>
                            </g>
                    ))}

                    {/* One direct label, on the value the chart is read for. A
                        number on every point is the fastest way to make a chart
                        unreadable, and the opening figure is already the top of
                        the scale — labelling it puts two numbers a few pixels
                        apart that say the same thing. */}
                    <text
                        x={WIDTH - PAD.right + 6}
                        y={y(current) + 3.5}
                        textAnchor="start"
                        className="fill-gray-700 text-[11px] font-medium tabular-nums"
                    >
                        {`${current}h`}
                    </text>

                    <text
                        x={PAD.left}
                        y={HEIGHT - 8}
                        textAnchor="start"
                        className="fill-gray-500 text-[10px]"
                    >
                        {axisFormat.format(t0)}
                    </text>
                    {/* One tick in the middle, so the axis says how long a span
                        this is rather than only where it starts and ends. Centred
                        between two labels anchored to the edges, so it cannot
                        collide with either however short the span. */}
                    <text
                        x={(PAD.left + WIDTH - PAD.right) / 2}
                        y={HEIGHT - 8}
                        textAnchor="middle"
                        className="fill-gray-500 text-[10px]"
                    >
                        {axisFormat.format(midpoint)}
                    </text>
                    <text
                        x={WIDTH - PAD.right}
                        y={HEIGHT - 8}
                        textAnchor="end"
                        className="fill-gray-500 text-[10px]"
                    >
                        {labels.now}
                    </text>
                </svg>
            </div>

            <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
                <span className="flex items-center gap-1.5">
                    <span className="inline-block h-0.5 w-4 shrink-0 bg-blue-600" />
                    {labels.remaining}
                </span>
                {estimateLine != null && (
                    <span className="flex items-center gap-1.5">
                        <span className="inline-block h-0.5 w-4 shrink-0 bg-gray-400" />
                        {labels.estimate}
                    </span>
                )}
                {marks.some((mark) => mark.up) && (
                    <span className="flex items-center gap-1.5">
                        <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-amber-600" />
                        {labels.upNote}
                    </span>
                )}
            </figcaption>
        </figure>
    );
}
