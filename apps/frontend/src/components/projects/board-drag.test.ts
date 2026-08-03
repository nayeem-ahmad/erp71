import {
    CARD_ATTR,
    COLUMN_ATTR,
    DRAG_THRESHOLD_PX,
    movedFar,
    resolveDropTarget,
    toFullIndex,
} from './board-drag';
import type { BoardColumn, BoardTask } from './board-tasks';

const task = (id: string): BoardTask => ({
    id,
    title: id,
    priority: 'MEDIUM',
    status_id: 'todo',
});

/**
 * jsdom has no layout, so every rect is zero. Building the column by hand and
 * stamping rects on it is the only way to exercise the midpoint rule — which is
 * exactly why this geometry lives outside the component.
 */
function buildColumn(columnId: string, cardIds: string[], cardHeight = 40): HTMLElement {
    const columnEl = document.createElement('div');
    columnEl.setAttribute(COLUMN_ATTR, columnId);

    cardIds.forEach((id, index) => {
        const card = document.createElement('article');
        card.setAttribute(CARD_ATTR, id);
        const top = index * cardHeight;
        card.getBoundingClientRect = () =>
            ({ top, bottom: top + cardHeight, height: cardHeight, left: 0, right: 100, width: 100 }) as DOMRect;
        columnEl.appendChild(card);
    });

    document.body.appendChild(columnEl);
    return columnEl;
}

afterEach(() => {
    document.body.innerHTML = '';
});

const at = (element: Element | null) =>
    ({ elementFromPoint: () => element, }) as unknown as Document;

describe('movedFar', () => {
    it('is false for a still pointer, so a click still opens the card', () => {
        expect(movedFar({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(false);
    });

    it('is false just under the threshold and true at it', () => {
        expect(movedFar({ x: 0, y: 0 }, { x: 0, y: DRAG_THRESHOLD_PX - 1 })).toBe(false);
        expect(movedFar({ x: 0, y: 0 }, { x: 0, y: DRAG_THRESHOLD_PX })).toBe(true);
    });

    it('measures diagonally, not per axis', () => {
        expect(movedFar({ x: 0, y: 0 }, { x: 5, y: 5 })).toBe(true);
    });
});

describe('resolveDropTarget', () => {
    it('is null when the pointer is over nothing', () => {
        expect(resolveDropTarget({ x: 0, y: 0 }, 'a', at(null))).toBeNull();
    });

    // A card released over the page chrome should stay where it was, not land
    // somewhere arbitrary.
    it('is null when the pointer is outside every column', () => {
        const stray = document.createElement('div');
        document.body.appendChild(stray);
        expect(resolveDropTarget({ x: 0, y: 0 }, 'a', at(stray))).toBeNull();
    });

    it('drops above a card when the pointer is in its top half', () => {
        const columnEl = buildColumn('todo', ['a', 'b', 'c']);
        expect(resolveDropTarget({ x: 5, y: 45 }, 'x', at(columnEl))).toEqual({
            columnId: 'todo',
            index: 1,
        });
    });

    it('drops below a card when the pointer is in its bottom half', () => {
        const columnEl = buildColumn('todo', ['a', 'b', 'c']);
        expect(resolveDropTarget({ x: 5, y: 75 }, 'x', at(columnEl))).toEqual({
            columnId: 'todo',
            index: 2,
        });
    });

    it('appends when the pointer is below every card', () => {
        const columnEl = buildColumn('todo', ['a', 'b', 'c']);
        expect(resolveDropTarget({ x: 5, y: 500 }, 'x', at(columnEl))).toEqual({
            columnId: 'todo',
            index: 3,
        });
    });

    it('appends to an empty column', () => {
        const columnEl = buildColumn('doing', []);
        expect(resolveDropTarget({ x: 5, y: 5 }, 'x', at(columnEl))).toEqual({
            columnId: 'doing',
            index: 0,
        });
    });

    // The card being dragged is still in the DOM. Counting it would shift every
    // index by one for a move within the same column.
    it('ignores the card being dragged', () => {
        const columnEl = buildColumn('todo', ['a', 'b', 'c']);
        expect(resolveDropTarget({ x: 5, y: 500 }, 'b', at(columnEl))).toEqual({
            columnId: 'todo',
            index: 2,
        });
    });

    it('resolves the column from a nested element under the pointer', () => {
        const columnEl = buildColumn('todo', ['a']);
        const inner = document.createElement('span');
        columnEl.firstElementChild!.appendChild(inner);

        expect(resolveDropTarget({ x: 5, y: 500 }, 'x', at(inner))?.columnId).toBe('todo');
    });
});

describe('toFullIndex', () => {
    const column = (ids: string[]): BoardColumn => ({
        id: 'todo',
        name: 'To do',
        category: 'TODO',
        tasks: ids.map(task),
    });

    it('is the same index when nothing is filtered out', () => {
        const col = column(['a', 'b', 'c']);
        expect(toFullIndex(col, col.tasks, 1, 'x')).toBe(1);
    });

    // Without this, dropping "above the second visible card" while a filter is
    // on would land the card at position 1 of the whole column, jumping it over
    // every hidden card in between.
    it('maps a visible position onto the full column', () => {
        const col = column(['a', 'hidden1', 'hidden2', 'b', 'c']);
        const visible = [task('a'), task('b'), task('c')];

        expect(toFullIndex(col, visible, 1, 'x')).toBe(3);
    });

    it('drops past the last visible card to the end of the whole column', () => {
        const col = column(['a', 'hidden1', 'b', 'hidden2']);
        const visible = [task('a'), task('b')];

        expect(toFullIndex(col, visible, 2, 'x')).toBe(4);
    });

    it('excludes the dragged card from both lists', () => {
        const col = column(['a', 'b', 'c']);
        // Moving 'a' to sit above 'c': with 'a' removed the target is index 1.
        expect(toFullIndex(col, col.tasks, 1, 'a')).toBe(1);
        expect(toFullIndex(col, col.tasks, 2, 'a')).toBe(2);
    });

    it('appends when the column is unknown rather than throwing', () => {
        expect(toFullIndex(undefined, [], 0, 'x')).toBe(0);
    });
});
