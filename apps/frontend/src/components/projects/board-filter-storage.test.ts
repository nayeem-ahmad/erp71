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
    assignee: 'all',
    priority: 'all',
    due: 'all',
    label: 'all',
};

const options = (assignees: string[] = [], labels: string[] = []) => ({
    assignees: new Set(assignees),
    labels: new Set(labels),
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
        expect(mergeStoredFilters({ assignee: 'u1', due: 'overdue' })).toEqual({
            ...NONE,
            assignee: 'u1',
            due: 'overdue',
        });
    });

    it('drops a due value outside the option list rather than passing it on', () => {
        // Otherwise `matchesDue` takes an unknown string down its final branch
        // and the select shows "Due", so nothing on screen explains the
        // missing cards.
        expect(mergeStoredFilters({ due: 'next-decade' }).due).toBe('all');
        expect(mergeStoredFilters({ due: 7 }).due).toBe('all');
    });

    it('ignores non-string and empty ids', () => {
        expect(mergeStoredFilters({ assignee: 42, label: '', priority: null })).toEqual(NONE);
    });
});

describe('hasStoredFilter', () => {
    it('is false when nothing is narrowed', () => {
        expect(hasStoredFilter(NONE)).toBe(false);
    });

    it('is true for any one filter', () => {
        expect(hasStoredFilter({ ...NONE, priority: 'HIGH' })).toBe(true);
        expect(hasStoredFilter({ ...NONE, label: 'none' })).toBe(true);
    });
});

describe('read/write', () => {
    it('round-trips a board’s filters', () => {
        writeStoredFilters('b1', { ...NONE, assignee: 'u1', due: 'overdue' });
        expect(readStoredFilters('b1')).toEqual({ ...NONE, assignee: 'u1', due: 'overdue' });
    });

    it('keeps each board’s filters apart', () => {
        // The whole reason this is keyed per board: `u1` may hold no card on
        // b2, and restoring it there would empty a board nobody filtered.
        writeStoredFilters('b1', { ...NONE, assignee: 'u1' });
        expect(readStoredFilters('b2')).toEqual(NONE);
    });

    it('clears the entry when the filters are cleared', () => {
        writeStoredFilters('b1', { ...NONE, priority: 'HIGH' });
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
            writeStoredFilters(`b${i}`, { ...NONE, priority: 'HIGH' });
        }
        now.mockRestore();

        // The three oldest are gone; the newest and the cap boundary remain.
        expect(localStorage.getItem(boardFiltersKey('b0'))).toBeNull();
        expect(localStorage.getItem(boardFiltersKey('b2'))).toBeNull();
        expect(localStorage.getItem(boardFiltersKey('b3'))).not.toBeNull();
        expect(readStoredFilters(`b${MAX_REMEMBERED_BOARDS + 2}`).priority).toBe('HIGH');
    });

    it('leaves unrelated storage alone when pruning', () => {
        localStorage.setItem('board-view', '{"density":"compact"}');
        for (let i = 0; i < MAX_REMEMBERED_BOARDS + 2; i += 1) {
            writeStoredFilters(`b${i}`, { ...NONE, priority: 'HIGH' });
        }
        expect(localStorage.getItem('board-view')).toBe('{"density":"compact"}');
    });
});

describe('pruneMissingOptions', () => {
    it('keeps a filter whose option is still on the board', () => {
        const filters = { ...NONE, assignee: 'u1', label: 'l1' };
        expect(pruneMissingOptions(filters, options(['u1'], ['l1']))).toEqual(filters);
    });

    it('drops an assignee who no longer holds a card here', () => {
        // The select would otherwise show "Assignee" over an empty board.
        const pruned = pruneMissingOptions({ ...NONE, assignee: 'gone' }, options(['u1'], []));
        expect(pruned.assignee).toBe('all');
    });

    it('drops a label that has been deleted', () => {
        const pruned = pruneMissingOptions({ ...NONE, label: 'gone' }, options([], ['l1']));
        expect(pruned.label).toBe('all');
    });

    it('keeps "unassigned" and "no label", which name no id', () => {
        const filters = { ...NONE, assignee: 'none', label: 'none' };
        expect(pruneMissingOptions(filters, options())).toEqual(filters);
    });

    it('leaves the closed-set filters alone', () => {
        const pruned = pruneMissingOptions(
            { ...NONE, priority: 'HIGH', due: 'overdue', assignee: 'gone' },
            options(),
        );
        expect(pruned.priority).toBe('HIGH');
        expect(pruned.due).toBe('overdue');
    });
});
