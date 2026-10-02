import { fireEvent, render, screen } from '@testing-library/react';
import SprintBurndownChart from './SprintBurndownChart';
import type { IdealDay, TimelinePoint } from './burndown-steps';

const ideal: IdealDay[] = [
    { date: '2026-08-02', value: 20, isWorkingDay: true },
    { date: '2026-08-03', value: 10, isWorkingDay: true },
    { date: '2026-08-04', value: 0, isWorkingDay: true },
];

const point = (at: string, remaining: number, over: Partial<TimelinePoint> = {}): TimelinePoint => ({
    at,
    remaining,
    committed: 20,
    open: 3,
    cause: 'WORK_LOGGED',
    task: null,
    ...over,
});

const points: TimelinePoint[] = [
    point('2026-08-02T03:00:00.000Z', 20, { cause: 'STARTED' }),
    point('2026-08-02T08:00:00.000Z', 17, {
        task: { id: 't1', code: 'PRJ-0001-4', title: 'Fix login' },
    }),
    point('2026-08-03T05:00:00.000Z', 23, {
        cause: 'TASK_ADDED',
        committed: 26,
        open: 4,
        task: { id: 't2', code: 'PRJ-0001-9', title: 'Export CSV' },
    }),
];

function renderChart(list = points) {
    return render(
        <SprintBurndownChart
            startDate="2026-08-02T00:00:00.000Z"
            endDate="2026-08-04T00:00:00.000Z"
            points={list}
            ideal={ideal}
        />,
    );
}

describe('SprintBurndownChart', () => {
    it('draws remaining, committed and open tasks as step lines, plus the ideal', () => {
        renderChart();

        const remaining = screen.getByTestId('remaining-line').getAttribute('d')!;
        // Horizontal then vertical moves only — a step, never a slope.
        expect(remaining).toMatch(/^M[\d.]+,[\d.]+( H[\d.]+ V[\d.]+)+$/);
        expect(screen.getByTestId('committed-line')).toBeInTheDocument();
        expect(screen.getByTestId('open-line')).toBeInTheDocument();
        expect(screen.getByTestId('ideal-line')).toBeInTheDocument();
        expect(screen.getByText('Open tasks (right axis)')).toBeInTheDocument();
    });

    it('marks a scope change so it does not read as work going backwards', () => {
        renderChart();
        expect(screen.getAllByTestId('scope-point')).toHaveLength(1);
        expect(screen.getByText('Task added or removed')).toBeInTheDocument();
    });

    it('stays one line, with markers only for scope, however many points there are', () => {
        const many = Array.from({ length: 500 }, (_, i) =>
            point(new Date(Date.parse('2026-08-02T00:00:00Z') + i * 300_000).toISOString(), 500 - i, {
                cause: i % 100 === 0 ? 'TASK_ADDED' : 'WORK_LOGGED',
            }),
        );
        renderChart(many);

        expect(screen.getAllByTestId('remaining-line')).toHaveLength(1);
        expect(screen.getAllByTestId('scope-point')).toHaveLength(5);
    });

    it('draws the ideal alone, and says why, before anything is recorded', () => {
        renderChart([]);

        expect(screen.getByTestId('ideal-line')).toBeInTheDocument();
        expect(screen.queryByTestId('remaining-line')).not.toBeInTheDocument();
        expect(
            screen.getByText('Nothing recorded yet. A point appears with every change once the sprint starts.'),
        ).toBeInTheDocument();
    });

    it('shades non-working days', () => {
        render(
            <SprintBurndownChart
                startDate="2026-08-06"
                endDate="2026-08-09"
                points={points}
                ideal={[
                    { date: '2026-08-06', value: 9, isWorkingDay: true },
                    { date: '2026-08-07', value: 9, isWorkingDay: false },
                    { date: '2026-08-08', value: 9, isWorkingDay: false },
                    { date: '2026-08-09', value: 0, isWorkingDay: true },
                ]}
            />,
        );
        expect(screen.getAllByTestId('non-working-day')).toHaveLength(2);
    });

    describe('hover', () => {
        const hoverAt = (fraction: number) => {
            const overlay = screen.getByTestId('burndown-hover-area');
            const svg = overlay.closest('svg')!;
            svg.getBoundingClientRect = () =>
                ({ left: 0, top: 0, width: 720, height: 260, right: 720, bottom: 260, x: 0, y: 0, toJSON() {} }) as DOMRect;
            fireEvent.pointerMove(overlay, { clientX: fraction * 720, pointerType: 'mouse' });
        };

        it('shows the nearest point: its figures, what caused it and the task', () => {
            renderChart();
            // Late on the second day: nearest is the TASK_ADDED point.
            hoverAt(0.62);

            const tip = screen.getByRole('tooltip');
            expect(tip).toHaveTextContent('Task added');
            expect(tip).toHaveTextContent('23h');
            expect(tip).toHaveTextContent('4 open');
            expect(tip).toHaveTextContent('PRJ-0001-9');
            expect(tip).toHaveTextContent('Export CSV');
        });

        it('hides again when the pointer leaves', () => {
            renderChart();
            hoverAt(0.2);
            expect(screen.getByRole('tooltip')).toBeInTheDocument();

            fireEvent.pointerLeave(screen.getByTestId('burndown-hover-area'), { pointerType: 'mouse' });
            expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
        });

        it('calls the live point "Now"', () => {
            renderChart([...points, point('2026-08-03T09:00:00.000Z', 21, { cause: null })]);
            hoverAt(0.99);
            expect(screen.getByRole('tooltip')).toHaveTextContent('Now');
        });
    });
});
