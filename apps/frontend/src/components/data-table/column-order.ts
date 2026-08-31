import type { ColumnDef } from '@tanstack/react-table';

/**
 * Column ordering rules shared by every DataTable.
 *
 * Two of the columns a table renders are structural rather than informational.
 * The row-selection checkbox belongs against the start edge, where the header's
 * "select all" box sits directly above the row boxes; the row actions belong
 * against the end edge, where the view/delete buttons line up in one gutter.
 * Neither holds a value anyone would want to read beside a neighbour, so
 * neither is reorderable: they are pinned to the two edges, and the drag
 * handles and drop targets skip them.
 */
export const PINNED_FIRST_COLUMN_ID = 'select';
export const PINNED_LAST_COLUMN_ID = 'actions';

export function isPinnedColumnId(id: string): boolean {
    return id === PINNED_FIRST_COLUMN_ID || id === PINNED_LAST_COLUMN_ID;
}

/**
 * The id TanStack will give a column definition, resolved the same way and in
 * the same precedence it uses: explicit `id`, else `accessorKey` with dots
 * flattened, else a string header.
 *
 * Deriving it from the defs rather than from `table.getAllLeafColumns()` is
 * deliberate — that accessor is itself ordered by `columnOrder`, so reading the
 * declared order out of it to compute `columnOrder` would be circular.
 */
export function columnDefId<T>(def: ColumnDef<T, any>): string {
    const withKeys = def as { id?: string; accessorKey?: string | number; header?: unknown };
    if (withKeys.id) return withKeys.id;
    if (withKeys.accessorKey != null) return String(withKeys.accessorKey).replace('.', '_');
    return typeof withKeys.header === 'string' ? withKeys.header : '';
}

/**
 * Fold a saved column order onto the columns a table currently declares.
 *
 * Three things happen here, and each closes a way the persisted order could
 * disagree with reality:
 *
 * 1. Ids for columns that no longer exist are dropped, so a removed column
 *    cannot hold a slot.
 * 2. Columns the saved order predates are spliced in **after their declared
 *    predecessor** rather than appended. TanStack appends anything its
 *    `columnOrder` does not name, which put every newly added column past the
 *    actions gutter for anyone who had ever used that table before.
 * 3. The two structural columns are forced back to their edges last, so
 *    neither a stale preference nor a drag can leave the checkbox anywhere but
 *    first or the actions anywhere but last.
 */
export function reconcileColumnOrder(
    saved: string[] | undefined,
    declared: string[],
): string[] {
    const declaredSet = new Set(declared);
    const placed = new Set<string>();
    const order: string[] = [];

    for (const id of saved ?? []) {
        if (declaredSet.has(id) && !placed.has(id)) {
            placed.add(id);
            order.push(id);
        }
    }

    declared.forEach((id, index) => {
        if (placed.has(id)) return;
        // Follow the nearest declared sibling that already has a slot, so a new
        // column lands where its author put it rather than at the far end.
        let at = 0;
        for (let before = index - 1; before >= 0; before--) {
            const previous = order.indexOf(declared[before]);
            if (previous !== -1) {
                at = previous + 1;
                break;
            }
        }
        order.splice(at, 0, id);
        placed.add(id);
    });

    return [
        ...order.filter((id) => id === PINNED_FIRST_COLUMN_ID),
        ...order.filter((id) => !isPinnedColumnId(id)),
        ...order.filter((id) => id === PINNED_LAST_COLUMN_ID),
    ];
}
