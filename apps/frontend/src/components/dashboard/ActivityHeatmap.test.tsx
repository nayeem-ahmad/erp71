import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ActivityHeatmap, rampLevel, type ActivityHeatmapPoint } from './ActivityHeatmap';

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

describe('ActivityHeatmap', () => {
    it('draws one square per day in each of the two bands', () => {
        renderHeatmap();

        expect(screen.getAllByTestId('heatmap-cell-done')).toHaveLength(14);
        expect(screen.getAllByTestId('heatmap-cell-planned')).toHaveLength(14);
    });

    it('gives each series its own hue', () => {
        renderHeatmap();

        const done = screen.getAllByTestId('heatmap-cell-done')[1];
        const planned = screen.getAllByTestId('heatmap-cell-planned')[1];

        expect(done.className).toContain('bg-primary');
        expect(planned.className).toContain('bg-series-2');
    });

    it('leaves a day with nothing on it grey rather than tinted', () => {
        renderHeatmap();

        const [first] = screen.getAllByTestId('heatmap-cell-done');
        expect(first).toHaveAttribute('data-level', '0');
        expect(first.className).toContain('bg-gray-100');
    });

    it('does not claim a future day had nothing completed on it', () => {
        renderHeatmap();

        const byDate = (series: string, date: string) =>
            screen.getAllByTestId(`heatmap-cell-${series}`).find((cell) => cell.dataset.date === date)!;

        // 2026-07-14 is after `today`; the work has not had a chance to happen.
        expect(byDate('done', '2026-07-14')).toHaveAttribute('data-level', 'unreached');
        // Planned work in the future is exactly what the second band is for.
        expect(byDate('planned', '2026-07-14')).toHaveAttribute('data-level', '0');
    });

    it('marks today so the past and the booked future are told apart', () => {
        renderHeatmap();

        const todayCells = screen
            .getAllByTestId('heatmap-cell-done')
            .filter((cell) => cell.className.includes('ring-gray-500'));

        expect(todayCells).toHaveLength(1);
        expect(todayCells[0].dataset.date).toBe('2026-07-10');
    });

    it('names both counts on a cell, whichever band is hovered', () => {
        renderHeatmap();

        const cell = screen.getAllByTestId('heatmap-cell-planned')[1];
        expect(cell).toHaveAttribute('title', 'Jul 6 — 4 completed · 1 planned');

        fireEvent.mouseEnter(cell);
        const tooltip = screen.getByTestId('heatmap-tooltip');
        expect(tooltip).toHaveTextContent('Jul 6');
        expect(tooltip).toHaveTextContent('4 completed · 1 planned');

        fireEvent.mouseLeave(cell);
        expect(screen.queryByTestId('heatmap-tooltip')).not.toBeInTheDocument();
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
        expect(screen.queryAllByTestId('heatmap-cell-done')).toHaveLength(0);
    });

    it('shows a skeleton while the window is still loading', () => {
        renderHeatmap({ loading: true });

        expect(screen.getByTestId('heatmap-skeleton')).toBeInTheDocument();
        expect(screen.queryAllByTestId('heatmap-cell-done')).toHaveLength(0);
    });

    it('pads a window that does not start on a Sunday instead of shifting the week', () => {
        // 2026-07-08 is a Wednesday: Sun–Tue of that column have no day.
        renderHeatmap({
            points: days('2026-07-08', 7, (i) => (i === 0 ? { planned: 1 } : {})),
            max: { done: 0, planned: 1 },
        });

        const cells = screen.getAllByTestId('heatmap-cell-planned');
        expect(cells).toHaveLength(7);
        expect(cells[0].dataset.date).toBe('2026-07-08');
    });
});
