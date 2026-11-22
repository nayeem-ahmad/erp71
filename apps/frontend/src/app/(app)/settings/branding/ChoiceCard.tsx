'use client';

import { useId, type ReactNode } from 'react';
import { Check } from 'lucide-react';

/**
 * One option in a radio group of cards: a preview, the option's name, a
 * "Current" tag for the saved choice and a description. The radio is named
 * by the option alone, with the description attached, so a screen reader says
 * "Polished, radio button" and then what it does.
 */
export default function ChoiceCard({
    group,
    value,
    name,
    description,
    preview,
    selected,
    current,
    currentLabel,
    onSelect,
}: {
    /** The radio group's `name`. */
    group: string;
    value: string;
    name: string;
    description: string;
    preview: ReactNode;
    selected: boolean;
    current: boolean;
    currentLabel: string;
    onSelect: () => void;
}) {
    const id = useId();
    return (
        <label
            className={`relative flex cursor-pointer flex-col gap-2 rounded-lg border bg-white p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500/40 ${
                selected ? 'border-blue-600 ring-1 ring-blue-600' : 'border-gray-200 hover:border-gray-300'
            }`}
        >
            <input
                type="radio"
                name={group}
                value={value}
                checked={selected}
                onChange={onSelect}
                aria-labelledby={`${id}-name`}
                aria-describedby={`${id}-description`}
                className="sr-only"
            />
            {preview}
            <span className="flex items-center gap-2">
                <span id={`${id}-name`} className="text-sm font-semibold text-gray-900">{name}</span>
                {current ? (
                    <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600">{currentLabel}</span>
                ) : null}
                {selected ? (
                    <span className="ms-auto inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white">
                        <Check className="h-3 w-3" aria-hidden />
                    </span>
                ) : null}
            </span>
            <span id={`${id}-description`} className="text-xs text-gray-500">{description}</span>
        </label>
    );
}
