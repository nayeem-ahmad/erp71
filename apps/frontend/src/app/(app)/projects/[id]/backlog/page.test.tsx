import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ProjectBacklogPage from './page';
import { api } from '@/lib/api';

jest.mock('next/navigation', () => ({ useParams: () => ({ id: 'p1' }) }));

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
        getProjectEpics: jest.fn().mockResolvedValue([]),
    },
}));

jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

jest.mock('@/components/projects/TaskDetailPanel', () => {
    const Panel = ({ taskId }: { taskId: string }) => <div data-testid="task-panel">{taskId}</div>;
    Panel.displayName = 'TaskDetailPanel';
    return Panel;
});

const backlog = () => ({
    project: { id: 'p1', code: 'OTB', name: 'Online till' },
    epics: [
        { id: 'e1', code: 'OTB-E1', title: 'Checkout payments', status: 'IN_PROGRESS', priority: 'HIGH', color: 'BLUE', sort_order: 0 },
    ],
    stories: [
        { id: 's1', code: 'OTB-3', title: 'Pay with bKash', status: 'IN_PROGRESS', priority: 'HIGH', story_points: 5, epic_id: 'e1', sort_order: 0 },
    ],
    tasks: [
        {
            id: 't1',
            key: 'OTB-1',
            reference: 1,
            title: 'Wire callback URL',
            user_story_id: 's1',
            priority: 'MEDIUM',
            logged_hours: 0,
            estimate_hours: 4,
            status: { id: 'doing', name: 'In Progress', category: 'IN_PROGRESS' },
        },
    ],
});

beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    (api.getProjectBacklog as jest.Mock).mockResolvedValue(backlog());
});

describe('ProjectBacklogPage', () => {
    it('opens epics to their stories on a first visit, with tasks folded', async () => {
        render(<ProjectBacklogPage />);
        expect(await screen.findByText('Checkout payments')).toBeInTheDocument();
        expect(screen.getByText('Pay with bKash')).toBeInTheDocument();
        expect(screen.queryByText('Wire callback URL')).not.toBeInTheDocument();
        expect(api.getProjectBacklog).toHaveBeenCalledWith('p1');
    });

    it('expands a story to its tasks and remembers it', async () => {
        render(<ProjectBacklogPage />);
        const story = (await screen.findByText('Pay with bKash')).closest('[role="treeitem"]') as HTMLElement;
        fireEvent.click(within(story).getByRole('button', { name: 'Expand' }));
        expect(screen.getByText('Wire callback URL')).toBeInTheDocument();
        expect(JSON.parse(localStorage.getItem('project-backlog-expanded:p1') ?? '[]')).toContain('s1');
    });

    it('shows a matching task through a search, whatever is folded', async () => {
        render(<ProjectBacklogPage />);
        await screen.findByText('Checkout payments');
        fireEvent.change(screen.getByLabelText('Search IDs, titles or assignees'), {
            target: { value: 'callback' },
        });
        expect(screen.getByText('Wire callback URL')).toBeInTheDocument();
    });

    it('adds a task under a story from the inline composer', async () => {
        (api.createProjectTask as jest.Mock).mockResolvedValue({ id: 't2' });
        render(<ProjectBacklogPage />);
        const story = (await screen.findByText('Pay with bKash')).closest('[role="treeitem"]') as HTMLElement;
        fireEvent.click(within(story).getByRole('button', { name: 'Expand' }));
        fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
        const input = screen.getByLabelText('Add task');
        fireEvent.change(input, { target: { value: 'Refund flow' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() =>
            expect(api.createProjectTask).toHaveBeenCalledWith({
                projectId: 'p1',
                title: 'Refund flow',
                userStoryId: 's1',
            }),
        );
        expect(api.getProjectBacklog).toHaveBeenCalledTimes(2);
    });

    it('opens a task in its panel', async () => {
        render(<ProjectBacklogPage />);
        const story = (await screen.findByText('Pay with bKash')).closest('[role="treeitem"]') as HTMLElement;
        fireEvent.click(within(story).getByRole('button', { name: 'Expand' }));
        fireEvent.click(screen.getByText('Wire callback URL'));
        expect(screen.getByTestId('task-panel')).toHaveTextContent('t1');
    });

    it('says so when nothing matches the filters', async () => {
        render(<ProjectBacklogPage />);
        await screen.findByText('Checkout payments');
        fireEvent.change(screen.getByLabelText('Search IDs, titles or assignees'), {
            target: { value: 'zzz' },
        });
        expect(screen.getByText('Nothing matches these filters.')).toBeInTheDocument();
    });
});
