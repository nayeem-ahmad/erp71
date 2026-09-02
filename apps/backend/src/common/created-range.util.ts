import { zonedDayRange, type ZonedDayFilter } from './tenant-time.util';

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
