export type SortDir = 'asc' | 'desc';
export type OrderByFragment = Record<string, unknown> | Record<string, unknown>[];
export type SortableMap = Record<string, (dir: SortDir) => OrderByFragment>;

/**
 * Resolve a client-supplied (sortBy, sortDir) pair into a Prisma `orderBy`
 * fragment using a per-endpoint allowlist. Unknown/absent keys fall back to the
 * endpoint's default order. Injection-safe: only allowlisted keys are honored.
 */
export function resolveOrderBy(
    sortBy: string | undefined,
    sortDir: string | undefined,
    sortable: SortableMap,
    fallback: OrderByFragment,
): OrderByFragment {
    if (!sortBy || !Object.prototype.hasOwnProperty.call(sortable, sortBy)) {
        return fallback;
    }
    const dir: SortDir = sortDir === 'desc' ? 'desc' : 'asc';
    return sortable[sortBy](dir);
}
