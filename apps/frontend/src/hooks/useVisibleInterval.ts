'use client';

import { useEffect, useRef } from 'react';

/**
 * `setInterval` for polls, standing still while the tab is hidden.
 *
 * A poll in a background tab buys nothing — nobody is looking — but it still
 * costs a request, counts against the API's rate limit (which every till behind
 * a shop's one connection shares), and keeps a phone's radio awake. The
 * notification and chat badges and the voucher queue poll on every page, so a
 * shopkeeper with a few forgotten tabs was paying for all of them, all day.
 *
 * - Nothing ticks while `document.visibilityState === 'hidden'`.
 * - Back in view, it ticks at once if a tick fell due while the tab was
 *   hidden, so the screen catches up without waiting out a whole interval.
 *   Otherwise it finishes the interval it was in. Either way it never runs
 *   faster than `ms`: flicking between tabs is not a way to multiply requests.
 * - `ms` of `null` stops it, for polls that only run in some state.
 *
 * Like `setInterval`, the first tick comes `ms` after it starts; callers load
 * on mount the way they already do. The callback is held in a ref, so an inline
 * function does not restart the timer on every render. A new `ms` does.
 */
export function useVisibleInterval(callback: () => void, ms: number | null): void {
    const callbackRef = useRef(callback);
    callbackRef.current = callback;

    useEffect(() => {
        if (ms === null) return;
        const interval = ms;

        let timer: ReturnType<typeof setTimeout> | null = null;
        // When the interval last started over; the next tick is due `interval` later.
        let lastTick = Date.now();

        const stop = () => {
            if (timer !== null) clearTimeout(timer);
            timer = null;
        };
        const tick = () => {
            lastTick = Date.now();
            // Rescheduled before the callback runs, so one that throws does
            // not end the poll.
            schedule(interval);
            callbackRef.current();
        };
        const schedule = (delay: number) => {
            timer = setTimeout(tick, delay);
        };
        const resume = () => {
            stop();
            const remaining = lastTick + interval - Date.now();
            if (remaining <= 0) tick();
            else schedule(remaining);
        };
        const onVisibilityChange = () => {
            if (document.visibilityState === 'hidden') stop();
            else resume();
        };

        if (document.visibilityState !== 'hidden') schedule(interval);
        document.addEventListener('visibilitychange', onVisibilityChange);

        return () => {
            stop();
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, [ms]);
}
