import { IsStoreIdOrAll } from './store-id-or-all.validator';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

/**
 * The shared half of the two line-item searches — every sale line and every
 * purchase line, filtered by period, counterparty, product and branch.
 *
 * The sales and purchase DTOs extend `LineItemSearchDto` with their own
 * counterparty and sort keys; the paging and rounding helpers below keep the
 * two services answering in the same shape.
 */

/**
 * A calendar day as a shopkeeper picks it. Strict on purpose: the services read
 * these as whole days in the tenant's zone, and `zonedDayRange` silently drops
 * anything else — so a timestamp slipped in here would widen the window to
 * "all time" rather than fail.
 */
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

export const LINE_ITEM_SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type LineItemSortDirection = (typeof LINE_ITEM_SORT_DIRECTIONS)[number];

/**
 * The same cap `PaginationDto` puts on every list, and the page size the
 * table's complete-list export walks in.
 */
export const LINE_ITEM_MAX_PAGE_SIZE = 100;
const LINE_ITEM_DEFAULT_PAGE_SIZE = 25;

export class LineItemSearchDto {
    /**
     * One branch, or `all`. The controller resolves it against the caller's
     * branch access before the service sees it.
     */
    @IsOptional()
    @IsStoreIdOrAll()
    storeId?: string;

    @IsOptional()
    @IsUUID()
    productId?: string;

    /**
     * Free text over the product's name and SKU, the document's own and
     * reference numbers, and the counterparty's name.
     */
    @IsOptional()
    @IsString()
    @MaxLength(100)
    search?: string;

    /** Inclusive `YYYY-MM-DD` bounds in the tenant's own zone. */
    @IsOptional()
    @Matches(CALENDAR_DAY, { message: '$property must be a YYYY-MM-DD date' })
    from?: string;

    @IsOptional()
    @Matches(CALENDAR_DAY, { message: '$property must be a YYYY-MM-DD date' })
    to?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(LINE_ITEM_MAX_PAGE_SIZE)
    limit?: number;

    @IsOptional()
    @IsIn(LINE_ITEM_SORT_DIRECTIONS)
    sortDir?: LineItemSortDirection;
}

export function lineItemPage(query: { page?: number; limit?: number }) {
    const limit = Math.min(Math.max(query.limit ?? LINE_ITEM_DEFAULT_PAGE_SIZE, 1), LINE_ITEM_MAX_PAGE_SIZE);
    const page = Math.max(query.page ?? 1, 1);
    return { page, limit, skip: (page - 1) * limit };
}

/**
 * The envelope's page counts.
 *
 * Nested under `pagination` rather than spread flat beside an `items` array:
 * `TransformInterceptor` rewrites anything shaped like a `PaginatedResult` into
 * `{ data: items, meta }`, which would drop the period totals travelling next
 * to the rows.
 */
export function lineItemPagination(page: number, limit: number, total: number) {
    return { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) };
}

export function searchTerm(value: string | undefined): string | undefined {
    const term = value?.trim();
    return term ? term : undefined;
}

/**
 * Two decimal places. `+ 0` folds the negative zero a rounded `-0.001` would
 * otherwise print as "-0".
 */
export function roundMoney(value: number): number {
    return Math.round(value * 100) / 100 + 0;
}
