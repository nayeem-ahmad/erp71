import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import BoardPage from './page';

const getProjectBoard = jest.fn();
const moveProjectTask = jest.fn();

jest.mock('next/navigation', () => ({
    useParams: () => ({ id: 'project-1' }),
}));

jest.mock('@/lib/api', () => ({
    api: {
        getProject: jest.fn().mockResolvedValue({ id: 'project-1', code: 'PRJ-0001', name: 'Fit-out' }),
        getSprints: jest.fn().mockResolvedValue([]),
        getSprintBurndown: jest.fn().mockResolvedValue({ series: [] }),
        getProjectBoard: (...args: unknown[]) => getProjectBoard(...args),
        moveProjectTask: (...args: unknown[]) => moveProjectTask(...args),
        // Reached only once a card is opened.
        getProjectTask: jest.fn().mockResolvedValue({ id: 't1', title: 'Wire the meter' }),
        getTaskRemainingHistory: jest.fn().mockResolvedValue([]),
        getProjectTaskStatuses: jest.fn().mockResolvedValue([]),
    },
}));

const dayKey = (offsetDays: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${month}-${day}`;
};

const task = (overrides: Record<string, unknown> = {}) => ({
    id: 't1',
    title: 'Wire the meter',
    priority: 'MEDIUM',
    status_id: 'todo',
    ...overrides,
});

const board = (tasks: Record<string, unknown>[]) => ({
    columns: [{ id: 'todo', name: 'To do', category: 'TODO', tasks }],
});

beforeEach(() => {
    getProjectBoard.mockReset();
    moveProjectTask.mockReset().mockResolvedValue({});
    getProjectBoard.mockResolvedValue(board([task()]));

    // The "did it open?" assertions all read this one mock, so a stale call
    // from the previous test would make the drag-guard test pass or fail for
    // the wrong reason.
    jest.requireMock('@/lib/api').api.getProjectTask.mockClear();
});

const card = async (title = 'Wire the meter') => {
    const heading = await screen.findByText(title);
    return heading.closest('article') as HTMLElement;
};

describe('Project board card', () => {
    it('opens the task detail panel when a card is clicked', async () => {
        // The panel has existed since Phase 1 and was wired into the Tasks list
        // and the project page, but never into the board — so the board had no
        // way to open a task at all.
        render(<BoardPage />);

        fireEvent.click(await card());

        const { api } = jest.requireMock('@/lib/api');
        await waitFor(() => expect(api.getProjectTask).toHaveBeenCalledWith('t1'));
    });

    it('opens on Enter, so the board is reachable without a mouse', async () => {
        render(<BoardPage />);

        fireEvent.keyDown(await card(), { key: 'Enter' });

        const { api } = jest.requireMock('@/lib/api');
        await waitFor(() => expect(api.getProjectTask).toHaveBeenCalled());
    });

    it('does not open the task when the click is the end of a drag', async () => {
        render(<BoardPage />);
        const article = await card();

        fireEvent.dragStart(article, { dataTransfer: { setData: jest.fn() } });
        fireEvent.dragEnd(article);
        fireEvent.click(article);

        const { api } = jest.requireMock('@/lib/api');
        expect(api.getProjectTask).not.toHaveBeenCalled();
    });

    it('shows checklist progress the board endpoint already returns', async () => {
        getProjectBoard.mockResolvedValue(
            board([
                task({
                    checklistItems: [
                        { id: 'c1', is_done: true },
                        { id: 'c2', is_done: false },
                        { id: 'c3', is_done: false },
                    ],
                }),
            ]),
        );
        render(<BoardPage />);

        expect(within(await card()).getByText('1/3')).toBeInTheDocument();
    });

    it('shows the comment and subtask counts', async () => {
        getProjectBoard.mockResolvedValue(
            board([task({ _count: { comments: 4, subtasks: 2 } })]),
        );
        render(<BoardPage />);

        const article = await card();
        expect(within(article).getByLabelText('4 comment(s)')).toBeInTheDocument();
        expect(within(article).getByLabelText('2 subtask(s)')).toBeInTheDocument();
    });

    it('omits zero counts rather than printing 0 on every card', async () => {
        getProjectBoard.mockResolvedValue(board([task({ _count: { comments: 0, subtasks: 0 } })]));
        render(<BoardPage />);

        const article = await card();
        expect(within(article).queryByLabelText(/comment/)).not.toBeInTheDocument();
        expect(within(article).queryByLabelText(/subtask/)).not.toBeInTheDocument();
    });

    it('calls out an overdue task', async () => {
        getProjectBoard.mockResolvedValue(board([task({ due_date: `${dayKey(-1)}T00:00:00.000Z` })]));
        render(<BoardPage />);

        expect(within(await card()).getByText('Overdue')).toBeInTheDocument();
    });

    // due_date is a @db.Date serialised at UTC midnight. Comparing it as a Date
    // against `now` marks today's task overdue for anyone east of UTC.
    it('does not call a task due today overdue', async () => {
        getProjectBoard.mockResolvedValue(board([task({ due_date: `${dayKey(0)}T00:00:00.000Z` })]));
        render(<BoardPage />);

        const article = await card();
        expect(within(article).getByText('Due today')).toBeInTheDocument();
        expect(within(article).queryByText('Overdue')).not.toBeInTheDocument();
    });

    it('treats a completed task as done however overdue its date is', async () => {
        getProjectBoard.mockResolvedValue(
            board([
                task({
                    due_date: `${dayKey(-30)}T00:00:00.000Z`,
                    completed_at: '2026-01-01T00:00:00.000Z',
                }),
            ]),
        );
        render(<BoardPage />);

        expect(within(await card()).queryByText('Overdue')).not.toBeInTheDocument();
    });

    it('badges urgent priority but stays quiet about medium', async () => {
        getProjectBoard.mockResolvedValue(
            board([task({ priority: 'URGENT' }), task({ id: 't2', title: 'Paint', priority: 'MEDIUM' })]),
        );
        render(<BoardPage />);

        expect(within(await card()).getByText('Urgent')).toBeInTheDocument();
        expect(within(await card('Paint')).queryByText('Medium')).not.toBeInTheDocument();
    });

    // Phase 2 made an employee without a login assignable; the old card read
    // only `assignee`, so those tasks looked unassigned.
    it('shows an employee assignee, not just a user assignee', async () => {
        getProjectBoard.mockResolvedValue(
            board([task({ assigneeEmployee: { id: 'e1', name: 'Rahim Uddin' } })]),
        );
        render(<BoardPage />);

        const article = await card();
        expect(within(article).getByLabelText('Rahim Uddin')).toBeInTheDocument();
        expect(within(article).queryByText('Unassigned')).not.toBeInTheDocument();
    });

    it('says so when nobody holds the task', async () => {
        render(<BoardPage />);
        expect(within(await card()).getByText('Unassigned')).toBeInTheDocument();
    });

    it('still moves a card between columns', async () => {
        getProjectBoard.mockResolvedValue({
            columns: [
                { id: 'todo', name: 'To do', category: 'TODO', tasks: [task()] },
                { id: 'doing', name: 'Doing', category: 'IN_PROGRESS', tasks: [] },
            ],
        });
        render(<BoardPage />);
        await card();

        const target = screen.getByText('Doing').closest('div') as HTMLElement;
        fireEvent.drop(target, { dataTransfer: { getData: () => 't1' } });

        await waitFor(() =>
            expect(moveProjectTask).toHaveBeenCalledWith(
                't1',
                expect.objectContaining({ statusId: 'doing' }),
            ),
        );
    });
});
