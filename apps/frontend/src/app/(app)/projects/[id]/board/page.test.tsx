import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import BoardPage from './page';

const getProjectBoard = jest.fn();
const moveProjectTask = jest.fn();
const createProjectTask = jest.fn();

jest.mock('next/navigation', () => ({
    useParams: () => ({ id: 'project-1' }),
}));

jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

jest.mock('@/lib/api', () => ({
    api: {
        getProject: jest.fn().mockResolvedValue({ id: 'project-1', code: 'PRJ-0001', name: 'Fit-out' }),
        getSprints: jest.fn().mockResolvedValue([]),
        getSprintBurndown: jest.fn().mockResolvedValue({ series: [] }),
        getProjectBoard: (...args: unknown[]) => getProjectBoard(...args),
        moveProjectTask: (...args: unknown[]) => moveProjectTask(...args),
        createProjectTask: (...args: unknown[]) => createProjectTask(...args),
        // Reached only once a card is opened.
        getProjectTask: jest.fn().mockResolvedValue({ id: 't1', title: 'Wire the meter' }),
        getTaskRemainingHistory: jest.fn().mockResolvedValue([]),
        getProjectTaskStatuses: jest.fn().mockResolvedValue([]),
    },
}));

const MOUSE = { pointerId: 1, pointerType: 'mouse', button: 0 };
const TOUCH = { pointerId: 2, pointerType: 'touch', button: 0 };

/** A press and release that never moves — the gesture that opens a card. */
const tap = (element: HTMLElement, pointer = MOUSE) => {
    fireEvent.pointerDown(element, { ...pointer, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(element, { ...pointer, clientX: 10, clientY: 10 });
};

const dragTo = (element: HTMLElement, to: { x: number; y: number }, pointer = MOUSE) => {
    fireEvent.pointerDown(element, { ...pointer, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(element, { ...pointer, clientX: to.x, clientY: to.y });
    fireEvent.pointerUp(element, { ...pointer, clientX: to.x, clientY: to.y });
};

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

const twoColumns = (todo: Record<string, unknown>[], doing: Record<string, unknown>[]) => ({
    columns: [
        { id: 'todo', name: 'To do', category: 'TODO', tasks: todo },
        { id: 'doing', name: 'Doing', category: 'IN_PROGRESS', tasks: doing },
    ],
});

beforeEach(() => {
    getProjectBoard.mockReset();
    moveProjectTask.mockReset().mockResolvedValue({});
    createProjectTask.mockReset().mockResolvedValue({ id: 'new' });
    getProjectBoard.mockResolvedValue(board([task()]));

    // The "did it open?" assertions all read this one mock, so a stale call
    // from the previous test would make the drag-guard test pass or fail for
    // the wrong reason.
    jest.requireMock('@/lib/api').api.getProjectTask.mockClear();

    // jsdom has no layout, so this always returns null unless a test says
    // otherwise — which is the honest default: a drag over nothing.
    document.elementFromPoint = jest.fn(() => null);
});

const card = async (title = 'Wire the meter') => {
    const heading = await screen.findByText(title);
    return heading.closest('article') as HTMLElement;
};

describe('Project board card', () => {
    it('opens the task detail panel when a card is tapped', async () => {
        // The panel has existed since Phase 1 and was wired into the Tasks list
        // and the project page, but never into the board — so the board had no
        // way to open a task at all.
        render(<BoardPage />);

        tap(await card());

        const { api } = jest.requireMock('@/lib/api');
        await waitFor(() => expect(api.getProjectTask).toHaveBeenCalledWith('t1'));
    });

    it('opens on Enter, so the board is reachable without a mouse', async () => {
        render(<BoardPage />);

        fireEvent.keyDown(await card(), { key: 'Enter' });

        const { api } = jest.requireMock('@/lib/api');
        await waitFor(() => expect(api.getProjectTask).toHaveBeenCalled());
    });

    it('does not open the task when the gesture was a drag', async () => {
        render(<BoardPage />);

        dragTo(await card(), { x: 200, y: 200 });

        const { api } = jest.requireMock('@/lib/api');
        expect(api.getProjectTask).not.toHaveBeenCalled();
    });

    it('still opens the task when the pointer only twitched', async () => {
        // A hand is never perfectly still on a click; 2px must not read as a
        // drag or the card would become impossible to open.
        render(<BoardPage />);
        const article = await card();

        fireEvent.pointerDown(article, { ...MOUSE, clientX: 10, clientY: 10 });
        fireEvent.pointerMove(article, { ...MOUSE, clientX: 12, clientY: 10 });
        fireEvent.pointerUp(article, { ...MOUSE, clientX: 12, clientY: 10 });

        const { api } = jest.requireMock('@/lib/api');
        await waitFor(() => expect(api.getProjectTask).toHaveBeenCalled());
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
        getProjectBoard.mockResolvedValue(twoColumns([task()], []));
        render(<BoardPage />);
        await card();

        document.elementFromPoint = jest.fn(
            () => document.querySelector('[data-board-column="doing"]') as Element,
        );
        dragTo(await card(), { x: 400, y: 200 });

        await waitFor(() =>
            expect(moveProjectTask).toHaveBeenCalledWith(
                't1',
                expect.objectContaining({ statusId: 'doing', sortOrder: 0 }),
            ),
        );
    });

    it('leaves the card alone when it is released outside every column', async () => {
        render(<BoardPage />);

        // elementFromPoint returns null by default here — dropped on the page
        // chrome, which must not be read as "move it somewhere".
        dragTo(await card(), { x: 900, y: 900 });

        expect(moveProjectTask).not.toHaveBeenCalled();
    });
});

// HTML5 `draggable` never fired from touch input, so the board was read-only on
// a phone. The grip exists because making the whole card touch-draggable would
// stop the column scrolling by finger.
describe('Project board touch dragging', () => {
    it('does not drag from the card body on touch, so the column can still scroll', async () => {
        getProjectBoard.mockResolvedValue(twoColumns([task()], []));
        render(<BoardPage />);

        document.elementFromPoint = jest.fn(
            () => document.querySelector('[data-board-column="doing"]') as Element,
        );
        dragTo(await card(), { x: 400, y: 200 }, TOUCH);

        expect(moveProjectTask).not.toHaveBeenCalled();
    });

    it('drags from the grip on touch', async () => {
        getProjectBoard.mockResolvedValue(twoColumns([task()], []));
        render(<BoardPage />);
        await card();

        document.elementFromPoint = jest.fn(
            () => document.querySelector('[data-board-column="doing"]') as Element,
        );
        dragTo(screen.getAllByLabelText('Drag to move')[0], { x: 400, y: 200 }, TOUCH);

        await waitFor(() =>
            expect(moveProjectTask).toHaveBeenCalledWith(
                't1',
                expect.objectContaining({ statusId: 'doing' }),
            ),
        );
    });

    // From the grip the intent is unambiguous, so there is no threshold to pass
    // — but that must not turn a tap on the grip into a move to nowhere.
    it('a tap on the grip does not move the card', async () => {
        render(<BoardPage />);
        await card();

        tap(screen.getAllByLabelText('Drag to move')[0], TOUCH);

        expect(moveProjectTask).not.toHaveBeenCalled();
    });
});

describe('Project board add card', () => {
    it('creates a task in the column it was added to', async () => {
        render(<BoardPage />);
        await card();

        fireEvent.click(screen.getByRole('button', { name: /Add a card/ }));
        fireEvent.change(screen.getByLabelText('Add a card — To do'), {
            target: { value: '  Test the circuit  ' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));

        await waitFor(() =>
            expect(createProjectTask).toHaveBeenCalledWith({
                projectId: 'project-1',
                // Trimmed, and into this column rather than the tenant default.
                title: 'Test the circuit',
                statusId: 'todo',
            }),
        );
    });

    it('reloads the board so the new card appears', async () => {
        render(<BoardPage />);
        await card();
        const before = getProjectBoard.mock.calls.length;

        fireEvent.click(screen.getByRole('button', { name: /Add a card/ }));
        fireEvent.change(screen.getByLabelText('Add a card — To do'), {
            target: { value: 'Test the circuit' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));

        await waitFor(() => expect(getProjectBoard.mock.calls.length).toBeGreaterThan(before));
    });

    it('stays open with an empty field so a column can be filled in one go', async () => {
        render(<BoardPage />);
        await card();

        fireEvent.click(screen.getByRole('button', { name: /Add a card/ }));
        const field = screen.getByLabelText('Add a card — To do');
        fireEvent.change(field, { target: { value: 'One' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));

        await waitFor(() => expect(field).toHaveValue(''));
        expect(screen.getByLabelText('Add a card — To do')).toBeInTheDocument();
    });

    it('keeps the text when the save fails, rather than losing what was typed', async () => {
        createProjectTask.mockRejectedValue(new Error('Nope'));
        render(<BoardPage />);
        await card();

        fireEvent.click(screen.getByRole('button', { name: /Add a card/ }));
        const field = screen.getByLabelText('Add a card — To do');
        fireEvent.change(field, { target: { value: 'One' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));

        const { toast } = jest.requireMock('@/lib/toast');
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Nope'));
        expect(field).toHaveValue('One');
    });

    it('closes on Escape', async () => {
        render(<BoardPage />);
        await card();

        fireEvent.click(screen.getByRole('button', { name: /Add a card/ }));
        fireEvent.keyDown(screen.getByLabelText('Add a card — To do'), { key: 'Escape' });

        expect(screen.queryByLabelText('Add a card — To do')).not.toBeInTheDocument();
    });

    it('will not create a blank card', async () => {
        render(<BoardPage />);
        await card();

        fireEvent.click(screen.getByRole('button', { name: /Add a card/ }));
        fireEvent.change(screen.getByLabelText('Add a card — To do'), { target: { value: '   ' } });

        expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    });
});

describe('Project board filters', () => {
    const mixed = () =>
        board([
            task({ id: 't1', title: 'Wire the meter', priority: 'URGENT' }),
            task({ id: 't2', title: 'Paint the wall', priority: 'LOW' }),
        ]);

    it('hides cards that do not match', async () => {
        getProjectBoard.mockResolvedValue(mixed());
        render(<BoardPage />);
        await screen.findByText('Wire the meter');

        fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'URGENT' } });

        expect(screen.getByText('Wire the meter')).toBeInTheDocument();
        expect(screen.queryByText('Paint the wall')).not.toBeInTheDocument();
    });

    it('says how much it is hiding', async () => {
        getProjectBoard.mockResolvedValue(mixed());
        render(<BoardPage />);
        await screen.findByText('Wire the meter');

        fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'URGENT' } });

        expect(screen.getByText('1 of 2 cards')).toBeInTheDocument();
    });

    it('clears back to everything', async () => {
        getProjectBoard.mockResolvedValue(mixed());
        render(<BoardPage />);
        await screen.findByText('Wire the meter');

        fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'URGENT' } });
        fireEvent.click(screen.getByRole('button', { name: /Clear/ }));

        expect(screen.getByText('Paint the wall')).toBeInTheDocument();
    });

    it('offers only assignees who actually hold a card here', async () => {
        getProjectBoard.mockResolvedValue(
            board([
                task({ assignee: { id: 'u1', name: 'Karim', email: 'k@x.com' } }),
                task({ id: 't2', title: 'Paint the wall' }),
            ]),
        );
        render(<BoardPage />);
        await screen.findByText('Wire the meter');

        const options = within(screen.getByLabelText('Assignee')).getAllByRole('option');
        expect(options.map((o) => o.textContent)).toEqual(['All', 'Unassigned', 'Karim']);
    });

    it('says a column is filtered empty rather than genuinely empty', async () => {
        getProjectBoard.mockResolvedValue(mixed());
        render(<BoardPage />);
        await screen.findByText('Wire the meter');

        fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'MEDIUM' } });

        expect(screen.getByText('Nothing matches the filters')).toBeInTheDocument();
        expect(screen.queryByText('Nothing here')).not.toBeInTheDocument();
    });

    // The server reorders against the whole column, so a visible index would
    // jump the card over every hidden card above it.
    it('drops to a position in the whole column, not the filtered one', async () => {
        getProjectBoard.mockResolvedValue(
            board([
                task({ id: 'hidden1', title: 'Hidden one', priority: 'LOW' }),
                task({ id: 'hidden2', title: 'Hidden two', priority: 'LOW' }),
                task({ id: 't1', title: 'Wire the meter', priority: 'URGENT' }),
            ]),
        );
        render(<BoardPage />);
        await screen.findByText('Wire the meter');

        fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'URGENT' } });
        document.elementFromPoint = jest.fn(
            () => document.querySelector('[data-board-column="todo"]') as Element,
        );
        dragTo(await card(), { x: 100, y: 300 });

        await waitFor(() =>
            // Two hidden cards remain above it once it is lifted out.
            expect(moveProjectTask).toHaveBeenCalledWith(
                't1',
                expect.objectContaining({ sortOrder: 2 }),
            ),
        );
    });
});
