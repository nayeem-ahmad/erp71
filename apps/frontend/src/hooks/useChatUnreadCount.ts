'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useVisibleInterval } from './useVisibleInterval';

const POLL_MS = 60_000;

/** Dispatched by the chat page after it marks a conversation read, so the badge clears without waiting for the next poll. */
export const CHAT_UNREAD_CHANGED_EVENT = 'erp71:chat-unread-changed';

export function notifyChatUnreadChanged() {
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(CHAT_UNREAD_CHANGED_EVENT));
    }
}

/**
 * Unread team-chat messages, for the sidebar's Chat link and the mobile menu
 * button. It used to be a header icon of its own; the count now hangs off the
 * entry it leads to.
 *
 * Polls at 60s rather than the chat page's 5s, and only while the tab is in
 * view: this runs for every signed-in member on every page, so it is the count
 * that has to stay cheap. The open conversation is what needs to feel live.
 *
 * `enabled` is the shell's own reading of the add-on and the member's
 * `USE_TEAM_CHAT` permission, so a workspace without chat sends nothing at all.
 * A 403 or 404 anyway means the guard disagrees, and stops the polling for the
 * rest of the session; anything else is transient and the next tick retries.
 */
export function useChatUnreadCount(enabled: boolean): number {
    const [count, setCount] = useState(0);
    const [available, setAvailable] = useState(true);
    const active = enabled && available;

    const refresh = useCallback(async () => {
        try {
            const data = await api.getChatUnreadCount();
            setCount(Number((data as { count?: number })?.count ?? 0));
        } catch (error) {
            const status = (error as { status?: number })?.status;
            if (status === 403 || status === 404) setAvailable(false);
        }
    }, []);

    useEffect(() => {
        if (!active) return;
        void refresh();

        const onChanged = () => void refresh();
        window.addEventListener(CHAT_UNREAD_CHANGED_EVENT, onChanged);

        return () => window.removeEventListener(CHAT_UNREAD_CHANGED_EVENT, onChanged);
    }, [active, refresh]);

    useVisibleInterval(() => void refresh(), active ? POLL_MS : null);

    return active ? count : 0;
}
