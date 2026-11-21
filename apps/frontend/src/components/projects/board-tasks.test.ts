import {
    applyFilters,
    cardsMatching,
    coverClass,
    CARD_SORTS,
    matchesText,
    sortCards,
    isOverWip,
    assigneeKeyOf,
    assigneeNameOf,
    assigneeOptionsFrom,
    dueStateOf,
    hasActiveFilter,
    initialsOf,
    LABEL_COLORS,
    labelClass,
    labelOptionsFrom,
    labelsOf,
    matchesFilters,
    NO_FILTERS,
    projectLabelOf,
    projectOptionsFrom,
    sprintOptionsFrom,
    storyOptionsFrom,
    type BoardColumn,
    type BoardTask,
    type ProjectLabel,
} from './board-tasks';

const blocked: ProjectLabel = { id: 'l1', name: 'Blocked', color: 'RED' };
const waiting: ProjectLabel = { id: 'l2', name: 'Client waiting', color: 'AMBER' };

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

    it('filters by assignee, and by several at once', () => {
        const mine = task({ assignee: { id: 'u1', name: 'Karim', email: 'k@x.com' } });
        const theirs = task({ assignee: { id: 'u2', name: 'Rafi', email: 'r@x.com' } });
        expect(matchesFilters(mine, { ...NO_FILTERS, assignees: ['user:u1'] })).toBe(true);
        expect(matchesFilters(mine, { ...NO_FILTERS, assignees: ['user:u2'] })).toBe(false);
        // Any of the picked people, the way the list treats a multi-select.
        expect(matchesFilters(mine, { ...NO_FILTERS, assignees: ['user:u2', 'user:u1'] })).toBe(true);
        expect(matchesFilters(theirs, { ...NO_FILTERS, assignees: ['user:u2', 'user:u1'] })).toBe(true);
    });

    it('spells "me" with the signed-in user, and matches nobody without one', () => {
        const mine = task({ assignee: { id: 'u1', name: 'Karim', email: 'k@x.com' } });
        expect(matchesFilters(mine, { ...NO_FILTERS, assignees: ['me'] }, 'u1')).toBe(true);
        expect(matchesFilters(mine, { ...NO_FILTERS, assignees: ['me'] }, 'u2')).toBe(false);
        // Before `/auth/me` answers, "me" is nobody rather than everybody.
        expect(matchesFilters(mine, { ...NO_FILTERS, assignees: ['me'] }, null)).toBe(false);
    });

    it('filters down to unassigned cards, under either name', () => {
        expect(matchesFilters(task(), { ...NO_FILTERS, assignees: ['none'] })).toBe(true);
        expect(matchesFilters(task(), { ...NO_FILTERS, assignees: ['unassigned'] })).toBe(true);
        expect(
            matchesFilters(task({ assignee: { id: 'u1', email: 'k@x.com' } }), {
                ...NO_FILTERS,
                assignees: ['none'],
            }),
        ).toBe(false);
    });

    it('filters by status, and hides done cards on request', () => {
        const doing = task({ status: { id: 's2', name: 'Doing', category: 'IN_PROGRESS' } });
        const done = task({ status: { id: 's3', name: 'Done', category: 'DONE' } });
        expect(matchesFilters(doing, { ...NO_FILTERS, statusCategories: ['IN_PROGRESS'] })).toBe(true);
        expect(matchesFilters(done, { ...NO_FILTERS, statusCategories: ['IN_PROGRESS'] })).toBe(false);

        expect(matchesFilters(done, { ...NO_FILTERS, hideDone: true })).toBe(false);
        expect(matchesFilters(doing, { ...NO_FILTERS, hideDone: true })).toBe(true);
        // A card marked finished in the panel counts as done even if the column
        // still says otherwise — the same rule the list applies.
        expect(matchesFilters(task({ completed_at: shift(-1) }), { ...NO_FILTERS, hideDone: true })).toBe(false);
    });

    it('filters by priority, and by several at once', () => {
        expect(matchesFilters(task({ priority: 'URGENT' }), { ...NO_FILTERS, priorities: ['URGENT'] })).toBe(true);
        expect(matchesFilters(task({ priority: 'LOW' }), { ...NO_FILTERS, priorities: ['URGENT'] })).toBe(false);
        expect(matchesFilters(task({ priority: 'LOW' }), { ...NO_FILTERS, priorities: ['URGENT', 'LOW'] })).toBe(
            true,
        );
    });

    it('finds overdue cards', () => {
        expect(matchesFilters(task({ due_date: shift(-1) }), { ...NO_FILTERS, due: ['overdue'] })).toBe(true);
        expect(matchesFilters(task({ due_date: shift(1) }), { ...NO_FILTERS, due: ['overdue'] })).toBe(false);
    });

    // Chasing a finished task because its date has passed is noise.
    it('does not call a completed card overdue', () => {
        expect(
            matchesFilters(task({ due_date: shift(-9), completed_at: shift(-8) }), {
                ...NO_FILTERS,
                due: ['overdue'],
            }),
        ).toBe(false);
    });

    it('finds cards due today', () => {
        expect(matchesFilters(task({ due_date: shift(0) }), { ...NO_FILTERS, due: ['today'] })).toBe(true);
        expect(matchesFilters(task({ due_date: shift(-1) }), { ...NO_FILTERS, due: ['today'] })).toBe(false);
    });

    it('this week means the next seven days, not anything already late', () => {
        expect(matchesFilters(task({ due_date: shift(3) }), { ...NO_FILTERS, due: ['week'] })).toBe(true);
        expect(matchesFilters(task({ due_date: shift(30) }), { ...NO_FILTERS, due: ['week'] })).toBe(false);
        expect(matchesFilters(task({ due_date: shift(-2) }), { ...NO_FILTERS, due: ['week'] })).toBe(false);
    });

    it('finds cards with no due date', () => {
        expect(matchesFilters(task(), { ...NO_FILTERS, due: ['none'] })).toBe(true);
        expect(matchesFilters(task({ due_date: shift(1) }), { ...NO_FILTERS, due: ['none'] })).toBe(false);
    });

    it('a dated filter excludes undated cards', () => {
        expect(matchesFilters(task(), { ...NO_FILTERS, due: ['overdue'] })).toBe(false);
    });

    it('a due range is an alternative to the presets, not a further cut', () => {
        const ranged = { ...NO_FILTERS, due: ['today' as const], dueFrom: shift(4).slice(0, 10), dueTo: shift(6).slice(0, 10) };
        expect(matchesFilters(task({ due_date: shift(0) }), ranged)).toBe(true);
        expect(matchesFilters(task({ due_date: shift(5) }), ranged)).toBe(true);
        expect(matchesFilters(task({ due_date: shift(20) }), ranged)).toBe(false);
    });

    it('combines filters as AND', () => {
        const t = task({ priority: 'HIGH', assignee: { id: 'u1', email: 'k@x.com' } });
        expect(matchesFilters(t, { ...NO_FILTERS, assignees: ['user:u1'], priorities: ['HIGH'] })).toBe(true);
        expect(matchesFilters(t, { ...NO_FILTERS, assignees: ['user:u1'], priorities: ['LOW'] })).toBe(false);
    });

    it('filters by label, several at once', () => {
        const tagged = task({ labels: [{ label: blocked }] });
        expect(matchesFilters(tagged, { ...NO_FILTERS, labelIds: ['l1'] })).toBe(true);
        expect(matchesFilters(tagged, { ...NO_FILTERS, labelIds: ['l2'] })).toBe(false);
        expect(matchesFilters(tagged, { ...NO_FILTERS, labelIds: ['l2', 'l1'] })).toBe(true);
        expect(matchesFilters(task(), { ...NO_FILTERS, labelIds: ['l1'] })).toBe(false);
    });

    it('matches a card carrying the label among several', () => {
        const tagged = task({ labels: [{ label: waiting }, { label: blocked }] });
        expect(matchesFilters(tagged, { ...NO_FILTERS, labelIds: ['l1'] })).toBe(true);
    });

    it('finds cards with no label at all', () => {
        expect(matchesFilters(task(), { ...NO_FILTERS, labelIds: ['none'] })).toBe(true);
        expect(
            matchesFilters(task({ labels: [{ label: blocked }] }), { ...NO_FILTERS, labelIds: ['none'] }),
        ).toBe(false);
    });

    it('filters by logged hours and by the time-vs-estimate flags', () => {
        const over = task({ logged_hours: 9, estimate_hours: '4', status: { id: 's', name: 'Doing', category: 'IN_PROGRESS' } });
        expect(matchesFilters(over, { ...NO_FILTERS, hours: { op: 'gt', value: 5 } })).toBe(true);
        expect(matchesFilters(over, { ...NO_FILTERS, hours: { op: 'lt', value: 5 } })).toBe(false);
        expect(matchesFilters(over, { ...NO_FILTERS, time: ['over'] })).toBe(true);
        expect(matchesFilters(task({ logged_hours: 0 }), { ...NO_FILTERS, time: ['none'] })).toBe(true);
        expect(matchesFilters(task({ logged_hours: 1 }), { ...NO_FILTERS, time: ['no-estimate'] })).toBe(true);
    });

    it('filters by when a card was last updated and when it was created', () => {
        const stale = task({ updated_at: new Date(Date.now() - 9 * 86400000).toISOString() });
        expect(matchesFilters(stale, { ...NO_FILTERS, updated: ['d7'] })).toBe(true);
        expect(matchesFilters(task({ updated_at: new Date().toISOString() }), { ...NO_FILTERS, updated: ['d7'] })).toBe(
            false,
        );

        const old = task({ created_at: shift(-40) });
        expect(matchesFilters(old, { ...NO_FILTERS, createdFrom: shift(-50).slice(0, 10) })).toBe(true);
        expect(matchesFilters(old, { ...NO_FILTERS, createdFrom: shift(-10).slice(0, 10) })).toBe(false);
    });
});

describe('project, sprint and story filters', () => {
    const alpha = { id: 'p1', code: 'ALP', name: 'Alpha' };
    const beta = { id: 'p2', code: 'BET', name: 'Beta' };
    const sprint4 = { id: 's4', name: 'Sprint 4', status: 'ACTIVE' };

    it('filters by project, and by several at once', () => {
        expect(matchesFilters(task({ project: alpha }), { ...NO_FILTERS, projectIds: ['p1'] })).toBe(true);
        expect(matchesFilters(task({ project: beta }), { ...NO_FILTERS, projectIds: ['p1'] })).toBe(false);
        expect(matchesFilters(task({ project: beta }), { ...NO_FILTERS, projectIds: ['p1', 'p2'] })).toBe(true);
    });

    it('filters by sprint', () => {
        const planned = task({ sprint_id: 's4', sprint: sprint4 });
        expect(matchesFilters(planned, { ...NO_FILTERS, sprintIds: ['s4'] })).toBe(true);
        expect(matchesFilters(planned, { ...NO_FILTERS, sprintIds: ['s5'] })).toBe(false);
        expect(matchesFilters(task(), { ...NO_FILTERS, sprintIds: ['s4'] })).toBe(false);
    });

    // The scalar arrives on every card even where the relation was not loaded.
    it('reads the sprint off the bare id when the relation is missing', () => {
        expect(matchesFilters(task({ sprint_id: 's4' }), { ...NO_FILTERS, sprintIds: ['s4'] })).toBe(true);
    });

    it('finds cards in some sprint, or in none', () => {
        expect(matchesFilters(task(), { ...NO_FILTERS, sprintIds: ['none'] })).toBe(true);
        expect(
            matchesFilters(task({ sprint_id: 's4', sprint: sprint4 }), { ...NO_FILTERS, sprintIds: ['none'] }),
        ).toBe(false);
        const both = { ...NO_FILTERS, sprintIds: ['none', 's4'] };
        expect(matchesFilters(task(), both)).toBe(true);
        expect(matchesFilters(task({ sprint_id: 's4', sprint: sprint4 }), both)).toBe(true);
    });

    it('filters by user story, and by cards under none', () => {
        const story = { id: 'st1', code: 'OTB-3', title: 'Take a payment' };
        expect(matchesFilters(task({ userStory: story }), { ...NO_FILTERS, storyIds: ['st1'] })).toBe(true);
        expect(matchesFilters(task(), { ...NO_FILTERS, storyIds: ['st1'] })).toBe(false);
        expect(matchesFilters(task(), { ...NO_FILTERS, storyIds: ['none'] })).toBe(true);
    });

    it('counts any of them as an active filter', () => {
        expect(hasActiveFilter({ ...NO_FILTERS, projectIds: ['p1'] })).toBe(true);
        expect(hasActiveFilter({ ...NO_FILTERS, sprintIds: ['none'] })).toBe(true);
        expect(hasActiveFilter({ ...NO_FILTERS, storyIds: ['st1'] })).toBe(true);
        expect(hasActiveFilter({ ...NO_FILTERS, hideDone: true })).toBe(true);
    });

    it('lets the search box find a card by its sprint or story', () => {
        expect(matchesText(task({ sprint_id: 's4', sprint: sprint4 }), 'sprint 4')).toBe(true);
        expect(
            matchesText(task({ userStory: { id: 'st1', code: 'OTB-3', title: 'Take a payment' } }), 'otb-3'),
        ).toBe(true);
    });
});

describe('projectOptionsFrom', () => {
    it('offers each project holding a card once, by name', () => {
        const options = projectOptionsFrom([
            task({ id: 'a', project: { id: 'p2', code: 'BET', name: 'Beta' } }),
            task({ id: 'b', project: { id: 'p1', code: 'ALP', name: 'Alpha' } }),
            task({ id: 'c', project: { id: 'p2', code: 'BET', name: 'Beta' } }),
            task({ id: 'd', project: null }),
        ]);
        expect(options).toEqual([
            { key: 'p1', label: 'Alpha' },
            { key: 'p2', label: 'Beta' },
        ]);
    });
});

describe('sprintOptionsFrom', () => {
    it('offers each sprint holding a card once, the running one first', () => {
        const options = sprintOptionsFrom([
            task({ id: 'a', sprint_id: 's10', sprint: { id: 's10', name: 'Sprint 10', status: 'PLANNED' } }),
            task({ id: 'b', sprint_id: 's9', sprint: { id: 's9', name: 'Sprint 9', status: 'PLANNED' } }),
            task({ id: 'c', sprint_id: 's8', sprint: { id: 's8', name: 'Sprint 8', status: 'ACTIVE' } }),
            task({ id: 'd', sprint_id: 's9', sprint: { id: 's9', name: 'Sprint 9', status: 'PLANNED' } }),
            task({ id: 'e' }),
        ]);
        // Numbers compare as numbers, so Sprint 9 comes before Sprint 10.
        expect(options.map((option) => option.key)).toEqual(['s8', 's9', 's10']);
        expect(options[0]).toEqual({ key: 's8', label: 'Sprint 8', status: 'ACTIVE' });
    });
});

describe('storyOptionsFrom', () => {
    it('offers each story holding a card once, ordered by its code', () => {
        const options = storyOptionsFrom([
            task({ id: 'a', userStory: { id: 'st2', code: 'OTB-10', title: 'Refunds' } }),
            task({ id: 'b', userStory: { id: 'st1', code: 'OTB-2', title: 'Payments' } }),
            task({ id: 'c', userStory: { id: 'st2', code: 'OTB-10', title: 'Refunds' } }),
            task({ id: 'd' }),
        ]);
        // Numeric compare, so OTB-2 comes before OTB-10.
        expect(options).toEqual([
            { key: 'st1', label: 'Payments', code: 'OTB-2' },
            { key: 'st2', label: 'Refunds', code: 'OTB-10' },
        ]);
    });
});

describe('labelOptionsFrom', () => {
    it('offers each label a card actually carries, sorted by name', () => {
        const options = labelOptionsFrom([
            task({ id: 'a', labels: [{ label: blocked }] }),
            task({ id: 'b', labels: [{ label: waiting }, { label: blocked }] }),
            task({ id: 'c' }),
        ]);
        expect(options).toEqual([blocked, waiting]);
    });

    it('leaves out a tenant label nobody on the board carries', () => {
        expect(labelOptionsFrom([task({ id: 'a', labels: [{ label: blocked }] })])).toEqual([blocked]);
    });
});

describe('cardsMatching', () => {
    // A tick's count has to say what ticking it would add, so the count for one
    // dimension ignores the choice already made in it.
    it('ignores the dimension it is counting', () => {
        const cards = [
            task({ id: 'a', priority: 'URGENT' }),
            task({ id: 'b', priority: 'HIGH' }),
            task({ id: 'c', priority: 'LOW' }),
        ];
        const filters = { ...NO_FILTERS, priorities: ['LOW'] };
        // Narrowed by priority, only the low one survives...
        expect(cards.filter((card) => matchesFilters(card, filters)).map((card) => card.id)).toEqual(['c']);
        // ...but counting the priority options against everything else keeps all
        // three, so ticking "Urgent" still reads as one card.
        expect(cardsMatching(cards, filters, 'priority').map((card) => card.id)).toEqual(['a', 'b', 'c']);
    });
});

describe('label helpers', () => {
    it('unwraps the join rows the API returns', () => {
        expect(labelsOf(task({ labels: [{ label: blocked }] }))).toEqual([blocked]);
    });

    it('treats a task with no labels as having none', () => {
        expect(labelsOf(task())).toEqual([]);
    });

    // A template like `bg-${color}-100` produces no CSS, because Tailwind scans
    // source text. Every colour must resolve to a class string written out.
    it('maps every colour in the palette to a written-out class pair', () => {
        for (const color of LABEL_COLORS) {
            expect(labelClass(color)).toMatch(/^bg-[a-z]+-100 text-[a-z]+-700$/);
        }
    });

    it('falls back to grey for a colour it does not know', () => {
        expect(labelClass(undefined)).toBe(labelClass('GRAY'));
        expect(labelClass('CHARTREUSE')).toBe(labelClass('GRAY'));
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
        const result = applyFilters(columns, { ...NO_FILTERS, priorities: ['URGENT'] });

        // Dropping an empty column would make the board's shape change as you
        // type, and you could no longer drop a card into it.
        expect(result).toHaveLength(2);
        expect(result[0].tasks.map((t) => t.id)).toEqual(['a']);
        expect(result[1].tasks).toEqual([]);
    });

    // A card just composed stays where it was typed, match or not.
    it('lets a kept card through a filter it does not match, and only that one', () => {
        const columns = [
            column([
                task({ id: 'a', priority: 'URGENT' }),
                task({ id: 'b', priority: 'LOW' }),
                task({ id: 'new', priority: 'MEDIUM' }),
            ]),
        ];
        const result = applyFilters(columns, { ...NO_FILTERS, priorities: ['URGENT'] }, new Set(['new']));

        expect(result[0].tasks.map((t) => t.id)).toEqual(['a', 'new']);
    });
});

describe('isOverWip', () => {
    const withCount = (n: number, wip: number | null) => ({
        id: 'todo',
        name: 'To do',
        category: 'TODO',
        wip_limit: wip,
        tasks: Array.from({ length: n }, (_, i) => task({ id: `t${i}` })),
    });

    it('is false when the column has no limit', () => {
        expect(isOverWip(withCount(50, null))).toBe(false);
    });

    it('is false at the limit and true above it', () => {
        expect(isOverWip(withCount(3, 3))).toBe(false);
        expect(isOverWip(withCount(4, 3))).toBe(true);
    });

    it('is false for a column that is not there', () => {
        expect(isOverWip(undefined)).toBe(false);
    });
});

describe('coverClass', () => {
    it('is null when there is no cover, so nothing renders', () => {
        expect(coverClass(null)).toBeNull();
        expect(coverClass(undefined)).toBeNull();
    });

    // Same reason as the label classes: Tailwind scans source text, so every
    // colour has to resolve to a class written out in full.
    it('maps every palette colour to a written-out class', () => {
        for (const color of LABEL_COLORS) {
            expect(coverClass(color)).toMatch(/^bg-[a-z]+-\d00$/);
        }
    });

    it('is null for a colour it does not know, rather than an empty class', () => {
        expect(coverClass('CHARTREUSE')).toBeNull();
    });
});

describe('projectLabelOf', () => {
    it('prefers the short name — that is what the field is for', () => {
        expect(
            projectLabelOf({ id: 'p1', code: 'PRJ-0001', name: 'Gulshan fit-out', short_name: 'Gulshan' }),
        ).toBe('Gulshan');
    });

    it('falls back to the code, which every project has', () => {
        expect(projectLabelOf({ id: 'p1', code: 'PRJ-0001', name: 'Gulshan fit-out' })).toBe('PRJ-0001');
        expect(
            projectLabelOf({ id: 'p1', code: 'PRJ-0001', name: 'Gulshan fit-out', short_name: '   ' }),
        ).toBe('PRJ-0001');
    });

    it('is null without a project, so the card renders nothing rather than a stray dash', () => {
        expect(projectLabelOf(null)).toBeNull();
        expect(projectLabelOf(undefined)).toBeNull();
    });
});

describe('text search', () => {
    const card = (overrides: Partial<BoardTask> = {}) =>
        task({
            title: 'Fix the login screen',
            description: 'The OTP field rejects a leading zero',
            project: { id: 'p1', code: 'ALP', name: 'Alpha Rollout', short_name: 'ALPHA' },
            assignee: { id: 'u1', name: 'Rahim Uddin', email: 'rahim@example.com' },
            labels: [{ label: blocked }],
            ...overrides,
        });

    it('matches nothing in particular when the box is empty', () => {
        expect(matchesText(card(), '')).toBe(true);
        expect(matchesText(card(), '   ')).toBe(true);
    });

    it('matches the title, ignoring case', () => {
        expect(matchesText(card(), 'LOGIN')).toBe(true);
        expect(matchesText(card(), 'logout')).toBe(false);
    });

    it('reaches the description, which the card may not even be showing', () => {
        expect(matchesText(card(), 'leading zero')).toBe(true);
    });

    it('reaches the project by code, short name and full name', () => {
        expect(matchesText(card(), 'alp')).toBe(true);
        expect(matchesText(card(), 'alpha')).toBe(true);
        expect(matchesText(card(), 'rollout')).toBe(true);
    });

    it('reaches the assignee and the labels', () => {
        expect(matchesText(card(), 'rahim')).toBe(true);
        expect(matchesText(card(), 'blocked')).toBe(true);
    });

    it('requires every word, in any field and any order', () => {
        // The point of splitting: "login alp" is the login card in ALP, and no
        // single field contains that string.
        expect(matchesText(card(), 'login alp')).toBe(true);
        expect(matchesText(card(), 'alp login')).toBe(true);
        expect(matchesText(card(), 'login beta')).toBe(false);
    });

    it('narrows the board through matchesFilters, alongside the other filters', () => {
        expect(matchesFilters(card(), { ...NO_FILTERS, text: 'login' })).toBe(true);
        expect(matchesFilters(card(), { ...NO_FILTERS, text: 'login', priorities: ['URGENT'] })).toBe(
            false,
        );
        expect(hasActiveFilter({ ...NO_FILTERS, text: 'login' })).toBe(true);
        // Whitespace alone is not a filter: it must not turn on the "showing x
        // of y" line or the Clear button.
        expect(hasActiveFilter({ ...NO_FILTERS, text: '  ' })).toBe(false);
    });
});

describe('sortCards', () => {
    const named = (id: string, overrides: Partial<BoardTask> = {}) =>
        task({ id, title: id, ...overrides });

    it('puts the earliest due date first and the undated last', () => {
        const cards = [
            named('none'),
            named('later', { due_date: '2026-10-01T00:00:00.000Z' }),
            named('sooner', { due_date: '2026-09-01T00:00:00.000Z' }),
        ];

        expect(sortCards(cards, 'due').map((c) => c.id)).toEqual(['sooner', 'later', 'none']);
    });

    it('puts the most urgent first, whatever order the priorities arrived in', () => {
        const cards = [
            named('low', { priority: 'LOW' }),
            named('urgent', { priority: 'URGENT' }),
            named('medium', { priority: 'MEDIUM' }),
            named('high', { priority: 'HIGH' }),
        ];

        expect(sortCards(cards, 'priority').map((c) => c.id)).toEqual([
            'urgent',
            'high',
            'medium',
            'low',
        ]);
    });

    it('sorts by title and by assignee, unassigned last', () => {
        const cards = [
            task({ id: 'b', title: 'Beta' }),
            task({ id: 'a', title: 'Alpha' }),
        ];
        expect(sortCards(cards, 'title').map((c) => c.id)).toEqual(['a', 'b']);

        const holders = [
            named('nobody'),
            named('zara', { assignee: { id: 'u2', name: 'Zara', email: 'z@x' } }),
            named('amina', { assignee: { id: 'u1', name: 'Amina', email: 'a@x' } }),
        ];
        expect(sortCards(holders, 'assignee').map((c) => c.id)).toEqual([
            'amina',
            'zara',
            'nobody',
        ]);
    });

    it('keeps ties in the order they were already in, and leaves the input alone', () => {
        const cards = [named('first'), named('second'), named('third')];
        const sorted = sortCards(cards, 'priority');

        expect(sorted.map((c) => c.id)).toEqual(['first', 'second', 'third']);
        // The caller renders the board from its own state until the server
        // answers, so a sort that mutated the array would move cards twice.
        expect(cards.map((c) => c.id)).toEqual(['first', 'second', 'third']);
        expect(sorted).not.toBe(cards);
    });

    it('has a comparison for every sort it offers', () => {
        for (const key of CARD_SORTS) {
            expect(() => sortCards([named('a'), named('b')], key)).not.toThrow();
        }
    });
});
