import { CustomerType, Prisma } from '@prisma/client';
import {
    applyColumnFilters,
    codesContaining,
    type ColumnFilters,
    containsInsensitive,
    type FilterableMap,
    numberEquals,
    readColumnFiltersQuery,
} from '../common/column-filter.util';
import { createdAtRange } from '../common/created-range.util';
import { idsOrNoneClause } from '../common/document-list-filters';
import {
    numberConditionFilter,
    readIdListQuery,
    readNumberConditionQuery,
    type NumberCondition,
} from '../common/number-condition.util';
import { type CustomerScope, customerScopeWhere } from './customer-visibility';

/**
 * The query behind the customers list and the stats strip above it.
 *
 * Read as a plain object rather than a validated DTO: `GET /customers` is also
 * every customer picker's search, called with whatever each one sends, and a
 * DTO under the global `forbidNonWhitelisted` pipe would turn a stray key into a
 * 400 for all of them. Each key is parsed here instead — a malformed amount is
 * still a 400 (see `readNumberConditionQuery`).
 */
export interface CustomerListQuery {
    page?: string;
    limit?: string;
    search?: string;
    /** One segment or a comma-separated set (`VIP,At-Risk`). */
    segment?: string;
    /** `true`: every segment but those in `segment`. */
    segmentExclude?: string;
    /** One customer type or a comma-separated set. */
    customerType?: string;
    /** Comma-separated customer-group ids; `none` is a customer in no group. */
    groupId?: string;
    /** Comma-separated territory ids; `none` is a customer in no territory. */
    territoryId?: string;
    /** What the customer owes — `gt:0`, `between:1000,5000`. */
    due?: string;
    /** Lifetime spend. */
    totalSpent?: string;
    /** Loyalty points balance. */
    points?: string;
    sortBy?: string;
    sortDir?: string;
    createdFrom?: string;
    createdTo?: string;
    /** A branch id or `all` — resolved to a `CustomerScope` by the controller. */
    storeId?: string;
    /** The table's advanced column filters, JSON. */
    filters?: string;
}

/** The parsed filters the customers list and its summary share. */
export interface CustomerListFilters {
    search?: string;
    segments?: string[];
    segmentExclude?: boolean;
    customerTypes?: string[];
    groupIds?: string[];
    territoryIds?: string[];
    due?: NumberCondition;
    totalSpent?: NumberCondition;
    points?: NumberCondition;
    createdFrom?: string;
    createdTo?: string;
    /** IANA zone the calendar-day bounds above are measured in. */
    timezone: string;
    /** Whose customers — see `customer-visibility.ts`. Omitted: everyone's. */
    scope?: CustomerScope;
    /** The table's advanced column filters — see CUSTOMER_FILTERABLE. */
    filters?: ColumnFilters;
}

/**
 * Columns of the customers table that take an advanced filter, by the column id
 * the table sends. The Customer cell shows the phone under the name, so that
 * column matches either.
 */
export const CUSTOMER_FILTERABLE: FilterableMap<Prisma.CustomerWhereInput> = {
    customer_code: (v) => ({ customer_code: containsInsensitive(v) }),
    name: (v) => ({ OR: [{ name: containsInsensitive(v) }, { phone: containsInsensitive(v) }] }),
    owner_name: (v) => ({ owner_name: containsInsensitive(v) }),
    customer_type: (v) => ({ customer_type: { in: codesContaining(Object.values(CustomerType), v) } }),
    group: (v) => ({ customerGroup: { name: containsInsensitive(v) } }),
    territory: (v) => ({ territory: { name: containsInsensitive(v) } }),
    total_spent: numberEquals('total_spent'),
    due_balance: numberEquals('due_balance'),
    loyalty_points: numberEquals('loyalty_points'),
    segment_category: (v) => ({ segment_category: containsInsensitive(v) }),
};

const CUSTOMER_TYPES = new Set<string>(Object.values(CustomerType));

/** Reads the filter keys off the query; the scope is resolved by the controller. */
export function readCustomerListFilters(
    query: CustomerListQuery,
    context: { timezone: string; scope?: CustomerScope },
): CustomerListFilters {
    const flag = (value?: string) => value === 'true' || value === '1';
    return {
        search: query.search?.trim() || undefined,
        segments: readIdListQuery(query.segment),
        segmentExclude: flag(query.segmentExclude),
        // An unknown type would be a Prisma error on the enum column; it can
        // match no customer, so it is dropped rather than sent.
        customerTypes: readIdListQuery(query.customerType)?.filter((type) => CUSTOMER_TYPES.has(type)),
        groupIds: readIdListQuery(query.groupId),
        territoryIds: readIdListQuery(query.territoryId),
        due: readNumberConditionQuery(query.due, 'due'),
        totalSpent: readNumberConditionQuery(query.totalSpent, 'totalSpent'),
        points: readNumberConditionQuery(query.points, 'points'),
        createdFrom: query.createdFrom || undefined,
        createdTo: query.createdTo || undefined,
        timezone: context.timezone,
        scope: context.scope,
        filters: readColumnFiltersQuery(query.filters),
    };
}

/**
 * The one `where` the customers list and its stats strip are both counted
 * from: the tenant's live customers the member may see, narrowed by the
 * toolbar's chips and the table's column filters.
 *
 * The search is a top-level `OR`; everything else goes on `AND`, after the
 * branch scope, so no clause can overwrite another.
 */
export function customerListWhere(tenantId: string, opts: CustomerListFilters): Prisma.CustomerWhereInput {
    const where: Prisma.CustomerWhereInput = {
        tenant_id: tenantId,
        deleted_at: null,
        ...(customerScopeWhere(opts.scope ?? null) as Prisma.CustomerWhereInput),
    };
    const created = createdAtRange(opts.createdFrom, opts.createdTo, opts.timezone);
    if (created) where.created_at = created;
    if (opts.search) {
        where.OR = [
            { name: { contains: opts.search, mode: 'insensitive' } },
            { owner_name: { contains: opts.search, mode: 'insensitive' } },
            { phone: { contains: opts.search } },
            { customer_code: { contains: opts.search, mode: 'insensitive' } },
        ];
    }

    const and: Prisma.CustomerWhereInput[] = [];
    if (opts.segments?.length) {
        and.push({ segment_category: opts.segmentExclude ? { notIn: opts.segments } : { in: opts.segments } });
    }
    if (opts.customerTypes?.length) {
        and.push({ customer_type: { in: opts.customerTypes as CustomerType[] } });
    }
    const group = idsOrNoneClause('customer_group_id', opts.groupIds);
    if (group) and.push(group as Prisma.CustomerWhereInput);
    const territory = idsOrNoneClause('territory_id', opts.territoryIds);
    if (territory) and.push(territory as Prisma.CustomerWhereInput);
    if (opts.due) and.push({ due_balance: numberConditionFilter(opts.due) });
    if (opts.totalSpent) and.push({ total_spent: numberConditionFilter(opts.totalSpent) });
    if (opts.points) and.push({ loyalty_points: numberConditionFilter(opts.points) });
    if (and.length) {
        const scoped = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
        where.AND = [...scoped, ...and];
    }

    return applyColumnFilters(where, opts.filters, CUSTOMER_FILTERABLE);
}

/** `GET /customers/summary` — the stats strip above the customers list. */
export interface CustomerListSummary {
    /** Customers the filters match. */
    count: number;
    /** Of them, added since the start of the tenant's current month. */
    newThisMonth: number;
    /** Of them, owing money. */
    withDue: number;
    /** What those customers owe in all — advances held for others are not netted off. */
    receivable: number;
    /** Lifetime spend of every matched customer. */
    totalSpent: number;
    vip: number;
    atRisk: number;
}
