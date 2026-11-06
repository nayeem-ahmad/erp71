'use client';

import { useId } from 'react';

/**
 * How a report's rows are rolled up, as a toolbar chip beside Columns and
 * Export. Not a filter: it always has a value, so it offers no "All" and the
 * filter row's Clear all leaves it alone.
 */
export default function GroupByChip<K extends string>({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: K;
    options: readonly { value: K; label: string }[];
    onChange: (next: K) => void;
}) {
    const id = useId();
    return (
        <label
            htmlFor={id}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-200 bg-white ps-2.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 max-md:min-h-touch"
        >
            <span className="text-gray-500">{label}</span>
            <select
                id={id}
                aria-label={label}
                value={value}
                onChange={(event) => onChange(event.target.value as K)}
                className="cursor-pointer border-0 bg-transparent py-1.5 ps-1 text-xs font-semibold focus:outline-none focus:ring-0"
            >
                {options.map((option) => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </select>
        </label>
    );
}
