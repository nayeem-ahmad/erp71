import { act, renderHook } from '@testing-library/react';
import { boardFiltersKey, readStoredFilters } from './board-filter-storage';
import { NO_FILTERS, type BoardFilters } from './board-tasks';
import { useBoardFilters } from './use-board-filters';

const options = (
    assignees: string[] = [],
    labels: string[] = [],
    projects: string[] = ['p1'],
    sprints: string[] = ['s1'],
) => ({
    assignees: new Set(assignees),
    labels: new Set(labels),
    projects: new Set(projects),
    sprints: new Set(sprints),
});

/**
 * Renders the hook the way the page does: `ready` false until the cards and
 * labels are in, and a fresh `available` object every render.
 */
function setup(boardId = 'b1', ready = true, avail = options(['u1'], ['l1'])) {
    return renderHook(
        ({ id, isReady }: { id: string; isReady: boolean }) =>
            useBoardFilters(id, isReady, avail),
        { initialProps: { id: boardId, isReady: ready } },
    );
}

beforeEach(() => {
    localStorage.clear();
});

describe('useBoardFilters', () => {
    it('opens unfiltered when nothing is remembered', () => {
        const { result } = setup();
        expect(result.current.filters).toEqual(NO_FILTERS);
    });

    it('restores the filters the last visit left behind', () => {
        localStorage.setItem(
            boardFiltersKey('b1'),
            JSON.stringify({ assignee: 'u1', priority: 'HIGH', due: 'overdue', label: 'l1' }),
        );

        const { result } = setup();
        expect(result.current.filters).toEqual({
            assignee: 'u1',
            priority: 'HIGH',
            due: 'overdue',
            label: 'l1',
            project: 'all',
            sprint: 'all',
            text: '',
        });
    });

    it('remembers the project and sprint filters too', () => {
        const { result, unmount } = setup();
        act(() => result.current.setFilters({ ...NO_FILTERS, project: 'p1', sprint: 's1' }));
        unmount();

        const again = setup();
        expect(again.result.current.filters.project).toBe('p1');
        expect(again.result.current.filters.sprint).toBe('s1');
    });

    it('drops a remembered sprint no card here is in any more', () => {
        localStorage.setItem(boardFiltersKey('b1'), JSON.stringify({ sprint: 'gone' }));

        const { result } = setup();
        expect(result.current.filters.sprint).toBe('all');
    });

    it('never restores the search box', () => {
        // A restored query reads as a board that has lost most of its cards,
        // and the string explaining why is easy to miss in a header row.
        localStorage.setItem(
            boardFiltersKey('b1'),
            JSON.stringify({ ...NO_FILTERS, priority: 'HIGH', text: 'login' }),
        );

        const { result } = setup();
        expect(result.current.filters.text).toBe('');
        expect(result.current.filters.priority).toBe('HIGH');
    });

    it('holds the defaults until the board and labels are in', () => {
        localStorage.setItem(boardFiltersKey('b1'), JSON.stringify({ assignee: 'u1' }));

        const { result, rerender } = setup('b1', false);
        expect(result.current.filters).toEqual(NO_FILTERS);

        rerender({ id: 'b1', isReady: true });
        expect(result.current.filters.assignee).toBe('u1');
    });

    it('drops a remembered assignee who no longer holds a card, and forgets it', () => {
        localStorage.setItem(boardFiltersKey('b1'), JSON.stringify({ assignee: 'gone' }));

        const { result } = setup('b1', true, options(['u1'], ['l1']));
        expect(result.current.filters.assignee).toBe('all');
        // Rewritten, so the dead id is not pruned again on every future visit.
        expect(readStoredFilters('b1').assignee).toBe('all');
    });

    it('writes each change straight through', () => {
        const { result } = setup();
        const next: BoardFilters = { ...NO_FILTERS, priority: 'HIGH', text: 'login' };

        act(() => result.current.setFilters(next));

        expect(result.current.filters).toEqual(next);
        expect(readStoredFilters('b1').priority).toBe('HIGH');
    });

    it('forgets the board once the filters are cleared', () => {
        localStorage.setItem(boardFiltersKey('b1'), JSON.stringify({ priority: 'HIGH' }));
        const { result } = setup();

        act(() => result.current.setFilters(NO_FILTERS));

        expect(localStorage.getItem(boardFiltersKey('b1'))).toBeNull();
    });

    it('does not put cleared filters back when the board reloads', () => {
        // A bulk move answers with the whole board, so `ready` flips false and
        // true again mid-visit. The restore must not run a second time.
        localStorage.setItem(boardFiltersKey('b1'), JSON.stringify({ priority: 'HIGH' }));
        const { result, rerender } = setup();
        expect(result.current.filters.priority).toBe('HIGH');

        act(() => result.current.setFilters(NO_FILTERS));
        rerender({ id: 'b1', isReady: false });
        rerender({ id: 'b1', isReady: true });

        expect(result.current.filters.priority).toBe('all');
    });

    it('re-reads when the reader moves to another board', () => {
        localStorage.setItem(boardFiltersKey('b2'), JSON.stringify({ priority: 'LOW' }));

        const { result, rerender } = setup();
        expect(result.current.filters.priority).toBe('all');

        rerender({ id: 'b2', isReady: true });
        expect(result.current.filters.priority).toBe('LOW');
    });
});
