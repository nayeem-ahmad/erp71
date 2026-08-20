'use client';

import { Select } from '@/components/ui';

export interface MonthRange {
    fromYear: number;
    fromMonth: number;
    toYear: number;
    toMonth: number;
}

export type MonthRangePreset = '3' | '6' | '12' | 'ytd' | 'custom';

export interface MonthRangeLabels {
    from: string;
    to: string;
    preset3: string;
    preset6: string;
    preset12: string;
    presetYtd: string;
    presetCustom: string;
    /** Readonly because the message tree is `as const` — see `messages/en`. */
    months: readonly string[];
}

/** The month a report should end on by default — the one that just closed. */
export function currentMonthKey(): { year: number; month: number } {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

/**
 * Walk back `count` months from the current one, inclusive.
 *
 * Done with an ordinal rather than `setMonth`, which rolls a 31st into the
 * following month and would silently shift the range by one.
 */
export function monthRangePreset(preset: MonthRangePreset): MonthRange {
    const end = currentMonthKey();
    if (preset === 'ytd') {
        return { fromYear: end.year, fromMonth: 1, toYear: end.year, toMonth: end.month };
    }
    const count = preset === 'custom' ? 3 : Number(preset);
    const ordinal = end.year * 12 + (end.month - 1) - (count - 1);
    return {
        fromYear: Math.floor(ordinal / 12),
        fromMonth: (ordinal % 12) + 1,
        toYear: end.year,
        toMonth: end.month,
    };
}

/** Years offered in the pickers: a decade back, plus next year for planning. */
function yearOptions(): number[] {
    const thisYear = new Date().getFullYear();
    return Array.from({ length: 12 }, (_, index) => thisYear + 1 - index);
}

/**
 * A from-month / to-month picker for the HR reports.
 *
 * Months rather than dates, because everything these reports read is keyed on
 * (year, month) — see `HrReportMonthRangeDto`. Offering a day picker over
 * month-grained data would invite a range the server has to silently round.
 */
export default function MonthRangeFilter({
    preset,
    range,
    onPresetChange,
    onRangeChange,
    labels,
}: {
    preset: MonthRangePreset;
    range: MonthRange;
    onPresetChange: (preset: MonthRangePreset) => void;
    onRangeChange: (range: MonthRange) => void;
    labels: MonthRangeLabels;
}) {
    const years = yearOptions();

    const setPart = (part: keyof MonthRange, value: number) => {
        onPresetChange('custom');
        onRangeChange({ ...range, [part]: value });
    };

    return (
        <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
            <Select
                value={preset}
                onChange={(event) => {
                    const next = event.target.value as MonthRangePreset;
                    onPresetChange(next);
                    if (next !== 'custom') onRangeChange(monthRangePreset(next));
                }}
                className="md:w-44"
                aria-label={labels.presetCustom}
            >
                <option value="3">{labels.preset3}</option>
                <option value="6">{labels.preset6}</option>
                <option value="12">{labels.preset12}</option>
                <option value="ytd">{labels.presetYtd}</option>
                <option value="custom">{labels.presetCustom}</option>
            </Select>

            <div className="flex items-center gap-2">
                <span className="shrink-0 text-xs text-gray-500">{labels.from}</span>
                <Select
                    value={range.fromMonth}
                    onChange={(event) => setPart('fromMonth', Number(event.target.value))}
                    className="w-32"
                    aria-label={labels.from}
                >
                    {labels.months.map((month, index) => (
                        <option key={month} value={index + 1}>{month}</option>
                    ))}
                </Select>
                <Select
                    value={range.fromYear}
                    onChange={(event) => setPart('fromYear', Number(event.target.value))}
                    className="w-24"
                    aria-label={`${labels.from} ${range.fromYear}`}
                >
                    {years.map((year) => (
                        <option key={year} value={year}>{year}</option>
                    ))}
                </Select>
            </div>

            <div className="flex items-center gap-2">
                <span className="shrink-0 text-xs text-gray-500">{labels.to}</span>
                <Select
                    value={range.toMonth}
                    onChange={(event) => setPart('toMonth', Number(event.target.value))}
                    className="w-32"
                    aria-label={labels.to}
                >
                    {labels.months.map((month, index) => (
                        <option key={month} value={index + 1}>{month}</option>
                    ))}
                </Select>
                <Select
                    value={range.toYear}
                    onChange={(event) => setPart('toYear', Number(event.target.value))}
                    className="w-24"
                    aria-label={`${labels.to} ${range.toYear}`}
                >
                    {years.map((year) => (
                        <option key={year} value={year}>{year}</option>
                    ))}
                </Select>
            </div>
        </div>
    );
}
