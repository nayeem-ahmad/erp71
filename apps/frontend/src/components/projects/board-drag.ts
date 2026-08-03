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

export interface DropTarget {
    columnId: string;
    /** Insertion point among the *visible* cards, the dragged one excluded. */
    index: number;
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

    for (let index = 0; index < cards.length; index += 1) {
        const rect = cards[index].getBoundingClientRect();
        if (point.y < rect.top + rect.height / 2) return { columnId, index };
    }
    return { columnId, index: cards.length };
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
