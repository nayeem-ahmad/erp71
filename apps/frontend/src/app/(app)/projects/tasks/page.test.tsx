import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TasksPage from './page';

const getProjectTasks = jest.fn();

jest.mock('@/lib/api', () => ({
    api: {
        getMe: jest.fn().mockResolvedValue({ id: 'user-me' }),
        getProjects: jest.fn().mockResolvedValue({ items: [{ id: 'p1', code: 'PRJ-0001', name: 'P1' }] }),
        getProjectTasks: (...args: unknown[]) => getProjectTasks(...args),
        createProjectTask: jest.fn(),
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
    status: { id: 's1', name: 'To do', category: 'TODO' },
    project: { id: 'p1', code: 'PRJ-0001', name: 'P1' },
    ...overrides,
});

beforeEach(() => {
    const { api } = jest.requireMock('@/lib/api');
    getProjectTasks.mockReset();
    getProjectTasks.mockResolvedValue({ items: [task()], total: 1, page: 1, limit: 25, pages: 1 });
    api.getProjects.mockResolvedValue({ items: [{ id: 'p1', code: 'PRJ-0001', name: 'P1' }] });
    api.createProjectTask.mockReset().mockResolvedValue({ id: 'task-new' });
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
     * Opening a task and coming back should land on the slice it was opened
     * from, rather than snapping back to "assigned to me".
     */
    it('comes back to the assignee, project and status the last visit left set', async () => {
        const first = render(<TasksPage />);
        await waitFor(() => expect(getProjectTasks).toHaveBeenCalled());
        await screen.findByText('Wire the meter');

        fireEvent.change(screen.getByDisplayValue('Assigned to me'), { target: { value: 'anyone' } });
        fireEvent.change(screen.getByDisplayValue('All projects'), { target: { value: 'p1' } });
        fireEvent.change(screen.getByDisplayValue('Any status'), { target: { value: 'DONE' } });
        await waitFor(() =>
            expect(getProjectTasks.mock.calls.at(-1)![0]).toMatchObject({
                assigneeId: undefined, projectId: 'p1', statusCategory: 'DONE',
            }),
        );
        first.unmount();

        getProjectTasks.mockClear();
        render(<TasksPage />);
        await screen.findByText('Wire the meter');

        expect(screen.getByDisplayValue('Anyone')).toBeInTheDocument();
        // And never a first request for the signed-in user's own tasks.
        for (const call of getProjectTasks.mock.calls) {
            expect(call[0]).toMatchObject({
                assigneeId: undefined, projectId: 'p1', statusCategory: 'DONE',
            });
        }
    });

    /**
     * The search box debounces, so a restored term has to bypass the debounce:
     * applying it 300ms late would send one request for the unsearched list first.
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
});
