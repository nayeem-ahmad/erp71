'use client';

import { useState } from 'react';
import { Select } from '@/components/ui';
import type { ProjectMeta } from './use-project-meta';

/**
 * A picker that does not know its options until somebody wants them.
 *
 * The Tasks list spans projects, and a row's status options are its own
 * project's board columns. Loading those for every visible row would be an N+1
 * on arrival; loading them when a picker is first touched costs one read per
 * project, only for the projects somebody actually edits in.
 *
 * Until then the select shows the value the row already holds, so the column
 * reads exactly as it did when it was plain text.
 */
export default function TaskRowSelect({
    value,
    label,
    current,
    options,
    onOpen,
    onChange,
    disabled,
    tone,
    testId,
}: {
    value: string;
    label: string;
    /** What to show before the options have loaded — the row's own value. */
    current: string;
    options: { value: string; label: string }[] | undefined;
    onOpen: () => void;
    onChange: (next: string) => Promise<void>;
    disabled?: boolean;
    tone?: string;
    testId?: string;
}) {
    const [saving, setSaving] = useState(false);

    const change = async (next: string) => {
        if (next === value) return;
        setSaving(true);
        try {
            await onChange(next);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Select
            aria-label={label}
            data-testid={testId}
            value={value}
            disabled={saving || disabled}
            // Touch and mouse both reach focus; pointerdown alone misses the
            // keyboard, and change alone would be too late to have options.
            onFocus={onOpen}
            onPointerDown={onOpen}
            onChange={(event) => void change(event.target.value)}
            className={`min-h-touch border-transparent bg-transparent px-1 hover:border-gray-300 ${tone ?? ''}`}
        >
            {options === undefined ? (
                <option value={value}>{current}</option>
            ) : (
                <>
                    {/* The row's own value first, so a holder who has since left
                        the project is still shown rather than silently swapped
                        for whatever the list happens to start with. */}
                    {!options.some((option) => option.value === value) && (
                        <option value={value}>{current}</option>
                    )}
                    {options.map((option) => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </>
            )}
        </Select>
    );
}

/** The two option lists a row needs, in the shape the select above wants. */
export const statusOptions = (meta: ProjectMeta | undefined) =>
    meta?.columns.map((column) => ({ value: column.id, label: column.name }));

export const assigneeOptions = (
    meta: ProjectMeta | undefined,
    unassignedLabel: string,
) => (meta ? [{ value: '', label: unassignedLabel }, ...meta.assignees] : undefined);
