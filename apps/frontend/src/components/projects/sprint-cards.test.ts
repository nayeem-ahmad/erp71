import {
    buildStatusColumns,
    matchesSprintSearch,
    sortOrderForDrop,
    tasksByColumn,
    type SprintCardTask,
} from './sprint-cards';

const p1 = { id: 'p1', code: 'OTB', name: 'Online' };
const p2 = { id: 'p2', code: 'POS', name: 'Till' };

const task = (id: string, overrides: Partial<SprintCardTask> = {}): SprintCardTask => ({
    id,
    title: id,
    project: p1,
    status: { id: 'p1-todo', name: 'To Do', category: 'TODO' },
    sort_order: 0,
    ...overrides,
});

describe('buildStatusColumns', () => {
    it('merges same-named statuses across projects and orders by category', () => {
        const columns = buildStatusColumns([], {
            p1: [
                { id: 'p1-done', name: 'Done', category: 'DONE', sort_order: 2 },
                { id: 'p1-todo', name: 'To Do', category: 'TODO', sort_order: 0 },
                { id: 'p1-doing', name: 'Doing', category: 'IN_PROGRESS', sort_order: 1 },
            ],
            p2: [
                { id: 'p2-todo', name: 'to do ', category: 'TODO', sort_order: 0 },
                { id: 'p2-review', name: 'Review', category: 'IN_PROGRESS', sort_order: 2 },
                { id: 'p2-old', name: 'Old', category: 'TODO', is_active: false },
            ],
        });

        expect(columns.map((c) => c.name)).toEqual(['To Do', 'Doing', 'Review', 'Done']);
        expect(columns[0].statusIds).toEqual({ p1: 'p1-todo', p2: 'p2-todo' });
        expect(columns[2].statusIds).toEqual({ p2: 'p2-review' });
    });

    it('keeps a column for a status a task still sits in, even when retired', () => {
        const columns = buildStatusColumns(
            [task('a', { status: { id: 'p1-old', name: 'Parked', category: 'TODO' } })],
            { p1: [] },
        );
        expect(columns).toEqual([
            { key: 'parked', name: 'Parked', category: 'TODO', statusIds: { p1: 'p1-old' } },
        ]);
    });
});

describe('tasksByColumn', () => {
    it('files cards under their status name in sort order', () => {
        const byColumn = tasksByColumn([task('b', { sort_order: 5 }), task('a', { sort_order: 1 })]);
        expect(byColumn['to do'].map((t) => t.id)).toEqual(['a', 'b']);
    });
});

describe('matchesSprintSearch', () => {
    const t = task('a', {
        title: 'Wire the callback',
        userStory: { id: 's', code: 'OTB-3', title: 'Pay with bKash' },
        assignee: { id: 'u', name: 'Rahim', email: 'r@x' },
        labels: [{ label: { id: 'l', name: 'Backend', color: 'BLUE' } }],
    });

    it('needs every word, in any field and order', () => {
        expect(matchesSprintSearch(t, 'bkash rahim')).toBe(true);
        expect(matchesSprintSearch(t, 'otb-3 backend')).toBe(true);
        expect(matchesSprintSearch(t, 'bkash nagad')).toBe(false);
        expect(matchesSprintSearch(t, '   ')).toBe(true);
    });
});

describe('sortOrderForDrop', () => {
    it('lands just after the nearest card of the same project above the drop', () => {
        const visible = [
            task('x', { sort_order: 3 }),
            task('y', { project: p2, sort_order: 0 }),
        ];
        const moving = task('m', { status: { id: 'p1-doing', name: 'Doing', category: 'IN_PROGRESS' } });
        expect(sortOrderForDrop(moving, 'p1-todo', visible, 2)).toBe(4);
    });

    it('lands before the nearest same-project card below when none is above', () => {
        const visible = [task('y', { project: p2 }), task('x', { sort_order: 2 })];
        const moving = task('m', { status: { id: 'p1-doing', name: 'Doing', category: 'IN_PROGRESS' } });
        expect(sortOrderForDrop(moving, 'p1-todo', visible, 0)).toBe(2);
    });

    it('allows for its own old slot when moving down its own status', () => {
        const moving = task('m', { sort_order: 0 });
        const visible = [moving, task('x', { sort_order: 1 }), task('z', { sort_order: 2 })];
        // Dropped after x: x is at 1 now, 0 once m leaves, so m goes to 1.
        expect(sortOrderForDrop(moving, 'p1-todo', visible, 1)).toBe(1);
    });

    it('goes to the top when no card of its project is in the column', () => {
        expect(sortOrderForDrop(task('m'), 'p1-todo', [task('y', { project: p2 })], 1)).toBe(0);
    });
});
