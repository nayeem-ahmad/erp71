import { render, screen } from '@testing-library/react';
import RemainingHoursChart, { type RemainingPoint } from './RemainingHoursChart';

const labels = {
    title: 'Remaining hours over time',
    remaining: 'Remaining',
    estimate: 'Estimated',
    now: 'now',
    upNote: 'Went up — work added',
};

/** The API hands rows back newest first; every test builds them that way. */
const row = (
    id: string,
    changedAt: string,
    previous: string | null,
    next: string,
): RemainingPoint => ({
    id,
    changed_at: changedAt,
    previous_hours: previous,
    new_hours: next,
    delta: String(Number(next) - Number(previous ?? 0)),
    source: previous == null ? 'TASK_CREATED' : 'TIME_LOGGED',
});

const chart = (history: RemainingPoint[], estimate?: number | null) =>
    render(
        <RemainingHoursChart
            history={history}
            estimate={estimate}
            labels={labels}
            dateLocale="en-GB"
        />,
    );

/** `M x y L x y L x y …` → the points, in order. */
const pointsOf = (d: string): { x: number; y: number }[] =>
    [...d.matchAll(/[ML]\s*(-?[\d.]+)\s+(-?[\d.]+)/g)].map((match) => ({
        x: Number(match[1]),
        y: Number(match[2]),
    }));

const line = () => screen.getByTestId('remaining-line').getAttribute('d') ?? '';

/**
 * Testing Library's `getByTitle` only reaches a `<title>` that is a direct child
 * of the `<svg>`; these hang off the hit circles, which is what makes the browser
 * show them against the mark rather than against the whole canvas.
 */
const tooltips = (container: HTMLElement) =>
    [...container.querySelectorAll('title')].map((node) => node.textContent ?? '');

describe('RemainingHoursChart', () => {
    it('draws nothing until there are two changes to draw', () => {
        const { container } = chart([row('r1', '2026-09-01T10:00:00.000Z', null, '8')]);
        expect(container).toBeEmptyDOMElement();
    });

    it('draws nothing at all when the task has no history', () => {
        const { container } = chart([]);
        expect(container).toBeEmptyDOMElement();
    });

    /**
     * The property that makes this a step and not a line: between two readings
     * the figure held, so every change is a horizontal run followed by a
     * vertical jump — never a diagonal.
     */
    it('holds each value flat and jumps, rather than sloping between readings', () => {
        chart([
            row('r2', '2026-09-05T10:00:00.000Z', '8', '5'),
            row('r1', '2026-09-01T10:00:00.000Z', null, '8'),
        ]);

        const points = pointsOf(line());
        for (let i = 1; i < points.length; i += 1) {
            const moved = points[i].x !== points[i - 1].x;
            const changed = points[i].y !== points[i - 1].y;
            // A diagonal is both at once; a step is one or the other.
            expect(moved && changed).toBe(false);
        }
    });

    it('reads oldest to newest even though the API answers newest first', () => {
        chart([
            row('r2', '2026-09-05T10:00:00.000Z', '8', '5'),
            row('r1', '2026-09-01T10:00:00.000Z', null, '8'),
        ]);

        const points = pointsOf(line());
        const xs = points.map((point) => point.x);
        expect(xs).toEqual([...xs].sort((a, b) => a - b));
        // 8h is the higher figure, so it is drawn nearer the top: the series
        // starts high and comes down.
        expect(points[0].y).toBeLessThan(points[points.length - 1].y);
    });

    it('carries the last value forward to now instead of stopping at the last write', () => {
        chart([
            row('r2', '2026-09-05T10:00:00.000Z', '8', '5'),
            row('r1', '2026-09-01T10:00:00.000Z', null, '8'),
        ]);

        const points = pointsOf(line());
        const last = points[points.length - 1];
        const lastWrite = points[points.length - 2];
        // A flat run on past the last write: same height, further along.
        expect(last.y).toBe(lastWrite.y);
        expect(last.x).toBeGreaterThan(lastWrite.x);
    });

    it('spends no points on a reading that moved nothing', () => {
        chart([
            row('r2', '2026-09-05T10:00:00.000Z', '8', '5'),
            row('r1', '2026-09-01T10:00:00.000Z', null, '8'),
        ]);

        // Open, run to the write, drop to 5, run on to now. Not one point more.
        expect(pointsOf(line())).toHaveLength(4);
    });

    it('marks a figure that went up in amber and one that came down in blue', () => {
        chart([
            row('r3', '2026-09-09T10:00:00.000Z', '5', '9'),
            row('r2', '2026-09-05T10:00:00.000Z', '8', '5'),
            row('r1', '2026-09-01T10:00:00.000Z', null, '8'),
        ]);

        const marks = screen.getAllByTestId('remaining-mark');
        expect(marks).toHaveLength(3);
        const up = marks.filter((mark) => mark.getAttribute('class')?.includes('fill-amber-600'));
        expect(up).toHaveLength(1);
    });

    /**
     * A task created with eight hours on it has a positive delta and is not a
     * warning about anything — the figure did not grow, it started.
     */
    it('does not flag the opening figure as work added', () => {
        chart([
            row('r2', '2026-09-05T10:00:00.000Z', '8', '5'),
            row('r1', '2026-09-01T10:00:00.000Z', null, '8'),
        ]);

        const marks = screen.getAllByTestId('remaining-mark');
        expect(
            marks.filter((mark) => mark.getAttribute('class')?.includes('fill-amber-600')),
        ).toHaveLength(0);
    });

    it('gives every recorded change a tooltip naming both figures', () => {
        const { container } = chart([
            row('r2', '2026-09-05T10:00:00.000Z', '8', '5'),
            row('r1', '2026-09-01T10:00:00.000Z', null, '8'),
        ]);

        expect(tooltips(container).some((text) => text.includes('8h → 5h'))).toBe(true);
    });

    // There was nothing before a task was created, and "0h → 8h" says there was.
    it('states the opening figure rather than inventing a zero to come from', () => {
        const { container } = chart([
            row('r2', '2026-09-05T10:00:00.000Z', '8', '5'),
            row('r1', '2026-09-01T10:00:00.000Z', null, '8'),
        ]);

        expect(tooltips(container).some((text) => text.includes('0h →'))).toBe(false);
        expect(tooltips(container).some((text) => text.endsWith('· 8h'))).toBe(true);
    });

    it('draws the estimate as a reference line when the task has one', () => {
        chart(
            [
                row('r2', '2026-09-05T10:00:00.000Z', '8', '5'),
                row('r1', '2026-09-01T10:00:00.000Z', null, '8'),
            ],
            12,
        );

        expect(screen.getByTestId('remaining-estimate')).toBeInTheDocument();
        expect(screen.getByText('Estimated')).toBeInTheDocument();
    });

    it('names the amber mark in the legend only when the chart wears one', () => {
        chart([
            row('r3', '2026-09-09T10:00:00.000Z', '5', '9'),
            row('r2', '2026-09-05T10:00:00.000Z', '8', '5'),
            row('r1', '2026-09-01T10:00:00.000Z', null, '8'),
        ]);

        expect(screen.getByText('Went up — work added')).toBeInTheDocument();
    });

    it('leaves it out when nothing on the chart went up', () => {
        chart([
            row('r2', '2026-09-05T10:00:00.000Z', '8', '5'),
            row('r1', '2026-09-01T10:00:00.000Z', null, '8'),
        ]);

        expect(screen.queryByText('Went up — work added')).not.toBeInTheDocument();
    });

    it('leaves the estimate out of the chart and the legend when there is none', () => {
        chart([
            row('r2', '2026-09-05T10:00:00.000Z', '8', '5'),
            row('r1', '2026-09-01T10:00:00.000Z', null, '8'),
        ]);

        expect(screen.queryByTestId('remaining-estimate')).not.toBeInTheDocument();
        expect(screen.queryByText('Estimated')).not.toBeInTheDocument();
    });

    // An estimate of zero is "no estimate" as far as a reference line goes —
    // a rule at the baseline is indistinguishable from the axis.
    it('ignores an estimate of zero', () => {
        chart(
            [
                row('r2', '2026-09-05T10:00:00.000Z', '8', '5'),
                row('r1', '2026-09-01T10:00:00.000Z', null, '8'),
            ],
            0,
        );

        expect(screen.queryByTestId('remaining-estimate')).not.toBeInTheDocument();
    });

    /**
     * One direct label, on the figure the chart is read for. The opening value is
     * already the top of the scale, so labelling it too puts two numbers a few
     * pixels apart saying the same thing.
     */
    it('labels the value it ends on and nothing else', () => {
        chart([
            row('r2', '2026-09-05T10:00:00.000Z', '8', '5'),
            row('r1', '2026-09-01T10:00:00.000Z', null, '8'),
        ]);

        expect(screen.getByText('5h')).toBeInTheDocument();
        expect(screen.queryByText('8h')).not.toBeInTheDocument();
    });

    it('anchors the time axis at both ends and in the middle', () => {
        chart([
            row('r2', '2026-09-05T10:00:00.000Z', '8', '5'),
            row('r1', '2026-09-01T10:00:00.000Z', null, '8'),
        ]);

        expect(screen.getByText('01/09')).toBeInTheDocument();
        expect(screen.getByText('now')).toBeInTheDocument();
        // Halfway between the first write and this moment, whenever that is.
        expect(screen.getAllByText(/^\d{2}\/\d{2}$/)).toHaveLength(2);
    });

    it('scales to the estimate when it is higher than anything logged', () => {
        chart(
            [
                row('r2', '2026-09-05T10:00:00.000Z', '8', '5'),
                row('r1', '2026-09-01T10:00:00.000Z', null, '8'),
            ],
            20,
        );

        // The reference line sits inside the plot rather than above its top edge.
        const estimateY = Number(screen.getByTestId('remaining-estimate').getAttribute('y1'));
        const highest = Math.min(...pointsOf(line()).map((point) => point.y));
        expect(estimateY).toBeGreaterThan(0);
        expect(estimateY).toBeLessThan(highest);
    });

    /**
     * docs/rtl-guidelines.md: a chart axis describes something physical, not
     * reading order, so time runs left to right in Arabic and Urdu too.
     */
    it('keeps the time axis left-to-right whatever the document direction', () => {
        const { container } = chart([
            row('r2', '2026-09-05T10:00:00.000Z', '8', '5'),
            row('r1', '2026-09-01T10:00:00.000Z', null, '8'),
        ]);

        expect(container.querySelector('[dir="ltr"]')).toContainElement(
            screen.getByTestId('remaining-line'),
        );
    });

    it('survives several writes landing on the same instant', () => {
        chart([
            row('r2', '2026-09-05T10:00:00.000Z', '8', '5'),
            row('r1', '2026-09-05T10:00:00.000Z', '9', '8'),
        ]);

        const points = pointsOf(line());
        expect(points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(
            true,
        );
    });

    it('names itself for a screen reader', () => {
        chart([
            row('r2', '2026-09-05T10:00:00.000Z', '8', '5'),
            row('r1', '2026-09-01T10:00:00.000Z', null, '8'),
        ]);

        expect(screen.getByRole('img', { name: 'Remaining hours over time' })).toBeInTheDocument();
    });
});
