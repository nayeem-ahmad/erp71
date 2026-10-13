import { isCalendarDate, zonedDayRange, type ZonedDayFilter } from './tenant-time.util';

export type CreatedAtPrismaFilter = ZonedDayFilter;

/**
 * Inclusive Prisma `created_at` filter for shopkeeper-picked calendar days.
 *
 * Bounds are `YYYY-MM-DD` in the tenant's own zone, and `to` covers the whole
 * last day — `new Date(to)` would be UTC midnight and drop almost everything
 * entered on that day anywhere east of Greenwich.
 *
 * The zone argument is required rather than defaulted on purpose. This filter
 * decides which rows a shopkeeper sees, and a silent default is exactly how the
 * platform ended up measuring every workspace's day in Dhaka. Callers on a
 * request take it from `@Tenant()`; the scheduled sweeps take it from
 * `TenantTimezoneService`.
 *
 * The name is kept because most callers filter that column; the range logic is
 * about calendar days, not about which column they are compared against. For
 * any other column, `zonedDayRange` is the same function under a neutral name.
 */
export const createdAtRange = zonedDayRange;

/**
 * Inclusive filter for a `@db.Date` column such as `expense_date` or a loan's
 * `start_date`.
 *
 * Those columns hold a calendar day with no zone, stored as UTC midnight. A
 * zoned range would be wrong for them: west of Greenwich the tenant's day
 * starts after that midnight, so the first day of every range would drop out.
 * Anything but a real `YYYY-MM-DD` is ignored, as `zonedDayRange` does.
 */
export function calendarDateRange(
    from: string | undefined,
    to: string | undefined,
): ZonedDayFilter | undefined {
    const filter: ZonedDayFilter = {};
    if (from && isCalendarDate(from)) filter.gte = new Date(`${from.trim()}T00:00:00.000Z`);
    if (to && isCalendarDate(to)) filter.lte = new Date(`${to.trim()}T00:00:00.000Z`);
    return Object.keys(filter).length > 0 ? filter : undefined;
}
