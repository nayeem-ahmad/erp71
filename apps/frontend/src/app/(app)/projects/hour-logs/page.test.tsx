import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import HourLogsPage from './page';

const getProjectTimeEntries = jest.fn();
const getProjectTimeReport = jest.fn();

jest.mock('@/lib/api', () => ({
    api: {
        getProjects: jest.fn(),
        getProjectTasks: jest.fn(),
        getProjectTimeEntries: (...args: unknown[]) => getProjectTimeEntries(...args),
        getProjectTimeReport: (...args: unknown[]) => getProjectTimeReport(...args),
        getProjectTimePeople: jest.fn(),
        logProjectTime: jest.fn(),
        updateProjectTimeEntry: jest.fn(),
        deleteProjectTimeEntry: jest.fn(),
    },
}));

// The panel pulls a whole task detail tree of its own; this suite only cares
// that a row hands off to it.
jest.mock('@/components/projects/TaskDetailPanel', () => {
    const MockPanel = ({ taskId }: { taskId: string }) => (
        <div data-testid="task-detail-panel">{taskId}</div>
    );
    MockPanel.displayName = 'TaskDetailPanel';
    return { __esModule: true, default: MockPanel };
});

const entry = (overrides: Record<string, unknown> = {}) => ({
    id: 'e1',
    work_date: '2026-08-03',
    hours: '3.50',
    note: 'Ran the conduit',
    task: { id: 't1', title: 'Wire the meter' },
    project: { id: 'p1', code: 'PRJ-0001', name: 'Fitout' },
    user: { id: 'u1', name: 'Rina', email: 'rina@example.com' },
    ...overrides,
});

const summary = {
    totalHours: 12.5,
    entries: 4,
    days: 3,
    people: 2,
    tasks: 2,
    projects: 1,
    avgHoursPerDay: 4.17,
};

beforeEach(() => {
    const { api } = jest.requireMock('@/lib/api');
    getProjectTimeEntries.mockReset().mockResolvedValue({
        items: [entry()],
        total: 1,
        page: 1,
        limit: 25,
        pages: 1,
    });
    getProjectTimeReport.mockReset().mockResolvedValue({ groupBy: 'date', summary, rows: [] });
    api.getProjects.mockReset().mockResolvedValue({
        items: [{ id: 'p1', code: 'PRJ-0001', name: 'Fitout' }],
    });
    api.getProjectTimePeople.mockReset().mockResolvedValue([
        { id: 'u1', name: 'Rina', email: 'rina@example.com' },
    ]);
    api.getProjectTasks.mockReset().mockResolvedValue({ items: [{ id: 't1', title: 'Wire the meter' }] });
    api.deleteProjectTimeEntry.mockReset().mockResolvedValue({ success: true });
});

describe('Hour logs page', () => {
    it('opens on a date range so the list is never an unbounded history', async () => {
        render(<HourLogsPage />);

        await waitFor(() => expect(getProjectTimeEntries).toHaveBeenCalled());
        const params = getProjectTimeEntries.mock.calls[0][0];
        expect(params.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(params.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(params.from <= params.to).toBe(true);
    });

    it('shows the task, project and person on every row', async () => {
        render(<HourLogsPage />);

        await waitFor(() => expect(screen.getByText('Wire the meter')).toBeInTheDocument());
        expect(screen.getAllByText(/PRJ-0001/).length).toBeGreaterThan(0);
        expect(screen.getAllByText('Rina').length).toBeGreaterThan(0);
    });

    /**
     * The strip is the totals for the whole filtered range; taking it from the
     * rows on screen would silently report one page's worth instead.
     */
    it('takes its totals from the range aggregate, not from the page on screen', async () => {
        render(<HourLogsPage />);

        await waitFor(() => expect(getProjectTimeReport).toHaveBeenCalled());
        expect(await screen.findByText('12.50')).toBeInTheDocument();
    });

    it('narrows both the list and the totals when a person is picked', async () => {
        render(<HourLogsPage />);
        await waitFor(() => expect(getProjectTimeEntries).toHaveBeenCalled());

        fireEvent.change(screen.getByLabelText('Person'), { target: { value: 'me' } });

        await waitFor(() =>
            expect(getProjectTimeEntries).toHaveBeenCalledWith(
                expect.objectContaining({ userId: 'me' }),
            ),
        );
        expect(getProjectTimeReport).toHaveBeenCalledWith(
            expect.objectContaining({ userId: 'me' }),
        );
    });

    it('opens the task panel from a row rather than navigating away from the list', async () => {
        render(<HourLogsPage />);

        fireEvent.click(await screen.findByText('Wire the meter'));

        expect(await screen.findByTestId('task-detail-panel')).toHaveTextContent('t1');
    });

    it('confirms before deleting, because the hours go back onto the task', async () => {
        const { api } = jest.requireMock('@/lib/api');
        render(<HourLogsPage />);

        fireEvent.click(await screen.findByRole('button', { name: 'Delete entry' }));
        expect(api.deleteProjectTimeEntry).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        await waitFor(() => expect(api.deleteProjectTimeEntry).toHaveBeenCalledWith('e1'));
    });
});
