import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import HourLogReportPage from './page';

const getProjectTimeReport = jest.fn();

jest.mock('@/lib/api', () => ({
    api: {
        getProjects: jest.fn(),
        getProjectTimePeople: jest.fn(),
        getProjectTimeReport: (...args: unknown[]) => getProjectTimeReport(...args),
    },
}));

const report = (overrides: Record<string, unknown> = {}) => ({
    groupBy: 'task',
    summary: {
        totalHours: 10,
        entries: 3,
        days: 2,
        people: 1,
        tasks: 2,
        projects: 1,
        avgHoursPerDay: 5,
    },
    rows: [
        { key: 't2', label: 'Painting', sublabel: 'PRJ-0001 · Fitout', hours: 6, entries: 2, share: 60 },
        { key: 't1', label: 'Wiring', sublabel: 'PRJ-0001 · Fitout', hours: 4, entries: 1, share: 40 },
    ],
    ...overrides,
});

beforeEach(() => {
    const { api } = jest.requireMock('@/lib/api');
    getProjectTimeReport.mockReset().mockResolvedValue(report());
    api.getProjects.mockReset().mockResolvedValue({
        items: [{ id: 'p1', code: 'PRJ-0001', name: 'Fitout' }],
    });
    api.getProjectTimePeople.mockReset().mockResolvedValue([
        { id: 'u1', name: 'Rina', email: 'rina@example.com' },
    ]);
});

describe('Hour log report page', () => {
    it('opens grouped by task over a bounded date range', async () => {
        render(<HourLogReportPage />);

        await waitFor(() => expect(getProjectTimeReport).toHaveBeenCalled());
        const params = getProjectTimeReport.mock.calls[0][0];
        expect(params.groupBy).toBe('task');
        expect(params.from <= params.to).toBe(true);
    });

    it('shows the range totals alongside the breakdown', async () => {
        render(<HourLogReportPage />);

        expect(await screen.findByText('10.00')).toBeInTheDocument();
        expect(screen.getByText('Painting')).toBeInTheDocument();
        // The share bar rides in a hideOnMobile column, so the hours are what
        // every viewport is guaranteed to show.
        expect(screen.getByText('6.00')).toBeInTheDocument();
    });

    it('re-summarises on the same range when the grouping changes', async () => {
        render(<HourLogReportPage />);
        await waitFor(() => expect(getProjectTimeReport).toHaveBeenCalled());
        const first = getProjectTimeReport.mock.calls[0][0];

        fireEvent.change(screen.getByLabelText('Summarise by'), { target: { value: 'week' } });

        await waitFor(() =>
            expect(getProjectTimeReport).toHaveBeenCalledWith(
                expect.objectContaining({ groupBy: 'week', from: first.from, to: first.to }),
            ),
        );
    });

    /** The heading names the dimension, so a week report cannot read "Task". */
    it('renames the first column to whatever it is grouped by', async () => {
        render(<HourLogReportPage />);
        await waitFor(() => expect(screen.getByText('Painting')).toBeInTheDocument());
        expect(screen.getAllByText('Task').length).toBeGreaterThan(0);

        fireEvent.change(screen.getByLabelText('Summarise by'), { target: { value: 'user' } });

        await waitFor(() => expect(screen.getAllByText('Person').length).toBeGreaterThan(0));
    });

    it('refuses a backwards range instead of asking the server for one', async () => {
        render(<HourLogReportPage />);
        await waitFor(() => expect(getProjectTimeReport).toHaveBeenCalledTimes(1));

        fireEvent.change(screen.getByLabelText('From'), { target: { value: '2099-01-01' } });

        expect(await screen.findByText(/start date must fall on or before/i)).toBeInTheDocument();
        expect(getProjectTimeReport).toHaveBeenCalledTimes(1);
    });
});
