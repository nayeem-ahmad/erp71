import { reorderByDrag } from './checklist-reorder';

/**
 * The arithmetic behind dragging a checklist item, kept pure and tested
 * directly.
 *
 * Not a component test on purpose: the drag needs `setPointerCapture` and
 * `document.elementFromPoint`, and **jsdom implements neither** (both report
 * `undefined`). A test that stubbed them would be testing the stubs. What can
 * actually be wrong here is the index maths — off-by-one when dragging
 * downwards is the classic — and that is what this covers, the same way
 * `board-drag.ts` keeps its geometry out of the component.
 */
describe('reorderByDrag', () => {
    const ids = ['a', 'b', 'c', 'd'];

    it('moves an item down the list', () => {
        expect(reorderByDrag(ids, 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
    });

    it('moves an item up the list', () => {
        expect(reorderByDrag(ids, 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
    });

    it('moves an item to the very top', () => {
        expect(reorderByDrag(ids, 'c', 'a')).toEqual(['c', 'a', 'b', 'd']);
    });

    it('moves an item to the very bottom', () => {
        expect(reorderByDrag(ids, 'a', 'd')).toEqual(['b', 'c', 'd', 'a']);
    });

    it('is a no-op when dropped on itself', () => {
        expect(reorderByDrag(ids, 'b', 'b')).toBeNull();
    });

    it('is a no-op when the dragged item is unknown', () => {
        expect(reorderByDrag(ids, 'zz', 'b')).toBeNull();
    });

    /**
     * A drag released over the page chrome rather than a row. `board-drag.ts`
     * takes the same line: no target means no move, not a move to somewhere
     * arbitrary.
     */
    it('is a no-op when dropped on nothing', () => {
        expect(reorderByDrag(ids, 'b', null)).toBeNull();
    });

    it('returns the whole order, not the swapped pair', () => {
        // The endpoint replaces the order outright, so a partial list would
        // leave two items sharing a sort_order and the list would reshuffle.
        expect(reorderByDrag(ids, 'a', 'b')).toHaveLength(ids.length);
    });

    it('leaves the original array alone', () => {
        const copy = [...ids];
        reorderByDrag(ids, 'a', 'd');
        expect(ids).toEqual(copy);
    });
});
