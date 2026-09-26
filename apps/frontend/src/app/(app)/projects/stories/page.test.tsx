import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ProjectStoriesPage from './page';
import { api } from '@/lib/api';

jest.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: any) => <a href={href}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

jest.mock('@/lib/api', () => ({
    api: {
        getAllProjectsBacklog: jest.fn(),
        getProjects: jest.fn(),
        createProjectStory: jest.fn(),
        importProjectStories: jest.fn(),
        getProjectEpics: jest.fn().mockResolvedValue([]),
        reorderBacklogScope: jest.fn(),
    },
}));

jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

jest.mock('@/components/projects/TaskDetailPanel', () => {
    const Panel = () => null;
    Panel.displayName = 'TaskDetailPanel';
    return Panel;
});

const backlog = () => ({
    projects: [
        { id: 'p1', code: 'OTB', name: 'Online till' },
        { id: 'p2', code: 'WMS', name: 'Warehouse' },
    ],
    epics: [
        { id: 'e1', project_id: 'p1', code: 'OTB-E1', title: 'Online payments', status: 'OPEN', priority: 'HIGH', color: 'BLUE', sort_order: 0 },
    ],
    stories: [
        { id: 's1', project_id: 'p1', code: 'OTB-3', title: 'Shopper pays with bKash', status: 'READY', priority: 'HIGH', story_points: 5, epic_id: 'e1', sort_order: 0 },
        { id: 's2', project_id: 'p2', code: 'WMS-1', title: 'Count a bin', status: 'BACKLOG', priority: 'LOW', story_points: null, epic_id: null, sort_order: 0 },
    ],
    tasks: [
        {
            id: 't1',
            project_id: 'p1',
            key: 'OTB-7',
            reference: 7,
            title: 'Wire callback',
            user_story_id: 's1',
            priority: 'MEDIUM',
            logged_hours: 0,
            status: { id: 'todo', name: 'To Do', category: 'TODO' },
        },
    ],
});

beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    (api.getAllProjectsBacklog as jest.Mock).mockResolvedValue(backlog());
    (api.getProjects as jest.Mock).mockResolvedValue({
        items: [
            { id: 'p1', code: 'OTB', name: 'Online till' },
            { id: 'p2', code: 'WMS', name: 'Warehouse' },
            { id: 'p3', code: 'NEW', name: 'Brand new' },
        ],
    });
});

describe('ProjectStoriesPage', () => {
    it('draws every project’s stories as the tree, grouped by project and opened to the stories', async () => {
        render(<ProjectStoriesPage />);
        expect(await screen.findByText('Shopper pays with bKash')).toBeInTheDocument();
        expect(screen.getByText('Online till')).toBeInTheDocument();
        expect(screen.getByText('Warehouse')).toBeInTheDocument();
        expect(screen.getByText('Count a bin')).toBeInTheDocument();
        // Tasks stay folded under their stories.
        expect(screen.queryByText('Wire callback')).not.toBeInTheDocument();
    });

    it('narrows to one project', async () => {
        render(<ProjectStoriesPage />);
        await screen.findByText('Shopper pays with bKash');
        fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'p2' } });
        expect(screen.queryByText('Shopper pays with bKash')).not.toBeInTheDocument();
        expect(screen.getByText('Count a bin')).toBeInTheDocument();
    });

    it('moves a story within its own project only', async () => {
        render(<ProjectStoriesPage />);
        await screen.findByText('Count a bin');
        fireEvent.click(screen.getByRole('button', { name: 'Move WMS-1 to…' }));
        // Warehouse has no epics: nothing from Online till is offered.
        expect(screen.queryByRole('option', { name: /OTB-E1/ })).not.toBeInTheDocument();
    });

    it('asks for a project, offering ones with no stories yet, then creates the story', async () => {
        (api.createProjectStory as jest.Mock).mockResolvedValue({ id: 's9' });
        render(<ProjectStoriesPage />);
        await screen.findByText('Shopper pays with bKash');

        fireEvent.click(screen.getByRole('button', { name: /New user story/ }));
        const dialog = screen.getByRole('dialog');
        fireEvent.change(within(dialog).getByLabelText(/Title/), { target: { value: 'Refunds' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
        expect(await screen.findByText('Pick a project.')).toBeInTheDocument();
        expect(api.createProjectStory).not.toHaveBeenCalled();

        const picker = within(dialog).getByLabelText(/Project/, { selector: 'select#story-project' });
        expect(within(picker).getByRole('option', { name: 'NEW · Brand new' })).toBeInTheDocument();
        fireEvent.change(picker, { target: { value: 'p3' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

        await waitFor(() =>
            expect(api.createProjectStory).toHaveBeenCalledWith(
                expect.objectContaining({ projectId: 'p3', title: 'Refunds' }),
            ),
        );
        expect(api.getAllProjectsBacklog).toHaveBeenCalledTimes(2);
    });

    it('opens the import dialog', async () => {
        render(<ProjectStoriesPage />);
        await screen.findByText('Shopper pays with bKash');
        fireEvent.click(screen.getByRole('button', { name: /Import/ }));
        expect(await screen.findByText('Drag & drop or click to browse')).toBeInTheDocument();
    });

    it('says so when no project has any scope yet', async () => {
        (api.getAllProjectsBacklog as jest.Mock).mockResolvedValue({ projects: [], epics: [], stories: [], tasks: [] });
        render(<ProjectStoriesPage />);
        expect(await screen.findByText('No epics or user stories in any project yet.')).toBeInTheDocument();
    });
});
