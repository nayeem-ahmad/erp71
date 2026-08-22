'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { MessagesSquare } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';

/**
 * Unread badge for team chat.
 *
 * Polls at the same 60s cadence as NotificationBell rather than the chat page's
 * 5s: this one runs for every signed-in user on every page, so it is the count
 * that has to stay cheap. The open conversation is what needs to feel live.
 *
 * Renders nothing at all when the workspace has no chat entitlement — the API
 * answers 403 and there is no badge to show.
 */
export default function ChatBell() {
    const { t } = useI18n();
    const [unreadCount, setUnreadCount] = useState(0);
    const [available, setAvailable] = useState(true);

    const fetchCount = useCallback(async () => {
        try {
            const data = await api.getChatUnreadCount();
            setUnreadCount((data as { count?: number })?.count ?? 0);
            setAvailable(true);
        } catch (error) {
            // A 403 means the add-on is not active for this workspace; anything
            // else is transient and the next tick can retry.
            const status = (error as { status?: number })?.status;
            if (status === 403 || status === 404) setAvailable(false);
        }
    }, []);

    useEffect(() => {
        void fetchCount();
        const interval = setInterval(() => void fetchCount(), 60_000);
        return () => clearInterval(interval);
    }, [fetchCount]);

    if (!available) return null;

    return (
        <Link
            href={routes.chat}
            aria-label={t.chat.bell.label}
            className="relative flex min-h-touch min-w-touch items-center justify-center rounded-md text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
        >
            <MessagesSquare className="h-5 w-5" aria-hidden="true" />
            {unreadCount > 0 && (
                <span className="absolute end-1 top-1 min-w-[16px] rounded-full bg-blue-600 px-1 text-center text-[10px] font-semibold leading-4 text-white">
                    {unreadCount > 9 ? '9+' : unreadCount}
                </span>
            )}
        </Link>
    );
}
