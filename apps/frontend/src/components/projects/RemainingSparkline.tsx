'use client';

import { useMemo } from 'react';
import { getActiveTimeZone } from '@/lib/format';
import type { RemainingPoint } from './RemainingHoursChart';

/**
 * The remaining-hours history at sidebar size, under the three figures.
 *
 * A deliberate sibling of `RemainingHoursChart` rather than a second opinion:
 * it draws the same series with the same rules, and the two must not disagree
 * about what the data means.
 *
 * - **A step, not a slope.** `ProjectTaskRemainingLog` records the moments the
 *   figure *changed*; between two rows it did not drift towards the next value,
 *   it sat still. A sloped line would draw a fortnight of imaginary progress
 *   across a task nobody touched.
 * - **Real time on the x axis**, not the row index, because the writes are
 *   irregular by nature — four in an afternoon, then nothing for three weeks.
 * - **Closed off at "now"**, so a task that has sat at 4h since Tuesday reads as
 *   a long flat run instead of ending at its last edit.
 *
 * Hover detail comes from an SVG `<title>` per segment, the same mechanism the
 * full chart uses. A styled tooltip would look better and would also be a
 * second way of saying the same thing, unavailable to the keyboard and to a
 * screen reader; `<title>` is spoken, focusable and free.
 */

const WIDTH = 244;
const HEIGHT = 64;
const PAD = { top: 6, right: 6, bottom: 12, left: 26 };

/** A change is only worth a chart once there are two of them. */
const MIN_ROWS = 2;

const num = (value: unknown): number => (value == null ? 0 : Number(value));
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

interface Reading {
    t: number;
    hours: number;
    row?: RemainingPoint;
}

export default function RemainingSparkline({
    history,
    labels,
    dateLocale,
}: {
    /** Newest first, the order the API returns. */
    history: RemainingPoint[];
    labels: { title: string; remaining: string; hover: string };
    dateLocale: string;
}) {
    const stamp = useMemo(
        () =>
            new Intl.DateTimeFormat(dateLocale, {
                timeZone: getActiveTimeZone(),
                day: '2-digit',
                month: 'short',
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
        const opening = rows[0].row.previous_hours;
        if (opening != null) readings.push({ t: rows[0].t, hours: num(opening) });
        for (const { row, t } of rows) readings.push({ t, hours: num(row.new_hours), row });

        const last = readings[readings.length - 1];
        const now = Date.now();
        if (now > last.t) readings.push({ t: now, hours: last.hours });
        if (readings.length < 2) return null;

        const t0 = readings[0].t;
        const t1 = readings[readings.length - 1].t;
        const span = t1 - t0 || 1;
        const top = Math.max(...readings.map((r) => r.hours), 1);

        const innerW = WIDTH - PAD.left - PAD.right;
        const innerH = HEIGHT - PAD.top - PAD.bottom;
        const x = (t: number) => PAD.left + ((t - t0) / span) * innerW;
        const y = (hours: number) => PAD.top + innerH - (hours / top) * innerH;

        // Step-after: hold the value across to the next timestamp, then jump.
        const step: string[] = [`M ${x(readings[0].t)} ${y(readings[0].hours)}`];
        for (let i = 1; i < readings.length; i += 1) {
            step.push(`L ${x(readings[i].t)} ${y(readings[i - 1].hours)}`);
            if (readings[i].hours !== readings[i - 1].hours) {
                step.push(`L ${x(readings[i].t)} ${y(readings[i].hours)}`);
            }
        }

        const baseline = PAD.top + innerH;
        const area = `${step.join(' ')} L ${x(t1)} ${baseline} L ${x(t0)} ${baseline} Z`;

        // One hover target per run, spanning the flat stretch it represents —
        // hovering anywhere along a run should report the reading that holds
        // there, not only the pixel the value changed on.
        const hits = readings.slice(0, -1).map((reading, i) => {
            const from = x(reading.t);
            const to = x(readings[i + 1].t);
            return { from, width: Math.max(to - from, 1), reading };
        });

        return { step: step.join(' '), area, x, y, top, readings, hits, baseline };
    }, [history]);

    if (!geometry) return null;

    const { step, area, top, hits, baseline } = geometry;
    const latest = geometry.readings[geometry.readings.length - 1];

    const describe = (reading: Reading) => {
        const when = stamp.format(new Date(reading.t));
        const head = `${when} — ${round2(reading.hours)}h ${labels.remaining}`;
        if (!reading.row) return head;
        const delta = num(reading.row.delta);
        if (!delta) return head;
        return `${head} (${delta > 0 ? '+' : ''}${round2(delta)})`;
    };

    return (
        <figure className="m-0 flex flex-col gap-1">
            <svg
                viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                className="block h-16 w-full"
                role="img"
                aria-label={`${labels.title}: ${round2(latest.hours)}h ${labels.remaining}`}
            >
                <line
                    x1={PAD.left}
                    y1={PAD.top}
                    x2={WIDTH - PAD.right}
                    y2={PAD.top}
                    stroke="currentColor"
                    className="text-gray-100"
                    strokeDasharray="2 3"
                />
                <line
                    x1={PAD.left}
                    y1={baseline}
                    x2={WIDTH - PAD.right}
                    y2={baseline}
                    stroke="currentColor"
                    className="text-gray-200"
                />
                <text
                    x={PAD.left - 5}
                    y={PAD.top + 4}
                    textAnchor="end"
                    className="fill-gray-500 text-[8px] tabular-nums"
                >
                    {round2(top)}
                </text>
                <text
                    x={PAD.left - 5}
                    y={baseline + 3}
                    textAnchor="end"
                    className="fill-gray-500 text-[8px] tabular-nums"
                >
                    0
                </text>

                <path d={area} className="fill-blue-600/10" />
                <path
                    d={step}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    className="text-blue-600"
                />
                <circle
                    cx={geometry.x(latest.t)}
                    cy={geometry.y(latest.hours)}
                    r="3"
                    className="fill-blue-600 stroke-white"
                    strokeWidth="1.5"
                />

                {hits.map(({ from, width, reading }) => (
                    <rect
                        key={`${reading.t}-${reading.hours}`}
                        x={from}
                        y={0}
                        width={width}
                        height={baseline}
                        className="fill-transparent hover:fill-blue-600/5"
                    >
                        <title>{describe(reading)}</title>
                    </rect>
                ))}
            </svg>
            <figcaption className="flex items-baseline justify-between gap-2 text-[11px] text-gray-500">
                <span>{labels.title}</span>
                <span className="italic">{labels.hover}</span>
            </figcaption>
        </figure>
    );
}
