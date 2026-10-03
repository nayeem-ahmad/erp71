/**
 * The maths behind the sprint burndown's time axis, apart from the SVG so it
 * can be tested without rendering.
 *
 * Sprint dates are calendar days in Dhaka (the backend's `todayKey` uses the
 * same zone), so a day on the axis runs from Dhaka midnight to Dhaka midnight —
 * not UTC, which would put a 05:00 edit on the previous day.
 */

/** One stored point on a sprint's burndown, as `GET /sprints/:id/burndown` returns it. */
export interface TimelinePoint {
    at: string;
    remaining: number;
    committed: number;
    open: number;
    /** Null on the live "now" point the server appends while the sprint runs. */
    cause: string | null;
    task: { id: string; code: string | null; title: string } | null;
}

/** The ideal line, one value per calendar day, flat across non-working days. */
export interface IdealDay {
    date: string;
    value: number | null;
    isWorkingDay: boolean;
}

const DHAKA_OFFSET = '+06:00';
const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/** Dhaka midnight at the start of a `YYYY-MM-DD` day (or an ISO timestamp's date), as epoch ms. */
export function dayStart(date: string): number {
    return Date.parse(`${date.slice(0, 10)}T00:00:00${DHAKA_OFFSET}`);
}

/** The span the axis covers: the first day's start to the last day's end. */
export function sprintWindow(startDate: string, endDate: string): { from: number; to: number } {
    return { from: dayStart(startDate), to: dayStart(endDate) + DAY_MS };
}

/**
 * An SVG path that holds each value until the next point and then steps to
 * it. A burndown is a series of readings taken when something changed; a
 * sloped line between two of them would claim the work burned gradually in
 * between, which nobody measured.
 */
export function stepPath(
    points: { t: number; v: number }[],
    x: (t: number) => number,
    y: (v: number) => number,
): string {
    if (points.length === 0) return '';
    const [first, ...rest] = points;
    // A single reading still marks the chart, as a round-capped dot.
    if (rest.length === 0) return `M${round(x(first.t))},${round(y(first.v))} h0.01`;
    let path = `M${round(x(first.t))},${round(y(first.v))}`;
    for (const point of rest) path += ` H${round(x(point.t))} V${round(y(point.v))}`;
    return path;
}

/** The index of the time closest to `t` in an ascending list; -1 when empty. */
export function nearestIndex(times: number[], t: number): number {
    if (times.length === 0) return -1;
    let lo = 0;
    let hi = times.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (times[mid] < t) lo = mid + 1;
        else hi = mid;
    }
    if (lo > 0 && Math.abs(times[lo - 1] - t) <= Math.abs(times[lo] - t)) return lo - 1;
    return lo;
}

/**
 * The ideal line's vertices: each day's value at that day's midpoint. At the
 * day's start the last working day would already read zero, a day early; at its
 * end the first day would show nothing burned on the day it began.
 */
export function idealVertices(days: IdealDay[]): { t: number; v: number }[] {
    return days
        .filter((day): day is IdealDay & { value: number } => day.value != null)
        .map((day) => ({ t: dayStart(day.date) + DAY_MS / 2, v: day.value }));
}

function round(value: number): number {
    return Math.round(value * 100) / 100;
}
