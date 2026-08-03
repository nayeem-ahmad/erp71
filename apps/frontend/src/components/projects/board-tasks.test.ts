import {
    applyFilters,
    assigneeKeyOf,
    assigneeNameOf,
    assigneeOptionsFrom,
    dueStateOf,
    hasActiveFilter,
    initialsOf,
    matchesFilters,
    NO_FILTERS,
    type BoardColumn,
    type BoardTask,
} from './board-tasks';

const shift = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    // The API serialises a @db.Date at UTC midnight; keep that shape.
    return `${d.getFullYear()}-${month}-${day}T00:00:00.000Z`;
};

const task = (overrides: Partial<BoardTask> = {}): BoardTask => ({
    id: 't1',
    title: 'Wire the meter',
    priority: 'MEDIUM',
    status_id: 'todo',
    ...overrides,
});

const column = (tasks: BoardTask[]): BoardColumn => ({
    id: 'todo',
    name: 'To do',
    category: 'TODO',
    tasks,
});

describe('dueStateOf', () => {
    it('has nothing to say about a task with no due date', () => {
        expect(dueStateOf(null, null)).toBeNull();
    });

    it('calls yesterday overdue', () => {
        expect(dueStateOf(shift(-1), null)).toBe('overdue');
    });

    // The bug this guards: due_date is a @db.Date at UTC midnight, so comparing
    // it as a Date against `now` marks today's task overdue everywhere east of
    // UTC — which is every timezone this product ships to.
    it('does not call today overdue', () => {
        expect(dueStateOf(shift(0), null)).toBe('today');
    });

    it('warns two days out but not five', () => {
        expect(dueStateOf(shift(2), null)).toBe('soon');
        expect(dueStateOf(shift(5), null)).toBe('later');
    });

    it('treats a completed task as done however old the date', () => {
        expect(dueStateOf(shift(-90), '2026-01-01T00:00:00.000Z')).toBe('done');
    });
});

describe('assignee helpers', () => {
    it('reads a user assignee', () => {
        const t = task({ assignee: { id: 'u1', name: 'Karim', email: 'k@x.com' } });
        expect(assigneeNameOf(t)).toBe('Karim');
        expect(assigneeKeyOf(t)).toBe('user:u1');
    });

    it('falls back to the email when a user has no name', () => {
        expect(assigneeNameOf(task({ assignee: { id: 'u1', email: 'k@x.com' } }))).toBe('k@x.com');
    });

    // Phase 2 made an employee without a login assignable; reading only
    // `assignee` made those tasks look unassigned.
    it('reads an employee assignee', () => {
        const t = task({ assigneeEmployee: { id: 'e1', name: 'Rahim Uddin' } });
        expect(assigneeNameOf(t)).toBe('Rahim Uddin');
        expect(assigneeKeyOf(t)).toBe('employee:e1');
    });

    it('keys users and employees apart so the filter cannot confuse them', () => {
        expect(assigneeKeyOf(task({ assignee: { id: 'x', email: 'a@b.c' } }))).not.toBe(
            assigneeKeyOf(task({ assigneeEmployee: { id: 'x', name: 'X' } })),
        );
    });

    it('says none when nobody holds the task', () => {
        expect(assigneeNameOf(task())).toBeNull();
        expect(assigneeKeyOf(task())).toBe('none');
    });

    it('offers each assignee once, sorted, ignoring unassigned cards', () => {
        const options = assigneeOptionsFrom([
            column([
                task({ id: 'a', assignee: { id: 'u1', name: 'Zara', email: 'z@x.com' } }),
                task({ id: 'b', assignee: { id: 'u1', name: 'Zara', email: 'z@x.com' } }),
                task({ id: 'c', assigneeEmployee: { id: 'e1', name: 'Aminul' } }),
                task({ id: 'd' }),
            ]),
        ]);

        expect(options).toEqual([
            { key: 'employee:e1', label: 'Aminul' },
            { key: 'user:u1', label: 'Zara' },
        ]);
    });
});

describe('initialsOf', () => {
    it('takes the first two words', () => {
        expect(initialsOf('Rahim Uddin Chowdhury')).toBe('RU');
    });

    it('copes with a single name', () => {
        expect(initialsOf('Karim')).toBe('K');
    });
});

describe('matchesFilters', () => {
    it('passes everything when nothing is set', () => {
        expect(hasActiveFilter(NO_FILTERS)).toBe(false);
        expect(matchesFilters(task(), NO_FILTERS)).toBe(true);
    });

    it('filters by assignee', () => {
        const mine = task({ assignee: { id: 'u1', name: 'Karim', email: 'k@x.com' } });
        expect(matchesFilters(mine, { ...NO_FILTERS, assignee: 'user:u1' })).toBe(true);
        expect(matchesFilters(mine, { ...NO_FILTERS, assignee: 'user:u2' })).toBe(false);
    });

    it('filters down to unassigned cards', () => {
        expect(matchesFilters(task(), { ...NO_FILTERS, assignee: 'none' })).toBe(true);
        expect(
            matchesFilters(task({ assignee: { id: 'u1', email: 'k@x.com' } }), {
                ...NO_FILTERS,
                assignee: 'none',
            }),
        ).toBe(false);
    });

    it('filters by priority', () => {
        expect(matchesFilters(task({ priority: 'URGENT' }), { ...NO_FILTERS, priority: 'URGENT' })).toBe(true);
        expect(matchesFilters(task({ priority: 'LOW' }), { ...NO_FILTERS, priority: 'URGENT' })).toBe(false);
    });

    it('finds overdue cards', () => {
        expect(matchesFilters(task({ due_date: shift(-1) }), { ...NO_FILTERS, due: 'overdue' })).toBe(true);
        expect(matchesFilters(task({ due_date: shift(1) }), { ...NO_FILTERS, due: 'overdue' })).toBe(false);
    });

    // Chasing a finished task because its date has passed is noise.
    it('does not call a completed card overdue', () => {
        expect(
            matchesFilters(task({ due_date: shift(-9), completed_at: shift(-8) }), {
                ...NO_FILTERS,
                due: 'overdue',
            }),
        ).toBe(false);
    });

    it('finds cards due today', () => {
        expect(matchesFilters(task({ due_date: shift(0) }), { ...NO_FILTERS, due: 'today' })).toBe(true);
        expect(matchesFilters(task({ due_date: shift(-1) }), { ...NO_FILTERS, due: 'today' })).toBe(false);
    });

    it('this week means the next seven days, not anything already late', () => {
        expect(matchesFilters(task({ due_date: shift(3) }), { ...NO_FILTERS, due: 'week' })).toBe(true);
        expect(matchesFilters(task({ due_date: shift(30) }), { ...NO_FILTERS, due: 'week' })).toBe(false);
        expect(matchesFilters(task({ due_date: shift(-2) }), { ...NO_FILTERS, due: 'week' })).toBe(false);
    });

    it('finds cards with no due date', () => {
        expect(matchesFilters(task(), { ...NO_FILTERS, due: 'none' })).toBe(true);
        expect(matchesFilters(task({ due_date: shift(1) }), { ...NO_FILTERS, due: 'none' })).toBe(false);
    });

    it('a dated filter excludes undated cards', () => {
        expect(matchesFilters(task(), { ...NO_FILTERS, due: 'overdue' })).toBe(false);
    });

    it('combines filters as AND', () => {
        const t = task({ priority: 'HIGH', assignee: { id: 'u1', email: 'k@x.com' } });
        expect(matchesFilters(t, { assignee: 'user:u1', priority: 'HIGH', due: 'all' })).toBe(true);
        expect(matchesFilters(t, { assignee: 'user:u1', priority: 'LOW', due: 'all' })).toBe(false);
    });
});

describe('applyFilters', () => {
    it('leaves the columns untouched when nothing is set', () => {
        const columns = [column([task()])];
        expect(applyFilters(columns, NO_FILTERS)).toBe(columns);
    });

    it('keeps every column, even one that filters to empty', () => {
        const columns = [
            column([task({ id: 'a', priority: 'URGENT' }), task({ id: 'b', priority: 'LOW' })]),
            { ...column([task({ id: 'c', priority: 'LOW' })]), id: 'doing', name: 'Doing' },
        ];
        const result = applyFilters(columns, { ...NO_FILTERS, priority: 'URGENT' });

        // Dropping an empty column would make the board's shape change as you
        // type, and you could no longer drop a card into it.
        expect(result).toHaveLength(2);
        expect(result[0].tasks.map((t) => t.id)).toEqual(['a']);
        expect(result[1].tasks).toEqual([]);
    });
});
