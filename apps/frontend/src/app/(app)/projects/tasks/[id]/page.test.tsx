import { render, screen, waitFor } from '@testing-library/react';

// `@testing-library/user-event` is NOT installed in this repo — the house
// pattern is fireEvent from @testing-library/react. See the board page's test.
import TaskDetailPage from './page';

const push = jest.fn();

jest.mock('next/navigation', () => ({
    useParams: () => ({ id: 't1' }),
    useRouter: () => ({ push, replace: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
}));

jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

const getProjectTask = jest.fn();
const getTaskRemainingHistory = jest.fn();
const getProjectColumns = jest.fn();

jest.mock('@/lib/api', () => ({
    api: {
        getProjectTask: (...args: unknown[]) => getProjectTask(...args),
        getTaskRemainingHistory: (...args: unknown[]) => getTaskRemainingHistory(...args),
        getProjectColumns: (...args: unknown[]) => getProjectColumns(...args),
        getProjectLabels: jest.fn().mockResolvedValue([]),
        getProject: jest.fn().mockResolvedValue({ id: 'project-1', members: [] }),
        getProjectStories: jest.fn().mockResolvedValue([]),
        getTaskAttachments: jest.fn().mockResolvedValue([]),
        getTaskComments: jest.fn().mockResolvedValue([]),
        getTaskActivity: jest.fn().mockResolvedValue([]),
        getTaskWatchers: jest.fn().mockResolvedValue([]),
        getMe: jest.fn().mockResolvedValue({ id: 'user-me' }),
        updateProjectTask: jest.fn().mockResolvedValue({}),
        logProjectTime: jest.fn().mockResolvedValue({}),
        deleteProjectTimeEntry: jest.fn().mockResolvedValue({}),
        getProjectTimer: jest.fn().mockResolvedValue(null),
        startProjectTimer: jest.fn().mockResolvedValue({}),
        stopProjectTimer: jest.fn().mockResolvedValue({}),
    },
}));

const task = {
    id: 't1',
    title: 'Wire the meter',
    description: 'Needs an idempotency key.',
    project: { id: 'project-1', code: 'PRJ-0001', name: 'Fit-out' },
    checklistItems: [],
    timeEntries: [],
};

beforeEach(() => {
    push.mockReset();
    getProjectTask.mockReset().mockResolvedValue(task);
    getTaskRemainingHistory.mockReset().mockResolvedValue([]);
    getProjectColumns.mockReset().mockResolvedValue([]);
});

describe('the task page', () => {
    it('names the task and its project in the header', async () => {
        render(<TaskDetailPage />);

        const heading = await screen.findByRole('heading', { name: 'Wire the meter' });
        expect(heading).toBeInTheDocument();

        // The project label renders twice on this page: as the header's
        // subtitle, and as the breadcrumb trail's own label (see
        // `projectChildBreadcrumbs`). So this asserts on the subtitle
        // specifically — `getByText` alone matches both and fails as ambiguous.
        const subtitle = heading.parentElement?.querySelector('p');
        expect(subtitle).toHaveTextContent('PRJ-0001 · Fit-out');
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
     * The reason Back is a push to the project rather than `router.back()`:
     * this page is reached as often from a pasted link with no history behind
     * it as from a board, and a Back that does nothing is worse than none.
     */
    it('goes back to the project, not through history', async () => {
        render(<TaskDetailPage />);

        const back = await screen.findByRole('button', { name: 'Back' });
        back.click();

        await waitFor(() => expect(push).toHaveBeenCalledWith('/projects/project-1'));
    });

    it('says it is loading until the task arrives', () => {
        // Never resolves, so the page stays in its pre-task state.
        getProjectTask.mockReturnValue(new Promise(() => {}));
        render(<TaskDetailPage />);

        expect(screen.getByText('Loading...')).toBeInTheDocument();
    });
});
