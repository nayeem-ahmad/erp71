/**
 * Server-side half of a server-paginated DataTable's advanced filters.
 *
 * The table sends them as one `filters` query param holding a JSON object,
 * `{ "<column id>": "<typed text>" }`. They have to be applied here, before the
 * page is cut: filtering only the rows already fetched for one page is how a
 * filter that matches two leads showed one on page 4 and the other on page 5.
 */
export type ColumnFilters = Record<string, string>;
export type FilterableMap<Where> = Record<string, (value: string) => Where>;

/**
 * `@Transform` for a DTO's `filters` field. Returns the parsed object when it is
 * a flat object of strings, and otherwise hands back what it was given, so the
 * field's `@IsObject()` turns a malformed param into a 400 rather than the
 * service quietly ignoring it.
 */
export function parseColumnFiltersParam({ value }: { value: unknown }): unknown {
    if (value === undefined || value === null || value === '') return undefined;
    let parsed = value;
    if (typeof value === 'string') {
        try {
            parsed = JSON.parse(value);
        } catch {
            return value;
        }
    }
    const isFlatStringObject =
        !!parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        Object.values(parsed).every((v) => typeof v === 'string');
    return isFlatStringObject ? parsed : value;
}

/**
 * Escape `%`, `_` and `\` so typed text matches literally. Prisma passes a
 * `contains` value straight into a LIKE pattern, so without this a filter of
 * `50%` or `cf_1` would match far more than it says.
 */
export function escapeLikePattern(value: string): string {
    return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * One where-clause per filter, through a per-endpoint allowlist. A column the
 * endpoint does not list is dropped, as `resolveOrderBy` drops an unknown sort
 * key; the client only offers filters on the columns the endpoint lists. Blank
 * values are no filter at all.
 */
export function resolveColumnFilters<Where>(
    filters: ColumnFilters | undefined,
    filterable: FilterableMap<Where>,
): Where[] {
    if (!filters) return [];
    const clauses: Where[] = [];
    for (const [columnId, raw] of Object.entries(filters)) {
        const value = typeof raw === 'string' ? raw.trim() : '';
        if (!value || !Object.prototype.hasOwnProperty.call(filterable, columnId)) continue;
        clauses.push(filterable[columnId](value));
    }
    return clauses;
}
