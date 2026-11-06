import type { Prisma } from '@prisma/client';
import { numberConditionFilter, readIdListQuery, readNumberConditionQuery, type NumberCondition } from '../common/number-condition.util';
import { zonedDayRange } from '../common/tenant-time.util';
import { type CustomerScope, customerScopeWhere } from '../customers/customer-visibility';
import type { LoyaltyCustomerListQueryDto } from './loyalty.dto';

/** The kinds of points activity a customer's ledger holds. */
export const LOYALTY_ACTIVITY_TYPES = ['EARN', 'REDEEM', 'ADJUST'] as const;

/** The parsed filters the loyalty customers list and its summary share. */
export interface LoyaltyCustomerListFilters {
    search?: string;
    points?: NumberCondition;
    /** Points activity within these calendar days (tenant zone). */
    activeFrom?: string;
    activeTo?: string;
    /** Activity of these kinds only; with no days, ever. */
    activityTypes?: string[];
    /** Whose customers — see `customer-visibility.ts`. Omitted: everyone's. */
    scope?: CustomerScope;
    timezone: string;
}

/** Reads the filter keys off the query; the scope is resolved by the controller. */
export function readLoyaltyCustomerListFilters(
    query: Pick<LoyaltyCustomerListQueryDto, 'search' | 'points' | 'activeFrom' | 'activeTo' | 'activityType'>,
    context: { timezone: string; scope?: CustomerScope },
): LoyaltyCustomerListFilters {
    const known = new Set<string>(LOYALTY_ACTIVITY_TYPES);
    const types = readIdListQuery(query.activityType)?.filter((type) => known.has(type));
    return {
        search: query.search?.trim() || undefined,
        points: readNumberConditionQuery(query.points, 'points'),
        activeFrom: query.activeFrom || undefined,
        activeTo: query.activeTo || undefined,
        activityTypes: types?.length ? types : undefined,
        scope: context.scope,
        timezone: context.timezone,
    };
}

/** The activity window, `undefined` when no day was picked. */
export function loyaltyActivityWindow(filters: LoyaltyCustomerListFilters) {
    return zonedDayRange(filters.activeFrom, filters.activeTo, filters.timezone);
}

/**
 * The one `where` the loyalty list and its stats strip are both counted from:
 * the tenant's live customers the member may see, narrowed by the search, the
 * points balance and — as "active" — some points activity in the window and of
 * the kinds picked.
 */
export function loyaltyCustomerWhere(tenantId: string, filters: LoyaltyCustomerListFilters): Prisma.CustomerWhereInput {
    const where: Prisma.CustomerWhereInput = {
        tenant_id: tenantId,
        deleted_at: null,
        ...(customerScopeWhere(filters.scope ?? null) as Prisma.CustomerWhereInput),
    };
    if (filters.search) {
        where.OR = [
            { name: { contains: filters.search, mode: 'insensitive' } },
            { phone: { contains: filters.search, mode: 'insensitive' } },
        ];
    }
    const and: Prisma.CustomerWhereInput[] = [];
    if (filters.points) and.push({ loyalty_points: numberConditionFilter(filters.points) });
    const window = loyaltyActivityWindow(filters);
    if (window || filters.activityTypes?.length) {
        and.push({
            loyaltyTransactions: {
                some: {
                    tenantId,
                    ...(window ? { created_at: window } : {}),
                    ...(filters.activityTypes?.length ? { type: { in: filters.activityTypes } } : {}),
                },
            },
        });
    }
    if (and.length) {
        const scoped = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
        where.AND = [...scoped, ...and];
    }
    return where;
}

/** `GET /loyalty/customers/summary` — the stats strip above the loyalty list. */
export interface LoyaltyCustomerListSummary {
    /** Customers the filters match. */
    count: number;
    /** Of them, holding points. */
    members: number;
    /** Their points balance in all. */
    points: number;
    /** Points they earned in the window — the activity days, or this month when none are picked. */
    earned: number;
    /** Points they redeemed in that window, as a positive number. */
    redeemed: number;
    /** Whether the window is the activity days picked (`true`) or the current month. */
    windowed: boolean;
}
