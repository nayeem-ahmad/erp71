import { fireEvent, render, screen } from '@testing-library/react';
import SprintCardBoard from './SprintCardBoard';
import { resolveDropTarget } from './board-drag';
import { toast } from '@/lib/toast';
import type { StatusColumn, SprintCardTask } from './sprint-cards';

// jsdom has no layout, so where the pointer lands is decided here.
jest.mock('./board-drag', () => ({
    ...jest.requireActual('./board-drag'),
    resolveDropTarget: jest.fn(),
}));

jest.mock('@/lib/toast', () => ({ toast: { info: jest.fn(), error: jest.fn(), success: jest.fn() } }));

const columns: StatusColumn[] = [
    { key: 'to do', name: 'To Do', category: 'TODO', statusIds: { p1: 'p1-todo', p2: 'p2-todo' } },
    { key: 'review', name: 'Review', category: 'IN_PROGRESS', statusIds: { p2: 'p2-review' } },
    { key: 'done', name: 'Done', category: 'DONE', statusIds: { p1: 'p1-done', p2: 'p2-done' } },
];

const task = (id: string, project: string, overrides: Partial<SprintCardTask> = {}): SprintCardTask => ({
    id,
    title: `Task ${id}`,
    project: { id: project, code: project.toUpperCase(), name: project },
    status: { id: `${project}-todo`, name: 'To Do', category: 'TODO' },
    sort_order: 0,
    estimate_hours: '5',
    remaining_hours: '2',
    ...overrides,
});

const drag = (title: string) => {
    const card = screen.getByRole('button', { name: new RegExp(title) });
    const init = { pointerId: 1, pointerType: 'mouse', button: 0 };
    fireEvent.pointerDown(card, { ...init, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(card, { ...init, clientX: 50, clientY: 50 });
    fireEvent.pointerUp(card, { ...init, clientX: 50, clientY: 50 });
};

const setup = (tasks: SprintCardTask[], laneMode: 'none' | 'assignee' = 'none') => {
    const onMove = jest.fn();
    const onOpen = jest.fn();
    const lanes =
        laneMode === 'none'
            ? [{ key: 'all', title: null, tasks }]
            : [
                  { key: 'user:u1', title: 'Rahim', tasks: tasks.filter((t) => t.assignee) },
                  { key: 'none', title: null, tasks: tasks.filter((t) => !t.assignee) },
              ];
    render(
        <SprintCardBoard
            lanes={lanes}
            laneMode={laneMode}
            columns={columns}
            busy={false}
            onOpen={onOpen}
            onReturn={jest.fn()}
            onMove={onMove}
        />,
    );
    return { onMove, onOpen };
};

beforeEach(() => jest.clearAllMocks());

describe('SprintCardBoard', () => {
    it('heads each column with its count and hours left', () => {
        setup([task('a', 'p1'), task('b', 'p2')]);
        const [todo] = screen.getAllByTestId('sprint-card-column');
        expect(todo).toHaveTextContent('To Do');
        expect(todo).toHaveTextContent('2');
        expect(todo).toHaveTextContent('4h left');
    });

    it('moves a dropped card to its own project\'s status of that column', () => {
        (resolveDropTarget as jest.Mock).mockReturnValue({ columnId: 'done', index: 0 });
        const { onMove } = setup([task('a', 'p1')]);

        drag('Task a');

        expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), 'p1-done', 0);
    });

    it('refuses a column the card\'s project does not have', () => {
        (resolveDropTarget as jest.Mock).mockReturnValue({ columnId: 'review', index: 0 });
        const { onMove } = setup([task('a', 'p1')]);

        drag('Task a');

        expect(onMove).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('P1 has no "Review" column'));
    });

    it('keeps a card inside its own swimlane', () => {
        (resolveDropTarget as jest.Mock).mockReturnValue({ columnId: 'done', index: 0, laneKey: 'none' });
        const { onMove } = setup(
            [task('a', 'p1', { assignee: { id: 'u1', name: 'Rahim', email: 'r@x' } }), task('b', 'p1')],
            'assignee',
        );

        drag('Task a');

        expect(onMove).not.toHaveBeenCalled();
        expect(toast.info).toHaveBeenCalled();
    });

    it('treats a press without movement as a click that opens the card', () => {
        const { onOpen, onMove } = setup([task('a', 'p1')]);
        const card = screen.getByRole('button', { name: /Task a/ });
        const init = { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 0, clientY: 0 };
        fireEvent.pointerDown(card, init);
        fireEvent.pointerUp(card, init);

        expect(onOpen).toHaveBeenCalledWith('a');
        expect(onMove).not.toHaveBeenCalled();
    });
});
