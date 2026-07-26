'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Paginated } from '@/lib/api';
import { useTablePreferences } from '@/components/data-table/useTablePreferences';
import { DEFAULT_PAGE_SIZE } from '@/lib/ui/compact-density';

export interface ServerListParams {
    page: number;
    limit: number;
    sortBy?: string;
    sortDir?: 'asc' | 'desc';
}

/** Shape consumed by `DataTable`'s `serverPagination` prop. */
export interface ServerPaginationProps {
    total: number;
    page: number;
    pageSize: number;
    onPageChange: (page: number) => void;
    onPageSizeChange: (size: number) => void;
    sort: { id: string; desc: boolean } | null;
    onSortChange: (sort: { id: string; desc: boolean } | null) => void;
}

export interface UseServerListResult<T> {
    items: T[];
    total: number;
    loading: boolean;
    error: unknown;
    /** Spread straight into `<DataTable serverPagination={...} />`. */
    serverPagination: ServerPaginationProps;
    /** Re-runs the current query — call after create/update/delete. */
    reload: () => Promise<void>;
    /** Escape hatch for optimistic updates. */
    setItems: React.Dispatch<React.SetStateAction<T[]>>;
    page: number;
    pageSize: number;
    sort: { id: string; desc: boolean } | null;
}

/**
 * Drives a server-paginated list: owns page/pageSize/sort state, fetches through
 * `fetch`, and hands `DataTable` a `serverPagination` prop so the footer count is
 * the server's real total rather than the length of whatever one page returned.
 *
 * `deps` are the page's own filters (search text, status dropdown, date range…).
 * Any change to them resets back to page 1, because holding page 7 across a filter
 * change usually lands past the end of the new, smaller result set.
 *
 * Out-of-order responses are dropped: changing a filter while on page > 1 fires a
 * stale-page request, then the reset-to-page-1 effect fires a second one. Only the
 * newest in-flight request is allowed to commit — otherwise the slower stale
 * response can overwrite the correct rows.
 */
export function useServerList<T>({
    fetch,
    deps = [],
    tableId,
    initialPageSize,
    initialSort = null,
    enabled = true,
}: {
    fetch: (params: ServerListParams) => Promise<Paginated<T>>;
    deps?: unknown[];
    /**
     * The `tableId` of the DataTable this drives. Supplying it makes a chosen rows-per-page
     * survive navigation: server-paginated tables own their page size here rather than in
     * DataTable, so without this they reopen at the default every time regardless of what
     * the viewer picked. DataTable remains the only writer of the stored value.
     */
    tableId?: string;
    initialPageSize?: number;
    initialSort?: { id: string; desc: boolean } | null;
    /** Set false to hold off fetching until prerequisites (e.g. a selected account) exist. */
    enabled?: boolean;
}): UseServerListResult<T> {
    const [items, setItems] = useState<T[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(enabled);
    const [error, setError] = useState<unknown>(null);
    const [page, setPage] = useState(1);
    // Read once on mount: DataTable persists the size as it changes, and re-reading later
    // would fight the local state it is being written from.
    const savedPageSize = useTablePreferences(
        (s) => (tableId ? s.getPreferences(tableId)?.pageSize : undefined),
    );
    const [pageSize, setPageSize] = useState(
        savedPageSize ?? initialPageSize ?? DEFAULT_PAGE_SIZE,
    );
    const [sort, setSort] = useState<{ id: string; desc: boolean } | null>(initialSort);

    const loadSeq = useRef(0);
    // Held in a ref so callers can pass a fresh inline closure each render without
    // the effect below re-firing on every parent re-render.
    const fetchRef = useRef(fetch);
    fetchRef.current = fetch;

    const load = useCallback(async () => {
        if (!enabled) {
            setItems([]);
            setTotal(0);
            setLoading(false);
            return;
        }
        const seq = ++loadSeq.current;
        setLoading(true);
        try {
            const result = await fetchRef.current({
                page,
                limit: pageSize,
                sortBy: sort?.id,
                sortDir: sort ? (sort.desc ? 'desc' : 'asc') : undefined,
            });
            if (seq !== loadSeq.current) return;
            setItems(result?.items ?? []);
            setTotal(result?.total ?? 0);
            setError(null);
        } catch (err) {
            if (seq !== loadSeq.current) return;
            setItems([]);
            setTotal(0);
            setError(err);
        } finally {
            if (seq === loadSeq.current) setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, page, pageSize, sort, ...deps]);

    useEffect(() => { void load(); }, [load]);

    // Filter/sort changes invalidate the current page index.
    useEffect(() => {
        setPage(1);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sort, ...deps]);

    const serverPagination = useMemo<ServerPaginationProps>(() => ({
        total,
        page,
        pageSize,
        onPageChange: setPage,
        // DataTable requires the page reset here, or the new size is requested
        // against a stale page index and returns an empty result.
        onPageSizeChange: (size: number) => { setPageSize(size); setPage(1); },
        sort,
        onSortChange: setSort,
    }), [total, page, pageSize, sort]);

    return { items, total, loading, error, serverPagination, reload: load, setItems, page, pageSize, sort };
}
