import { groupIntoLanes, laneKeyOf, NO_LANE, UNSORTED_CELL } from './board-lanes';
import type { BoardColumn, BoardTask } from './board-tasks';

const task = (id: string, overrides: Partial<BoardTask> = {}): BoardTask => ({
    id,
    title: id,
    priority: 'MEDIUM',
    status_id: 's1',
    ...overrides,
});

const rafi = { assignee: { id: 'u1', name: 'Rafi', email: 'rafi@example.com' } };
const anika = { assignee: { id: 'u2', name: 'Anika', email: 'anika@example.com' } };
const karim = { assigneeEmployee: { id: 'e1', name: 'Karim' } };

const story = (id: string, code: string) => ({ userStory: { id, code, title: `Story ${code}` } });

const column = (id: string, tasks: BoardTask[]): BoardColumn =>
    ({ id, name: id, category: 'TODO', tasks }) as BoardColumn;

describe('laneKeyOf', () => {
    it('keys a user and an employee apart, so the same id in both is two lanes', () => {
        expect(laneKeyOf(task('a', rafi), 'assignee')).toBe('user:u1');
        expect(laneKeyOf(task('a', karim), 'assignee')).toBe('employee:e1');
    });

    it('puts a card with nobody, or no story, in the one catch-all lane', () => {
        expect(laneKeyOf(task('a'), 'assignee')).toBe(NO_LANE);
        expect(laneKeyOf(task('a'), 'story')).toBe(NO_LANE);
    });

    it('keys a story lane by the story id, not its editable code', () => {
        expect(laneKeyOf(task('a', story('st1', 'OTB-3')), 'story')).toBe('story:st1');
    });
});

describe('groupIntoLanes', () => {
    it('returns no lanes when the board is not grouped', () => {
        expect(groupIntoLanes([column('c1', [task('a', rafi)])], [], 'none')).toEqual([]);
    });

    it('gives each lane a cell for every column, in column order, keeping card order', () => {
        const lanes = groupIntoLanes(
            [
                column('todo', [task('a', rafi), task('b', anika), task('c', rafi)]),
                column('done', [task('d', anika)]),
            ],
            [],
            'assignee',
        );
        const rafiLane = lanes.find((lane) => lane.key === 'user:u1')!;
        expect(rafiLane.cells.todo.map((t) => t.id)).toEqual(['a', 'c']);
        expect(rafiLane.cells.done).toEqual([]);
        expect(rafiLane.count).toBe(2);
    });

    it('orders people by name and puts Unassigned last', () => {
        const lanes = groupIntoLanes(
            [column('c1', [task('a'), task('b', rafi), task('c', karim), task('d', anika)])],
            [],
            'assignee',
        );
        expect(lanes.map((lane) => lane.title)).toEqual(['Anika', 'Karim', 'Rafi', null]);
        expect(lanes.at(-1)!.key).toBe(NO_LANE);
    });

    it('orders stories by code the way a person counts, and No story last', () => {
        const lanes = groupIntoLanes(
            [
                column('c1', [
                    task('a', story('s10', 'OTB-10')),
                    task('b'),
                    task('c', story('s2', 'OTB-2')),
                ]),
            ],
            [],
            'story',
        );
        expect(lanes.map((lane) => lane.code ?? null)).toEqual(['OTB-2', 'OTB-10', null]);
        expect(lanes[0].title).toBe('Story OTB-2');
    });

    it('only makes lanes that hold a card, so a filter hides a lane it empties', () => {
        const lanes = groupIntoLanes([column('c1', [task('a', rafi)])], [], 'assignee');
        expect(lanes.map((lane) => lane.key)).toEqual(['user:u1']);
    });

    it('files Unsorted cards into their lane under a cell of their own', () => {
        const lanes = groupIntoLanes([column('c1', [])], [task('u', rafi)], 'assignee');
        expect(lanes[0].cells[UNSORTED_CELL].map((t) => t.id)).toEqual(['u']);
        expect(lanes[0].cells.c1).toEqual([]);
        expect(lanes[0].count).toBe(1);
    });
});
