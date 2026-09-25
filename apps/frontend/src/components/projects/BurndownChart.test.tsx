import { render, screen } from '@testing-library/react';
import BurndownChart, { type BurndownPoint } from './BurndownChart';

const point = (date: string, over: Partial<BurndownPoint> = {}): BurndownPoint => ({
    date,
    ideal: 10,
    actual: 8,
    committed: 12,
    isWorkingDay: true,
    ...over,
});

const series = [point('2026-09-01'), point('2026-09-02', { actual: 6, ideal: 5 })];

describe('BurndownChart', () => {
    it('draws the ideal line and names it by default', () => {
        render(<BurndownChart series={series} />);

        expect(screen.getByText('Ideal')).toBeInTheDocument();
    });

    /**
     * A project's `target_end_date` is optional where a sprint's dates are not,
     * so a project without one has no ideal to draw — and a legend key for a
     * line that is not on the chart is worse than no key at all.
     */
    it('drops the ideal line and its key when there is nothing to pace against', () => {
        const { container } = render(<BurndownChart series={series} hideIdeal />);

        expect(screen.queryByText('Ideal')).not.toBeInTheDocument();
        const dashed = [...container.querySelectorAll('polyline')].filter(
            (line) => line.getAttribute('stroke-dasharray') === '5 4',
        );
        expect(dashed).toHaveLength(0);
    });

    it('still draws the actual line without an ideal', () => {
        const { container } = render(<BurndownChart series={series} hideIdeal />);

        expect(
            [...container.querySelectorAll('polyline')].some((line) =>
                line.getAttribute('class')?.includes('stroke-blue-600'),
            ),
        ).toBe(true);
    });

    it('says so when there is nothing to draw', () => {
        render(<BurndownChart series={[]} />);

        expect(screen.getByText(/no snapshots yet/i)).toBeInTheDocument();
    });

    describe('open tasks line', () => {
        const withOpen = [
            point('2026-09-01', { open: 6 }),
            point('2026-09-02', { actual: 6, ideal: 5, open: 3 }),
            point('2026-09-03', { actual: null, committed: null, open: null }),
        ];

        it('draws open tasks against a right-hand axis in tasks, with its own key', () => {
            const { container } = render(<BurndownChart series={withOpen} compact />);

            expect(screen.getAllByTestId('open-task-point')).toHaveLength(2);
            expect(screen.getByText('Open tasks (right axis)')).toBeInTheDocument();
            expect(screen.getByText('tasks')).toBeInTheDocument();
            // Max of 6 rounds up to 8, so the right axis reads 0/2/4/6/8 and
            // every hours gridline lands on a whole number of tasks.
            const right = [...container.querySelectorAll('text[text-anchor="start"]')].map(
                (node) => node.textContent,
            );
            expect(right).toEqual(expect.arrayContaining(['0', '2', '4', '6', '8']));
        });

        it('leaves it out, key and axis, when the series has no open counts', () => {
            render(<BurndownChart series={series} />);

            expect(screen.queryAllByTestId('open-task-point')).toHaveLength(0);
            expect(screen.queryByText('Open tasks (right axis)')).not.toBeInTheDocument();
            expect(screen.queryByText('tasks')).not.toBeInTheDocument();
        });
    });
});
