import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ProjectBacklogPage from './page';
import { api } from '@/lib/api';

let search = new URLSearchParams();
jest.mock('next/navigation', () => ({
    useParams: () => ({ id: 'p1' }),
    useSearchParams: () => search,
}));

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: any) => <a href={href}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

jest.mock('@/lib/api', () => ({
    api: {
        getProjectBacklog: jest.fn(),
        createProjectStory: jest.fn(),
        createProjectTask: jest.fn(),
        reorderBacklogScope: jest.fn(),
        reorderBacklogTasks: jest.fn(),
        bulkBacklogScope: jest.fn(),
        bulkBacklogTasks: jest.fn(),
        updateProjectStory: jest.fn(),
        updateProjectTask: jest.fn(),
        updateProjectEpic: jest.fn(),
        getProjectColumns: jest.fn(),
        getProject: jest.fn(),
        getProjectEpics: jest.fn().mockResolvedValue([]),
    },
}));

jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

jest.mock('@/components/projects/TaskDetailPanel', () => {
    const Panel = ({ taskId }: { taskId: string }) => <div data-testid="task-panel">{taskId}</div>;
    Panel.displayName = 'TaskDetailPanel';
    return Panel;
});

const task = (overrides: Record<string, unknown> = {}) => ({
    id: 't1',
    key: 'OTB-1',
    reference: 1,
    title: 'Wire callback URL',
    user_story_id: 's1',
    priority: 'MEDIUM',
    logged_hours: 0,
    estimate_hours: 4,
    status: { id: 'doing', name: 'In Progress', category: 'IN_PROGRESS' },
    ...overrides,
});

const backlog = () => ({
    project: { id: 'p1', code: 'OTB', name: 'Online till' },
    epics: [
        { id: 'e1', code: 'OTB-E1', title: 'Checkout payments', status: 'IN_PROGRESS', priority: 'HIGH', color: 'BLUE', sort_order: 0 },
        { id: 'e2', code: 'OTB-E2', title: 'Loyalty', status: 'OPEN', priority: 'MEDIUM', color: 'AMBER', sort_order: 1 },
    ],
    stories: [
        { id: 's1', code: 'OTB-S1', title: 'Pay with bKash', status: 'IN_PROGRESS', priority: 'HIGH', story_points: 5, epic_id: 'e1', sort_order: 0 },
        { id: 's2', code: 'OTB-S2', title: 'Earn points', status: 'BACKLOG', priority: 'LOW', story_points: null, epic_id: 'e2', sort_order: 0 },
    ],
    tasks: [task(), task({ id: 't2', key: 'OTB-2', title: 'Refund flow', status: { id: 'todo', name: 'To Do', category: 'TODO' } })],
});

const rowOf = (text: string) => screen.getByText(text).closest('[role="treeitem"]') as HTMLElement;

async function renderPage() {
    render(<ProjectBacklogPage />);
    await screen.findByText('Checkout payments');
}

async function openStory(title: string) {
    fireEvent.click(within(rowOf(title)).getByRole('button', { name: 'Expand' }));
}

beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    search = new URLSearchParams();
    (api.getProjectBacklog as jest.Mock).mockResolvedValue(backlog());
    (api.reorderBacklogScope as jest.Mock).mockResolvedValue({ success: true });
    (api.reorderBacklogTasks as jest.Mock).mockResolvedValue({ success: true });
    (api.bulkBacklogTasks as jest.Mock).mockResolvedValue({ updated: 2, skipped: [] });
    (api.getProjectColumns as jest.Mock).mockResolvedValue([
        { id: 'todo', name: 'To Do', category: 'TODO' },
        { id: 'doing', name: 'In Progress', category: 'IN_PROGRESS' },
        { id: 'done', name: 'Done', category: 'DONE' },
    ]);
});

describe('ProjectBacklogPage', () => {
    it('names the catch-all groups', async () => {
        (api.getProjectBacklog as jest.Mock).mockResolvedValue({
            ...backlog(),
            stories: [...backlog().stories, { id: 's3', code: 'OTB-S3', title: 'Loose story', status: 'BACKLOG', priority: 'LOW', epic_id: null, sort_order: 0 }],
            tasks: [...backlog().tasks, task({ id: 't9', key: 'OTB-9', title: 'Loose task', user_story_id: null })],
        });
        await renderPage();
        expect(within(rowOf('No epic')).getByText('1')).toBeInTheDocument();
        expect(within(rowOf('Tasks without a story')).getByText('1')).toBeInTheDocument();
        expect(screen.getByText('Loose task')).toBeInTheDocument();
    });

    it('opens epics to their stories on a first visit, with tasks folded', async () => {
        await renderPage();
        expect(screen.getByText('Pay with bKash')).toBeInTheDocument();
        expect(screen.queryByText('Wire callback URL')).not.toBeInTheDocument();
        expect(api.getProjectBacklog).toHaveBeenCalledWith('p1');
    });

    it('expands a story to its tasks and remembers it', async () => {
        await renderPage();
        await openStory('Pay with bKash');
        expect(screen.getByText('Wire callback URL')).toBeInTheDocument();
        expect(JSON.parse(localStorage.getItem('project-backlog-expanded:p1') ?? '[]')).toContain('s1');
    });

    it('shows a matching task through a search, whatever is folded', async () => {
        await renderPage();
        fireEvent.change(screen.getByLabelText('Search IDs, titles or assignees'), { target: { value: 'callback' } });
        expect(screen.getByText('Wire callback URL')).toBeInTheDocument();
    });

    it('says so when nothing matches the filters', async () => {
        await renderPage();
        fireEvent.change(screen.getByLabelText('Search IDs, titles or assignees'), { target: { value: 'zzz' } });
        expect(screen.getByText('Nothing matches these filters.')).toBeInTheDocument();
    });

    it('adds a task under a story from the inline composer', async () => {
        (api.createProjectTask as jest.Mock).mockResolvedValue({ id: 't3' });
        await renderPage();
        await openStory('Pay with bKash');
        fireEvent.click(screen.getAllByRole('button', { name: 'Add task' })[0]);
        const input = screen.getByLabelText('Add task');
        fireEvent.change(input, { target: { value: 'Timeouts' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() =>
            expect(api.createProjectTask).toHaveBeenCalledWith({ projectId: 'p1', title: 'Timeouts', userStoryId: 's1' }),
        );
    });

    it('opens a task in its panel', async () => {
        await renderPage();
        await openStory('Pay with bKash');
        fireEvent.click(screen.getByText('Wire callback URL'));
        expect(screen.getByTestId('task-panel')).toHaveTextContent('t1');
    });

    describe('moving', () => {
        it('moves a story to another epic from its "Move to" chip', async () => {
            await renderPage();
            fireEvent.click(screen.getByRole('button', { name: 'Move OTB-S1 to…' }));
            fireEvent.click(screen.getByRole('option', { name: /OTB-E2 · Loyalty/ }));

            await waitFor(() =>
                expect(api.reorderBacklogScope).toHaveBeenCalledWith('p1', {
                    kind: 'story',
                    id: 's1',
                    parentId: 'e2',
                    orderedIds: ['s2', 's1'],
                }),
            );
            expect(api.getProjectBacklog).toHaveBeenCalledTimes(2);
        });

        it('reorders a task with Alt+↓ and sends the story’s whole order', async () => {
            await renderPage();
            await openStory('Pay with bKash');
            fireEvent.keyDown(rowOf('Wire callback URL'), { key: 'ArrowDown', altKey: true });

            await waitFor(() =>
                expect(api.reorderBacklogTasks).toHaveBeenCalledWith('p1', {
                    id: 't1',
                    parentId: 's1',
                    orderedIds: ['t2', 't1'],
                }),
            );
        });

        it('does nothing at the end of a group', async () => {
            await renderPage();
            await openStory('Pay with bKash');
            fireEvent.keyDown(rowOf('Refund flow'), { key: 'ArrowDown', altKey: true });
            expect(api.reorderBacklogTasks).not.toHaveBeenCalled();
        });

        it('says so and reloads when the server refuses a move', async () => {
            const { toast } = jest.requireMock('@/lib/toast');
            (api.reorderBacklogScope as jest.Mock).mockRejectedValue(new Error('Epic not found'));
            await renderPage();
            fireEvent.keyDown(rowOf('Checkout payments'), { key: 'ArrowDown', altKey: true });
            await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Epic not found'));
            expect(api.getProjectBacklog).toHaveBeenCalledTimes(2);
        });
    });

    describe('keyboard', () => {
        it('moves focus down the rows and opens a folded row with →', async () => {
            await renderPage();
            const epic = rowOf('Checkout payments');
            act(() => epic.focus());
            fireEvent.keyDown(epic, { key: 'ArrowDown' });
            expect(document.activeElement).toBe(rowOf('Pay with bKash'));
            fireEvent.keyDown(rowOf('Pay with bKash'), { key: 'ArrowRight' });
            expect(screen.getByText('Wire callback URL')).toBeInTheDocument();
        });

        it('selects with Space and opens with Enter', async () => {
            await renderPage();
            const story = rowOf('Pay with bKash');
            fireEvent.keyDown(story, { key: ' ' });
            expect(story).toHaveAttribute('aria-selected', 'true');
            expect(screen.getByText('1 selected')).toBeInTheDocument();
            fireEvent.keyDown(story, { key: 'Enter' });
            expect(await screen.findByRole('dialog')).toBeInTheDocument();
        });
    });

    describe('bulk actions', () => {
        it('sets the priority of every selected task in one request', async () => {
            await renderPage();
            await openStory('Pay with bKash');
            fireEvent.click(screen.getByLabelText('Select OTB-1 Wire callback URL'));
            fireEvent.click(screen.getByLabelText('Select OTB-2 Refund flow'));
            expect(screen.getByText('2 selected')).toBeInTheDocument();

            const bar = screen.getByRole('region', { name: 'Actions for the selection' });
            fireEvent.click(within(bar).getByRole('button', { name: 'Priority' }));
            fireEvent.click(screen.getByRole('option', { name: 'Urgent' }));

            await waitFor(() =>
                expect(api.bulkBacklogTasks).toHaveBeenCalledWith('p1', {
                    ids: ['t1', 't2'],
                    action: 'priority',
                    value: 'URGENT',
                }),
            );
            await waitFor(() => expect(screen.queryByText('2 selected')).not.toBeInTheDocument());
        });

        it('offers status and "Move to" only for one kind of item', async () => {
            await renderPage();
            fireEvent.click(screen.getByLabelText('Select OTB-E1 Checkout payments'));
            fireEvent.click(screen.getByLabelText('Select OTB-S1 Pay with bKash'));
            const bar = screen.getByRole('region', { name: 'Actions for the selection' });
            expect(within(bar).queryByRole('button', { name: 'Status' })).not.toBeInTheDocument();
            expect(within(bar).queryByRole('button', { name: 'Move to…' })).not.toBeInTheDocument();
            expect(within(bar).getByRole('button', { name: 'Priority' })).toBeInTheDocument();
        });

        it('confirms before deleting, then deletes epics and stories separately', async () => {
            (api.bulkBacklogScope as jest.Mock).mockResolvedValue({ updated: 1, skipped: [] });
            await renderPage();
            fireEvent.click(screen.getByLabelText('Select OTB-E2 Loyalty'));
            fireEvent.click(screen.getByLabelText('Select OTB-S1 Pay with bKash'));
            const bar = screen.getByRole('region', { name: 'Actions for the selection' });
            fireEvent.click(within(bar).getByRole('button', { name: 'Delete' }));
            expect(api.bulkBacklogScope).not.toHaveBeenCalled();
            fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));

            await waitFor(() => expect(api.bulkBacklogScope).toHaveBeenCalledTimes(2));
            expect(api.bulkBacklogScope).toHaveBeenCalledWith('p1', { kind: 'epic', ids: ['e2'], action: 'delete', value: undefined });
            expect(api.bulkBacklogScope).toHaveBeenCalledWith('p1', { kind: 'story', ids: ['s1'], action: 'delete', value: undefined });
        });

        it('reports the rows the server skipped', async () => {
            const { toast } = jest.requireMock('@/lib/toast');
            (api.bulkBacklogScope as jest.Mock).mockResolvedValue({
                updated: 0,
                skipped: [{ id: 's1', reason: "This story's status follows its tasks" }],
            });
            await renderPage();
            fireEvent.click(screen.getByLabelText('Select OTB-S1 Pay with bKash'));
            const bar = screen.getByRole('region', { name: 'Actions for the selection' });
            fireEvent.click(within(bar).getByRole('button', { name: 'Status' }));
            fireEvent.click(screen.getByRole('option', { name: 'Ready' }));
            await waitFor(() =>
                expect(toast.error).toHaveBeenCalledWith("0 updated, 1 skipped: This story's status follows its tasks"),
            );
        });
    });

    describe('inline edits', () => {
        it('changes a task’s column from its status chip', async () => {
            (api.updateProjectTask as jest.Mock).mockResolvedValue({});
            await renderPage();
            await openStory('Pay with bKash');
            fireEvent.click(screen.getByRole('button', { name: 'Status of OTB-2' }));
            fireEvent.click(await screen.findByRole('option', { name: 'Done' }));
            await waitFor(() => expect(api.updateProjectTask).toHaveBeenCalledWith('t2', { statusId: 'done' }));
            expect(api.getProjectColumns).toHaveBeenCalledWith('p1');
        });

        it('sizes a story from its points chip', async () => {
            (api.updateProjectStory as jest.Mock).mockResolvedValue({});
            await renderPage();
            fireEvent.click(screen.getByRole('button', { name: 'Points of OTB-S2' }));
            fireEvent.click(screen.getByRole('option', { name: '8' }));
            await waitFor(() => expect(api.updateProjectStory).toHaveBeenCalledWith('s2', { storyPoints: 8 }));
        });

        it('does not offer a status for a story whose work has started', async () => {
            await renderPage();
            expect(screen.queryByRole('button', { name: 'Status of OTB-S1' })).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Status of OTB-S2' })).toBeInTheDocument();
        });
    });

    it('opens the story a deep link names', async () => {
        search = new URLSearchParams('story=s2');
        await renderPage();
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByDisplayValue('Earn points')).toBeInTheDocument();
    });
});
