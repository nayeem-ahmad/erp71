'use client';

import { useCallback, useEffect, useState } from 'react';
import { File as FileIcon, FileText, Paperclip, Trash2 } from 'lucide-react';
import { ImagePreviewModal } from '@/components/ui/ImagePreviewModal';
import { sizedImageUrl } from '@/components/ui/markdown-bridge';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import type { Attachment } from './model';
import { ACCEPTED_TYPES, MAX_BYTES, THUMBNAIL_WIDTH, readAsDataUrl } from './task-image-upload';

/**
 * `ProjectAttachment` has had a model since Phase 1 and no API. This is the
 * first UI over it.
 *
 * Loads independently of the panel, like the activity feed: a failure here must
 * not cost the hours form above it, and an empty list has to be
 * distinguishable from a broken one.
 */
export default function AttachmentsSection({ taskId }: { taskId: string }) {
    const { t } = useI18n();
    const m = t.projects.attachments;

    const [items, setItems] = useState<Attachment[]>([]);
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);
    /** Which attachment the preview is open on, or null for closed. */
    const [previewAt, setPreviewAt] = useState<number | null>(null);

    const load = useCallback(async () => {
        try {
            const list = await api.getTaskAttachments(taskId);
            setItems(Array.isArray(list) ? list : []);
            setFailed(false);
        } catch {
            setFailed(true);
        }
    }, [taskId]);

    useEffect(() => {
        load();
    }, [load]);

    const upload = async (file: File | undefined) => {
        if (!file) return;
        // Checked before reading: no point turning 20 MB into base64 to be told
        // no, and the message is clearer than a 400 from the server.
        if (!ACCEPTED_TYPES.includes(file.type)) return toast.error(m.unsupported);
        if (file.size > MAX_BYTES) return toast.error(m.tooLarge);

        setBusy(true);
        try {
            const fileBase64 = await readAsDataUrl(file);
            await api.addTaskAttachment(taskId, {
                fileBase64,
                fileName: file.name,
                mimeType: file.type,
            });
            await load();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.uploadFailed);
        } finally {
            setBusy(false);
        }
    };

    const remove = async (id: string) => {
        setBusy(true);
        try {
            await api.deleteTaskAttachment(id);
            await load();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.uploadFailed);
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className="rounded-md border border-gray-200 p-3">
            <h3 className="text-sm font-medium">{m.title}</h3>
            <p className="mt-0.5 text-xs text-gray-500">{m.hint}</p>

            <label className="mt-2 inline-flex max-md:min-h-touch cursor-pointer items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
                <Paperclip className="h-4 w-4" />
                {m.add}
                <input
                    type="file"
                    className="sr-only"
                    aria-label={m.add}
                    accept={ACCEPTED_TYPES.join(',')}
                    disabled={busy}
                    onChange={(e) => {
                        upload(e.target.files?.[0]);
                        // Clear it, or picking the same file twice fires nothing.
                        e.target.value = '';
                    }}
                />
            </label>

            {failed ? (
                <p className="mt-2 text-sm text-danger">{m.loadFailed}</p>
            ) : items.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">{m.empty}</p>
            ) : (
                <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                    {items.map((item, at) => (
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
                                </span>
                                <button
                                    type="button"
                                    aria-label={`${m.deleteFile} ${item.file_name}`}
                                    className="max-md:min-h-touch shrink-0 px-1 text-red-600 disabled:opacity-40"
                                    disabled={busy}
                                    onClick={() => remove(item.id)}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </button>
                            </div>
                        </li>
                    ))}
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
        </section>
    );
}
