import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { addCalendarDays, startOfZonedToday, zonedDateString } from '../common/tenant-time.util';
import { calendarDaysBetween } from '../common/dashboard-window';
import { GetBirthdaysDto } from './crm-reports.dto';

const DEFAULT_DAYS = 30;
const MAX_DAYS = 366;

export type BirthdayRow = {
    customer_id: string;
    name: string;
    phone: string | null;
    birthday: string;
    next_birthday: string;
    days_until: number;
    turning: number | null;
    today: boolean;
};

export type BirthdaysReport = {
    filters: { from: string; to: string };
    days: number;
    rows: BirthdayRow[];
    total: number;
    today: number;
};

/** The months a window covers, so the scan can be narrowed before the day maths. */
function monthsInWindow(from: string, to: string): number[] {
    const months = new Set<number>();
    let cursor = from;
    while (cursor <= to) {
        months.add(Number(cursor.slice(5, 7)));
        cursor = addCalendarDays(cursor, 1);
    }
    return [...months];
}

/**
 * The next time a birthday comes round, on the tenant calendar.
 *
 * A birthday stored on 29 February falls on 28 February in a common year —
 * clamping rather than skipping, because a customer who only gets a greeting
 * every fourth year has effectively been dropped.
 */
function nextOccurrence(birthday: Date, today: string): string {
    const month = birthday.getUTCMonth() + 1;
    const day = birthday.getUTCDate();
    const year = Number(today.slice(0, 4));

    const build = (y: number): string => {
        const lastDay = new Date(Date.UTC(y, month, 0)).getUTCDate();
        const clamped = Math.min(day, lastDay);
        return `${y}-${String(month).padStart(2, '0')}-${String(clamped).padStart(2, '0')}`;
    };

    const thisYear = build(year);
    return thisYear >= today ? thisYear : build(year + 1);
}

/**
 * Whose birthday is coming up, as a worklist.
 *
 * The birthday is stored on `Customer.birthday` with its real birth year, which
 * no filter can compare against — the year is never the one we want. Prisma
 * cannot express "month and day only", so the scan is narrowed by month in raw
 * SQL and the exact occurrence is worked out in JS, where the window, the year
 * rollover and 29 February are all visible at once.
 *
 * The birthday cron in `CrmActivitiesService` already raises a greeting on the
 * day itself. This report is for the days *before* it, when somebody can still
 * plan a call or a discount.
 */
@Injectable()
export class CrmBirthdaysService {
    constructor(private readonly db: DatabaseService) {}

    async report(
        tenantId: string,
        query: GetBirthdaysDto,
        timezone: string,
    ): Promise<BirthdaysReport> {
        const days = Math.min(query.days ?? DEFAULT_DAYS, MAX_DAYS);

        const todayStart = startOfZonedToday(timezone);
        const from = zonedDateString(todayStart, timezone);
        // `days` counts today: 30 days means today plus the next 29.
        const to = addCalendarDays(from, Math.max(days - 1, 0));

        const months = monthsInWindow(from, to);

        const customers = await this.db.$queryRaw<
            { id: string; name: string; phone: string | null; birthday: Date }[]
        >`
            SELECT id, name, phone, birthday FROM "Customer"
            WHERE deleted_at IS NULL
              AND birthday IS NOT NULL
              AND tenant_id = ${tenantId}
              AND EXTRACT(MONTH FROM birthday) = ANY(${months})
        `;

        const rows: BirthdayRow[] = [];
        for (const customer of customers) {
            // The stored column is a plain date; read its parts in UTC so no zone
            // can shift the one day that decides whether this is the right report.
            const birthdayDay = customer.birthday.toISOString().slice(0, 10);

            const next = nextOccurrence(customer.birthday, from);
            if (next < from || next > to) continue;

            const daysUntil = calendarDaysBetween(from, next);
            const birthYear = Number(birthdayDay.slice(0, 4));
            const nextYear = Number(next.slice(0, 4));

            rows.push({
                customer_id: customer.id,
                name: customer.name,
                phone: customer.phone,
                birthday: birthdayDay,
                next_birthday: next,
                days_until: daysUntil,
                // Only when the stored date really carries a year. A placeholder
                // year would make every age wrong, and a wrong age in a greeting
                // is worse than no age at all.
                turning: birthYear > 1900 ? nextYear - birthYear : null,
                today: daysUntil === 0,
            });
        }

        rows.sort((a, b) => a.days_until - b.days_until || a.name.localeCompare(b.name));

        return {
            filters: { from, to },
            days,
            rows,
            total: rows.length,
            today: rows.filter((row) => row.today).length,
        };
    }
}
