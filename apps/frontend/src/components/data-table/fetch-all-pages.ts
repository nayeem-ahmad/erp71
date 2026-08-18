/** Backend `PaginationDto` hard-caps `limit` at 100. */
export const EXPORT_FETCH_PAGE_SIZE = 100;
/** Safety cap so a complete-list export cannot walk an unbounded result set. */
export const EXPORT_ROW_CAP = 10_000;

export type FetchAllPageParams = {
    page: number;
    limit: number;
    sortBy?: string;
    sortDir?: 'asc' | 'desc';
};

export type FetchAllPageResult<T> = {
    items: T[];
    total: number;
};

export type FetchAllPagesOptions = {
    sort?: { id: string; desc: boolean } | null;
    cap?: number;
    onProgress?: (loaded: number, total: number) => void;
};

export type FetchAllPagesResult<T> = {
    items: T[];
    truncated: boolean;
    total: number;
};

/**
 * Walk an existing paginated list API until every matching row (or the cap) is
 * loaded. Reuses the caller's current filters because those live inside `fetchPage`.
 */
export async function fetchAllPages<T>(
    fetchPage: (params: FetchAllPageParams) => Promise<FetchAllPageResult<T>>,
    options: FetchAllPagesOptions = {},
): Promise<FetchAllPagesResult<T>> {
    const cap = options.cap ?? EXPORT_ROW_CAP;
    const sort = options.sort ?? null;
    const sortParams: Pick<FetchAllPageParams, 'sortBy' | 'sortDir'> = sort
        ? { sortBy: sort.id, sortDir: sort.desc ? 'desc' : 'asc' }
        : {};

    const collected: T[] = [];
    let total = 0;
    let page = 1;

    while (collected.length < cap) {
        const result = await fetchPage({
            page,
            limit: EXPORT_FETCH_PAGE_SIZE,
            ...sortParams,
        });
        const batch = result.items ?? [];
        total = result.total ?? collected.length + batch.length;

        const remaining = cap - collected.length;
        collected.push(...batch.slice(0, remaining));
        options.onProgress?.(collected.length, total);

        if (batch.length === 0) break;
        if (collected.length >= total) break;
        if (collected.length >= cap) break;
        if (batch.length < EXPORT_FETCH_PAGE_SIZE) break;
        page += 1;
    }

    return {
        items: collected,
        truncated: total > collected.length,
        total,
    };
}
