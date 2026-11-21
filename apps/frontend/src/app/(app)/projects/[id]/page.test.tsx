import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProjectDetailPage from './page';

jest.mock('next/navigation', () => ({
    useParams: () => ({ id: 'p1' }),
    useRouter: () => ({ replace: jest.fn() }),
    useSearchParams: () => new URLSearchParams(),
}));

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

jest.mock('@/lib/api', () => ({
    api: {
        getProject: jest.fn(),
        getProjectTasks: jest.fn(),
        getProjectStories: jest.fn(),
        getProjectEpics: jest.fn(),
        getProjectBurndown: jest.fn(),
    },
}));

jest.mock('@/hooks/use-me', () => ({
    fetchMe: jest.fn().mockResolvedValue({ tenants: [{ id: 't1', role: 'OWNER', permissions: [] }] }),
}));

jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

jest.mock('@/components/projects/TaskDetailPanel', () => ({
    __esModule: true,
    default: () => null,
}));
jest.mock('@/components/projects/ProjectTeamCard', () => ({
    __esModule: true,
    default: () => null,
}));
jest.mock('@/components/projects/ProjectSkillsCard', () => ({
    __esModule: true,
    default: () => null,
}));
jest.mock('@/components/projects/backlog/BacklogSummary', () => ({
    __esModule: true,
    default: () => null,
}));
jest.mock('@/components/projects/BurndownChart', () => ({
    __esModule: true,
    default: () => null,
}));

const { api } = jest.requireMock('@/lib/api') as {
    api: {
        getProject: jest.Mock;
        getProjectTasks: jest.Mock;
        getProjectStories: jest.Mock;
        getProjectEpics: jest.Mock;
        getProjectBurndown: jest.Mock;
    };
};

const project = {
    id: 'p1',
    code: 'BS23',
    name: 'Fit-out',
    status: 'ACTIVE',
    priority: 'MEDIUM',
    members: [],
    milestones: [],
    progress: {
        taskCount: 60,
        doneTaskCount: 0,
        percentComplete: 0,
        estimatedHours: 0,
        remainingHours: 0,
        loggedHours: 0,
        milestones: [],
    },
};

const task = (id: string, title: string) => ({
    id,
    title,
    priority: 'MEDIUM',
    remaining_hours: '2',
    status: { id: 's1', name: 'To do', category: 'TODO' },
});

const taskPage = ({
    items = [task('t1', 'First task')],
    page = 1,
    total = 60,
}: {
    items?: ReturnType<typeof task>[];
    page?: number;
    total?: number;
}) => ({
    items,
    total,
    page,
    limit: 25,
    pages: Math.ceil(total / 25),
});

describe('ProjectDetailPage task pagination', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        api.getProject.mockResolvedValue(project);
        api.getProjectStories.mockResolvedValue([]);
        api.getProjectEpics.mockResolvedValue([]);
        api.getProjectBurndown.mockResolvedValue({ series: [] });
    });

    it('asks for the first page rather than loading every task', async () => {
        api.getProjectTasks.mockResolvedValue(taskPage({}));

        render(<ProjectDetailPage />);

        expect(await screen.findByText('First task')).toBeInTheDocument();
        expect(api.getProjectTasks).toHaveBeenCalledWith({
            projectId: 'p1',
            page: 1,
            limit: 25,
        });
    });

    it('moves to the next page and shows where you are', async () => {
        api.getProjectTasks
            .mockResolvedValueOnce(taskPage({}))
            .mockResolvedValueOnce(taskPage({ items: [task('t2', 'Second page task')], page: 2 }));

        render(<ProjectDetailPage />);

        expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));

        expect(await screen.findByText('Second page task')).toBeInTheDocument();
        expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
        await waitFor(() =>
            expect(api.getProjectTasks).toHaveBeenLastCalledWith({
                projectId: 'p1',
                page: 2,
                limit: 25,
            }),
        );
    });

    it('hides the pager when everything fits on one page', async () => {
        api.getProjectTasks.mockResolvedValue(taskPage({ total: 3 }));

        render(<ProjectDetailPage />);

        expect(await screen.findByText('First task')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    });
});
