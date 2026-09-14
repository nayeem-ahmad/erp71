/**
 * Where a dragged checklist item lands.
 *
 * Pure and separate from the component for the same reason `board-drag.ts` is:
 * the drag itself needs `setPointerCapture` and `document.elementFromPoint`,
 * **neither of which jsdom implements**, so a component test could only
 * exercise stubs. What can actually be wrong is the index arithmetic — an
 * off-by-one when dragging downwards is the classic — and that is testable here
 * without a DOM at all.
 *
 * Returns the whole new order, which is what `reorderTaskChecklist` takes: the
 * endpoint replaces the order outright, so sending a partial list would leave
 * two items sharing a `sort_order` and the list would reshuffle on next read.
 *
 * `null` means "no move" — dropped on itself, on nothing, or on a row that is
 * not in the list. A drag released over the page chrome is a no-op rather than
 * a move to somewhere arbitrary.
 */
export function reorderByDrag(
    ids: string[],
    draggedId: string | null,
    overId: string | null,
): string[] | null {
    if (!draggedId || !overId || draggedId === overId) return null;

    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(overId);
    if (from < 0 || to < 0) return null;

    const next = [...ids];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
}
