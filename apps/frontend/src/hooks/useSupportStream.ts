'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

/** What the backend publishes when a thread moves. */
export interface SupportStreamEvent {
    kind: 'status' | 'message';
    threadId: string;
    ticketNumber: number;
    status: string;
    actor: 'owner' | 'admin';
    at: string;
}

function isSupportStreamEvent(value: unknown): value is SupportStreamEvent {
    if (!value || typeof value !== 'object') return false;
    const event = value as Partial<SupportStreamEvent>;
    return typeof event.threadId === 'string' && (event.kind === 'status' || event.kind === 'message');
}

/**
 * Subscribes to this workspace's support thread changes.
 *
 * `connected` is the point of the return value: a screen using this keeps a
 * poll running and slows it right down once the stream is live, so a browser or
 * proxy that will not carry the stream degrades to the old behaviour instead of
 * going stale. Nothing here is the source of truth — `onEvent` is a nudge to
 * re-read over the ordinary endpoints.
 *
 * The callback is held in a ref so a page can pass an inline function without
 * tearing down and re-establishing the stream on every render.
 */
export function useSupportStream(
    onEvent: (event: SupportStreamEvent) => void,
    options?: { enabled?: boolean },
): { connected: boolean } {
    const enabled = options?.enabled ?? true;
    const [connected, setConnected] = useState(false);
    const handlerRef = useRef(onEvent);
    handlerRef.current = onEvent;

    useEffect(() => {
        if (!enabled) {
            setConnected(false);
            return;
        }

        const close = api.openSupportStream({
            onFrame: (frame) => {
                // `ready` is the server saying hello and carries no thread.
                if (frame.event === 'ready') return;
                if (isSupportStreamEvent(frame.data)) handlerRef.current(frame.data);
            },
            onConnected: setConnected,
        });

        return () => {
            close();
            setConnected(false);
        };
    }, [enabled]);

    return { connected };
}
