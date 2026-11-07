import { IsOptional, IsString } from 'class-validator';
import { SortableBranchListQueryDto } from './branch-list-query.dto';
import { readIdListQuery, readNumberConditionQuery, type NumberCondition } from './number-condition.util';

/**
 * The query behind a customer-document list — sales returns, exchanges,
 * quotations, sales orders, customer payments — and the stats strip above it.
 *
 * The customer-side twin of `DocumentListQueryDto`: the Sales list's filter
 * row (a search box, a status set that can be inverted, the customers, an
 * amount condition, a date of the document's own beside its created date).
 * Every key is declared here because the global ValidationPipe runs with
 * `forbidNonWhitelisted`. A list that needs more keys extends this class.
 */
export class SalesDocumentListQueryDto extends SortableBranchListQueryDto {
    @IsOptional()
    @IsString()
    search?: string;

    /** One status or a comma-separated set. */
    @IsOptional()
    @IsString()
    status?: string;

    /** `true`: every status but those in `status`. */
    @IsOptional()
    @IsString()
    statusExclude?: string;

    /** Comma-separated customer ids; `none` is a walk-in document with no customer. */
    @IsOptional()
    @IsString()
    customerId?: string;

    /** `gt:100`, `between:100,500` — see `readNumberConditionQuery`. */
    @IsOptional()
    @IsString()
    total?: string;

    /** The document's own date (return date, valid-until, delivery date), `YYYY-MM-DD[THH:mm]`. */
    @IsOptional()
    @IsString()
    dateFrom?: string;

    @IsOptional()
    @IsString()
    dateTo?: string;
}

/** The parsed filters a customer-document list and its summary share. */
export interface SalesDocumentListFilters {
    search?: string;
    statuses?: string[];
    statusExclude?: boolean;
    customerIds?: string[];
    total?: NumberCondition;
    createdFrom?: string;
    createdTo?: string;
    dateFrom?: string;
    dateTo?: string;
    /** One branch, already resolved against the caller's access; omitted, every branch. */
    storeId?: string;
    /** IANA zone the calendar-day bounds are measured in. */
    timezone: string;
}

/** Reads the shared filter keys off the query; `storeId` is resolved by the controller. */
export function readSalesDocumentListFilters(
    query: SalesDocumentListQueryDto,
    context: { storeId?: string; timezone: string },
): SalesDocumentListFilters {
    return {
        search: query.search?.trim() || undefined,
        statuses: readIdListQuery(query.status) ?? [],
        statusExclude: query.statusExclude === 'true' || query.statusExclude === '1',
        customerIds: readIdListQuery(query.customerId),
        total: readNumberConditionQuery(query.total, 'total'),
        createdFrom: query.createdFrom || undefined,
        createdTo: query.createdTo || undefined,
        dateFrom: query.dateFrom || undefined,
        dateTo: query.dateTo || undefined,
        storeId: context.storeId,
        timezone: context.timezone,
    };
}

// The clause builders are the purchase side's; re-exported so a sales module
// imports its whole filter vocabulary from one place.
export { statusSetClause, idsOrNoneClause, searchClause } from './document-list-filters';
