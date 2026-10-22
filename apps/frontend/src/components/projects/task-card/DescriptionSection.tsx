'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { Button, CompactSection } from '@/components/ui';
import { RichTextEditor } from '@/components/ui/LazyRichTextEditor';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { Markdown } from './lazy-markdown';
import { imageKey, imageUrlsIn, urlsDropped, withoutImages } from './task-image-refs';
import { useTaskFiles } from './task-files';
import { useTrackedTaskImages } from './use-tracked-task-images';

const DESCRIPTION_MAX = 5000;

/**
 * The description, in markdown, under the same rule as every other field on the
 * card: click it, type, click away, it saves.
 *
 * It used to need a pencil button to get into and a Save/Cancel pair to get out
 * of — the two clicks that made "fix a typo" a four-step errand, and the loudest
 * of the five different save idioms this panel used to carry. A tick and a
 * cross came back under the editor (2026-09-29) as a way out that says so, not
 * as the only one: clicking away still saves, and the cross is the one way to
 * throw an edit away that you can see.
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
    const images = useTrackedTaskImages(taskId, description);
    const { registerDescriptionStrip } = useTaskFiles();

    /* A pasted image sits in the text as a placeholder until its upload lands,
       so blurring in between would save the placeholder. The commit waits, and
       `pendingCommit` remembers that it was asked to. */
    const uploading = useRef(false);
    const pendingCommit = useRef(false);

    // Not while editing: a file removed from the Attachments tab rewrites the
    // saved description, and copying that over the draft would throw away
    // whatever else was being typed. The draft is updated on its own, below.
    useEffect(() => {
        if (!editing) setValue(description);
    }, [description, editing]);

    useEffect(() => {
        if (!editing) return;
        registerDescriptionStrip((keys) => setValue((current) => withoutImages(current, keys)));
        return () => registerDescriptionStrip(null);
    }, [editing, registerDescriptionStrip]);

    const commit = async () => {
        setEditing(false);
        const previous = description.trim();
        const next = value.trim();
        const { shown, abandoned } = images.consume(next);
        const changed = next !== previous;
        if (!changed && abandoned.length === 0) return;

        setSaving(true);
        try {
            if (changed) {
                // '' clears it — the backend stores an empty description as null.
                await onSaved(await api.updateProjectTask(taskId, { description: next }));
            }
        } catch (error) {
            // The draft is thrown away, so an image that existed only in it
            // must not stay in Attachments. One the saved text still shows stays.
            const kept = new Set(imageUrlsIn(description).map(imageKey));
            const orphaned = [...shown, ...abandoned].filter((item) => !kept.has(imageKey(item.url)));
            await images.release(description, orphaned);
            setValue(description);
            toast.error(error instanceof Error ? error.message : m.saveFailed);
            setSaving(false);
            return;
        }

        // An image taken out of the text leaves the inventory too, unless a
        // comment still shows it. A file that was only ever an attachment is
        // not in `abandoned` or `urlsDropped`, so it stays.
        await images.release(next, [
            ...abandoned,
            ...urlsDropped(previous, next).map((url) => ({ url })),
        ]);
        setSaving(false);
    };

    const cancel = () => {
        const { abandoned } = images.consume(description);
        setValue(description);
        setEditing(false);
        void images.release(description, abandoned);
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
                            <Suspense fallback={<span className="whitespace-pre-wrap break-words">{description}</span>}>
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
                    // Focus moving to the toolbar, or tabbing to the tick and
                    // the cross, is not focus leaving the editor.
                    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                    // Switching tabs or apps blurs with no related target too,
                    // the same as a click on empty page. The difference is that
                    // the editor stays the active element and gets focus back
                    // on return, so the edit is still in progress.
                    if (document.activeElement === event.target) return;
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
                    showActions
                    uploadImage={images.uploadImage}
                    onImageDiscarded={images.discard}
                    onUploadingChange={(busy) => {
                        uploading.current = busy;
                        if (busy || !pendingCommit.current) return;
                        // Blurred while it uploaded: save now, with the link the
                        // upload put in place of the placeholder.
                        pendingCommit.current = false;
                        void commit();
                    }}
                    onCancel={cancel}
                />
            </div>
        </CompactSection>
    );
}
