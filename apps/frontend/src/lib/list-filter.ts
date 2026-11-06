import { isCreatedRangeEmpty, tenantDateOnly, type CreatedRange } from '@/lib/created-range';
import type { NumberCondition } from '@/lib/number-condition';

/*
 * The toolbar chips for a list that holds all of its rows in the browser — a
 * shop's staff, its departments, a report already computed on the server.
 * The same chips a server list sends as query params are applied here, so the
 * rows and the stats strip above them describe the same records.
 */

/** "Is any of" (or, with `exclude`, "is none of") over a multi-select chip. No choice matches everything. */
export function matchesAnyOf(selected: readonly string[], value: string | null | undefined, exclude = false): boolean {
    if (selected.length === 0) return true;
    const hit = selected.includes(value ?? '');
    return exclude ? !hit : hit;
}

/** An amount or count chip: between / greater than / less than / equal to. */
export function matchesNumberCondition(value: number, condition: NumberCondition | null | undefined): boolean {
    if (!condition) return true;
    if (condition.op === 'gt') return value > condition.value;
    if (condition.op === 'lt') return value < condition.value;
    if (condition.op === 'eq') return value === condition.value;
    const upper = condition.to ?? condition.value;
    return value >= condition.value && value <= upper;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The workspace's calendar day a stored value falls on. A date-only field
 * (joining date, a leave's start) is stored at UTC midnight and is that day
 * as written; a timestamp is read on the workspace's own clock.
 */
export function calendarDayOf(value: string | Date | null | undefined): string | null {
    if (!value) return null;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const at = value instanceof Date ? value : new Date(value);
    const instant = at.getTime();
    if (Number.isNaN(instant)) return null;
    return instant % DAY_MS === 0 ? at.toISOString().slice(0, 10) : tenantDateOnly(at);
}

/**
 * A date chip over a day the row carries. Bounds are whole days (a bound with
 * a time is read as its day). A row with no date is outside any range.
 */
export function inDateRange(value: string | Date | null | undefined, range: CreatedRange | null | undefined): boolean {
    if (isCreatedRangeEmpty(range)) return true;
    const day = calendarDayOf(value);
    if (!day) return false;
    const from = range?.from?.slice(0, 10);
    const to = range?.to?.slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
}

/** The search box: every word typed must appear somewhere in the row's text. */
export function matchesSearch(query: string, ...values: Array<string | number | null | undefined>): boolean {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return true;
    const haystack = values
        .filter((value) => value !== null && value !== undefined && value !== '')
        .join(' ')
        .toLowerCase();
    return words.every((word) => haystack.includes(word));
}
