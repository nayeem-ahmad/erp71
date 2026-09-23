/**
 * Pointer-based card dragging.
 *
 * The board used HTML5 `draggable`, which does not produce drag events from
 * touch input on iOS Safari or Android Chrome — a phone could see the board and
 * not move a card on it. Pointer events cover mouse, touch and pen with one
 * code path.
 *
 * The geometry lives here rather than in the page so it can be tested: jsdom
 * has no layout, so a component test cannot exercise "which card is the pointer
 * over", but these functions can be handed rectangles directly.
 */

import type { BoardColumn, BoardTask } from './board-tasks';

/** Below this, a mouse gesture is a click that opens the card, not a drag. */
export const DRAG_THRESHOLD_PX = 6;

export const COLUMN_ATTR = 'data-board-column';
export const CARD_ATTR = 'data-board-card';
/**
 * On a swimlane cell, beside `COLUMN_ATTR`: which row the cell belongs to. A
 * column's cards are split across one cell per lane, so the column alone no
 * longer says where a card was dropped.
 */
export const LANE_ATTR = 'data-board-lane';

export interface DropTarget {
    columnId: string;
    /** Insertion point among the *visible* cards, the dragged one excluded. */
    index: number;
    /** The swimlane the drop is in. Absent on an ungrouped board. */
    laneKey?: string;
}

export function movedFar(
    origin: { x: number; y: number },
    point: { x: number; y: number },
): boolean {
    return Math.hypot(point.x - origin.x, point.y - origin.y) >= DRAG_THRESHOLD_PX;
}

/**
 * Which column the pointer is over and where the card would land in it.
 * Returns null when the pointer is outside every column, so a drag released
 * over the page chrome is a no-op rather than a move to somewhere arbitrary.
 */
export function resolveDropTarget(
    point: { x: number; y: number },
    draggingTaskId: string,
    doc: Document,
): DropTarget | null {
    const under = doc.elementFromPoint(point.x, point.y);
    const columnEl = under?.closest(`[${COLUMN_ATTR}]`);
    if (!columnEl) return null;

    const columnId = columnEl.getAttribute(COLUMN_ATTR);
    if (!columnId) return null;

    const cards = Array.from(columnEl.querySelectorAll(`[${CARD_ATTR}]`)).filter(
        (card) => card.getAttribute(CARD_ATTR) !== draggingTaskId,
    );
    const laneKey = columnEl.getAttribute(LANE_ATTR);
    const at = (index: number): DropTarget =>
        laneKey === null ? { columnId, index } : { columnId, index, laneKey };

    for (let index = 0; index < cards.length; index += 1) {
        const rect = cards[index].getBoundingClientRect();
        if (point.y < rect.top + rect.height / 2) return at(index);
    }
    return at(cards.length);
}

/**
 * Translates a position among the visible cards into a position in the whole
 * column, which is what the server reorders against.
 *
 * Without this, dropping a card while a filter is on would land it at the
 * filtered index — "second from the top" of three visible cards would become
 * second of twenty, jumping over every hidden card.
 */
export function toFullIndex(
    column: BoardColumn | undefined,
    visibleTasks: BoardTask[],
    visibleIndex: number,
    draggingTaskId: string,
): number {
    const full = (column?.tasks ?? []).filter((task) => task.id !== draggingTaskId);
    const visible = visibleTasks.filter((task) => task.id !== draggingTaskId);

    // Dropped past the last visible card: the end of the column, hidden cards
    // included, which is where the eye says it went.
    if (visibleIndex >= visible.length) return full.length;

    const anchor = full.findIndex((task) => task.id === visible[visibleIndex].id);
    return anchor === -1 ? full.length : anchor;
}

/**
 * Which column the pointer is over, for a column drag rather than a card one.
 *
 * Deliberately the same `[data-board-column]` marker the card drop uses: a
 * column dragged over another column is over that column's element, cards and
 * all, so there is nothing extra to mark up.
 */
export function columnAtPoint(
    point: { x: number; y: number },
    doc: Document,
): string | null {
    const columnEl = doc.elementFromPoint(point.x, point.y)?.closest(`[${COLUMN_ATTR}]`);
    return columnEl?.getAttribute(COLUMN_ATTR) ?? null;
}

/**
 * `ids` with `moved` dropped into the slot `target` currently holds.
 *
 * "Into its slot" rather than "before it" because a column drag has to work in
 * both directions: inserting *before* the column under the pointer moves
 * nothing at all when the drag went rightwards (the dragged column was already
 * in front of it), which reads as the board refusing half the gesture.
 * Landing on the target's own index gives the expected result either way —
 * dragging To Do onto Done sends it past Done, and dragging it back returns it.
 */
export function withColumnMoved(ids: string[], moved: string, target: string): string[] {
    const at = ids.indexOf(target);
    if (moved === target || at === -1 || !ids.includes(moved)) return ids;

    const rest = ids.filter((id) => id !== moved);
    return [...rest.slice(0, at), moved, ...rest.slice(at)];
}
