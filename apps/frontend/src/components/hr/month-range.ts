import type { CreatedRange, CreatedRangePreset } from '@/lib/created-range';

/**
 * A month span for the HR reports. Months rather than dates, because
 * everything these reports read is keyed on (year, month) — see
 * `HrReportMonthRangeDto`.
 */
export interface MonthRange {
    fromYear: number;
    fromMonth: number;
    toYear: number;
    toMonth: number;
}

/** The month a report should end on by default — the one under way. */
export function currentMonthKey(): { year: number; month: number } {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

/** The shortcuts the toolbar's period chip offers on a month-grained HR report. */
export const MONTH_RANGE_PRESETS: readonly CreatedRangePreset[] = [
    'thisMonth', 'last3Months', 'last6Months', 'last12Months', 'thisYear',
];

/**
 * The months a toolbar date range covers: the month of its first day through
 * the month of its last. These reports read (year, month) keys, so a range
 * that starts or ends mid-month takes the whole of that month. An open end
 * runs to this month.
 */
export function monthRangeFromDates(range: CreatedRange | null | undefined): MonthRange {
    const now = currentMonthKey();
    const read = (bound: string | undefined) => {
        if (!bound) return null;
        const [year, month] = bound.slice(0, 7).split('-').map(Number);
        return year && month ? { year, month } : null;
    };
    const to = read(range?.to) ?? now;
    const from = read(range?.from) ?? to;
    return { fromYear: from.year, fromMonth: from.month, toYear: to.year, toMonth: to.month };
}
