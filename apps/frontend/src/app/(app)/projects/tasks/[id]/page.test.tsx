import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

// `@testing-library/user-event` is NOT installed in this repo — the house
// pattern is fireEvent from @testing-library/react. See the board page's test.
import TaskDetailPage from './page';

const push = jest.fn();
const replace = jest.fn();
/** What `?…` the page was opened with. Set per case before rendering. */
let search = '';

jest.mock('next/navigation', () => ({
    useParams: () => ({ id: 't1' }),
    useRouter: () => ({ push, replace, refresh: jest.fn(), back: jest.fn() }),
    useSearchParams: () => new URLSearchParams(search),
}));

jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

const getProjectTask = jest.fn();
const getTaskRemainingHistory = jest.fn();
const getProjectColumns = jest.fn();
const getTaskComments = jest.fn();
const updateProjectTask = jest.fn();
const deleteProjectTask = jest.fn();

jest.mock('@/lib/api', () => ({
    api: {
        getProjectTask: (...args: unknown[]) => getProjectTask(...args),
        getTaskRemainingHistory: (...args: unknown[]) => getTaskRemainingHistory(...args),
        getProjectColumns: (...args: unknown[]) => getProjectColumns(...args),
        getProjectLabels: jest.fn().mockResolvedValue([]),
        getProject: jest.fn().mockResolvedValue({ id: 'project-1', members: [] }),
        getProjectStories: jest.fn().mockResolvedValue([]),
        getTaskAttachments: jest.fn().mockResolvedValue([]),
        getTaskComments: (...args: unknown[]) => getTaskComments(...args),
        getTaskActivity: jest.fn().mockResolvedValue([]),
        getTaskWatchers: jest.fn().mockResolvedValue([]),
        getMe: jest.fn().mockResolvedValue({ id: 'user-me' }),
        updateProjectTask: (...args: unknown[]) => updateProjectTask(...args),
        deleteProjectTask: (...args: unknown[]) => deleteProjectTask(...args),
        watchTask: jest.fn().mockResolvedValue({}),
        unwatchTask: jest.fn().mockResolvedValue({}),
        logProjectTime: jest.fn().mockResolvedValue({}),
        deleteProjectTimeEntry: jest.fn().mockResolvedValue({}),
        getProjectTimer: jest.fn().mockResolvedValue(null),
        startProjectTimer: jest.fn().mockResolvedValue({}),
        stopProjectTimer: jest.fn().mockResolvedValue({}),
    },
}));

const task = {
    id: 't1',
    reference: 7,
    title: 'Wire the meter',
    description: 'Needs an idempotency key.',
    project: { id: 'project-1', code: 'PRJ-0001', name: 'Fit-out' },
    checklistItems: [],
    timeEntries: [],
};

beforeEach(() => {
    search = '';
    push.mockReset();
    replace.mockReset();
    getProjectTask.mockReset().mockResolvedValue(task);
    getTaskRemainingHistory.mockReset().mockResolvedValue([]);
    getProjectColumns.mockReset().mockResolvedValue([]);
    getTaskComments.mockReset().mockResolvedValue([]);
    updateProjectTask.mockReset().mockResolvedValue({});
    deleteProjectTask.mockReset().mockResolvedValue({});
});

describe('the task page', () => {
    it('names the task, its key and its project in the header', async () => {
        render(<TaskDetailPage />);

        const heading = await screen.findByRole('heading', { level: 1, name: 'Wire the meter' });

        // The key is the handle people say; the project links back to where the
        // task lives. The breadcrumb ends on the key too, not on the word "Task".
        const subtitle = heading.parentElement?.querySelector('p') as HTMLElement;
        expect(within(subtitle).getByRole('button', { name: /PRJ-0001-7/ })).toBeInTheDocument();
        expect(within(subtitle).getByRole('link', { name: 'Fit-out' })).toHaveAttribute(
            'href',
            '/projects/project-1',
        );
    });

    it('reads the task named in the route', async () => {
        render(<TaskDetailPage />);
        await waitFor(() => expect(getProjectTask).toHaveBeenCalledWith('t1'));
    });

    it('renders the same body the modal does', async () => {
        render(<TaskDetailPage />);

        // The description section is part of `TaskCardBody`, so finding it here
        // is what proves the page mounts the shared body rather than a copy.
        expect(await screen.findByText('Needs an idempotency key.')).toBeInTheDocument();
    });

    /**
     * The page printed the title as plain text while the modal made it a
     * field — the presentation built for keeping a card open was the one where
     * it could not be renamed.
     */
    it('renames the task from its own heading', async () => {
        updateProjectTask.mockResolvedValue({ ...task, title: 'Wire the sub-meter' });
        render(<TaskDetailPage />);

        const field = await screen.findByLabelText('Title');
        fireEvent.change(field, { target: { value: 'Wire the sub-meter' } });
        fireEvent.blur(field);

        await waitFor(() =>
            expect(updateProjectTask).toHaveBeenCalledWith('t1', { title: 'Wire the sub-meter' }),
        );
    });

    it('keeps a pasted line break out of the title', async () => {
        render(<TaskDetailPage />);

        const field = await screen.findByLabelText('Title');
        fireEvent.change(field, { target: { value: 'Wire the\nmeter room' } });

        expect(field).toHaveValue('Wire the meter room');
    });

    it('names the browser tab after the task', async () => {
        render(<TaskDetailPage />);
        await screen.findByText('Needs an idempotency key.');

        await waitFor(() => expect(document.title).toBe('PRJ-0001-7 · Wire the meter'));
    });

    /**
     * Back was a push to the project — the page is reached from a pasted link
     * with no history as often as from a board. The project breadcrumb goes
     * there, and so does the ⋯ menu.
     */
    it('opens the project from its menu, not through history', async () => {
        render(<TaskDetailPage />);

        fireEvent.click(await screen.findByRole('button', { name: 'More actions' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Open project' }));

        expect(push).toHaveBeenCalledWith('/projects/project-1');
    });

    it('copies the task key', async () => {
        const writeText = jest.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText } });
        render(<TaskDetailPage />);

        fireEvent.click(await screen.findByRole('button', { name: /PRJ-0001-7/ }));

        await waitFor(() => expect(writeText).toHaveBeenCalledWith('PRJ-0001-7'));
    });

    it('deletes the task only after asking, then goes to its project', async () => {
        render(<TaskDetailPage />);

        fireEvent.click(await screen.findByRole('button', { name: 'More actions' }));
        fireEvent.click(screen.getByRole('menuitem', { name: /Delete task/ }));
        expect(deleteProjectTask).not.toHaveBeenCalled();

        const dialog = screen.getByRole('dialog');
        await act(async () => {
            fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
        });

        await waitFor(() => expect(deleteProjectTask).toHaveBeenCalledWith('t1'));
        await waitFor(() => expect(push).toHaveBeenCalledWith('/projects/project-1'));
    });

    it('says it is loading until the task arrives', () => {
        // Never resolves, so the page stays in its pre-task state.
        getProjectTask.mockReturnValue(new Promise(() => {}));
        render(<TaskDetailPage />);

        expect(screen.getByText('Loading...')).toBeInTheDocument();
    });

    // A link to a deleted task, or to a private project the reader is not on,
    // used to say "Loading…" for ever.
    it('says a task it cannot read is unavailable, and offers the task list', async () => {
        getProjectTask.mockRejectedValue(Object.assign(new Error('Task not found'), { status: 404 }));
        render(<TaskDetailPage />);

        expect(await screen.findByText("This task isn't available")).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Go to Tasks' }));
        expect(push).toHaveBeenCalledWith('/projects/tasks');
    });
});

/**
 * The page opens on Comments — it was navigated to on purpose, and a tab strip
 * over nothing was half of why it looked unfinished — and keeps the open tab in
 * the URL, so a link can land on a task's hour log.
 */
describe('the task page record', () => {
    it('opens on the comments', async () => {
        render(<TaskDetailPage />);

        expect(await screen.findByRole('tab', { name: /^Comments/ })).toHaveAttribute(
            'aria-selected',
            'true',
        );
        await waitFor(() => expect(getTaskComments).toHaveBeenCalledWith('t1'));
    });

    it('opens the tab the link names', async () => {
        search = 'tab=time';
        render(<TaskDetailPage />);

        expect(await screen.findByRole('tab', { name: /^Hour log/ })).toHaveAttribute(
            'aria-selected',
            'true',
        );
        // The feed is not what was asked for, so it is not fetched.
        expect(getTaskComments).not.toHaveBeenCalled();
    });

    it('puts the tab it moves to in the URL', async () => {
        render(<TaskDetailPage />);

        fireEvent.click(await screen.findByRole('tab', { name: /^Activity/ }));

        expect(replace).toHaveBeenCalledWith('/projects/tasks/t1?tab=activity', { scroll: false });
    });

    it('leaves the URL bare for the default tab', async () => {
        search = 'tab=activity';
        render(<TaskDetailPage />);

        fireEvent.click(await screen.findByRole('tab', { name: /^Comments/ }));

        expect(replace).toHaveBeenCalledWith('/projects/tasks/t1', { scroll: false });
    });

    // The strip toggles closed on a second click, which suits the modal. A page
    // has no closed state for its record.
    it('does not close the open tab', async () => {
        render(<TaskDetailPage />);

        fireEvent.click(await screen.findByRole('tab', { name: /^Comments/ }));

        expect(replace).not.toHaveBeenCalled();
    });

    it('ignores a tab it does not know', async () => {
        search = 'tab=secrets';
        render(<TaskDetailPage />);

        expect(await screen.findByRole('tab', { name: /^Comments/ })).toHaveAttribute(
            'aria-selected',
            'true',
        );
    });
});
