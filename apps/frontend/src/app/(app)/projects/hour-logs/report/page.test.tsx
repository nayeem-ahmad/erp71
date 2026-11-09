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

// Desktop: Sales-style filter chips sit inline rather than in the phone sheet.
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

/** A filter chip in the toolbar — the column headers' sort buttons share its name. */
function chip(name: string | RegExp): HTMLElement {
    const found = screen
        .getAllByRole('button', { name })
        .find((button) => button.getAttribute('aria-haspopup') === 'dialog');
    if (!found) throw new Error(`No filter chip named ${String(name)}`);
    return found;
}

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

    it('shows the range totals in the Sales-style summary strip', async () => {
        render(<HourLogReportPage />);

        const strip = await screen.findByRole('region', { name: 'Hour log report summary' });
        expect(strip).toHaveTextContent('10.00');
        expect(await screen.findByText('Painting')).toBeInTheDocument();
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

    it('refuses a backwards range in the date chip instead of asking the server for one', async () => {
        render(<HourLogReportPage />);
        await waitFor(() => expect(getProjectTimeReport).toHaveBeenCalledTimes(1));

        fireEvent.click(chip(/^Date/));
        fireEvent.change(screen.getByLabelText('From'), { target: { value: '2099-01-01' } });

        expect(await screen.findByText(/From must be on or before To/i)).toBeInTheDocument();
        expect(getProjectTimeReport).toHaveBeenCalledTimes(1);
    });
});
