'use client';

import { useMemo, useRef, useState } from 'react';

export type ActivityHeatmapPoint = {
    date: string;
    done: number;
    planned: number;
};

export type ActivityHeatmapLabels = {
    title: string;
    subtitle: string;
    done: string;
    planned: string;
    less: string;
    more: string;
    empty: string;
    today: string;
    /** A template carrying `{done}` and `{planned}`, filled per day. */
    dayCounts: string;
    /** Screen-reader summary of the whole grid. */
    summary: string;
    /** Caption for the hidden table of the days that had activity. */
    tableCaption: string;
    tableDate: string;
};

/**
 * The two sequential ramps, one hue each.
 *
 * Alpha steps on the two palette tokens rather than hand-picked tints: over the
 * white card that is a monotone-lightness ramp by construction, it cannot drift
 * off-hue, and the darkest step is the token itself — the pair the design system
 * already validated for colour-vision deficiency (ΔE 29.9 protan, 38.5 normal).
 * Written out in full because Tailwind only keeps classes it can see as literals.
 */
const RAMP = {
    done: ['bg-primary/25', 'bg-primary/45', 'bg-primary/70', 'bg-primary'],
    planned: ['bg-series-2/25', 'bg-series-2/45', 'bg-series-2/70', 'bg-series-2'],
} as const;

const EMPTY_CELL = 'bg-gray-100';
/** A day that has not happened yet: fainter than a zero, because it is not one. */
const UNREACHED_CELL = 'bg-gray-50';

/**
 * Taller than wide, because a cell now carries two stacked halves rather than
 * one flat tone — at a square 14px each half would be three pixels of colour.
 * Merging the old two bands into one grid is what paid for the extra height.
 */
const CELL = 'h-5 w-4 md:h-6 md:w-5 lg:h-7 lg:w-6';
/** Matches `CELL`'s height, for the weekday label column beside the grid. */
const CELL_ROW = 'h-5 md:h-6 lg:h-7';
/**
 * The weekday-label column. Fixed rather than content-sized so the month labels
 * stay over their own group in every locale — "Mon", "সোম" and "الاثنين" are not
 * the same width, and a shrink-to-fit gutter would slide the grid along with it.
 */
const GUTTER = 'w-8';
const KEY_SWATCH = 'h-2.5 w-2.5 rounded-[2px]';
const LEVELS = 4;

type Series = keyof typeof RAMP;

/** Where a tooltip hangs off its cell, so it can never reach past the card. */
type Align = 'start' | 'center' | 'end';

/**
 * Which of the four steps a count sits on, against the busiest day in its *own*
 * series. A tenant logging three calls a day should see the same contrast as one
 * logging thirty; a shared scale would wash one of them out.
 */
export function rampLevel(count: number, max: number): number {
    if (count <= 0 || max <= 0) return 0;
    return Math.min(LEVELS, Math.ceil((count / max) * LEVELS));
}

/** `YYYY-MM-DD` read as a UTC instant, so day arithmetic never crosses a zone. */
function parseDay(date: string): Date {
    const [year, month, day] = date.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Days laid out as calendar columns: one column per week, seven rows per column,
 * Sunday first. Days before the first Sunday (or after the last Saturday) are
 * `null` spacers rather than empty squares.
 */
function toWeeks(points: ActivityHeatmapPoint[]): (ActivityHeatmapPoint | null)[][] {
    if (points.length === 0) return [];

    const weeks: (ActivityHeatmapPoint | null)[][] = [];
    let current: (ActivityHeatmapPoint | null)[] = Array.from({ length: 7 }, () => null);

    for (const point of points) {
        const weekday = parseDay(point.date).getUTCDay();
        // A new week starts on a Sunday, or on the very first point when the
        // run does not begin on one.
        if (weekday === 0 && current.some(Boolean)) {
            weeks.push(current);
            current = Array.from({ length: 7 }, () => null);
        }
        current[weekday] = point;
    }
    weeks.push(current);

    return weeks;
}

export type HeatmapMonth = { key: string; first: string; weeks: (ActivityHeatmapPoint | null)[][] };

/**
 * One block per calendar month, each laid out on its own week columns.
 *
 * A single continuous run of weeks needs a month *label* to say where you are,
 * and the label can only sit over the week a month happens to start in — which
 * is usually mid-column, so it points at the wrong place by up to six days.
 * Breaking the run into month blocks makes the boundary a gap you can see, and
 * the label then names the block underneath it rather than approximating.
 *
 * The cost is that a week spanning a boundary is drawn as two part-columns, one
 * in each month. That is the honest rendering: those days really are in
 * different months, which is the thing being grouped by.
 */
export function toMonths(points: ActivityHeatmapPoint[]): HeatmapMonth[] {
    const byMonth = new Map<string, ActivityHeatmapPoint[]>();
    for (const point of points) {
        const key = point.date.slice(0, 7);
        const bucket = byMonth.get(key);
        if (bucket) bucket.push(point);
        else byMonth.set(key, [point]);
    }

    return [...byMonth.entries()].map(([key, days]) => ({
        key,
        first: days[0].date,
        weeks: toWeeks(days),
    }));
}

/**
 * A calendar of CRM activity: one square per day, split in two — the upper half
 * is what was completed that day, the lower half what is planned for it.
 *
 * Two halves of one cell rather than two separate grids. A day is one thing, and
 * the question people actually bring to this chart is "how did that day go",
 * which a single square answers by being read once. The split keeps each series
 * on its own sequential ramp — intensity is still one hue per half — while
 * halving the height the panel needs, which is what lets it sit beside the
 * funnel instead of on a row of its own.
 *
 * Presentational — the window and the fetch belong to the dashboard, the same
 * way `PipelineFunnel` and `CashFlowChart` take theirs.
 */
export function ActivityHeatmap({
    points,
    max,
    today,
    loading,
    locale,
    labels,
}: Readonly<{
    /** One per calendar day, ascending and gapless — as the endpoint returns them. */
    points: ActivityHeatmapPoint[];
    max: { done: number; planned: number };
    /** `YYYY-MM-DD`. Splits "nothing happened" from "has not happened yet". */
    today: string;
    loading: boolean;
    locale: string;
    labels: ActivityHeatmapLabels;
}>) {
    /**
     * The frame the tooltip is positioned against. Deliberately *outside* the
     * scrolling element: an `overflow-x-auto` ancestor clips its children on both
     * axes, which is what used to shear the tooltip off at the card edge.
     */
    const frameRef = useRef<HTMLDivElement>(null);
    const [hovered, setHovered] = useState<
        { point: ActivityHeatmapPoint; x: number; y: number; align: Align; below: boolean } | null
    >(null);

    const months = useMemo(() => toMonths(points), [points]);
    const active = useMemo(() => points.filter((point) => point.done > 0 || point.planned > 0), [points]);

    const dayLabel = (date: string) =>
        parseDay(date).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
    const monthLabel = (date: string) =>
        parseDay(date).toLocaleDateString(locale, { month: 'short', timeZone: 'UTC' });
    const weekdayLabel = (weekday: number) =>
        // 2026-03-01 was a Sunday, so the offset lands on the right weekday name.
        new Date(Date.UTC(2026, 2, 1 + weekday)).toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' });

    const counts = (point: ActivityHeatmapPoint) =>
        labels.dayCounts.replace('{done}', String(point.done)).replace('{planned}', String(point.planned));
    const cellTitle = (point: ActivityHeatmapPoint) =>
        `${dayLabel(point.date)}${point.date === today ? ` (${labels.today})` : ''} — ${counts(point)}`;

    /**
     * Where the tooltip goes, measured off the cell rather than computed from the
     * grid geometry, so it stays anchored however the month blocks reflow.
     *
     * Near an edge the tooltip hangs by that edge instead of by its centre, and a
     * cell in the top rows gets one below it rather than above. Chosen from the
     * cell's position rather than the tooltip's measured width on purpose: the
     * width is not known until after a paint, and correcting it then is a visible
     * jump on every hover.
     */
    const track = (event: React.MouseEvent<HTMLElement>, point: ActivityHeatmapPoint) => {
        const frame = frameRef.current;
        if (!frame) return;
        const cell = event.currentTarget.getBoundingClientRect();
        const box = frame.getBoundingClientRect();
        const x = cell.left - box.left + cell.width / 2;
        const y = cell.top - box.top;

        setHovered({
            point,
            x,
            y,
            align: x < box.width * 0.25 ? 'start' : x > box.width * 0.75 ? 'end' : 'center',
            below: y < 48,
        });
    };

    const half = (point: ActivityHeatmapPoint, series: Series) => {
        // A future day cannot have been worked, so an empty "completed" half
        // there would be a claim, not a fact.
        const unreached = series === 'done' && point.date > today;
        const level = unreached ? 0 : rampLevel(point[series], max[series]);
        const tone = unreached ? UNREACHED_CELL : level === 0 ? EMPTY_CELL : RAMP[series][level - 1];
        return (
            <span
                key={series}
                data-testid={`heatmap-half-${series}`}
                data-date={point.date}
                data-level={unreached ? 'unreached' : level}
                className={`flex-1 ${tone}`}
            />
        );
    };

    const cell = (point: ActivityHeatmapPoint | null, weekday: number) => {
        if (!point) return <span key={weekday} className={CELL} />;
        return (
            <span
                key={point.date}
                data-testid="heatmap-cell"
                data-date={point.date}
                title={cellTitle(point)}
                // Flush, with no dividing line: a hairline between the halves
                // made each cell read as two stacked pills rather than one day
                // split in two, which is the whole point of the shape. The hue
                // change carries the split, and an all-grey cell is a quiet day
                // that should look like one square, not two.
                className={`${CELL} flex flex-col overflow-hidden rounded-[2px] ${
                    point.date === today ? 'ring-1 ring-gray-500 ring-offset-1 ring-offset-white' : ''
                }`}
                onMouseEnter={(event) => track(event, point)}
                onMouseLeave={() => setHovered(null)}
            >
                {half(point, 'done')}
                {half(point, 'planned')}
            </span>
        );
    };

    /**
     * A series' name, its hue, and its own Less→More key.
     *
     * One key per hue rather than one for the chart: there are two ramps, a single
     * key could only be drawn in one of them, and it would then be quietly
     * claiming to describe the other too. The swatch beside the name is also what
     * keeps series identity off colour alone.
     */
    const legendRow = (series: Series, label: string) => (
        <div className="flex items-center gap-1.5">
            <span
                className={`${KEY_SWATCH} shrink-0 ${series === 'done' ? 'bg-primary' : 'bg-series-2'}`}
                aria-hidden="true"
            />
            <span className="text-[10px] font-bold text-gray-600">{label}</span>
            <span className="flex items-center gap-0.5 text-[9px] text-gray-400" aria-hidden="true">
                {labels.less}
                <span className={`${KEY_SWATCH} ${EMPTY_CELL}`} />
                {RAMP[series].map((tone) => (
                    <span key={tone} className={`${KEY_SWATCH} ${tone}`} />
                ))}
                {labels.more}
            </span>
        </div>
    );

    return (
        <div className="flex h-full flex-col rounded-xl border border-gray-100 bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                <h3 className="text-xs font-bold text-gray-900">{labels.title}</h3>
                <p className="text-[10px] text-gray-400">{labels.subtitle}</p>
            </div>

            {loading ? (
                <div data-testid="heatmap-skeleton" className="h-40 flex-1 animate-pulse rounded-lg bg-gray-100" />
            ) : active.length === 0 ? (
                // A wall of identical grey squares tells a new tenant nothing; the
                // empty message is what every other panel here shows instead.
                <p className="flex-1 py-8 text-center text-[11px] text-gray-400">{labels.empty}</p>
            ) : (
                <>
                    {/* The positioning frame. It does not scroll, so the tooltip
                        inside it is not clipped by the scroller below. */}
                    <div ref={frameRef} data-testid="heatmap-frame" className="relative flex-1">
                        <div className="overflow-x-auto pb-1">
                            <div role="img" aria-label={labels.summary} className="flex w-max items-start gap-1.5">
                                <div className={`flex shrink-0 flex-col ${GUTTER}`}>
                                    {/* Spacer under the month labels, so the weekday
                                        names start level with the first row. */}
                                    <span aria-hidden="true" className="mb-1 block h-3" />
                                    <div className="flex flex-col gap-0.5">
                                        {Array.from({ length: 7 }, (_, weekday) => (
                                            <span
                                                key={weekday}
                                                aria-hidden="true"
                                                className={`flex ${CELL_ROW} items-center truncate text-[8px] leading-none text-gray-400`}
                                            >
                                                {/* Every other row, or the names crowd into each other. */}
                                                {weekday % 2 === 1 ? weekdayLabel(weekday) : ''}
                                            </span>
                                        ))}
                                    </div>
                                </div>

                                {/* One block per month, with a gap between them —
                                    the boundary you can see, rather than a label
                                    pointing into the middle of a shared column. */}
                                {months.map((month) => (
                                    <div key={month.key} data-testid="heatmap-month" data-month={month.key}>
                                        <p
                                            aria-hidden="true"
                                            className="mb-1 h-3 whitespace-nowrap text-[8px] font-bold leading-none text-gray-400"
                                        >
                                            {monthLabel(month.first)}
                                        </p>
                                        <div className="flex gap-0.5">
                                            {month.weeks.map((week, index) => (
                                                <div
                                                    key={week.find(Boolean)?.date ?? index}
                                                    className="flex flex-col gap-0.5"
                                                >
                                                    {week.map(cell)}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {hovered ? (
                            <div
                                data-testid="heatmap-tooltip"
                                data-align={hovered.align}
                                className={`pointer-events-none absolute z-10 max-w-[calc(100%-0.5rem)] rounded-md bg-gray-900 px-2.5 py-1.5 text-[11px] leading-snug text-white shadow-lg ${
                                    hovered.align === 'center'
                                        ? '-translate-x-1/2'
                                        : hovered.align === 'end'
                                          ? '-translate-x-full'
                                          : ''
                                } ${hovered.below ? '' : '-translate-y-full'}`}
                                style={{
                                    left: hovered.x,
                                    top: hovered.below ? hovered.y + 28 : hovered.y - 6,
                                }}
                            >
                                <p className="whitespace-nowrap font-bold">
                                    {dayLabel(hovered.point.date)}
                                    {hovered.point.date === today ? ` · ${labels.today}` : ''}
                                </p>
                                <p className="whitespace-nowrap text-gray-300">{counts(hovered.point)}</p>
                            </div>
                        ) : null}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                        {legendRow('done', labels.done)}
                        {legendRow('planned', labels.planned)}
                    </div>

                    {/* The table view: the same numbers, for anyone who cannot read a
                        square. Only the days that carry any — 91 rows of "0 · 0" would
                        bury the ones that matter. */}
                    <table className="sr-only">
                        <caption>{labels.tableCaption}</caption>
                        <thead>
                            <tr>
                                <th scope="col">{labels.tableDate}</th>
                                <th scope="col">{labels.done}</th>
                                <th scope="col">{labels.planned}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {active.map((point) => (
                                <tr key={point.date}>
                                    <th scope="row">{dayLabel(point.date)}</th>
                                    <td>{point.done}</td>
                                    <td>{point.planned}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </>
            )}
        </div>
    );
}

export default ActivityHeatmap;
