'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useVisibleInterval } from './useVisibleInterval';

const POLL_MS = 60_000;
export const MEETING_ACTIONS_CHANGED_EVENT = 'erp71:meeting-actions-changed';

export function notifyMeetingActionsChanged() {
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(MEETING_ACTIONS_CHANGED_EVENT));
    }
}

export function useOverdueMeetingActionsCount() {
    const [count, setCount] = useState(0);

    const refresh = useCallback(async () => {
        try {
            const result = await api.getMeetingActionsOverdueCount();
            setCount(Number(result?.count ?? 0));
        } catch {
            setCount(0);
        }
    }, []);

    useEffect(() => {
        void refresh();
        const onChanged = () => void refresh();
        window.addEventListener(MEETING_ACTIONS_CHANGED_EVENT, onChanged);
        return () => window.removeEventListener(MEETING_ACTIONS_CHANGED_EVENT, onChanged);
    }, [refresh]);

    useVisibleInterval(() => void refresh(), POLL_MS);
    return { count, refresh };
}
