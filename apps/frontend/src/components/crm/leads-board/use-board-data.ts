'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { columnQuery, type BoardColumn, type BoardLead, type LeadBoardGroup } from './board-columns';

/** Cards a column fetches at a time; "Load more" asks for the next batch. */
export const BOARD_PAGE_SIZE = 20;

/** The list's filters, as `GET /crm/leads` takes them. */
export type LeadsQuery = NonNullable<Parameters<typeof api.getLeads>[0]>;

export interface ColumnState {
    items: BoardLead[];
    total: number;
    page: number;
    loading: boolean;
    error: boolean;
}

const LOADING: ColumnState = { items: [], total: 0, page: 0, loading: true, error: false };

/**
 * Each column is its own filtered page of `GET /crm/leads`, not a slice of one
 * big fetch: the endpoint returns at most 100 rows, and a column's count has to
 * be the real number of leads in it, not the ones that happened to load.
 *
 * `matching` is the total for the filters alone, so the board can say when
 * some matching leads sit in no column — owned by someone no longer on the
 * team, say — rather than silently showing fewer than the list would.
 */
export function useBoardData(
    group: LeadBoardGroup,
    columns: BoardColumn[],
    baseQuery: LeadsQuery,
    enabled: boolean,
    reloadSignal: number,
) {
    const [columnsState, setColumnsState] = useState<Record<string, ColumnState>>({});
    const [matching, setMatching] = useState<number | null>(null);
    // A 403 is a plan without CRM, not a row of broken columns.
    const [denied, setDenied] = useState(false);
    const stateRef = useRef(columnsState);
    stateRef.current = columnsState;
    // Only the latest load may commit: changing a filter mid-flight fires a new
    // one, and the older responses must not land on top of it.
    const generation = useRef(0);

    const queryKey = JSON.stringify(baseQuery);
    const columnsKey = columns.map((col) => col.key).join('|');
    // Read through refs inside the loaders so they key on the serialised
    // values above rather than on arrays that are new every render.
    const columnsRef = useRef(columns);
    columnsRef.current = columns;
    const queryRef = useRef(baseQuery);
    queryRef.current = baseQuery;

    const patchColumn = useCallback((key: string, patch: Partial<ColumnState>) => {
        setColumnsState((prev) => ({ ...prev, [key]: { ...(prev[key] ?? LOADING), ...patch } }));
    }, []);

    const fetchPage = useCallback(
        (column: BoardColumn, page: number) =>
            api.getLeads({ ...columnQuery(group, queryRef.current, column), page, limit: BOARD_PAGE_SIZE }),
        [group],
    );

    const loadColumn = useCallback(
        async (column: BoardColumn, gen: number) => {
            patchColumn(column.key, { loading: true, error: false });
            try {
                const data = await fetchPage(column, 1);
                if (gen !== generation.current) return;
                patchColumn(column.key, { items: data?.items ?? [], total: data?.total ?? 0, page: 1, loading: false });
            } catch (err) {
                if (gen !== generation.current) return;
                if (err instanceof ApiError && err.status === 403) setDenied(true);
                patchColumn(column.key, { loading: false, error: true });
            }
        },
        [fetchPage, patchColumn],
    );

    useEffect(() => {
        if (!enabled) return;
        const gen = ++generation.current;
        // Cards from the previous grouping must not linger under new headers.
        setColumnsState(Object.fromEntries(columnsRef.current.map((col) => [col.key, LOADING])));
        setMatching(null);
        setDenied(false);
        for (const column of columnsRef.current) void loadColumn(column, gen);
        api.getLeads({ ...queryRef.current, page: 1, limit: 1 })
            .then((data: { total?: number }) => {
                if (gen === generation.current) setMatching(data?.total ?? null);
            })
            .catch(() => undefined);
    }, [enabled, group, columnsKey, queryKey, reloadSignal, loadColumn]);

    const retry = useCallback(
        (key: string) => {
            const column = columnsRef.current.find((col) => col.key === key);
            if (column) void loadColumn(column, generation.current);
        },
        [loadColumn],
    );

    const loadMore = useCallback(
        async (key: string) => {
            const column = columnsRef.current.find((col) => col.key === key);
            const current = stateRef.current[key];
            if (!column || !current || current.loading) return;
            const gen = generation.current;
            patchColumn(key, { loading: true, error: false });
            try {
                const data = await fetchPage(column, current.page + 1);
                if (gen !== generation.current) return;
                setColumnsState((prev) => {
                    const col = prev[key] ?? LOADING;
                    // A card moved in since the last page shifts the offsets by
                    // one, so the next page can repeat a card already shown.
                    const seen = new Set(col.items.map((lead) => lead.id));
                    const fresh = (data?.items ?? []).filter((lead: BoardLead) => !seen.has(lead.id));
                    return {
                        ...prev,
                        [key]: { ...col, items: [...col.items, ...fresh], total: data?.total ?? col.total, page: col.page + 1, loading: false },
                    };
                });
            } catch {
                if (gen !== generation.current) return;
                patchColumn(key, { loading: false, error: true });
            }
        },
        [fetchPage, patchColumn],
    );

    /**
     * Moves a card between two columns on screen, ahead of the server, and
     * returns the undo for when the server refuses.
     */
    const move = useCallback((lead: BoardLead, fromKey: string, toKey: string): (() => void) => {
        const before = { from: stateRef.current[fromKey], to: stateRef.current[toKey] };
        setColumnsState((prev) => {
            const from = prev[fromKey];
            const to = prev[toKey];
            if (!from || !to) return prev;
            return {
                ...prev,
                [fromKey]: { ...from, items: from.items.filter((l) => l.id !== lead.id), total: Math.max(0, from.total - 1) },
                [toKey]: { ...to, items: [lead, ...to.items.filter((l) => l.id !== lead.id)], total: to.total + 1 },
            };
        });
        return () =>
            setColumnsState((prev) => ({
                ...prev,
                ...(before.from ? { [fromKey]: before.from } : {}),
                ...(before.to ? { [toKey]: before.to } : {}),
            }));
    }, []);

    /** Swaps a card's data for what the server returned, wherever it sits. */
    const replace = useCallback((lead: BoardLead) => {
        setColumnsState((prev) => {
            const next: Record<string, ColumnState> = {};
            for (const [key, col] of Object.entries(prev)) {
                next[key] = col.items.some((l) => l.id === lead.id)
                    ? { ...col, items: col.items.map((l) => (l.id === lead.id ? { ...l, ...lead } : l)) }
                    : col;
            }
            return next;
        });
    }, []);

    return { columns: columnsState, matching, denied, retry, loadMore, move, replace };
}
