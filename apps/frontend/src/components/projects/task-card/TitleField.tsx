'use client';

import { useEffect, useRef, useState } from 'react';
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
    variant = 'modal',
}: {
    title: string;
    taskId: string;
    onSaved: (updated: unknown) => Promise<unknown>;
    /**
     * `page` is the task page's own heading: page-title type, and a textarea
     * that grows rather than an input that scrolls, since a title of three
     * hundred characters is legal and the page has the room to show all of it.
     * The page used to print the title as plain text — the one presentation
     * built for keeping a card open was the one where it could not be renamed.
     */
    variant?: 'modal' | 'page';
}) {
    const { t } = useI18n();
    const m = t.projects.task;

    const [value, setValue] = useState(title);
    const [saving, setSaving] = useState(false);

    useEffect(() => setValue(title), [title]);

    // Grow to fit, one line at a time. `field-sizing: content` would do this in
    // CSS, but neither Safari nor Firefox has it yet.
    const areaRef = useRef<HTMLTextAreaElement>(null);
    useEffect(() => {
        const area = areaRef.current;
        if (!area) return;
        area.style.height = 'auto';
        area.style.height = `${area.scrollHeight}px`;
    }, [value, variant]);

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

    const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
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
    };

    if (variant === 'page') {
        return (
            <textarea
                ref={areaRef}
                rows={1}
                value={value}
                maxLength={TITLE_MAX}
                disabled={saving}
                aria-label={m.titleField}
                // A title is one line that wraps, never two lines: Enter saves,
                // and a pasted line break becomes a space.
                onChange={(event) => setValue(event.target.value.replace(/\s*\n\s*/g, ' '))}
                onBlur={commit}
                onKeyDown={onKeyDown}
                className="-mx-1.5 block w-[calc(100%+0.75rem)] resize-none overflow-hidden rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-lg font-bold leading-7 tracking-tight text-gray-950 transition-colors hover:border-gray-200 focus:border-primary/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
            />
        );
    }

    return (
        <Input
            value={value}
            maxLength={TITLE_MAX}
            disabled={saving}
            aria-label={m.titleField}
            className="border-transparent bg-transparent px-1 text-base font-semibold hover:border-gray-300"
            onChange={(event) => setValue(event.target.value)}
            onBlur={commit}
            onKeyDown={onKeyDown}
        />
    );
}
