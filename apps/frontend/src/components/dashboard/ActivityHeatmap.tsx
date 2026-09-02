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

const CELL = 'h-3.5 w-3.5 md:h-4 md:w-4 lg:h-5 lg:w-5 rounded-[3px]';
/** Matches `CELL`'s height, for the label column that runs alongside a band. */
const CELL_ROW = 'h-3.5 md:h-4 lg:h-5';
/**
 * The weekday-label column. Fixed rather than content-sized so the month strip
 * lines up over the right week in every locale — "Mon", "সোম" and "الاثنين" are
 * not the same width, and a shrink-to-fit gutter would slide the months along
 * with the label.
 */
const GUTTER = 'w-9';
const LEVELS = 4;

type Series = keyof typeof RAMP;

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
 * The points laid out as calendar columns: one column per week, seven rows per
 * column, Sunday first. Days before the window's first Sunday (or after its last
 * Saturday) are `null` spacers rather than empty squares.
 */
function toWeeks(points: ActivityHeatmapPoint[]): (ActivityHeatmapPoint | null)[][] {
    if (points.length === 0) return [];

    const weeks: (ActivityHeatmapPoint | null)[][] = [];
    let current: (ActivityHeatmapPoint | null)[] = Array.from({ length: 7 }, () => null);

    for (const point of points) {
        const weekday = parseDay(point.date).getUTCDay();
        // A new week starts on a Sunday, or on the very first point when the
        // window does not begin on one.
        if (weekday === 0 && current.some(Boolean)) {
            weeks.push(current);
            current = Array.from({ length: 7 }, () => null);
        }
        current[weekday] = point;
    }
    weeks.push(current);

    return weeks;
}

/**
 * A calendar of CRM activity: one square per day, in two bands — what was
 * completed that day, and what is planned for it.
 *
 * Two aligned bands rather than one grid of two-tone cells. Intensity is a
 * sequential encoding, and a sequential encoding is one hue; splitting a 14px
 * square into two 6px ramps would look like a chart and read like noise. Stacked
 * on a shared set of week columns, each band keeps its own clean ramp and the
 * two are still comparable straight down the column.
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
    const gridRef = useRef<HTMLDivElement>(null);
    const [hovered, setHovered] = useState<{ point: ActivityHeatmapPoint; x: number; y: number } | null>(null);

    const weeks = useMemo(() => toWeeks(points), [points]);
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
     * grid geometry, so it stays anchored however the band labels reflow.
     */
    const track = (event: React.MouseEvent<HTMLElement>, point: ActivityHeatmapPoint) => {
        const host = gridRef.current;
        if (!host) return;
        const cell = event.currentTarget.getBoundingClientRect();
        const box = host.getBoundingClientRect();
        setHovered({ point, x: cell.left - box.left + cell.width / 2, y: cell.top - box.top });
    };

    const band = (series: Series) => (
        <div className="flex items-start gap-1.5">
            <div className={`flex shrink-0 flex-col gap-0.5 ${GUTTER}`}>
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
            <div className="flex gap-0.5">
                {weeks.map((week, index) => (
                    <div key={week.find(Boolean)?.date ?? index} className="flex flex-col gap-0.5">
                        {week.map((point, weekday) => {
                            if (!point) return <span key={weekday} className={CELL} />;
                            // A future day cannot have been worked, so an empty
                            // "completed" square there would be a claim, not a fact.
                            const unreached = series === 'done' && point.date > today;
                            const level = unreached ? 0 : rampLevel(point[series], max[series]);
                            const tone = unreached
                                ? UNREACHED_CELL
                                : (level === 0 ? EMPTY_CELL : RAMP[series][level - 1]);
                            return (
                                <span
                                    key={point.date}
                                    data-testid={`heatmap-cell-${series}`}
                                    data-date={point.date}
                                    data-level={unreached ? 'unreached' : level}
                                    title={cellTitle(point)}
                                    className={`${CELL} ${tone} ${
                                        point.date === today
                                            ? 'ring-1 ring-gray-500 ring-offset-1 ring-offset-white'
                                            : ''
                                    }`}
                                    onMouseEnter={(event) => track(event, point)}
                                    onMouseLeave={() => setHovered(null)}
                                />
                            );
                        })}
                    </div>
                ))}
            </div>
        </div>
    );

    /**
     * The band's name, its hue, and its own Less→More key.
     *
     * The key belongs here rather than once at the foot of the card: there are two
     * ramps, a single key could only be drawn in one of the hues, and it would
     * then be quietly claiming to describe the other one too. The colour swatch
     * beside the name is also what keeps identity off colour alone.
     */
    const bandHeading = (series: Series, label: string) => (
        <div className="mb-1 flex items-center gap-2">
            <p className="flex items-center gap-1.5 text-[10px] font-bold text-gray-600">
                <span className={`h-2 w-2 shrink-0 rounded-[2px] ${series === 'done' ? 'bg-primary' : 'bg-series-2'}`} />
                {label}
            </p>
            <span className="ms-auto flex items-center gap-1 text-[9px] text-gray-400">
                {labels.less}
                <span className={`${CELL} ${EMPTY_CELL}`} />
                {RAMP[series].map((tone) => (
                    <span key={tone} className={`${CELL} ${tone}`} />
                ))}
                {labels.more}
            </span>
        </div>
    );

    return (
        <div className="rounded-xl border border-gray-100 bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                <h3 className="text-xs font-bold text-gray-900">{labels.title}</h3>
                <p className="text-[10px] text-gray-400">{labels.subtitle}</p>
            </div>

            {loading ? (
                <div data-testid="heatmap-skeleton" className="h-40 animate-pulse rounded-lg bg-gray-100" />
            ) : active.length === 0 ? (
                // A wall of identical grey squares tells a new tenant nothing; the
                // empty message is what every other panel here shows instead.
                <p className="py-8 text-center text-[11px] text-gray-400">{labels.empty}</p>
            ) : (
                <>
                    <div className="overflow-x-auto">
                        <div ref={gridRef} className="relative w-max">
                            {/* One month strip, shared: both bands run on the same
                                columns. Built from the same gutter + gap as a band,
                                so alignment is structural rather than a padding
                                number that drifts the first time a font changes. */}
                            <div className="mb-1 flex items-start gap-1.5" aria-hidden="true">
                                <div className={`${GUTTER} shrink-0`} />
                                <div className="flex gap-0.5">
                                    {weeks.map((week, index) => {
                                        const first = week.find(Boolean);
                                        const previous = weeks[index - 1]?.find(Boolean);
                                        const starts = first
                                            && (!previous
                                                || parseDay(previous.date).getUTCMonth() !== parseDay(first.date).getUTCMonth());
                                        return (
                                            <span
                                                key={first?.date ?? index}
                                                className="w-3.5 whitespace-nowrap text-[8px] leading-none text-gray-400"
                                            >
                                                {starts ? monthLabel(first.date) : ''}
                                            </span>
                                        );
                                    })}
                                </div>
                            </div>

                            <div role="img" aria-label={labels.summary} className="space-y-2">
                                <div>
                                    {bandHeading('done', labels.done)}
                                    {band('done')}
                                </div>
                                <div>
                                    {bandHeading('planned', labels.planned)}
                                    {band('planned')}
                                </div>
                            </div>

                            {hovered ? (
                                <div
                                    data-testid="heatmap-tooltip"
                                    className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md bg-gray-900 px-2.5 py-1.5 text-[11px] leading-snug text-white shadow-lg"
                                    style={{ left: hovered.x, top: hovered.y - 4 }}
                                >
                                    <p className="font-bold">
                                        {dayLabel(hovered.point.date)}
                                        {hovered.point.date === today ? ` · ${labels.today}` : ''}
                                    </p>
                                    <p className="text-gray-300">{counts(hovered.point)}</p>
                                </div>
                            ) : null}
                        </div>
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
