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
        getProjectTimeTags: jest.fn(),
        getProjectTimer: jest.fn(),
        startProjectTimer: jest.fn(),
        stopProjectTimer: jest.fn(),
        updateProjectTimer: jest.fn(),
        discardProjectTimer: jest.fn(),
        logProjectTime: jest.fn(),
        updateProjectTimeEntry: jest.fn(),
        deleteProjectTimeEntry: jest.fn(),
    },
}));

const toastError = jest.fn();
const toastInfo = jest.fn();
jest.mock('@/lib/toast', () => ({
    toast: {
        success: jest.fn(),
        error: (...args: unknown[]) => toastError(...args),
        info: (...args: unknown[]) => toastInfo(...args),
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
    created_at: '2026-08-03T10:00:00.000Z',
    tags: [],
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

const listOf = (items: unknown[]) => ({
    items,
    total: items.length,
    page: 1,
    limit: 25,
    pages: 1,
});

beforeEach(() => {
    const { api } = jest.requireMock('@/lib/api');
    toastError.mockReset();
    toastInfo.mockReset();
    getProjectTimeEntries.mockReset().mockResolvedValue(listOf([entry()]));
    getProjectTimeReport.mockReset().mockResolvedValue({ groupBy: 'date', summary, rows: [] });
    api.getProjects.mockReset().mockResolvedValue({
        items: [{ id: 'p1', code: 'PRJ-0001', name: 'Fitout' }],
    });
    api.getProjectTimePeople.mockReset().mockResolvedValue([
        { id: 'u1', name: 'Rina', email: 'rina@example.com' },
    ]);
    api.getProjectTasks.mockReset().mockResolvedValue({ items: [{ id: 't1', title: 'Wire the meter' }] });
    api.getProjectTimeTags.mockReset().mockResolvedValue([]);
    api.getProjectTimer.mockReset().mockResolvedValue(null);
    api.startProjectTimer.mockReset().mockResolvedValue({});
    api.stopProjectTimer.mockReset().mockResolvedValue({ discarded: false, entry: {} });
    api.discardProjectTimer.mockReset().mockResolvedValue({ success: true });
    api.updateProjectTimer.mockReset().mockResolvedValue({});
    api.deleteProjectTimeEntry.mockReset().mockResolvedValue({ success: true });
    api.updateProjectTimeEntry.mockReset().mockResolvedValue({});
    api.logProjectTime.mockReset().mockResolvedValue({});
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

        expect(await screen.findByText('Wire the meter')).toBeInTheDocument();
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

    describe('the day ledger', () => {
        it('heads each day with a total drawn from the range aggregate', async () => {
            // 4 hours across the whole day; the single row in view is 3.5.
            getProjectTimeReport.mockResolvedValue({
                groupBy: 'date',
                summary,
                rows: [{ key: '2026-08-03', hours: 4, entries: 2 }],
            });
            render(<HourLogsPage />);

            expect(await screen.findByText('4h')).toBeInTheDocument();
        });

        it('says so when a page is showing only part of a day', async () => {
            getProjectTimeReport.mockResolvedValue({
                groupBy: 'date',
                summary,
                rows: [{ key: '2026-08-03', hours: 4, entries: 2 }],
            });
            render(<HourLogsPage />);

            expect(await screen.findByText(/showing 1 of 2/)).toBeInTheDocument();
        });

        it('folds a task logged twice with the same note into one expandable row', async () => {
            getProjectTimeEntries.mockResolvedValue(
                listOf([
                    entry({ id: 'e1', hours: '3.20' }),
                    entry({ id: 'e2', hours: '1.17' }),
                ]),
            );
            render(<HourLogsPage />);

            const fold = await screen.findByRole('button', {
                name: 'Show the entries behind this row',
            });
            expect(fold).toHaveTextContent('2');
            // One row on screen, holding the summed duration.
            expect(screen.getAllByRole('button', { name: 'Delete entry' })).toHaveLength(1);
            expect(fold.closest('div')).toHaveTextContent('4h 22m');

            fireEvent.click(fold);
            expect(screen.getAllByRole('button', { name: 'Delete entry' })).toHaveLength(3);
        });

        it('offers an empty note as something to click rather than a dash', async () => {
            getProjectTimeEntries.mockResolvedValue(listOf([entry({ note: null })]));
            render(<HourLogsPage />);

            expect(await screen.findByText('Add description')).toBeInTheDocument();
        });
    });

    describe('inline editing', () => {
        it('saves a changed duration with one PATCH and no modal', async () => {
            const { api } = jest.requireMock('@/lib/api');
            render(<HourLogsPage />);

            fireEvent.click(await screen.findByRole('button', { name: 'Duration' }));
            const box = screen.getByRole('spinbutton', { name: 'Duration' });
            fireEvent.change(box, { target: { value: '4' } });
            fireEvent.blur(box);

            await waitFor(() =>
                expect(api.updateProjectTimeEntry).toHaveBeenCalledWith('e1', { hours: 4 }),
            );
        });

        it('does not save a duration that did not change', async () => {
            const { api } = jest.requireMock('@/lib/api');
            render(<HourLogsPage />);

            fireEvent.click(await screen.findByRole('button', { name: 'Duration' }));
            fireEvent.blur(screen.getByRole('spinbutton', { name: 'Duration' }));

            expect(api.updateProjectTimeEntry).not.toHaveBeenCalled();
        });

        it('discards an edit on Escape', async () => {
            const { api } = jest.requireMock('@/lib/api');
            render(<HourLogsPage />);

            fireEvent.click(await screen.findByRole('button', { name: 'Note' }));
            const box = screen.getByRole('textbox', { name: 'Note' });
            fireEvent.change(box, { target: { value: 'something else' } });
            fireEvent.keyDown(box, { key: 'Escape' });

            expect(api.updateProjectTimeEntry).not.toHaveBeenCalled();
            expect(screen.getByRole('button', { name: 'Note' })).toHaveTextContent('Ran the conduit');
        });

        it('refuses a duration outside what an entry can hold, without calling the server', async () => {
            const { api } = jest.requireMock('@/lib/api');
            render(<HourLogsPage />);

            fireEvent.click(await screen.findByRole('button', { name: 'Duration' }));
            const box = screen.getByRole('spinbutton', { name: 'Duration' });
            fireEvent.change(box, { target: { value: '30' } });
            fireEvent.blur(box);

            expect(api.updateProjectTimeEntry).not.toHaveBeenCalled();
        });
    });

    describe('the running clock', () => {
        it('starts a timer on the task the bar is pointed at', async () => {
            const { api } = jest.requireMock('@/lib/api');
            render(<HourLogsPage />);
            await waitFor(() => expect(api.getProjects).toHaveBeenCalled());

            fireEvent.change(screen.getByLabelText('Project to log against'), { target: { value: 'p1' } });
            await waitFor(() => expect(api.getProjectTasks).toHaveBeenCalled());
            fireEvent.change(screen.getByLabelText('Task to log against'), { target: { value: 't1' } });
            fireEvent.click(screen.getByRole('button', { name: 'Start' }));

            await waitFor(() =>
                expect(api.startProjectTimer).toHaveBeenCalledWith(
                    expect.objectContaining({ taskId: 't1' }),
                ),
            );
        });

        it('shows the running task and a stop button instead of start', async () => {
            const { api } = jest.requireMock('@/lib/api');
            api.getProjectTimer.mockResolvedValue({
                id: 'timer-1',
                started_at: '2026-08-03T08:00:00.000Z',
                elapsed_seconds: 3849,
                note: 'Ran the conduit',
                tags: [],
                task: { id: 't1', title: 'Wire the meter' },
                project: { id: 'p1', code: 'PRJ-0001', name: 'Fitout' },
            });
            render(<HourLogsPage />);

            expect(await screen.findByRole('button', { name: /Stop/ })).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: /^Start$/ })).not.toBeInTheDocument();
            expect(screen.getByRole('timer')).toHaveTextContent('1:04:09');
        });

        it('says nothing was logged when a timer is stopped under a minute', async () => {
            const { api } = jest.requireMock('@/lib/api');
            api.getProjectTimer.mockResolvedValue({
                id: 'timer-1',
                started_at: '2026-08-03T08:00:00.000Z',
                elapsed_seconds: 10,
                tags: [],
                task: { id: 't1', title: 'Wire the meter' },
                project: { id: 'p1', code: 'PRJ-0001', name: 'Fitout' },
            });
            api.stopProjectTimer.mockResolvedValue({ discarded: true, entry: null, seconds: 10 });
            render(<HourLogsPage />);

            fireEvent.click(await screen.findByRole('button', { name: /Stop/ }));

            await waitFor(() =>
                expect(toastInfo).toHaveBeenCalledWith(
                    expect.stringContaining('under a minute'),
                ),
            );
        });

        it('restarts a row rather than opening a form — the ▷ of the screen it borrows from', async () => {
            const { api } = jest.requireMock('@/lib/api');
            render(<HourLogsPage />);

            fireEvent.click(
                await screen.findByRole('button', { name: 'Start a timer on this again' }),
            );

            await waitFor(() =>
                expect(api.startProjectTimer).toHaveBeenCalledWith({
                    taskId: 't1',
                    note: 'Ran the conduit',
                    tagIds: [],
                }),
            );
        });

        it('refuses to start a second clock, and says which one is running', async () => {
            const { api } = jest.requireMock('@/lib/api');
            api.getProjectTimer.mockResolvedValue({
                id: 'timer-1',
                started_at: '2026-08-03T08:00:00.000Z',
                elapsed_seconds: 60,
                tags: [],
                task: { id: 't9', title: 'Stock count' },
                project: { id: 'p1', code: 'PRJ-0001', name: 'Fitout' },
            });
            render(<HourLogsPage />);

            fireEvent.click(
                await screen.findByRole('button', { name: 'Start a timer on this again' }),
            );

            expect(api.startProjectTimer).not.toHaveBeenCalled();
            expect(toastInfo).toHaveBeenCalledWith(expect.stringContaining('Stock count'));
        });
    });

    describe('overlapping hours', () => {
        it('asks before keeping two entries over the same minutes', async () => {
            const { api } = jest.requireMock('@/lib/api');
            api.logProjectTime
                .mockRejectedValueOnce(new Error('Those hours overlap time you already logged.'))
                .mockResolvedValueOnce({});
            render(<HourLogsPage />);
            await waitFor(() => expect(api.getProjects).toHaveBeenCalled());

            // Manual mode: a span plus a task is all a log needs.
            fireEvent.click(screen.getByRole('button', { name: 'Enter hours by hand' }));
            fireEvent.change(screen.getByLabelText('Project to log against'), { target: { value: 'p1' } });
            await waitFor(() => expect(api.getProjectTasks).toHaveBeenCalled());
            fireEvent.change(screen.getByLabelText('Task to log against'), { target: { value: 't1' } });
            fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '13:45' } });
            fireEvent.change(screen.getByLabelText('End time'), { target: { value: '18:08' } });
            fireEvent.click(screen.getByRole('button', { name: /Log hours/ }));

            expect(await screen.findByText(/Keep both entries anyway/)).toBeInTheDocument();
            expect(api.logProjectTime).toHaveBeenCalledTimes(1);
            expect(api.logProjectTime.mock.calls[0][0]).not.toHaveProperty('allowOverlap');

            fireEvent.click(screen.getByRole('button', { name: 'Keep both' }));

            await waitFor(() => expect(api.logProjectTime).toHaveBeenCalledTimes(2));
            expect(api.logProjectTime.mock.calls[1][0]).toMatchObject({ allowOverlap: true });
        });

        it('reports any other failure rather than offering to keep both', async () => {
            const { api } = jest.requireMock('@/lib/api');
            api.logProjectTime.mockRejectedValue(new Error('Task not found'));
            render(<HourLogsPage />);
            await waitFor(() => expect(api.getProjects).toHaveBeenCalled());

            fireEvent.click(screen.getByRole('button', { name: 'Enter hours by hand' }));
            fireEvent.change(screen.getByLabelText('Project to log against'), { target: { value: 'p1' } });
            await waitFor(() => expect(api.getProjectTasks).toHaveBeenCalled());
            fireEvent.change(screen.getByLabelText('Task to log against'), { target: { value: 't1' } });
            fireEvent.change(screen.getByLabelText('Hours'), { target: { value: '2' } });
            fireEvent.click(screen.getByRole('button', { name: /Log hours/ }));

            await waitFor(() => expect(toastError).toHaveBeenCalledWith('Task not found'));
            expect(screen.queryByText(/Keep both entries anyway/)).not.toBeInTheDocument();
        });
    });

    describe('tags', () => {
        it('offers a tag filter only once the workspace has tags', async () => {
            const { api } = jest.requireMock('@/lib/api');
            render(<HourLogsPage />);
            await waitFor(() => expect(api.getProjectTimeTags).toHaveBeenCalled());
            // The capture bar's tag picker is always there; the filter select
            // is what waits for a vocabulary to exist.
            expect(screen.getByLabelText('Tags')).toBeInTheDocument();
            expect(screen.queryByRole('combobox', { name: 'Tags' })).not.toBeInTheDocument();
        });

        it('filters the list and the totals by a tag', async () => {
            const { api } = jest.requireMock('@/lib/api');
            api.getProjectTimeTags.mockResolvedValue([
                { id: 'tag-1', name: 'Billable', color: 'EMERALD' },
            ]);
            render(<HourLogsPage />);

            const select = await screen.findByRole('combobox', { name: 'Tags' });
            fireEvent.change(select, { target: { value: 'tag-1' } });

            await waitFor(() =>
                expect(getProjectTimeEntries).toHaveBeenCalledWith(
                    expect.objectContaining({ tagId: 'tag-1' }),
                ),
            );
            expect(getProjectTimeReport).toHaveBeenCalledWith(
                expect.objectContaining({ tagId: 'tag-1' }),
            );
        });

        it('draws the tags an entry carries on its row', async () => {
            getProjectTimeEntries.mockResolvedValue(
                listOf([entry({ tags: [{ id: 'tag-1', name: 'Billable', color: 'EMERALD' }] })]),
            );
            render(<HourLogsPage />);

            expect(await screen.findByText('Billable')).toBeInTheDocument();
        });
    });
});
