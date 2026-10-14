'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ColumnFiltersState } from '@tanstack/react-table';

/** The `filters` param a list endpoint takes: `{ columnId: typed text }`. */
export type ColumnFilterParam = Record<string, string>;

/**
 * The table's advanced filters as the list endpoint takes them, serialised so
 * they compare by value, or `''` when none is set. Blank boxes are dropped, so
 * clearing one does not count as a change of slice.
 */
export function columnFilterKey(filters: ColumnFiltersState): string {
    const entries = filters.flatMap((f) =>
        typeof f.value === 'string' && f.value.trim() ? [[f.id, f.value.trim()] as const] : [],
    );
    return entries.length ? JSON.stringify(Object.fromEntries(entries)) : '';
}

/**
 * A server-paginated table's advanced filters, held by the page so they can be
 * sent to the server rather than applied to the one page already fetched — a
 * filter matching two rows used to show one on page 4 and the other on page 5.
 *
 * `columnFilters` / `setColumnFilters` go to `DataTable` (through
 * `serverPagination`) and follow every keystroke. `filters` is what to send:
 * it settles 300ms after typing stops, and only changes when the filters
 * themselves do, so it is safe in a dependency list.
 */
export function useServerColumnFilters() {
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
    const typedKey = useMemo(() => columnFilterKey(columnFilters), [columnFilters]);
    const [appliedKey, setAppliedKey] = useState('');

    useEffect(() => {
        const timer = setTimeout(() => setAppliedKey(typedKey), 300);
        return () => clearTimeout(timer);
    }, [typedKey]);

    const filters = useMemo(
        () => (appliedKey ? (JSON.parse(appliedKey) as ColumnFilterParam) : undefined),
        [appliedKey],
    );

    return { columnFilters, setColumnFilters, filters };
}
