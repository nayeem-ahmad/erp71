import { applyDecorators, BadRequestException } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsObject, IsOptional } from 'class-validator';

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
    return isColumnFilters(parsed) ? parsed : value;
}

function isColumnFilters(value: unknown): value is ColumnFilters {
    return (
        !!value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.values(value).every((v) => typeof v === 'string')
    );
}

/** A list DTO's `filters` field: optional, parsed, and a 400 when malformed. */
export const ColumnFiltersParam = () =>
    applyDecorators(IsOptional(), Transform(parseColumnFiltersParam), IsObject());

/**
 * The same parse for a handler that reads `@Query('filters')` directly rather
 * than through a DTO: a malformed param is a 400 here too.
 */
export function readColumnFiltersQuery(raw: unknown): ColumnFilters | undefined {
    const parsed = parseColumnFiltersParam({ value: raw });
    if (parsed === undefined) return undefined;
    if (!isColumnFilters(parsed)) throw new BadRequestException('filters must be a JSON object of strings');
    return parsed;
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

/** A case-insensitive contains on a string column, wildcards taken literally. */
export const containsInsensitive = (value: string) => ({
    contains: escapeLikePattern(value),
    mode: 'insensitive' as const,
});

/**
 * Enum values whose code contains the typed text, e.g. "high" → HIGH. An
 * underscore reads as a space, so the label the table shows ("business card")
 * finds its code (BUSINESS_CARD).
 */
export const codesContaining = <T extends string>(codes: readonly T[], value: string): T[] => {
    const words = (text: string) => text.toLowerCase().replace(/_/g, ' ');
    return codes.filter((code) => words(code).includes(words(value)));
};

/**
 * The typed text as a number, for a numeric column matched exactly — or null
 * when it is not one (thousands separators and a currency sign are allowed, so
 * "৳1,250" reads as 1250).
 */
export function parseNumberFilter(value: string): number | null {
    const cleaned = value.replace(/[,\s৳$]/g, '');
    if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
    return Number(cleaned);
}

/** A clause no row satisfies — for a filter whose text cannot match the column at all. */
export const NO_MATCH = { id: { in: [] as string[] } };

/**
 * An exact match on a numeric column, or no rows when the text is not a number:
 * no amount "contains" letters.
 */
export const numberEquals = (field: string) => (value: string) => {
    const n = parseNumberFilter(value);
    return n === null ? NO_MATCH : { [field]: n };
};

/**
 * `where` narrowed by the column filters. They go into `AND`, appended to what
 * is there: several are ORs themselves, and the where may already hold its own
 * OR (a free-text search) that a merged key would overwrite.
 */
export function applyColumnFilters<W extends object>(
    where: W,
    filters: ColumnFilters | undefined,
    filterable: FilterableMap<unknown>,
): W {
    const clauses = resolveColumnFilters(filters, filterable);
    if (!clauses.length) return where;
    const existing = (where as { AND?: unknown }).AND;
    const and = Array.isArray(existing) ? existing : existing ? [existing] : [];
    return { ...where, AND: [...and, ...clauses] };
}
