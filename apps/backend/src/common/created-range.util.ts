import { DHAKA_UTC_OFFSET_MINUTES } from './period.util';

export type CreatedAtPrismaFilter = { gte?: Date; lte?: Date };

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Dhaka midnight for a `YYYY-MM-DD` calendar day, as a UTC Date. */
function dhakaDayStart(value: string | undefined): Date | null {
    if (!value) return null;
    const match = DATE_ONLY.exec(value.trim());
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const utcMidnight = Date.UTC(year, month - 1, day);
    const check = new Date(utcMidnight);
    if (
        check.getUTCFullYear() !== year ||
        check.getUTCMonth() !== month - 1 ||
        check.getUTCDate() !== day
    ) {
        return null;
    }
    return new Date(utcMidnight - DHAKA_UTC_OFFSET_MINUTES * 60 * 1000);
}

/**
 * Inclusive Prisma `created_at` filter for shopkeeper-picked calendar days.
 *
 * Bounds are `YYYY-MM-DD` in Asia/Dhaka. `to` includes the whole last day —
 * `new Date(to)` would be UTC midnight and drop almost everything entered on
 * that day in Bangladesh.
 */
export function createdAtRange(
    from?: string,
    to?: string,
): CreatedAtPrismaFilter | undefined {
    const start = dhakaDayStart(from);
    const endStart = dhakaDayStart(to);
    const filter: CreatedAtPrismaFilter = {};
    if (start) filter.gte = start;
    if (endStart) filter.lte = new Date(endStart.getTime() + DAY_MS - 1);
    return Object.keys(filter).length > 0 ? filter : undefined;
}
