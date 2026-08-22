'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Paperclip, Send, X } from 'lucide-react';
import { useI18n, formatMessage } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import {
    CHAT_ACCEPTED_MIME_TYPES,
    MAX_CHAT_ATTACHMENTS,
    MAX_CHAT_FILE_BYTES,
    type PendingAttachment,
} from './types';

let pendingId = 0;

export default function MessageComposer({
    disabled,
    sending,
    editing,
    onSend,
    onCancelEdit,
}: {
    disabled: boolean;
    sending: boolean;
    /** Set while an existing message is being rewritten; attachments are hidden then. */
    editing: { id: string; body: string } | null;
    onSend: (body: string, attachments: PendingAttachment[]) => Promise<boolean>;
    onCancelEdit: () => void;
}) {
    const { t } = useI18n();
    const m = t.chat;
    const [body, setBody] = useState('');
    const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
    const [reading, setReading] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);
    const textRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (editing) {
            setBody(editing.body);
            textRef.current?.focus();
        }
    }, [editing]);

    // Object URLs are a process-wide leak if they are never revoked, and the
    // composer can churn through many across one conversation.
    useEffect(() => {
        return () => {
            attachments.forEach((attachment) => {
                if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
            });
        };
        // Intentionally on unmount only: revoking on every change would kill the
        // previews still on screen.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const readFiles = async (files: FileList) => {
        const room = MAX_CHAT_ATTACHMENTS - attachments.length;
        if (room <= 0) {
            toast.error(formatMessage(m.composer.tooManyFiles, { count: MAX_CHAT_ATTACHMENTS }));
            return;
        }

        setReading(true);
        try {
            const accepted: PendingAttachment[] = [];
            for (const file of Array.from(files).slice(0, room)) {
                if (!(CHAT_ACCEPTED_MIME_TYPES as readonly string[]).includes(file.type)) {
                    toast.error(formatMessage(m.composer.badFileType, { name: file.name }));
                    continue;
                }
                if (file.size > MAX_CHAT_FILE_BYTES) {
                    toast.error(formatMessage(m.composer.fileTooLarge, { name: file.name }));
                    continue;
                }
                accepted.push({
                    id: String(++pendingId),
                    fileName: file.name,
                    mimeType: file.type,
                    size: file.size,
                    fileBase64: await toBase64(file),
                    previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
                });
            }
            if (accepted.length > 0) setAttachments((prev) => [...prev, ...accepted]);
        } finally {
            setReading(false);
            // Reset so picking the same file twice in a row still fires onChange.
            if (fileRef.current) fileRef.current.value = '';
        }
    };

    const dropAttachment = (id: string) => {
        setAttachments((prev) => {
            const target = prev.find((attachment) => attachment.id === id);
            if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
            return prev.filter((attachment) => attachment.id !== id);
        });
    };

    const submit = async () => {
        const trimmed = body.trim();
        if (!trimmed && attachments.length === 0) return;

        const ok = await onSend(trimmed, attachments);
        if (!ok) return;

        attachments.forEach((attachment) => {
            if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
        });
        setBody('');
        setAttachments([]);
    };

    const busy = sending || reading;
    const canSend = !disabled && !busy && (body.trim().length > 0 || attachments.length > 0);

    return (
        <div className="border-t border-gray-200 bg-white p-3">
            {editing && (
                <div className="mb-2 flex items-center justify-between rounded-md bg-blue-50 px-2 py-1.5 text-xs text-blue-700">
                    <span>{m.composer.editingNotice}</span>
                    <button
                        type="button"
                        onClick={onCancelEdit}
                        className="min-h-touch px-2 font-medium hover:underline"
                    >
                        {m.composer.cancelEdit}
                    </button>
                </div>
            )}

            {attachments.length > 0 && (
                <ul className="mb-2 flex flex-wrap gap-2">
                    {attachments.map((attachment) => (
                        <li
                            key={attachment.id}
                            className="relative flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 p-1.5 text-xs"
                        >
                            {attachment.previewUrl ? (
                                <img
                                    src={attachment.previewUrl}
                                    alt=""
                                    className="h-10 w-10 rounded object-cover"
                                />
                            ) : (
                                <span className="max-w-[140px] truncate px-1">
                                    {attachment.fileName}
                                </span>
                            )}
                            <button
                                type="button"
                                onClick={() => dropAttachment(attachment.id)}
                                aria-label={formatMessage(m.composer.removeFile, {
                                    name: attachment.fileName,
                                })}
                                className="rounded-full p-1 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
                            >
                                <X className="h-3 w-3" />
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            <div className="flex items-end gap-2">
                {!editing && (
                    <>
                        <input
                            ref={fileRef}
                            type="file"
                            multiple
                            accept={CHAT_ACCEPTED_MIME_TYPES.join(',')}
                            className="hidden"
                            onChange={(event) => {
                                if (event.target.files) void readFiles(event.target.files);
                            }}
                        />
                        <button
                            type="button"
                            onClick={() => fileRef.current?.click()}
                            disabled={disabled || busy}
                            aria-label={m.composer.attach}
                            className="flex min-h-touch min-w-touch items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
                        >
                            <Paperclip className="h-4 w-4" />
                        </button>
                    </>
                )}

                <textarea
                    ref={textRef}
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    onKeyDown={(event) => {
                        // Enter sends, Shift+Enter breaks the line — the convention
                        // every chat app has trained people into.
                        if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault();
                            void submit();
                        }
                    }}
                    rows={1}
                    disabled={disabled}
                    placeholder={disabled ? m.composer.archivedPlaceholder : m.composer.placeholder}
                    className="max-h-32 min-h-touch flex-1 resize-y rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600 disabled:bg-gray-50"
                />

                <button
                    type="button"
                    onClick={() => void submit()}
                    disabled={!canSend}
                    aria-label={m.composer.send}
                    className="flex min-h-touch min-w-touch items-center justify-center rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                >
                    {busy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <Send className="h-4 w-4" />
                    )}
                </button>
            </div>
        </div>
    );
}

function toBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        // The backend accepts the whole data: URL, so there is nothing to strip.
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}
