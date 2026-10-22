'use client';

import { useCallback, useEffect, useState } from 'react';
import { File as FileIcon, FileText, Paperclip, Trash2 } from 'lucide-react';
import { ImagePreviewModal } from '@/components/ui/ImagePreviewModal';
import { sizedImageUrl } from '@/components/ui/image-width';
import { ConfirmDialog } from '@/components/ui';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import type { Attachment } from './model';
import { ACCEPTED_TYPES, MAX_BYTES, THUMBNAIL_WIDTH, readAsDataUrl } from './task-image-upload';
import { imageKey, imagePlace, imageUrlsIn, withoutImages, type ImagePlace } from './task-image-refs';
import { useTaskFiles } from './task-files';

type CommentRow = { id: string; body?: string | null };

/**
 * The task's files.
 *
 * One inventory. An image pasted into the description or a comment is the
 * same file, drawn in the text and listed here — the caption under the tile
 * says which. Removing it from the text removes it here. Removing it here
 * takes it out of the text, so the description is not left pointing at a
 * file that no longer exists. A file added here, and never pasted into the
 * text, lives only here.
 */
export default function AttachmentsSection({
    taskId,
    description,
    onDescriptionSaved,
}: {
    taskId: string;
    description: string;
    onDescriptionSaved: (updated: unknown) => Promise<unknown>;
}) {
    const { t, fmt } = useI18n();
    const m = t.projects.attachments;
    const { revision, bump, stripDescriptionDraft } = useTaskFiles();

    const [items, setItems] = useState<Attachment[]>([]);
    const [comments, setComments] = useState<CommentRow[]>([]);
    /** False when the comment read failed, so an image is not removed blind. */
    const [commentsKnown, setCommentsKnown] = useState(false);
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    /** Which attachment the preview is open on, or null for closed. */
    const [previewAt, setPreviewAt] = useState<number | null>(null);
    /** A file that is also shown in the text, waiting on the confirm. */
    const [pending, setPending] = useState<{ item: Attachment; place: ImagePlace } | null>(null);

    const load = useCallback(async () => {
        try {
            const list = await api.getTaskAttachments(taskId);
            // A failed comment read must not look like "no comment shows this".
            // The list still loads; removal of an image waits until the read works.
            let thread: CommentRow[] = [];
            let known = false;
            try {
                const rows = await api.getTaskComments(taskId);
                thread = Array.isArray(rows) ? rows : [];
                known = true;
            } catch {
                known = false;
            }
            setItems(Array.isArray(list) ? list : []);
            setComments(thread);
            setCommentsKnown(known);
            setFailed(false);
        } catch {
            setFailed(true);
        }
    }, [taskId]);

    useEffect(() => {
        void load();
    }, [load, revision]);

    const uploadMany = useCallback(
        async (files: Iterable<File>) => {
            const list = Array.from(files);
            if (list.length === 0) return;
            setBusy(true);
            let added = 0;
            try {
                for (const file of list) {
                    // Checked before reading: no point turning 20 MB into base64
                    // to be told no, and the message is clearer than a 400.
                    if (!ACCEPTED_TYPES.includes(file.type)) {
                        toast.error(m.unsupported);
                        continue;
                    }
                    if (file.size > MAX_BYTES) {
                        toast.error(m.tooLarge);
                        continue;
                    }
                    try {
                        await api.addTaskAttachment(taskId, {
                            fileBase64: await readAsDataUrl(file),
                            fileName: file.name,
                            mimeType: file.type,
                        });
                        added += 1;
                    } catch (error) {
                        toast.error(error instanceof Error ? error.message : m.uploadFailed);
                    }
                }
            } finally {
                setBusy(false);
                if (added) bump(added);
            }
        },
        [taskId, m.unsupported, m.tooLarge, m.uploadFailed, bump],
    );

    // Paste lands here when this tab is open and the paste was not into the
    // description. The description editor takes its own paste; this must not
    // take it a second time.
    useEffect(() => {
        const onPaste = (event: ClipboardEvent) => {
            if (event.defaultPrevented) return;
            const target = event.target;
            if (target instanceof Element && target.closest('[data-rich-text-editor]')) return;
            if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
            const files = Array.from(event.clipboardData?.files ?? []).filter(
                (file) => file.type.startsWith('image/') || file.type === 'application/pdf',
            );
            if (files.length === 0) return;
            event.preventDefault();
            void uploadMany(files);
        };
        window.addEventListener('paste', onPaste);
        return () => window.removeEventListener('paste', onPaste);
    }, [uploadMany]);

    const bodiesOf = (thread: CommentRow[]) => thread.map((comment) => comment.body ?? '');

    const placeOf = (item: Attachment, thread: CommentRow[] = comments) =>
        imagePlace(item.file_url, description, bodiesOf(thread));

    const destroy = async (item: Attachment, thread: CommentRow[]) => {
        const place = placeOf(item, thread);
        const key = imageKey(item.file_url);
        const keys = new Set([key]);
        setBusy(true);
        try {
            if (place === 'description' || place === 'both') {
                const next = withoutImages(description, keys);
                const updated = await api.updateProjectTask(taskId, { description: next });
                stripDescriptionDraft(keys);
                await onDescriptionSaved(updated);
            }
            if (place === 'comment' || place === 'both') {
                for (const comment of thread) {
                    if (!imageUrlsIn(comment.body ?? '').some((url) => imageKey(url) === key)) continue;
                    await api.updateTaskComment(comment.id, withoutImages(comment.body ?? '', keys));
                }
            }
            await api.deleteTaskAttachment(item.id);
            bump(-1);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.removeFailed);
        } finally {
            setBusy(false);
            setPending(null);
        }
    };

    const askRemove = async (item: Attachment) => {
        let thread = comments;
        // An image might live only in a comment. Deleting it without that list
        // would leave the comment pointing at a file that is gone.
        if (!commentsKnown && item.mime_type?.startsWith('image/')) {
            try {
                const rows = await api.getTaskComments(taskId);
                thread = Array.isArray(rows) ? rows : [];
                setComments(thread);
                setCommentsKnown(true);
            } catch {
                toast.error(m.removeFailed);
                return;
            }
        }
        const place = placeOf(item, thread);
        if (place) setPending({ item, place });
        else void destroy(item, thread);
    };

    const caption = (place: ImagePlace | null) => {
        if (place === 'description') return m.inDescription;
        if (place === 'comment') return m.inComment;
        if (place === 'both') return m.inBoth;
        return null;
    };

    const pendingPrompt = pending
        ? fmt(
              pending.place === 'description'
                  ? m.removeUsedDescription
                  : pending.place === 'comment'
                    ? m.removeUsedComment
                    : m.removeUsedBoth,
              { name: pending.item.file_name },
          )
        : '';

    return (
        // No box or heading of its own: the tab it sits in names it, and the
        // one it used to draw was a second "Attachments" inside that tab.
        <div>
            <div
                role="region"
                aria-label={m.dropHint}
                onDragOver={(event) => {
                    event.preventDefault();
                    setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(event) => {
                    event.preventDefault();
                    setDragOver(false);
                    void uploadMany(event.dataTransfer.files);
                }}
                className={`rounded-md border border-dashed p-3 ${
                    dragOver ? 'border-blue-600 bg-blue-50' : 'border-gray-300'
                }`}
            >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <label className="inline-flex max-md:min-h-touch cursor-pointer items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">
                        <Paperclip className="h-4 w-4" aria-hidden />
                        {m.add}
                        <input
                            type="file"
                            className="sr-only"
                            aria-label={m.add}
                            accept={ACCEPTED_TYPES.join(',')}
                            multiple
                            disabled={busy}
                            onChange={(e) => {
                                void uploadMany(e.target.files ?? []);
                                // Clear it, or picking the same file twice fires nothing.
                                e.target.value = '';
                            }}
                        />
                    </label>
                    <p className="text-xs text-gray-500">{m.dropHint}</p>
                </div>
                <p className="mt-1 text-xs text-gray-500">{m.hint}</p>
                <p className="mt-1 text-xs text-gray-500">{m.linked}</p>
            </div>

            {failed ? (
                <p className="mt-3 text-sm text-danger">{m.loadFailed}</p>
            ) : items.length === 0 ? (
                <p className="mt-3 text-sm text-gray-500">{m.empty}</p>
            ) : (
                <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                    {items.map((item, at) => {
                        const place = placeOf(item);
                        const where = caption(place);
                        return (
                            <li key={item.id} className="group relative">
                                <button
                                    type="button"
                                    aria-label={`${m.preview} ${item.file_name}`}
                                    onClick={() => setPreviewAt(at)}
                                    className="block w-full overflow-hidden rounded-md border border-gray-200 hover:border-blue-600"
                                >
                                    {item.mime_type?.startsWith('image/') ? (
                                        /* The thumbnail is the file itself, asked for
                                           small: a screenshot is recognisable long
                                           before its name is. */
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                            src={sizedImageUrl(item.file_url, THUMBNAIL_WIDTH)}
                                            alt={item.file_name}
                                            loading="lazy"
                                            referrerPolicy="no-referrer"
                                            className="h-24 w-full bg-gray-50 object-cover"
                                        />
                                    ) : (
                                        <span className="flex h-24 w-full items-center justify-center bg-gray-50 text-gray-400">
                                            {item.mime_type === 'application/pdf' ? (
                                                <FileText className="h-8 w-8" aria-hidden />
                                            ) : (
                                                <FileIcon className="h-8 w-8" aria-hidden />
                                            )}
                                        </span>
                                    )}
                                </button>

                                <div className="mt-1 flex items-start gap-1">
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-xs text-gray-700">
                                            {item.file_name}
                                        </span>
                                        <span className="text-xs text-gray-400">
                                            {Math.max(1, Math.round((item.file_size ?? 0) / 1024))} KB
                                        </span>
                                        {where && (
                                            <span className="block text-xs text-gray-500">{where}</span>
                                        )}
                                    </span>
                                    <button
                                        type="button"
                                        aria-label={`${m.deleteFile} ${item.file_name}`}
                                        className="max-md:min-h-touch shrink-0 px-1 text-red-600 disabled:opacity-40"
                                        disabled={busy}
                                        onClick={() => askRemove(item)}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}

            {previewAt !== null && (
                <ImagePreviewModal
                    items={items.map((item) => ({
                        url: item.file_url,
                        name: item.file_name,
                        mimeType: item.mime_type,
                    }))}
                    index={previewAt}
                    onIndexChange={setPreviewAt}
                    onClose={() => setPreviewAt(null)}
                />
            )}

            <ConfirmDialog
                open={pending != null}
                title={m.removeUsedTitle}
                prompt={pendingPrompt}
                confirmLabel={t.common.delete}
                cancelLabel={t.common.cancel}
                danger
                loading={busy}
                onCancel={() => setPending(null)}
                onConfirm={() => {
                    if (pending) void destroy(pending.item, comments);
                }}
            />
        </div>
    );
}
