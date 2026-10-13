'use client';

import { useEffect, useMemo, useState } from 'react';
import { File as FileIcon, FileText, Mic, X } from 'lucide-react';
import { ImagePreviewModal } from '@/components/ui/ImagePreviewModal';
import { formatFileSize } from '@/lib/file-preview';
import { useI18n } from '@/lib/i18n';

/**
 * Files and voice notes on a support ticket: the composer's pending list, and
 * what a thread shows under the message they came with. Limits mirror
 * `support-attachment.util.ts` on the server, which has the final say.
 */

export const MAX_SUPPORT_ATTACHMENTS = 5;
export const MAX_SUPPORT_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const ACCEPTED_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf',
    'audio/webm',
    'audio/ogg',
    'audio/mp4',
    'audio/x-m4a',
    'audio/aac',
    'audio/mpeg',
    'audio/wav',
    'audio/x-wav',
];

export const SUPPORT_ATTACHMENT_ACCEPT = ACCEPTED_TYPES.join(',');

/** `audio/webm;codecs=opus` → `audio/webm`, as the server reads it. */
const baseType = (type: string) => type.split(';')[0].trim().toLowerCase();

export function checkSupportFile(file: File): 'type' | 'size' | null {
    if (!ACCEPTED_TYPES.includes(baseType(file.type))) return 'type';
    if (file.size > MAX_SUPPORT_ATTACHMENT_BYTES) return 'size';
    return null;
}

const isAudio = (type: string) => baseType(type).startsWith('audio/');
const isImage = (type: string) => baseType(type).startsWith('image/');

/** One attachment as the thread endpoints return it. */
export type SupportAttachment = {
    id: string;
    kind: string;
    url: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
};

/** The files a composer is holding, each with a local URL to preview it by. */
export function PendingAttachmentList({
    files,
    onRemove,
    disabled,
}: {
    files: File[];
    onRemove: (index: number) => void;
    disabled?: boolean;
}) {
    const { t } = useI18n();
    const m = t.components.feedbackWidget.attachments;
    const urls = useMemo(
        () => files.map((file) => (typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : '')),
        [files],
    );
    useEffect(
        () => () => urls.forEach((url) => url && URL.revokeObjectURL(url)),
        [urls],
    );

    if (!files.length) return null;

    return (
        <ul className="space-y-2">
            {files.map((file, index) => (
                <li
                    key={`${file.name}-${index}`}
                    className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 p-2"
                >
                    {isImage(file.type) && urls[index] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={urls[index]} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
                    ) : (
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-white text-gray-400">
                            {isAudio(file.type) ? (
                                <Mic className="h-4 w-4" aria-hidden />
                            ) : (
                                <FileText className="h-4 w-4" aria-hidden />
                            )}
                        </span>
                    )}
                    <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs text-gray-700">
                            {isAudio(file.type) ? m.voiceNote : file.name}
                        </span>
                        {isAudio(file.type) && urls[index] ? (
                            <audio controls preload="metadata" src={urls[index]} className="mt-1 h-8 w-full" />
                        ) : (
                            <span className="text-xs text-gray-400">{formatFileSize(file.size)}</span>
                        )}
                    </span>
                    <button
                        type="button"
                        aria-label={`${m.remove} ${isAudio(file.type) ? m.voiceNote : file.name}`}
                        onClick={() => onRemove(index)}
                        disabled={disabled}
                        className="min-h-touch shrink-0 px-2 text-gray-400 hover:text-red-600 disabled:opacity-40"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </li>
            ))}
        </ul>
    );
}

/**
 * Attachments under a sent message. Voice notes play inline; images show as
 * thumbnails and, with PDFs, open in the shared preview rather than a new tab.
 * `onPrimary` is for a message drawn in the accent bubble.
 */
export function SupportAttachmentList({
    attachments,
    onPrimary,
}: {
    attachments?: SupportAttachment[];
    onPrimary?: boolean;
}) {
    const { t } = useI18n();
    const m = t.components.feedbackWidget.attachments;
    const [previewAt, setPreviewAt] = useState<number | null>(null);

    const list = attachments ?? [];
    const previewable = list.filter((a) => !isAudio(a.mimeType));
    if (!list.length) return null;

    const chip = onPrimary
        ? 'border-white/40 bg-white/10 text-white hover:bg-white/20'
        : 'border-gray-200 bg-white text-gray-700 hover:border-blue-600';

    return (
        <div className="mt-2 space-y-2">
            {list.filter((a) => isAudio(a.mimeType)).map((a) => (
                <div key={a.id}>
                    <p className={`mb-1 flex items-center gap-1 text-[10px] font-semibold ${onPrimary ? 'text-blue-100' : 'text-gray-500'}`}>
                        <Mic className="h-3 w-3" aria-hidden /> {m.voiceNote}
                    </p>
                    <audio controls preload="metadata" src={a.url} className="h-9 w-64 max-w-full" />
                </div>
            ))}

            {previewable.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {previewable.map((a, at) =>
                        isImage(a.mimeType) ? (
                            <button
                                key={a.id}
                                type="button"
                                aria-label={`${m.open} ${a.fileName}`}
                                onClick={() => setPreviewAt(at)}
                                className={`block overflow-hidden rounded-md border ${chip}`}
                            >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={a.url}
                                    alt={a.fileName}
                                    loading="lazy"
                                    referrerPolicy="no-referrer"
                                    className="h-20 w-20 bg-gray-50 object-cover"
                                />
                            </button>
                        ) : (
                            <button
                                key={a.id}
                                type="button"
                                aria-label={`${m.open} ${a.fileName}`}
                                onClick={() => setPreviewAt(at)}
                                className={`flex min-h-touch max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${chip}`}
                            >
                                {a.mimeType === 'application/pdf' ? (
                                    <FileText className="h-4 w-4 shrink-0" aria-hidden />
                                ) : (
                                    <FileIcon className="h-4 w-4 shrink-0" aria-hidden />
                                )}
                                <span className="truncate">{a.fileName}</span>
                                <span className={onPrimary ? 'text-blue-100' : 'text-gray-400'}>
                                    {formatFileSize(a.fileSize)}
                                </span>
                            </button>
                        ),
                    )}
                </div>
            )}

            {previewAt !== null && (
                <ImagePreviewModal
                    items={previewable.map((a) => ({ url: a.url, name: a.fileName, mimeType: a.mimeType }))}
                    index={previewAt}
                    onIndexChange={setPreviewAt}
                    onClose={() => setPreviewAt(null)}
                />
            )}
        </div>
    );
}
