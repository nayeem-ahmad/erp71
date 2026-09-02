import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ActivityHeatmap, rampLevel, toMonths, type ActivityHeatmapPoint } from './ActivityHeatmap';

const labels = {
    title: 'Activity calendar',
    subtitle: 'Last 10 weeks · next 2',
    done: 'Completed',
    planned: 'Planned',
    less: 'Less',
    more: 'More',
    empty: 'Nothing logged or planned in this window',
    today: 'today',
    dayCounts: '{done} completed · {planned} planned',
    summary: 'Activity calendar — 9 completed and 4 planned over 14 days',
    tableCaption: 'Days with activity',
    tableDate: 'Date',
};

/** A run of days from `from`, with counts supplied per index. */
function days(
    from: string,
    length: number,
    counts: (index: number) => Partial<ActivityHeatmapPoint> = () => ({}),
): ActivityHeatmapPoint[] {
    const [year, month, day] = from.split('-').map(Number);
    return Array.from({ length }, (_, index) => {
        const at = new Date(Date.UTC(year, month - 1, day + index));
        return { date: at.toISOString().slice(0, 10), done: 0, planned: 0, ...counts(index) };
    });
}

/**
 * Real rects for the frame and the hovered cells. jsdom reports zeroes for
 * everything, which would collapse every tooltip position to the same case.
 */
function stubGeometry(cellLefts: Record<string, number>, frameWidth = 400, cellTop = 90) {
    jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLElement,
    ) {
        if (this.dataset.testid === 'heatmap-frame') {
            return { left: 0, top: 0, width: frameWidth, height: 200 } as DOMRect;
        }
        return { left: cellLefts[this.dataset.date ?? ''] ?? 0, top: cellTop, width: 20, height: 24 } as DOMRect;
    });
}

afterEach(() => jest.restoreAllMocks());

function renderHeatmap(props: Partial<React.ComponentProps<typeof ActivityHeatmap>> = {}) {
    // 2026-07-05 is a Sunday, so the window starts cleanly on a column boundary.
    return render(
        <ActivityHeatmap
            points={days('2026-07-05', 14, (i) => (i === 1 ? { done: 4, planned: 1 } : {}))}
            max={{ done: 4, planned: 1 }}
            today="2026-07-10"
            loading={false}
            locale="en"
            labels={labels}
            {...props}
        />,
    );
}

describe('rampLevel', () => {
    it('gives a day with no activity no colour at all', () => {
        expect(rampLevel(0, 10)).toBe(0);
    });

    it('puts the busiest day on the darkest step', () => {
        expect(rampLevel(10, 10)).toBe(4);
    });

    it('steps a quiet tenant against its own peak, not an absolute scale', () => {
        // Three calls a day is this tenant's busiest; it should still read as busy.
        expect(rampLevel(3, 3)).toBe(4);
        expect(rampLevel(1, 3)).toBe(2);
    });

    it('never leaves a day with activity looking empty', () => {
        expect(rampLevel(1, 1000)).toBe(1);
    });
});


describe('toMonths', () => {
    it('puts each calendar month in its own block', () => {
        const months = toMonths(days('2026-06-28', 40));

        expect(months.map((month) => month.key)).toEqual(['2026-06', '2026-07', '2026-08']);
    });

    it('splits a week that straddles a boundary rather than filing it under one month', () => {
        // 2026-06-28 is a Sunday, so Jun 28-30 and Jul 1-4 share a calendar week.
        const [june, july] = toMonths(days('2026-06-28', 10));

        // June keeps Sun-Tue of that week; the rest of the column is padding.
        expect(june.weeks).toHaveLength(1);
        expect(june.weeks[0].filter(Boolean).map((point) => point!.date)).toEqual([
            '2026-06-28',
            '2026-06-29',
            '2026-06-30',
        ]);
        // July picks the same week up at Wednesday, in the right weekday rows.
        expect(july.weeks[0][2]).toBeNull();
        expect(july.weeks[0][3]?.date).toBe('2026-07-01');
    });

    it('keeps every day exactly once across the blocks', () => {
        const points = days('2026-06-28', 40);
        const laid = toMonths(points).flatMap((month) => month.weeks.flat()).filter(Boolean);

        expect(laid.map((point) => point!.date)).toEqual(points.map((point) => point.date));
    });
});

describe('ActivityHeatmap', () => {
    it('draws one square per day, carrying both series', () => {
        renderHeatmap();

        expect(screen.getAllByTestId('heatmap-cell')).toHaveLength(14);
        // Each cell is split, so both halves exist on every day.
        expect(screen.getAllByTestId('heatmap-half-done')).toHaveLength(14);
        expect(screen.getAllByTestId('heatmap-half-planned')).toHaveLength(14);
    });

    it('gives each half of a cell its own hue', () => {
        renderHeatmap();

        const done = screen.getAllByTestId('heatmap-half-done')[1];
        const planned = screen.getAllByTestId('heatmap-half-planned')[1];

        expect(done.className).toContain('bg-primary');
        expect(planned.className).toContain('bg-series-2');
    });

    it('stacks completed above planned within the day', () => {
        renderHeatmap();

        const cell = screen.getAllByTestId('heatmap-cell')[1];
        const halves = [...cell.children].map((child) => (child as HTMLElement).dataset.testid);
        expect(halves).toEqual(['heatmap-half-done', 'heatmap-half-planned']);
    });

    it('leaves a day with nothing on it grey rather than tinted', () => {
        renderHeatmap();

        const [first] = screen.getAllByTestId('heatmap-half-done');
        expect(first).toHaveAttribute('data-level', '0');
        expect(first.className).toContain('bg-gray-100');
    });

    it('does not claim a future day had nothing completed on it', () => {
        renderHeatmap();

        const byDate = (series: string, date: string) =>
            screen.getAllByTestId(`heatmap-half-${series}`).find((cell) => cell.dataset.date === date)!;

        // 2026-07-14 is after `today`; the work has not had a chance to happen.
        expect(byDate('done', '2026-07-14')).toHaveAttribute('data-level', 'unreached');
        // Planned work in the future is exactly what the second band is for.
        expect(byDate('planned', '2026-07-14')).toHaveAttribute('data-level', '0');
    });

    it('marks today so the past and the booked future are told apart', () => {
        renderHeatmap();

        const todayCells = screen
            .getAllByTestId('heatmap-cell')
            .filter((cell) => cell.className.includes('ring-gray-500'));

        expect(todayCells).toHaveLength(1);
        expect(todayCells[0].dataset.date).toBe('2026-07-10');
    });

    it('names both counts on a cell, whichever band is hovered', () => {
        renderHeatmap();

        const cell = screen.getAllByTestId('heatmap-cell')[1];
        expect(cell).toHaveAttribute('title', 'Jul 6 — 4 completed · 1 planned');

        fireEvent.mouseEnter(cell);
        const tooltip = screen.getByTestId('heatmap-tooltip');
        expect(tooltip).toHaveTextContent('Jul 6');
        expect(tooltip).toHaveTextContent('4 completed · 1 planned');

        fireEvent.mouseLeave(cell);
        expect(screen.queryByTestId('heatmap-tooltip')).not.toBeInTheDocument();
    });


    it('draws a separate labelled block per month', () => {
        renderHeatmap({
            points: days('2026-06-28', 40, (i) => (i === 5 ? { done: 2 } : {})),
            max: { done: 2, planned: 0 },
        });

        const blocks = screen.getAllByTestId('heatmap-month');
        expect(blocks.map((block) => block.dataset.month)).toEqual(['2026-06', '2026-07', '2026-08']);
        expect(blocks[0]).toHaveTextContent('Jun');
        expect(blocks[1]).toHaveTextContent('Jul');
    });

    /**
     * The tooltip used to live inside the `overflow-x-auto` scroller, which clips
     * on both axes — a cell near the left edge had its tooltip sheared in half.
     * It now hangs by whichever edge it is near rather than always by its centre.
     *
     * jsdom gives every element a zero rect, so the geometry is stubbed: without
     * it the maths is never exercised and every case reads as "centre".
     */
    it('anchors the tooltip by whichever edge its cell is near', () => {
        // A 400px frame; cells near the left edge, in the middle, and near the right.
        stubGeometry({ '2026-07-05': 6, '2026-07-06': 200, '2026-07-18': 386 });
        renderHeatmap();

        const at = (date: string) =>
            screen.getAllByTestId('heatmap-cell').find((cell) => cell.dataset.date === date)!;

        fireEvent.mouseEnter(at('2026-07-05'));
        expect(screen.getByTestId('heatmap-tooltip')).toHaveAttribute('data-align', 'start');
        fireEvent.mouseLeave(at('2026-07-05'));

        fireEvent.mouseEnter(at('2026-07-06'));
        expect(screen.getByTestId('heatmap-tooltip')).toHaveAttribute('data-align', 'center');
        fireEvent.mouseLeave(at('2026-07-06'));

        fireEvent.mouseEnter(at('2026-07-18'));
        expect(screen.getByTestId('heatmap-tooltip')).toHaveAttribute('data-align', 'end');
    });

    it('drops the tooltip below a cell in the top rows rather than off the top', () => {
        stubGeometry({ '2026-07-06': 200 }, 400, 10);
        renderHeatmap();

        fireEvent.mouseEnter(screen.getAllByTestId('heatmap-cell')[1]);
        // Hanging upwards from 10px would put it above the card.
        expect(screen.getByTestId('heatmap-tooltip').className).not.toContain('-translate-y-full');
    });

    it('keeps the tooltip out of the scrolling element entirely', () => {
        renderHeatmap();

        fireEvent.mouseEnter(screen.getAllByTestId('heatmap-cell')[1]);
        const tooltip = screen.getByTestId('heatmap-tooltip');

        expect(tooltip.closest('.overflow-x-auto')).toBeNull();
    });

    it('carries the same numbers in a table for anyone who cannot read a square', () => {
        renderHeatmap();

        const row = screen.getByRole('row', { name: /Jul 6/ });
        expect(row).toHaveTextContent('4');
        expect(row).toHaveTextContent('1');
        // Only the days that carry something — 91 rows of zeroes would bury them.
        expect(screen.getAllByRole('row')).toHaveLength(2);
    });

    it('labels the grid for a screen reader rather than leaving it colour-only', () => {
        renderHeatmap();

        expect(screen.getByRole('img', { name: labels.summary })).toBeInTheDocument();
    });

    it('says nothing is happening rather than showing a wall of empty squares', () => {
        renderHeatmap({ points: days('2026-07-05', 14), max: { done: 0, planned: 0 } });

        expect(screen.getByText(labels.empty)).toBeInTheDocument();
        expect(screen.queryAllByTestId('heatmap-cell')).toHaveLength(0);
    });

    it('shows a skeleton while the window is still loading', () => {
        renderHeatmap({ loading: true });

        expect(screen.getByTestId('heatmap-skeleton')).toBeInTheDocument();
        expect(screen.queryAllByTestId('heatmap-cell')).toHaveLength(0);
    });

    it('pads a window that does not start on a Sunday instead of shifting the week', () => {
        // 2026-07-08 is a Wednesday: Sun–Tue of that column have no day.
        renderHeatmap({
            points: days('2026-07-08', 7, (i) => (i === 0 ? { planned: 1 } : {})),
            max: { done: 0, planned: 1 },
        });

        const cells = screen.getAllByTestId('heatmap-cell');
        expect(cells).toHaveLength(7);
        expect(cells[0].dataset.date).toBe('2026-07-08');
    });
});
