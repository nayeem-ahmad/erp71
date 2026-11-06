import type { ListFilter } from '@/components/data-table';
import {
    addCalendarDays,
    createdRangeFromPreset,
    tenantDateOnly,
    type CreatedRange,
    type CreatedRangePreset,
} from '@/lib/created-range';

/**
 * The Period chip on the sales reports. A report is always over some period,
 * so the chip always holds one: cleared, it goes back to the last 30 days —
 * the window every one of these reports has always opened on.
 */

/** The shortcuts the chip offers: the days a till is checked on, then whole months for a trend. */
export const REPORT_PERIOD_PRESETS: readonly CreatedRangePreset[] = [
    'today',
    'yesterday',
    'last7',
    'last30',
    'thisMonth',
    'last3Months',
    'last12Months',
    'thisYear',
];

/** The last 30 days, ending today as the workspace's calendar reads it. */
export function defaultReportPeriod(): CreatedRange {
    return createdRangeFromPreset('last30');
}

export function reportPeriodFilter({
    id = 'period',
    label,
    value,
    onChange,
    fallback = defaultReportPeriod,
}: {
    id?: string;
    label: string;
    value: CreatedRange;
    onChange: (next: CreatedRange) => void;
    /** What clearing the chip goes back to. */
    fallback?: () => CreatedRange;
}): ListFilter {
    return {
        id,
        type: 'date-range',
        label,
        value,
        onChange: (next) => onChange(next && (next.from || next.to) ? next : fallback()),
        presets: REPORT_PERIOD_PRESETS,
        operators: true,
    };
}

/** The period as the report endpoints read it: `from`/`to` calendar days, either end open. */
export function reportPeriodQuery(range: CreatedRange): { from?: string; to?: string } {
    return {
        ...(range.from ? { from: range.from.slice(0, 10) } : {}),
        ...(range.to ? { to: range.to.slice(0, 10) } : {}),
    };
}

/** "2026-03-01 – 2026-03-31", for an AI prompt or an export title. */
export function reportPeriodText(range: CreatedRange): string {
    return `${range.from ?? '…'} – ${range.to ?? '…'}`;
}

/** Both ends of a range, an open end closed on today — for a report that compares two whole spans. */
export function closedRange(range: CreatedRange): { from: string; to: string } {
    const today = tenantDateOnly();
    const to = (range.to ?? today).slice(0, 10);
    const from = (range.from ?? to).slice(0, 10);
    return { from, to };
}

/** The span of the same length that ends the day before `range` starts. */
export function precedingRange(range: CreatedRange): { from: string; to: string } {
    const { from, to } = closedRange(range);
    const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
    const previousTo = addCalendarDays(from, -1);
    return { from: addCalendarDays(previousTo, -days), to: previousTo };
}
