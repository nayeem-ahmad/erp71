import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SprintDetailPage from './page';
import { api } from '@/lib/api';

jest.mock('next/navigation', () => ({
    useParams: () => ({ id: 's1' }),
    useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
    usePathname: () => '/projects/sprints/s1',
    useSearchParams: () => new URLSearchParams(),
}));

jest.mock('next/link', () => {
    const MockLink = ({ children, href, ...rest }: any) => (
        <a href={href} {...rest}>
            {children}
        </a>
    );
    MockLink.displayName = 'Link';
    return MockLink;
});

jest.mock('@/components/projects/TaskDetailPanel', () => ({
    __esModule: true,
    default: ({ taskId }: { taskId: string }) => <div data-testid="task-panel">{taskId}</div>,
}));

jest.mock('@/lib/api', () => ({
    api: {
        getSprint: jest.fn(),
        getProjectTasks: jest.fn(),
        getSprintBurndown: jest.fn(),
        getProjects: jest.fn(),
        getProjectStories: jest.fn(),
        assignTasksToSprint: jest.fn(),
        assignStoriesToSprint: jest.fn(),
        removeTasksFromSprint: jest.fn(),
        deleteProjectTask: jest.fn(),
        getProjectColumns: jest.fn(),
        moveProjectTask: jest.fn(),
    },
}));

const tasks = [
    {
        id: 't1',
        title: 'Wire the bKash callback',
        estimate_hours: '8',
        remaining_hours: '3',
        logged_hours: 6,
        status: { id: 'st1', name: 'Doing', category: 'IN_PROGRESS' },
        project: { id: 'p1', code: 'OTB', name: 'Online' },
        assignee: { id: 'u1', name: 'Rahim', email: 'r@x' },
        userStory: { id: 'us1', code: 'OTB-1', title: 'Pay with bKash' },
    },
    {
        id: 't2',
        title: 'Receipt email',
        estimate_hours: '4',
        remaining_hours: '4',
        logged_hours: 0,
        status: { id: 'st0', name: 'To do', category: 'TODO' },
        project: { id: 'p1', code: 'OTB', name: 'Online' },
        assignee: null,
        userStory: null,
    },
];

beforeEach(() => {
    localStorage.clear();
    (api.getSprint as jest.Mock).mockReset().mockResolvedValue({
        id: 's1',
        name: 'Sprint 7',
        goal: 'Payments',
        status: 'ACTIVE',
        start_date: '2026-08-02',
        end_date: '2026-08-04',
    });
    (api.getProjectTasks as jest.Mock).mockReset().mockResolvedValue({ items: tasks });
    (api.getSprintBurndown as jest.Mock).mockReset().mockResolvedValue({
        series: [
            { date: '2026-08-02', ideal: 12, actual: 12, committed: 12, open: 2, isWorkingDay: true },
            { date: '2026-08-03', ideal: 6, actual: 9.5, committed: 12, open: 2, isWorkingDay: true },
            { date: '2026-08-04', ideal: 0, actual: null, committed: null, open: null, isWorkingDay: true },
        ],
    });
    (api.getProjects as jest.Mock).mockReset().mockResolvedValue({ items: [] });
    (api.getProjectStories as jest.Mock).mockReset().mockResolvedValue([
        {
            id: 'us2',
            code: 'OTB-2',
            title: 'Refunds',
            status: 'READY',
            progress: { taskCount: 3, doneTaskCount: 1 },
        },
    ]);
    (api.getProjectColumns as jest.Mock).mockReset().mockResolvedValue([
        { id: 'st0', name: 'To do', category: 'TODO', sort_order: 0 },
        { id: 'st1', name: 'Doing', category: 'IN_PROGRESS', sort_order: 1 },
        { id: 'st2', name: 'Done', category: 'DONE', sort_order: 2 },
    ]);
    (api.assignStoriesToSprint as jest.Mock).mockReset().mockResolvedValue({ assigned: 2 });
    (api.removeTasksFromSprint as jest.Mock).mockReset().mockResolvedValue({ removed: 1 });
});

describe('Sprint detail page', () => {
    it('shows committed tasks in a table with hours, and no day columns', async () => {
        render(<SprintDetailPage />);

        const row = (await screen.findByText('Wire the bKash callback')).closest('tr')!;
        const cells = within(row).getAllByRole('cell').map((cell) => cell.textContent);
        // Task, estimate, spent, remaining, assignee, actions — nothing after.
        expect(cells).toHaveLength(6);
        expect(cells.slice(1, 5)).toEqual(['8', '6', '3', 'Rahim']);

        const footer = screen.getByText('Total').closest('tr')!;
        expect(within(footer).getAllByRole('cell').slice(1, 4).map((c) => c.textContent)).toEqual([
            '12',
            '6',
            '7',
        ]);
        expect(screen.getAllByRole('columnheader')).toHaveLength(6);
        // No backlog on the page until it is asked for.
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(api.getProjectTasks).toHaveBeenCalledWith({ sprintId: 's1', limit: 200 });
    });

    it('splits the table into swimlanes by story, with the unlinked lane last', async () => {
        render(<SprintDetailPage />);
        await screen.findByText('Wire the bKash callback');

        fireEvent.change(screen.getByTestId('sprint-swimlanes'), { target: { value: 'story' } });

        const lanes = screen.getAllByTestId('sprint-lane');
        expect(lanes).toHaveLength(2);
        expect(lanes[0]).toHaveTextContent('OTB-1 · Pay with bKash');
        expect(lanes[1]).toHaveTextContent('No user story');
        expect(localStorage.getItem('erp71.sprint.swimlanes')).toBe('story');
    });

    it('adds a user story\'s open tasks from the backlog modal', async () => {
        render(<SprintDetailPage />);
        await screen.findByText('Wire the bKash callback');

        fireEvent.click(screen.getByRole('button', { name: /add work/i }));
        fireEvent.click(await screen.findByRole('tab', { name: /user stories/i }));
        fireEvent.click(await screen.findByText('Refunds'));
        fireEvent.click(screen.getByRole('button', { name: /^add to sprint$/i }));

        await waitFor(() => expect(api.assignStoriesToSprint).toHaveBeenCalledWith('s1', ['us2']));
    });

    it('returns a task to the backlog from its row', async () => {
        render(<SprintDetailPage />);
        const row = (await screen.findByText('Receipt email')).closest('tr')!;

        fireEvent.click(within(row).getByRole('button', { name: /return to backlog/i }));

        await waitFor(() => expect(api.removeTasksFromSprint).toHaveBeenCalledWith('s1', ['t2']));
    });

    it('opens the task panel to edit a row', async () => {
        render(<SprintDetailPage />);
        const row = (await screen.findByText('Receipt email')).closest('tr')!;

        fireEvent.click(within(row).getByRole('button', { name: /edit/i }));

        expect(screen.getByTestId('task-panel')).toHaveTextContent('t2');
    });

    it('narrows the table with the search box at the top', async () => {
        render(<SprintDetailPage />);
        await screen.findByText('Wire the bKash callback');

        fireEvent.change(screen.getByRole('searchbox', { name: /search tasks/i }), {
            target: { value: 'rahim' },
        });

        expect(screen.getAllByTestId('sprint-task-row')).toHaveLength(1);
        expect(screen.queryByText('Receipt email')).not.toBeInTheDocument();
        // The footer totals follow the rows on screen.
        const footer = screen.getByText('Total').closest('tr')!;
        expect(within(footer).getAllByRole('cell')[1]).toHaveTextContent('8');

        fireEvent.change(screen.getByRole('searchbox', { name: /search tasks/i }), {
            target: { value: 'nothing-like-this' },
        });
        expect(screen.getByText(/no tasks match the search/i)).toBeInTheDocument();
    });

    it('shows a card view with one column per status, remembered per browser', async () => {
        render(<SprintDetailPage />);
        await screen.findByText('Wire the bKash callback');

        fireEvent.click(screen.getByRole('button', { name: /^cards$/i }));

        await waitFor(() => expect(screen.getAllByTestId('sprint-card-column')).toHaveLength(3));
        const columns = screen.getAllByTestId('sprint-card-column');
        expect(columns.map((column) => column.querySelector('h3')?.textContent)).toEqual([
            'To do',
            'Doing',
            'Done',
        ]);
        expect(within(columns[1]).getByText('Wire the bKash callback')).toBeInTheDocument();
        expect(within(columns[0]).getByText('Receipt email')).toBeInTheDocument();
        expect(screen.queryAllByTestId('sprint-task-row')).toHaveLength(0);
        expect(localStorage.getItem('erp71.sprint.view')).toBe('cards');
        expect(api.getProjectColumns).toHaveBeenCalledWith('p1');
    });

    it('opens a card in the task panel', async () => {
        render(<SprintDetailPage />);
        await screen.findByText('Wire the bKash callback');
        fireEvent.click(screen.getByRole('button', { name: /^cards$/i }));

        const card = screen.getByRole('button', { name: /receipt email/i });
        fireEvent.keyDown(card, { key: 'Enter' });

        expect(screen.getByTestId('task-panel')).toHaveTextContent('t2');
    });

    it('splits the card view into swimlanes too', async () => {
        render(<SprintDetailPage />);
        await screen.findByText('Wire the bKash callback');
        fireEvent.click(screen.getByRole('button', { name: /^cards$/i }));
        fireEvent.change(screen.getByTestId('sprint-swimlanes'), { target: { value: 'assignee' } });

        const lanes = screen.getAllByTestId('sprint-card-lane');
        expect(lanes).toHaveLength(2);
        expect(lanes[0]).toHaveTextContent('Rahim');
        expect(lanes[1]).toHaveTextContent('Unassigned');
    });

    it('filters by assignee, with Unassigned as a choice, alongside the search', async () => {
        render(<SprintDetailPage />);
        await screen.findByText('Wire the bKash callback');

        const filter = screen.getByTestId('sprint-assignee-filter');
        expect(within(filter).getAllByRole('option').map((o) => o.textContent)).toEqual([
            'Everyone',
            'Rahim',
            'Unassigned',
        ]);

        fireEvent.change(filter, { target: { value: 'none' } });
        expect(screen.getAllByTestId('sprint-task-row')).toHaveLength(1);
        expect(screen.getByText('Receipt email')).toBeInTheDocument();

        fireEvent.change(screen.getByRole('searchbox', { name: /search tasks/i }), {
            target: { value: 'bkash' },
        });
        expect(screen.getByText(/no tasks match the search/i)).toBeInTheDocument();
    });

    it('shows the sprint\'s goal, dates and how much of its time has passed', async () => {
        jest.useFakeTimers({ now: new Date('2026-08-03T10:00:00Z'), doNotFake: ['setTimeout', 'setInterval'] });
        try {
            render(<SprintDetailPage />);
            const info = await screen.findByTestId('sprint-info');

            expect(info).toHaveTextContent('Payments');
            expect(info).toHaveTextContent('Day 2 of 3');
            expect(within(info).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '67');
        } finally {
            jest.useRealTimers();
        }
    });

    it('draws the open tasks chart below the burndown', async () => {
        render(<SprintDetailPage />);

        expect(await screen.findByText('Open tasks chart')).toBeInTheDocument();
        const chart = screen.getByTestId('open-tasks-chart');
        // One reading per day that has a snapshot; the future day is a gap.
        expect(chart.querySelectorAll('title')).toHaveLength(2);
        expect(chart.querySelector('title')).toHaveTextContent('2026-08-02: 2');
    });
});
