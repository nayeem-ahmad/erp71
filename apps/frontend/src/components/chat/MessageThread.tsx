'use client';

import { useEffect, useRef } from 'react';
import { FileText, Loader2, Pencil, Trash2 } from 'lucide-react';
import { useI18n, formatMessage } from '@/lib/i18n';
import ChatAvatar from './ChatAvatar';
import { displayName, type ChatMessage } from './types';

/** Mirrors the backend's CHAT_EDIT_WINDOW_MS, so the affordance matches the rule. */
const EDIT_WINDOW_MS = 15 * 60 * 1000;

export default function MessageThread({
    messages,
    currentUserId,
    seenMessageId,
    loading,
    hasMore,
    loadingMore,
    onLoadMore,
    onEdit,
    onDelete,
}: {
    messages: ChatMessage[];
    currentUserId: string | null;
    /** Newest own message the other side has seen — see `seenReceiptMessageId`. */
    seenMessageId?: string | null;
    loading: boolean;
    hasMore: boolean;
    loadingMore: boolean;
    onLoadMore: () => void;
    onEdit: (message: ChatMessage) => void;
    onDelete: (message: ChatMessage) => void;
}) {
    const { t, locale } = useI18n();
    const m = t.chat;
    const endRef = useRef<HTMLDivElement>(null);
    const newestIdRef = useRef<string | null>(null);

    // Scroll only when the newest message actually changes. Scrolling on every
    // render would yank the view back down each time the 5s poll returns, which
    // makes reading history impossible.
    useEffect(() => {
        const newestId = messages.length > 0 ? messages[messages.length - 1].id : null;
        if (newestId && newestId !== newestIdRef.current) {
            newestIdRef.current = newestId;
            endRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages]);

    if (loading && messages.length === 0) {
        return (
            <div className="flex flex-1 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" aria-label={m.thread.loading} />
            </div>
        );
    }

    const timeLabel = (iso: string) =>
        new Date(iso).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });

    const dayLabel = (iso: string) =>
        new Date(iso).toLocaleDateString(locale, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
        });

    let lastDay = '';

    return (
        <div className="flex-1 overflow-y-auto p-3 md:p-4">
            {hasMore && (
                <div className="mb-3 flex justify-center">
                    <button
                        type="button"
                        onClick={onLoadMore}
                        disabled={loadingMore}
                        className="min-h-touch rounded-md px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                    >
                        {loadingMore ? m.thread.loadingMore : m.thread.loadMore}
                    </button>
                </div>
            )}

            <ul className="space-y-2">
                {messages.map((message) => {
                    const day = dayLabel(message.createdAt);
                    const showDay = day !== lastDay;
                    lastDay = day;

                    if (message.kind === 'system') {
                        return (
                            <li key={message.id}>
                                {showDay && <DayDivider label={day} />}
                                <p className="py-1 text-center text-xs text-gray-500">{message.body}</p>
                            </li>
                        );
                    }

                    const mine = message.sender.id === currentUserId;
                    const editable =
                        mine &&
                        !message.deleted &&
                        Date.now() - new Date(message.createdAt).getTime() < EDIT_WINDOW_MS;

                    return (
                        <li key={message.id}>
                            {showDay && <DayDivider label={day} />}
                            <div className={`flex gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
                                {!mine && <ChatAvatar person={message.sender} />}

                                <div className={`group max-w-[85%] md:max-w-[70%] ${mine ? 'items-end' : ''}`}>
                                    {!mine && (
                                        <p className="mb-0.5 text-xs font-medium text-gray-600">
                                            {displayName(message.sender)}
                                        </p>
                                    )}

                                    <div
                                        className={`rounded-lg px-3 py-2 text-sm ${
                                            message.deleted
                                                ? 'bg-gray-50 italic text-gray-400'
                                                : mine
                                                  ? 'bg-blue-600 text-white'
                                                  : 'bg-gray-100 text-gray-900'
                                        }`}
                                    >
                                        {message.deleted ? (
                                            <span>{m.thread.deleted}</span>
                                        ) : (
                                            <>
                                                {message.body && (
                                                    <p className="whitespace-pre-wrap break-words">
                                                        {message.body}
                                                    </p>
                                                )}
                                                {message.attachments.length > 0 && (
                                                    <ul
                                                        className={`flex flex-wrap gap-2 ${message.body ? 'mt-2' : ''}`}
                                                    >
                                                        {message.attachments.map((attachment) => (
                                                            <li key={attachment.id}>
                                                                <a
                                                                    href={attachment.url}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="block"
                                                                >
                                                                    {attachment.mimeType.startsWith('image/') ? (
                                                                        <img
                                                                            src={attachment.url}
                                                                            alt={attachment.name}
                                                                            className="max-h-40 rounded-md object-cover"
                                                                        />
                                                                    ) : (
                                                                        <span
                                                                            className={`flex min-h-touch items-center gap-1.5 rounded-md px-2 py-1.5 text-xs underline ${
                                                                                mine
                                                                                    ? 'bg-blue-500 text-white'
                                                                                    : 'bg-white text-gray-700'
                                                                            }`}
                                                                        >
                                                                            <FileText
                                                                                className="h-3.5 w-3.5"
                                                                                aria-hidden="true"
                                                                            />
                                                                            {attachment.name}
                                                                        </span>
                                                                    )}
                                                                </a>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                )}
                                            </>
                                        )}
                                    </div>

                                    <div
                                        className={`mt-0.5 flex items-center gap-2 text-[11px] text-gray-400 ${
                                            mine ? 'justify-end' : ''
                                        }`}
                                    >
                                        <span>{timeLabel(message.createdAt)}</span>
                                        {message.editedAt && <span>{m.thread.edited}</span>}
                                        {message.id === seenMessageId && (
                                            <span className="text-blue-600">{m.thread.seen}</span>
                                        )}
                                        {editable && (
                                            <button
                                                type="button"
                                                onClick={() => onEdit(message)}
                                                className="hidden text-gray-400 hover:text-blue-600 group-hover:inline"
                                                aria-label={m.thread.edit}
                                            >
                                                <Pencil className="h-3 w-3" />
                                            </button>
                                        )}
                                        {mine && !message.deleted && (
                                            <button
                                                type="button"
                                                onClick={() => onDelete(message)}
                                                className="hidden text-gray-400 hover:text-red-600 group-hover:inline"
                                                aria-label={m.thread.delete}
                                            >
                                                <Trash2 className="h-3 w-3" />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </li>
                    );
                })}
            </ul>

            {messages.length === 0 && (
                <p className="py-8 text-center text-xs text-gray-500">
                    {formatMessage(m.thread.empty, {})}
                </p>
            )}

            <div ref={endRef} />
        </div>
    );
}

function DayDivider({ label }: { label: string }) {
    return (
        <div className="my-3 flex items-center gap-2">
            <span className="h-px flex-1 bg-gray-100" />
            <span className="text-[11px] text-gray-400">{label}</span>
            <span className="h-px flex-1 bg-gray-100" />
        </div>
    );
}
