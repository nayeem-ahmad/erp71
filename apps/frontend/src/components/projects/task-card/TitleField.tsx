'use client';

import { useEffect, useState } from 'react';
import { Input } from '@/components/ui';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';

const TITLE_MAX = 300;

/**
 * The title, as a field.
 *
 * It used to be a heading you clicked to turn into an input — a hidden
 * affordance, and one of five different ways this panel saved a field. It is now
 * simply an input styled as a heading: click it, type, leave it, it saves. Same
 * rule as the estimate, the dates and every other text field on the card.
 *
 * Blank is refused rather than saved: a task with no title is not something the
 * backend takes, and quietly erasing the one thing that names the card would be
 * worse than ignoring the edit.
 */
export default function TitleField({
    title,
    taskId,
    onSaved,
}: {
    title: string;
    taskId: string;
    onSaved: (updated: unknown) => Promise<unknown>;
}) {
    const { t } = useI18n();
    const m = t.projects.task;

    const [value, setValue] = useState(title);
    const [saving, setSaving] = useState(false);

    useEffect(() => setValue(title), [title]);

    const commit = async () => {
        const next = value.trim();
        if (!next || next === title) {
            setValue(title);
            return;
        }
        setSaving(true);
        try {
            await onSaved(await api.updateProjectTask(taskId, { title: next }));
        } catch (error) {
            setValue(title);
            toast.error(error instanceof Error ? error.message : m.renameFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Input
            value={value}
            maxLength={TITLE_MAX}
            disabled={saving}
            aria-label={m.titleField}
            className="border-transparent bg-transparent px-1 text-base font-semibold hover:border-gray-300"
            onChange={(event) => setValue(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    event.currentTarget.blur();
                }
                if (event.key === 'Escape') {
                    // Kept off the document, where ModalShell would read it as
                    // "close the card" and take the edit with it.
                    event.stopPropagation();
                    setValue(title);
                }
            }}
        />
    );
}
