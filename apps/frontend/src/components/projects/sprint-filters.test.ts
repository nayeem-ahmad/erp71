import {
    composerAssigneeKey,
    EMPTY_SPRINT_FILTERS,
    filterSprintTasks,
    parseSprintFilters,
    sprintFiltersToQuery,
    taskMatchesSprintFilters,
    weekBounds,
    type SprintFilterState,
} from './sprint-filters';
import type { SprintCardTask } from './sprint-cards';

const TODAY = '2026-08-05';
const ctx = { today: TODAY, userId: 'me' };

const task = (overrides: Partial<SprintCardTask> = {}): SprintCardTask => ({
    id: overrides.id ?? 't',
    title: 'Wire the callback',
    project: { id: 'p1', code: 'OTB', name: 'Online' },
    status: { id: 'doing', name: 'Doing', category: 'IN_PROGRESS' },
    priority: 'MEDIUM',
    estimate_hours: 8,
    logged_hours: 2,
    due_date: '2026-08-06',
    updated_at: '2026-08-05T06:00:00.000Z',
    reference: 14,
    carried_in: false,
    ...overrides,
});

const filters = (overrides: Partial<SprintFilterState> = {}): SprintFilterState => ({
    ...EMPTY_SPRINT_FILTERS,
    ...overrides,
});

describe('sprint filter query', () => {
    it('round-trips a full set and drops values the page does not understand', () => {
        const state = filters({
            q: 'bkash',
            assignee: ['me', 'unassigned', 'user:u1'],
            status: ['doing'],
            hideDone: true,
            priority: ['HIGH', 'NOPE'],
            due: ['overdue', 'week'],
            dueFrom: '2026-08-01',
            dueTo: '2026-08-09',
            time: ['over', 'none'],
            hours: { op: 'between', value: 1, to: 8 },
            labels: ['lab-1'],
            carried: 'yes',
            updated: ['d7'],
            updatedFrom: '2026-07-01',
            updatedTo: '2026-07-20',
        });
        // priority is validated on the way in, not on the way out — the control only offers the four.
        const params = new URLSearchParams(sprintFiltersToQuery(new URLSearchParams('story=s1'), state));
        expect(params.get('story')).toBe('s1');
        const parsed = parseSprintFilters(params);
        expect(parsed.priority).toEqual(['HIGH']);
        expect(parsed.q).toBe('bkash');
        expect(parsed.assignee).toEqual(['me', 'unassigned', 'user:u1']);
        expect(parsed.hideDone).toBe(true);
        expect(parsed.hours).toEqual({ op: 'between', value: 1, to: 8 });
        expect(parsed.carried).toBe('yes');
        expect(sprintFiltersToQuery(new URLSearchParams(), parsed)).toBe(
            sprintFiltersToQuery(new URLSearchParams(), { ...state, priority: ['HIGH'] }),
        );
    });

    it('ignores a malformed day and an unknown preset', () => {
        const parsed = parseSprintFilters(new URLSearchParams('due=tomorrow&dueFrom=August&hideDone=0&carried=maybe'));
        expect(parsed).toEqual(EMPTY_SPRINT_FILTERS);
    });
});

describe('weekBounds', () => {
    it('runs Monday to Sunday, including a Sunday', () => {
        expect(weekBounds('2026-08-05')).toEqual({ from: '2026-08-03', to: '2026-08-09' });
        expect(weekBounds('2026-08-02')).toEqual({ from: '2026-07-27', to: '2026-08-02' });
    });
});

describe('taskMatchesSprintFilters', () => {
    const rows = [
        task({ id: 'mine', assignee: { id: 'me', name: 'Nayeem', email: 'n@x' }, priority: 'HIGH' }),
        task({
            id: 'open',
            assignee: null,
            priority: 'LOW',
            logged_hours: 0,
            estimate_hours: null,
            due_date: '2026-08-01',
            status: { id: 'todo', name: 'To do', category: 'TODO' },
            labels: [{ label: { id: 'lab-1', name: 'Backend', color: 'BLUE' } }],
            carried_in: true,
            updated_at: '2026-07-20T06:00:00.000Z',
        }),
        task({
            id: 'done',
            title: 'Shipped',
            status: { id: 'done', name: 'Done', category: 'DONE' },
            due_date: '2026-08-01',
            logged_hours: 12,
            assignee: { id: 'u2', name: 'Rahim', email: 'r@x' },
        }),
    ];

    it('matches assignee as Me, a person, or unassigned', () => {
        expect(filterSprintTasks(rows, filters({ assignee: ['me'] }), ctx).map((row) => row.id)).toEqual(['mine']);
        expect(filterSprintTasks(rows, filters({ assignee: ['unassigned'] }), ctx).map((row) => row.id)).toEqual(['open']);
        expect(filterSprintTasks(rows, filters({ assignee: ['me', 'user:u2'] }), ctx).map((row) => row.id)).toEqual([
            'mine',
            'done',
        ]);
    });

    it('matches any chosen status and can hide Done on top', () => {
        expect(filterSprintTasks(rows, filters({ status: ['to do', 'done'] }), ctx).map((row) => row.id)).toEqual([
            'open',
            'done',
        ]);
        expect(filterSprintTasks(rows, filters({ status: ['done'], hideDone: true }), ctx)).toEqual([]);
        expect(filterSprintTasks(rows, filters({ hideDone: true }), ctx).map((row) => row.id)).toEqual(['mine', 'open']);
    });

    it('treats due presets and a custom range as alternatives', () => {
        expect(filterSprintTasks(rows, filters({ due: ['overdue'] }), ctx).map((row) => row.id)).toEqual(['open']);
        expect(filterSprintTasks(rows, filters({ due: ['today'] }), ctx)).toEqual([]);
        expect(filterSprintTasks(rows, filters({ due: ['week'] }), ctx).map((row) => row.id)).toEqual(['mine']);
        // Done and dated in the past is not overdue.
        expect(taskMatchesSprintFilters(rows[2], filters({ due: ['overdue'] }), ctx)).toBe(false);
        expect(
            filterSprintTasks(rows, filters({ due: ['overdue'], dueFrom: '2026-08-06', dueTo: '2026-08-06' }), ctx).map(
                (row) => row.id,
            ),
        ).toEqual(['mine', 'open']);
    });

    it('matches time against the estimate, and a logged-hours range on its own', () => {
        expect(filterSprintTasks(rows, filters({ time: ['none', 'over'] }), ctx).map((row) => row.id)).toEqual([
            'open',
            'done',
        ]);
        expect(filterSprintTasks(rows, filters({ time: ['no-estimate'] }), ctx).map((row) => row.id)).toEqual(['open']);
        expect(filterSprintTasks(rows, filters({ hours: { op: 'gt', value: 10 } }), ctx).map((row) => row.id)).toEqual([
            'done',
        ]);
        expect(
            filterSprintTasks(rows, filters({ time: ['over'], hours: { op: 'lt', value: 5 } }), ctx),
        ).toEqual([]);
    });

    it('matches labels, carry-in, and a stale update or a date it changed', () => {
        expect(filterSprintTasks(rows, filters({ labels: ['lab-1'] }), ctx).map((row) => row.id)).toEqual(['open']);
        expect(filterSprintTasks(rows, filters({ carried: 'yes' }), ctx).map((row) => row.id)).toEqual(['open']);
        expect(filterSprintTasks(rows, filters({ carried: 'no' }), ctx).map((row) => row.id)).toEqual(['mine', 'done']);
        expect(filterSprintTasks(rows, filters({ updated: ['d7'] }), ctx).map((row) => row.id)).toEqual(['open']);
        expect(filterSprintTasks(rows, filters({ updated: ['d2'] }), ctx).map((row) => row.id)).toEqual(['open']);
        expect(
            filterSprintTasks(rows, filters({ updatedFrom: '2026-08-05', updatedTo: '2026-08-05' }), ctx).map(
                (row) => row.id,
            ),
        ).toEqual(['mine', 'done']);
    });

    it('searches the title, the key and the description together', () => {
        const described = task({ id: 'key', description: 'Nagad refund path', reference: 14 });
        expect(taskMatchesSprintFilters(described, filters({ q: 'otb-14 nagad' }), ctx)).toBe(true);
        expect(taskMatchesSprintFilters(described, filters({ q: 'nothing-like-this' }), ctx)).toBe(false);
    });

    it('counts a facet without the dimension being counted', () => {
        const base = filterSprintTasks(rows, filters({ priority: ['HIGH'], hideDone: true }), ctx, 'priority');
        expect(base.map((row) => row.id)).toEqual(['mine', 'open']);
    });
});

describe('composerAssigneeKey', () => {
    it('follows a single person, leaves unassigned alone, and otherwise uses me', () => {
        expect(composerAssigneeKey(['user:u2'], 'me')).toBe('user:u2');
        expect(composerAssigneeKey(['me'], 'me')).toBe('user:me');
        expect(composerAssigneeKey(['unassigned'], 'me')).toBe('');
        expect(composerAssigneeKey(['user:u2', 'user:u3'], 'me')).toBe('user:me');
        expect(composerAssigneeKey([], null)).toBe('');
    });
});
