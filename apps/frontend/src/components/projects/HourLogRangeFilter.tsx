'use client';

import { Input, Select } from '@/components/ui';

export type HourLogRangePreset = '7' | '30' | 'month' | 'custom';

export interface HourLogRange {
    from: string;
    to: string;
}

export interface HourLogRangeLabels {
    from: string;
    to: string;
    preset7: string;
    preset30: string;
    presetMonth: string;
    presetCustom: string;
}

const isoDay = (date: Date): string => {
    // Local parts rather than toISOString(): a Dhaka evening is already the next
    // day in UTC, and "today" on a timesheet has to mean the user's today.
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
};

/** The date span a preset stands for, ending today. */
export function hourLogPresetRange(preset: HourLogRangePreset): HourLogRange {
    const today = new Date();
    if (preset === 'month') {
        return {
            from: isoDay(new Date(today.getFullYear(), today.getMonth(), 1)),
            to: isoDay(today),
        };
    }
    const days = preset === '7' ? 7 : 30;
    const start = new Date(today);
    start.setDate(today.getDate() - (days - 1));
    return { from: isoDay(start), to: isoDay(today) };
}

/**
 * Range picker shared by the hour-log list and its report, so both pages read
 * "last 30 days" as the same 30 days. Editing either date drops the preset to
 * Custom rather than silently disagreeing with the label above it.
 */
export function HourLogRangeFilter({
    preset,
    range,
    onPresetChange,
    onRangeChange,
    labels,
}: {
    preset: HourLogRangePreset;
    range: HourLogRange;
    onPresetChange: (preset: HourLogRangePreset) => void;
    onRangeChange: (range: HourLogRange) => void;
    labels: HourLogRangeLabels;
}) {
    const choose = (next: HourLogRangePreset) => {
        onPresetChange(next);
        if (next !== 'custom') onRangeChange(hourLogPresetRange(next));
    };

    const edit = (patch: Partial<HourLogRange>) => {
        onPresetChange('custom');
        onRangeChange({ ...range, ...patch });
    };

    return (
        <>
            <Select
                value={preset}
                onChange={(e) => choose(e.target.value as HourLogRangePreset)}
                className="md:w-40"
                aria-label={labels.presetCustom}
            >
                <option value="7">{labels.preset7}</option>
                <option value="30">{labels.preset30}</option>
                <option value="month">{labels.presetMonth}</option>
                <option value="custom">{labels.presetCustom}</option>
            </Select>
            <Input
                type="date"
                value={range.from}
                aria-label={labels.from}
                onChange={(e) => edit({ from: e.target.value })}
                className="md:w-40"
            />
            <Input
                type="date"
                value={range.to}
                aria-label={labels.to}
                onChange={(e) => edit({ to: e.target.value })}
                className="md:w-40"
            />
        </>
    );
}
