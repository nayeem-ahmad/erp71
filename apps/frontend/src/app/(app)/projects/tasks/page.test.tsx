import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import TasksPage from './page';

const getProjectTasks = jest.fn();

jest.mock('@/lib/api', () => ({
    api: {
        getMe: jest.fn().mockResolvedValue({ id: 'user-me' }),
        getProjects: jest.fn().mockResolvedValue({ items: [{ id: 'p1', code: 'PRJ-0001', name: 'P1' }] }),
        getProjectTasks: (...args: unknown[]) => getProjectTasks(...args),
        getProjectTaskAssignees: jest.fn(),
        createProjectTask: jest.fn(),
        deleteProjectTask: jest.fn(),
        importProjectTasks: jest.fn(),
    },
}));

// The panel loads a task's whole detail tree of its own; this suite only cares
// that creating a task hands off to it.
jest.mock('@/components/projects/TaskDetailPanel', () => {
    const MockPanel = ({ taskId }: { taskId: string }) => (
        <div data-testid="task-detail-panel">{taskId}</div>
    );
    MockPanel.displayName = 'TaskDetailPanel';
    return { __esModule: true, default: MockPanel };
});

const task = (overrides: Record<string, unknown> = {}) => ({
    id: 't1',
    title: 'Wire the meter',
    priority: 'MEDIUM',
    created_at: '2026-08-19T04:00:00.000Z',
    status: { id: 's1', name: 'To do', category: 'TODO' },
    project: { id: 'p1', code: 'PRJ-0001', name: 'P1' },
    ...overrides,
});

/** The last query the list sent, whatever re-fetches happened before it. */
const lastQuery = () => getProjectTasks.mock.calls.at(-1)?.[0];

const assigneeSelect = () => screen.getByLabelText(/assignee/i);

beforeEach(() => {
    const { api } = jest.requireMock('@/lib/api');
    // Filters are remembered per tab; a leftover slice would decide the next test.
    sessionStorage.clear();
    getProjectTasks.mockReset();
    getProjectTasks.mockResolvedValue({ items: [task()], total: 1, page: 1, limit: 25, pages: 1 });
    api.getProjects.mockResolvedValue({ items: [{ id: 'p1', code: 'PRJ-0001', name: 'P1' }] });
    api.getProjectTaskAssignees.mockReset().mockResolvedValue([
        { key: 'user:user-9', userId: 'user-9', name: 'Karim', hint: 'karim@acme.test', noLogin: false },
        { key: 'employee:emp-3', employeeId: 'emp-3', name: 'Rahim Uddin', hint: 'EMP-003', noLogin: true },
    ]);
    api.createProjectTask.mockReset().mockResolvedValue({ id: 'task-new' });
    api.deleteProjectTask.mockReset().mockResolvedValue({ success: true });
    api.importProjectTasks.mockReset().mockResolvedValue({
        created: 0, updated: 0, skipped: 0, errors: [],
    });
});

describe('Tasks page', () => {
    it('opens on the signed-in user’s tasks, preserving what My Tasks used to show', async () => {
        render(<TasksPage />);

        await waitFor(() => expect(getProjectTasks).toHaveBeenCalled());
        expect(getProjectTasks).toHaveBeenCalledWith(
            expect.objectContaining({ assigneeId: 'user-me' }),
        );
    });

    it('never fetches before the user id resolves, so it cannot flash everyone’s tasks', async () => {
        // The default filter needs the id. Firing first and narrowing after would
        // briefly show the whole workspace.
        const { api } = jest.requireMock('@/lib/api');
        let resolveMe: (v: unknown) => void = () => {};
        api.getMe.mockReturnValueOnce(new Promise((r) => { resolveMe = r; }));

        render(<TasksPage />);
        expect(getProjectTasks).not.toHaveBeenCalled();

        resolveMe({ id: 'user-me' });
        await waitFor(() => expect(getProjectTasks).toHaveBeenCalled());
    });

    it('shows the project on every row — it is the one list where it is not implied', async () => {
        render(<TasksPage />);
        await waitFor(() => expect(screen.getByText('Wire the meter')).toBeInTheDocument());
        expect(screen.getAllByText('PRJ-0001').length).toBeGreaterThan(0);
    });

    it('creates a task from the header, against the project the list is filtered to', async () => {
        const { api } = jest.requireMock('@/lib/api');
        render(<TasksPage />);
        await waitFor(() => expect(getProjectTasks).toHaveBeenCalled());
        await screen.findByText('Wire the meter');

        fireEvent.click(screen.getByRole('button', { name: /new task/i }));
        fireEvent.change(screen.getByLabelText(/^title/i), {
            target: { value: 'Paint the shutters' },
        });
        fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

        await waitFor(() =>
            expect(api.createProjectTask).toHaveBeenCalledWith(
                // The one project in the workspace is picked for them.
                expect.objectContaining({ projectId: 'p1', title: 'Paint the shutters' }),
            ),
        );
        // A new task has no assignee, so the default "assigned to me" list cannot
        // show it — it opens instead, rather than seeming to vanish.
        expect(await screen.findByTestId('task-detail-panel')).toHaveTextContent('task-new');
    });

    /**
     * The rest of the remembering is covered by the toolbar suite below. The
     * search box is the one filter that debounces, so a restored term has to
     * bypass the debounce: applying it 300ms late would send one request for
     * the unsearched list first, and flash it.
     */
    it('restores a search term with the first request, not 300ms after it', async () => {
        const first = render(<TasksPage />);
        await screen.findByText('Wire the meter');

        fireEvent.change(screen.getByPlaceholderText(/search task title/i), {
            target: { value: 'meter' },
        });
        await waitFor(() => expect(getProjectTasks.mock.calls.at(-1)![0].search).toBe('meter'));
        first.unmount();

        getProjectTasks.mockClear();
        render(<TasksPage />);
        await screen.findByText('Wire the meter');

        for (const call of getProjectTasks.mock.calls) {
            expect(call[0].search).toBe('meter');
        }
    });

    /**
     * The rest of the module imports its lists through the shared dialog; a
     * screen that can only be filled a row at a time is the odd one out.
     */
    it('offers the standard spreadsheet import', async () => {
        render(<TasksPage />);
        await waitFor(() => expect(getProjectTasks).toHaveBeenCalled());

        fireEvent.click(screen.getByRole('button', { name: /^import$/i }));

        expect(await screen.findByText(/map fields/i)).toBeInTheDocument();
        // The file names its columns in words, so nothing has to hold an id.
        expect(screen.getByText(/upload/i)).toBeInTheDocument();
    });

    it('flags a missing project and title inline rather than posting them', async () => {
        const { api } = jest.requireMock('@/lib/api');
        // Two projects, so nothing is preselected and the choice is really required.
        api.getProjects.mockResolvedValue({
            items: [
                { id: 'p1', code: 'PRJ-0001', name: 'P1' },
                { id: 'p2', code: 'PRJ-0002', name: 'P2' },
            ],
        });
        render(<TasksPage />);
        await waitFor(() => expect(getProjectTasks).toHaveBeenCalled());

        fireEvent.click(screen.getByRole('button', { name: /new task/i }));
        fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

        expect(await screen.findByText(/pick the project this task belongs to/i)).toBeInTheDocument();
        expect(screen.getByText(/give the task a title/i)).toBeInTheDocument();
        expect(api.createProjectTask).not.toHaveBeenCalled();
    });

    describe('assignee filter', () => {
        it('offers everyone who holds a task, not just me and anyone', async () => {
            render(<TasksPage />);
            await waitFor(() => expect(getProjectTasks).toHaveBeenCalled());

            const options = within(assigneeSelect()).getAllByRole('option');
            expect(options.map((option) => (option as HTMLOptionElement).value)).toEqual([
                'me',
                'anyone',
                'unassigned',
                'user:user-9',
                'employee:emp-3',
            ]);
        });

        it('marks an employee with no workspace account, who cannot be “me”', async () => {
            render(<TasksPage />);
            await waitFor(() => expect(getProjectTasks).toHaveBeenCalled());

            expect(within(assigneeSelect()).getByRole('option', { name: /Rahim Uddin \(no login\)/ }))
                .toBeInTheDocument();
        });

        it('filters to one person by their user id', async () => {
            render(<TasksPage />);
            await waitFor(() => expect(getProjectTasks).toHaveBeenCalled());

            fireEvent.change(assigneeSelect(), { target: { value: 'user:user-9' } });

            await waitFor(() => expect(lastQuery()).toMatchObject({ assigneeId: 'user-9' }));
            expect(lastQuery().unassigned).toBeUndefined();
        });

        it('filters to an employee through the other column entirely', async () => {
            // A login-less employee holds a task in `assignee_employee_id`; sending
            // their id as `assigneeId` would quietly match nothing.
            render(<TasksPage />);
            await waitFor(() => expect(getProjectTasks).toHaveBeenCalled());

            fireEvent.change(assigneeSelect(), { target: { value: 'employee:emp-3' } });

            await waitFor(() => expect(lastQuery()).toMatchObject({ assigneeEmployeeId: 'emp-3' }));
            expect(lastQuery().assigneeId).toBeUndefined();
        });

        it('asks for tasks nobody holds as its own filter, not an empty assignee', async () => {
            render(<TasksPage />);
            await waitFor(() => expect(getProjectTasks).toHaveBeenCalled());

            fireEvent.change(assigneeSelect(), { target: { value: 'unassigned' } });

            await waitFor(() => expect(lastQuery()).toMatchObject({ unassigned: 'true' }));
            expect(lastQuery().assigneeId).toBeUndefined();
        });

        it('drops the assignee filter entirely for “anyone”', async () => {
            render(<TasksPage />);
            await waitFor(() => expect(getProjectTasks).toHaveBeenCalled());

            fireEvent.change(assigneeSelect(), { target: { value: 'anyone' } });

            await waitFor(() => expect(lastQuery().assigneeId).toBeUndefined());
            expect(lastQuery().unassigned).toBeUndefined();
        });

        it('still lists everyone when the roster cannot be read', async () => {
            const { api } = jest.requireMock('@/lib/api');
            api.getProjectTaskAssignees.mockRejectedValue(new Error('403'));

            render(<TasksPage />);
            await waitFor(() => expect(getProjectTasks).toHaveBeenCalled());

            expect(within(assigneeSelect()).getAllByRole('option')).toHaveLength(3);
        });
    });

    describe('row actions', () => {
        it('opens the task for editing', async () => {
            render(<TasksPage />);
            await screen.findByText('Wire the meter');

            fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));

            expect(await screen.findByTestId('task-detail-panel')).toHaveTextContent('t1');
        });

        it('asks before deleting, naming the task', async () => {
            const { api } = jest.requireMock('@/lib/api');
            render(<TasksPage />);
            await screen.findByText('Wire the meter');

            fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

            expect(await screen.findByText(/Delete Wire the meter\?/)).toBeInTheDocument();
            expect(api.deleteProjectTask).not.toHaveBeenCalled();
        });

        it('deletes and reloads once confirmed', async () => {
            const { api } = jest.requireMock('@/lib/api');
            render(<TasksPage />);
            await screen.findByText('Wire the meter');
            const before = getProjectTasks.mock.calls.length;

            fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
            const dialog = await screen.findByRole('dialog');
            fireEvent.click(within(dialog).getByRole('button', { name: /^delete$/i }));

            await waitFor(() => expect(api.deleteProjectTask).toHaveBeenCalledWith('t1'));
            await waitFor(() => expect(getProjectTasks.mock.calls.length).toBeGreaterThan(before));
        });

        it('leaves the task alone when the dialog is cancelled', async () => {
            const { api } = jest.requireMock('@/lib/api');
            render(<TasksPage />);
            await screen.findByText('Wire the meter');

            fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
            const dialog = await screen.findByRole('dialog');
            fireEvent.click(within(dialog).getByRole('button', { name: /^cancel$/i }));

            await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
            expect(api.deleteProjectTask).not.toHaveBeenCalled();
        });
    });

    describe('the rest of the standard list toolbar', () => {
        it('narrows by priority', async () => {
            render(<TasksPage />);
            await waitFor(() => expect(getProjectTasks).toHaveBeenCalled());

            fireEvent.change(screen.getByLabelText(/^priority$/i), { target: { value: 'URGENT' } });

            await waitFor(() => expect(lastQuery()).toMatchObject({ priority: 'URGENT' }));
        });

        it('clears every filter back to the whole workspace, not back to me', async () => {
            render(<TasksPage />);
            await waitFor(() => expect(getProjectTasks).toHaveBeenCalled());
            fireEvent.change(screen.getByLabelText(/^priority$/i), { target: { value: 'HIGH' } });
            await waitFor(() => expect(lastQuery()).toMatchObject({ priority: 'HIGH' }));

            fireEvent.click(screen.getByRole('button', { name: /clear all/i }));

            await waitFor(() => expect(lastQuery().priority).toBeUndefined());
            expect(lastQuery().assigneeId).toBeUndefined();
        });

        it('remembers the slice for the next visit to the page', async () => {
            const { unmount } = render(<TasksPage />);
            await waitFor(() => expect(getProjectTasks).toHaveBeenCalled());
            fireEvent.change(assigneeSelect(), { target: { value: 'user:user-9' } });
            await waitFor(() => expect(lastQuery()).toMatchObject({ assigneeId: 'user-9' }));
            unmount();

            getProjectTasks.mockClear();
            render(<TasksPage />);

            await waitFor(() => expect(lastQuery()).toMatchObject({ assigneeId: 'user-9' }));
        });

        it('lets rows be selected for a bulk delete', async () => {
            const { api } = jest.requireMock('@/lib/api');
            render(<TasksPage />);
            await screen.findByText('Wire the meter');

            const boxes = screen.getAllByRole('checkbox');
            // The first is the header's select-all; the row's own is next.
            fireEvent.click(boxes[boxes.length - 1]);

            // Scoped to the bulk bar: the row's own Delete carries the same label.
            const bar = (await screen.findByText(/1 selected/)).closest('div') as HTMLElement;
            fireEvent.click(within(bar).getByRole('button', { name: /^delete$/i }));

            const dialog = await screen.findByRole('dialog');
            fireEvent.click(within(dialog).getByRole('button', { name: /^delete$/i }));

            await waitFor(() => expect(api.deleteProjectTask).toHaveBeenCalledWith('t1'));
        });
    });
});
