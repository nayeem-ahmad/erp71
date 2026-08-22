'use client';

import { Archive, BellOff, MessagesSquare, Users } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import ChatAvatar from './ChatAvatar';
import type { ChatConversation } from './types';

export default function ConversationList({
    conversations,
    activeId,
    loading,
    onSelect,
}: {
    conversations: ChatConversation[];
    activeId: string | null;
    loading: boolean;
    onSelect: (id: string) => void;
}) {
    const { t, locale } = useI18n();
    const m = t.chat;

    const timeLabel = (iso: string | null): string => {
        if (!iso) return '';
        const date = new Date(iso);
        const sameDay = new Date().toDateString() === date.toDateString();
        return sameDay
            ? date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
            : date.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
    };

    if (loading && conversations.length === 0) {
        return <p className="p-3 text-xs text-gray-500">{m.list.loading}</p>;
    }

    if (conversations.length === 0) {
        return (
            <div className="flex flex-col items-center gap-2 p-6 text-center">
                <MessagesSquare className="h-8 w-8 text-gray-300" aria-hidden="true" />
                <p className="text-xs text-gray-500">{m.list.empty}</p>
            </div>
        );
    }

    return (
        <ul className="divide-y divide-gray-100">
            {conversations.map((conversation) => {
                const unread = conversation.unreadCount ?? 0;
                const isActive = conversation.id === activeId;
                const other = conversation.participants.find(
                    (person) => person.name === conversation.title,
                );

                return (
                    <li key={conversation.id}>
                        <button
                            type="button"
                            onClick={() => onSelect(conversation.id)}
                            aria-current={isActive ? 'true' : undefined}
                            className={`flex w-full min-h-touch items-center gap-2 p-3 text-start transition-colors ${
                                isActive ? 'bg-blue-50' : 'hover:bg-gray-50'
                            }`}
                        >
                            {conversation.kind === 'group' ? (
                                <span
                                    aria-hidden="true"
                                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600"
                                >
                                    <Users className="h-4 w-4" />
                                </span>
                            ) : (
                                <ChatAvatar person={other ?? { name: conversation.title }} />
                            )}

                            <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-1">
                                    <span
                                        className={`truncate text-sm ${
                                            unread > 0 ? 'font-semibold text-gray-900' : 'text-gray-800'
                                        }`}
                                    >
                                        {conversation.title}
                                    </span>
                                    {conversation.muted && (
                                        <BellOff
                                            className="h-3 w-3 shrink-0 text-gray-400"
                                            aria-label={m.list.muted}
                                        />
                                    )}
                                    {conversation.archived && (
                                        <Archive
                                            className="h-3 w-3 shrink-0 text-gray-400"
                                            aria-label={m.list.archived}
                                        />
                                    )}
                                </span>
                                <span className="block truncate text-xs text-gray-500">
                                    {conversation.lastMessagePreview || m.list.noMessages}
                                </span>
                            </span>

                            <span className="flex shrink-0 flex-col items-end gap-1">
                                <span className="text-[11px] text-gray-400">
                                    {timeLabel(conversation.lastMessageAt)}
                                </span>
                                {unread > 0 && (
                                    <span className="min-w-[18px] rounded-full bg-blue-600 px-1.5 text-center text-[11px] font-semibold leading-[18px] text-white">
                                        {unread > 99 ? '99+' : unread}
                                    </span>
                                )}
                            </span>
                        </button>
                    </li>
                );
            })}
        </ul>
    );
}
