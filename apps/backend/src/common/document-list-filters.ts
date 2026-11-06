import { IsOptional, IsString } from 'class-validator';
import { SortableBranchListQueryDto } from './branch-list-query.dto';
import { readIdListQuery, readNumberConditionQuery, type NumberCondition } from './number-condition.util';

/**
 * The query behind a supplier-document list — purchases, purchase returns,
 * purchase orders and purchase quotations — and the stats strip above it.
 *
 * These lists share the Sales list's filter row: a search box, a status set
 * that can be inverted, the suppliers, an amount condition and a date of the
 * document's own beside its created date. Every key is declared here because
 * the global ValidationPipe runs with `forbidNonWhitelisted`.
 */
export class DocumentListQueryDto extends SortableBranchListQueryDto {
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

    /** Comma-separated supplier ids; `none` is a document with no supplier. */
    @IsOptional()
    @IsString()
    supplierId?: string;

    /** `gt:100`, `between:100,500` — see `readNumberConditionQuery`. */
    @IsOptional()
    @IsString()
    total?: string;

    /** The document's own date (bill date, expected date, valid-until), `YYYY-MM-DD[THH:mm]`. */
    @IsOptional()
    @IsString()
    dateFrom?: string;

    @IsOptional()
    @IsString()
    dateTo?: string;
}

/** The parsed filters a document list and its summary share. */
export interface DocumentListFilters {
    search?: string;
    statuses?: string[];
    statusExclude?: boolean;
    supplierIds?: string[];
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
export function readDocumentListFilters(
    query: DocumentListQueryDto,
    context: { storeId?: string; timezone: string },
): DocumentListFilters {
    return {
        search: query.search?.trim() || undefined,
        statuses: readIdListQuery(query.status) ?? [],
        statusExclude: query.statusExclude === 'true' || query.statusExclude === '1',
        supplierIds: readIdListQuery(query.supplierId),
        total: readNumberConditionQuery(query.total, 'total'),
        createdFrom: query.createdFrom || undefined,
        createdTo: query.createdTo || undefined,
        dateFrom: query.dateFrom || undefined,
        dateTo: query.dateTo || undefined,
        storeId: context.storeId,
        timezone: context.timezone,
    };
}

/** The status clause: any of the chosen statuses, or — inverted — none of them. */
export function statusSetClause(statuses: readonly string[] = [], exclude = false): { status?: unknown } {
    if (!statuses.length) return {};
    if (exclude) return { status: { notIn: [...statuses] } };
    return statuses.length === 1 ? { status: statuses[0] } : { status: { in: [...statuses] } };
}

/**
 * Ids of a nullable foreign key, where the id `none` asks for the rows with no
 * link at all (a bill recorded without a supplier). `undefined` when no id was
 * asked for, so the caller adds nothing.
 */
export function idsOrNoneClause(field: string, ids: readonly string[] | undefined): Record<string, unknown> | undefined {
    if (!ids?.length) return undefined;
    const named = ids.filter((id) => id !== 'none');
    const clauses: Record<string, unknown>[] = [];
    if (named.length) clauses.push({ [field]: { in: named } });
    if (named.length !== ids.length) clauses.push({ [field]: null });
    return clauses.length === 1 ? clauses[0] : { OR: clauses };
}

/** A case-insensitive `contains` on each path; nested paths (`supplier.name`) become relation filters. */
export function searchClause(search: string | undefined, paths: readonly string[]): Record<string, unknown> | undefined {
    if (!search) return undefined;
    return {
        OR: paths.map((path) =>
            path
                .split('.')
                .reverse()
                .reduce<Record<string, unknown>>(
                    (inner, key) => ({ [key]: inner }),
                    { contains: search, mode: 'insensitive' } as Record<string, unknown>,
                ),
        ),
    };
}
