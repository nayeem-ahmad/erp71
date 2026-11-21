import {
    boardFiltersKey,
    hasStoredFilter,
    MAX_REMEMBERED_BOARDS,
    mergeStoredFilters,
    pruneMissingOptions,
    readStoredFilters,
    writeStoredFilters,
    type StoredBoardFilters,
} from './board-filter-storage';

const NONE: StoredBoardFilters = {
    assignees: [],
    statusCategories: [],
    hideDone: false,
    priorities: [],
    due: [],
    dueFrom: '',
    dueTo: '',
    projectIds: [],
    sprintIds: [],
    storyIds: [],
    labelIds: [],
    time: [],
    hours: null,
    updated: [],
    updatedFrom: '',
    updatedTo: '',
    createdFrom: '',
    createdTo: '',
};

const options = (
    assignees: string[] = [],
    labels: string[] = [],
    projects: string[] = [],
    sprints: string[] = [],
    stories: string[] = [],
) => ({
    assignees: new Set(assignees),
    labels: new Set(labels),
    projects: new Set(projects),
    sprints: new Set(sprints),
    stories: new Set(stories),
});

beforeEach(() => {
    localStorage.clear();
});

describe('mergeStoredFilters', () => {
    it('falls back to no filter for anything that is not an object', () => {
        expect(mergeStoredFilters(null)).toEqual(NONE);
        expect(mergeStoredFilters('overdue')).toEqual(NONE);
        expect(mergeStoredFilters(['overdue'])).toEqual(NONE);
    });

    it('keeps the filters a stored entry does carry', () => {
        expect(mergeStoredFilters({ assignees: ['u1'], due: ['overdue'] })).toEqual({
            ...NONE,
            assignees: ['u1'],
            due: ['overdue'],
        });
    });

    it('drops a due value outside the option list rather than passing it on', () => {
        // Otherwise the filter takes an unknown string down its final branch and
        // the chip shows nothing, so nothing on screen explains the missing cards.
        expect(mergeStoredFilters({ due: ['next-decade'] }).due).toEqual([]);
        expect(mergeStoredFilters({ due: 7 }).due).toEqual([]);
        expect(mergeStoredFilters({ due: ['overdue', 'nope'] }).due).toEqual(['overdue']);
    });

    it('keeps a stored project, sprint and story', () => {
        expect(
            mergeStoredFilters({ projectIds: ['p1'], sprintIds: ['none'], storyIds: ['st1'] }),
        ).toEqual({ ...NONE, projectIds: ['p1'], sprintIds: ['none'], storyIds: ['st1'] });
    });

    it('reads a well-formed hours condition and drops a malformed one', () => {
        expect(mergeStoredFilters({ hours: { op: 'gt', value: 4 } }).hours).toEqual({ op: 'gt', value: 4 });
        // `between` with no upper end is filled from the lower one rather than
        // left half-built.
        expect(mergeStoredFilters({ hours: { op: 'between', value: 2 } }).hours).toEqual({
            op: 'between',
            value: 2,
            to: 2,
        });
        expect(mergeStoredFilters({ hours: { op: 'sideways', value: 1 } }).hours).toBeNull();
        expect(mergeStoredFilters({ hours: { op: 'gt', value: 'four' } }).hours).toBeNull();
    });

    it('accepts only days for the date bounds', () => {
        expect(mergeStoredFilters({ dueFrom: '2026-05-01T10:00:00.000Z' }).dueFrom).toBe('2026-05-01');
        expect(mergeStoredFilters({ dueFrom: 'soon' }).dueFrom).toBe('');
    });

    it('ignores non-string and empty ids', () => {
        expect(mergeStoredFilters({ assignees: [42, ''], priorities: [], labelIds: null })).toEqual(NONE);
    });

    it('keeps only the closed-set values it recognises', () => {
        expect(mergeStoredFilters({ statusCategories: ['DONE', 'NOPE'], time: ['over', 'x'] })).toEqual({
            ...NONE,
            statusCategories: ['DONE'],
            time: ['over'],
        });
    });
});

describe('hasStoredFilter', () => {
    it('is false when nothing is narrowed', () => {
        expect(hasStoredFilter(NONE)).toBe(false);
    });

    it('is true for any one filter', () => {
        expect(hasStoredFilter({ ...NONE, priorities: ['HIGH'] })).toBe(true);
        expect(hasStoredFilter({ ...NONE, labelIds: ['none'] })).toBe(true);
        expect(hasStoredFilter({ ...NONE, projectIds: ['p1'] })).toBe(true);
        expect(hasStoredFilter({ ...NONE, sprintIds: ['none'] })).toBe(true);
        expect(hasStoredFilter({ ...NONE, storyIds: ['st1'] })).toBe(true);
        expect(hasStoredFilter({ ...NONE, hideDone: true })).toBe(true);
        expect(hasStoredFilter({ ...NONE, hours: { op: 'gt', value: 1 } })).toBe(true);
        expect(hasStoredFilter({ ...NONE, createdFrom: '2026-01-01' })).toBe(true);
    });
});

describe('read/write', () => {
    it('round-trips a board’s filters', () => {
        writeStoredFilters('b1', { ...NONE, assignees: ['u1'], due: ['overdue'], sprintIds: ['s1'] });
        expect(readStoredFilters('b1')).toEqual({ ...NONE, assignees: ['u1'], due: ['overdue'], sprintIds: ['s1'] });
    });

    it('keeps each board’s filters apart', () => {
        // The whole reason this is keyed per board: `u1` may hold no card on
        // b2, and restoring it there would empty a board nobody filtered.
        writeStoredFilters('b1', { ...NONE, assignees: ['u1'] });
        expect(readStoredFilters('b2')).toEqual(NONE);
    });

    it('clears the entry when the filters are cleared', () => {
        writeStoredFilters('b1', { ...NONE, priorities: ['HIGH'] });
        writeStoredFilters('b1', NONE);
        expect(localStorage.getItem(boardFiltersKey('b1'))).toBeNull();
        expect(readStoredFilters('b1')).toEqual(NONE);
    });

    it('reads an unwritable or corrupt entry as no filter', () => {
        localStorage.setItem(boardFiltersKey('b1'), '{not json');
        expect(readStoredFilters('b1')).toEqual(NONE);
    });

    it('drops the least recently written board once the cap is passed', () => {
        const now = jest.spyOn(Date, 'now');
        for (let i = 0; i < MAX_REMEMBERED_BOARDS + 3; i += 1) {
            now.mockReturnValue(1_000 + i);
            writeStoredFilters(`b${i}`, { ...NONE, priorities: ['HIGH'] });
        }
        now.mockRestore();

        // The three oldest are gone; the newest and the cap boundary remain.
        expect(localStorage.getItem(boardFiltersKey('b0'))).toBeNull();
        expect(localStorage.getItem(boardFiltersKey('b2'))).toBeNull();
        expect(localStorage.getItem(boardFiltersKey('b3'))).not.toBeNull();
        expect(readStoredFilters(`b${MAX_REMEMBERED_BOARDS + 2}`).priorities).toEqual(['HIGH']);
    });

    it('leaves unrelated storage alone when pruning', () => {
        localStorage.setItem('board-view', '{"density":"compact"}');
        for (let i = 0; i < MAX_REMEMBERED_BOARDS + 2; i += 1) {
            writeStoredFilters(`b${i}`, { ...NONE, priorities: ['HIGH'] });
        }
        expect(localStorage.getItem('board-view')).toBe('{"density":"compact"}');
    });
});

describe('pruneMissingOptions', () => {
    it('keeps a filter whose option is still on the board', () => {
        const filters = { ...NONE, assignees: ['u1'], labelIds: ['l1'] };
        expect(pruneMissingOptions(filters, options(['u1'], ['l1']))).toEqual(filters);
    });

    it('drops an assignee who no longer holds a card here', () => {
        // The chip would otherwise show a filter over an empty board.
        const pruned = pruneMissingOptions({ ...NONE, assignees: ['gone'] }, options(['u1'], []));
        expect(pruned.assignees).toEqual([]);
    });

    it('keeps the ones that still name someone, dropping only the dead id', () => {
        const pruned = pruneMissingOptions(
            { ...NONE, assignees: ['u1', 'gone'] },
            options(['u1']),
        );
        expect(pruned.assignees).toEqual(['u1']);
    });

    it('drops a label that has been deleted', () => {
        const pruned = pruneMissingOptions({ ...NONE, labelIds: ['gone'] }, options([], ['l1']));
        expect(pruned.labelIds).toEqual([]);
    });

    it('drops a project that no longer has a card here', () => {
        const pruned = pruneMissingOptions({ ...NONE, projectIds: ['gone'] }, options([], [], ['p1']));
        expect(pruned.projectIds).toEqual([]);
    });

    it('drops a story no card here carries any more', () => {
        const pruned = pruneMissingOptions({ ...NONE, storyIds: ['gone'] }, options([], [], [], [], ['st1']));
        expect(pruned.storyIds).toEqual([]);
    });

    it('drops a sprint no card here is in any more, but keeps "no sprint"', () => {
        expect(pruneMissingOptions({ ...NONE, sprintIds: ['gone'] }, options([], [], [], ['s1'])).sprintIds).toEqual(
            [],
        );
        expect(pruneMissingOptions({ ...NONE, sprintIds: ['none'] }, options()).sprintIds).toEqual(['none']);
    });

    it('keeps a project and sprint still on the board', () => {
        const filters = { ...NONE, projectIds: ['p1'], sprintIds: ['s1'] };
        expect(pruneMissingOptions(filters, options([], [], ['p1'], ['s1']))).toEqual(filters);
    });

    it('keeps "unassigned" and "no label", which name no id', () => {
        const filters = { ...NONE, assignees: ['unassigned'], labelIds: ['none'] };
        expect(pruneMissingOptions(filters, options())).toEqual(filters);
    });

    it('always keeps "me", which names whoever is signed in', () => {
        expect(pruneMissingOptions({ ...NONE, assignees: ['me'] }, options()).assignees).toEqual(['me']);
    });

    it('leaves the closed-set filters alone', () => {
        const pruned = pruneMissingOptions(
            { ...NONE, priorities: ['HIGH'], due: ['overdue'], assignees: ['gone'], hideDone: true },
            options(),
        );
        expect(pruned.priorities).toEqual(['HIGH']);
        expect(pruned.due).toEqual(['overdue']);
        expect(pruned.hideDone).toBe(true);
    });
});
