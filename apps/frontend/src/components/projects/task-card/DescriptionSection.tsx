'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { Button, CompactSection, RichTextEditor } from '@/components/ui';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { Markdown } from './lazy-markdown';
import { useTaskImageUpload } from './task-image-upload';

const DESCRIPTION_MAX = 5000;

/**
 * The description, in markdown, under the same rule as every other field on the
 * card: click it, type, click away, it saves.
 *
 * It used to need a pencil button to get into and a Save/Cancel pair to get out
 * of — the two clicks that made "fix a typo" a four-step errand, and the loudest
 * of the five different save idioms this panel used to carry.
 *
 * **The commit is on the container, not the textarea.** The editor has a
 * toolbar, and a toolbar button steals focus from the textarea; committing on
 * the textarea's own blur would save (and close the editor) every time somebody
 * reached for *bold*. `relatedTarget` inside the container means focus merely
 * moved within the editor, which is not leaving it.
 *
 * Stored as the text the user typed rather than as HTML: it stays legible
 * everywhere else the field surfaces (exports, the API, a notification email)
 * and there is nothing to sanitise on the way out — `Markdown` renders it with
 * raw HTML and images disallowed.
 */
export default function DescriptionSection({
    description,
    taskId,
    onSaved,
}: {
    description: string;
    taskId: string;
    onSaved: (updated: unknown) => Promise<unknown>;
}) {
    const { t } = useI18n();
    const m = t.projects.description;

    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState(description);
    const [saving, setSaving] = useState(false);
    const uploadImage = useTaskImageUpload(taskId);

    /* A pasted image sits in the text as a placeholder until its upload lands,
       so blurring in between would save the placeholder. The commit waits, and
       `pendingCommit` remembers that it was asked to. */
    const uploading = useRef(false);
    const pendingCommit = useRef(false);

    useEffect(() => setValue(description), [description]);

    const commit = async () => {
        setEditing(false);
        const next = value.trim();
        if (next === description.trim()) return;
        setSaving(true);
        try {
            // '' clears it — the backend stores an empty description as null.
            await onSaved(await api.updateProjectTask(taskId, { description: next }));
        } catch (error) {
            setValue(description);
            toast.error(error instanceof Error ? error.message : m.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    if (!editing) {
        const empty = description === '';
        return (
            <CompactSection
                title={m.title}
                titleStyle="heading"
                // The text itself is still the way in, under the 4D rule — the
                // button is for the reader who does not know that yet, which a
                // card whose body looks like plain prose otherwise never tells.
                actions={
                    empty ? undefined : (
                        <Button
                            type="button"
                            variant="ghost"
                            aria-label={m.edit}
                            onClick={() => setEditing(true)}
                        >
                            <Pencil className="h-3.5 w-3.5" aria-hidden />
                            {t.common.edit}
                        </Button>
                    )
                }
            >
                <button
                    type="button"
                    onClick={() => setEditing(true)}
                    aria-label={m.title}
                    // Empty, a dashed prompt one line high with a word on what
                    // belongs here. It used to be a grey 10rem box with its
                    // placeholder floating in the middle, which read as a
                    // disabled field rather than as an invitation.
                    className={
                        empty
                            ? 'flex w-full items-start gap-2.5 rounded-md border border-dashed border-gray-300 px-3 py-2.5 text-start transition-colors hover:border-gray-400 hover:bg-gray-50'
                            : '-mx-2 block w-[calc(100%+1rem)] rounded-md px-2 py-1 text-start transition-colors hover:bg-gray-50'
                    }
                >
                    {empty ? (
                        <>
                            <Plus className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden />
                            <span className="flex flex-col gap-0.5">
                                <span className="text-sm font-medium text-gray-700">{m.add}</span>
                                <span className="text-xs text-gray-500">{m.addHint}</span>
                            </span>
                        </>
                    ) : (
                        <span className="block text-sm leading-relaxed text-gray-700">
                            <Suspense fallback={<span className="whitespace-pre-wrap">{description}</span>}>
                                <Markdown content={description} allowImages />
                            </Suspense>
                        </span>
                    )}
                </button>
            </CompactSection>
        );
    }

    return (
        <CompactSection title={m.title} titleStyle="heading">
            <div
                onBlur={(event) => {
                    // Focus moving to the toolbar is not focus leaving the editor.
                    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                    if (uploading.current) {
                        pendingCommit.current = true;
                        return;
                    }
                    void commit();
                }}
            >
                <RichTextEditor
                    autoFocus
                    rows={10}
                    value={value}
                    onChange={setValue}
                    disabled={saving}
                    maxLength={DESCRIPTION_MAX}
                    placeholder={m.placeholder}
                    ariaLabel={m.title}
                    onSubmit={commit}
                    uploadImage={uploadImage}
                    onUploadingChange={(busy) => {
                        uploading.current = busy;
                        if (busy || !pendingCommit.current) return;
                        // Blurred while it uploaded: save now, with the link the
                        // upload put in place of the placeholder.
                        pendingCommit.current = false;
                        void commit();
                    }}
                    onCancel={() => {
                        setValue(description);
                        setEditing(false);
                    }}
                />
            </div>
        </CompactSection>
    );
}
