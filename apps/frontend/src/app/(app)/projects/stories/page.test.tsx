import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ProjectStoriesPage from './page';
import { api } from '@/lib/api';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
    usePathname: () => '/projects/stories',
    useSearchParams: () => new URLSearchParams(),
}));

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: any) => <a href={href}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

jest.mock('@/lib/api', () => ({
    api: {
        getAllProjectsBacklog: jest.fn(),
        getProjectStories: jest.fn(),
        getProjectEpics: jest.fn().mockResolvedValue([]),
        getProjects: jest.fn(),
        getMe: jest.fn().mockResolvedValue({ id: 'user-me' }),
        createProjectStory: jest.fn(),
        importProjectStories: jest.fn(),
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

const storyList = () => [
    {
        id: 's1',
        reference: 3,
        code: 'OTB-3',
        title: 'Shopper pays with bKash',
        status: 'READY',
        priority: 'HIGH',
        story_points: 5,
        project: { id: 'p1', code: 'OTB', name: 'Online till' },
        epic: { id: 'e1', code: 'OTB-E1', title: 'Online payments', color: 'BLUE' },
        progress: { taskCount: 1, doneTaskCount: 0, percentComplete: 0 },
    },
    {
        id: 's2',
        reference: 1,
        code: 'WMS-1',
        title: 'Count a bin',
        status: 'BACKLOG',
        priority: 'LOW',
        story_points: null,
        project: { id: 'p2', code: 'WMS', name: 'Warehouse' },
        epic: null,
        progress: { taskCount: 0, doneTaskCount: 0, percentComplete: 0 },
    },
];

beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    (api.getAllProjectsBacklog as jest.Mock).mockResolvedValue(backlog());
    (api.getProjectStories as jest.Mock).mockResolvedValue(storyList());
    (api.getProjectEpics as jest.Mock).mockResolvedValue([
        { id: 'e1', code: 'OTB-E1', title: 'Online payments', color: 'BLUE', project: { code: 'OTB' } },
    ]);
    (api.getProjects as jest.Mock).mockResolvedValue({
        items: [
            { id: 'p1', code: 'OTB', name: 'Online till' },
            { id: 'p2', code: 'WMS', name: 'Warehouse' },
            { id: 'p3', code: 'NEW', name: 'Brand new' },
        ],
    });
});

const chooseView = (name: 'List' | 'Hierarchy') => {
    fireEvent.click(screen.getByRole('button', { name: 'View options' }));
    const menu = screen.getByRole('dialog', { name: 'View options' });
    fireEvent.click(within(menu).getByRole('button', { name }));
};

describe('ProjectStoriesPage — list view', () => {
    it('draws the Sales-style list with a stats strip', async () => {
        render(<ProjectStoriesPage />);
        expect(await screen.findByText('Shopper pays with bKash')).toBeInTheDocument();
        expect(screen.getByText('Count a bin')).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Stories summary' })).toBeInTheDocument();
        expect(api.getProjectStories).toHaveBeenCalled();
        expect(api.getAllProjectsBacklog).not.toHaveBeenCalled();
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
        expect(api.getProjectStories).toHaveBeenCalledTimes(2);
    });

    it('opens the import dialog', async () => {
        render(<ProjectStoriesPage />);
        await screen.findByText('Shopper pays with bKash');
        fireEvent.click(screen.getByRole('button', { name: /Import/ }));
        expect(await screen.findByText('Drag & drop or click to browse')).toBeInTheDocument();
    });

    it('switches to the hierarchy tree from View options', async () => {
        render(<ProjectStoriesPage />);
        await screen.findByText('Shopper pays with bKash');
        chooseView('Hierarchy');
        expect(await screen.findByRole('tree')).toBeInTheDocument();
        expect(api.getAllProjectsBacklog).toHaveBeenCalled();
    });
});

describe('ProjectStoriesPage — hierarchy view', () => {
    beforeEach(() => {
        localStorage.setItem('project-stories-view', 'hierarchy');
    });

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

    it('says so when no project has any scope yet', async () => {
        (api.getAllProjectsBacklog as jest.Mock).mockResolvedValue({ projects: [], epics: [], stories: [], tasks: [] });
        render(<ProjectStoriesPage />);
        expect(await screen.findByText('No epics or user stories in any project yet.')).toBeInTheDocument();
    });
});
