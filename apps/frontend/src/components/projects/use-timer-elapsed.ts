'use client';

import { useEffect, useReducer } from 'react';
import { useProjectTimerStore } from '@/lib/project-timer-store';

/**
 * Seconds on the running clock, re-rendering once a second while it runs.
 *
 * The server's `elapsed_seconds` plus the time since that answer arrived. Both
 * halves matter. Counting from the device's own `Date.now()` against
 * `started_at` would show a phone whose clock is minutes out a figure the
 * server never records. Adding one per interval tick drifts behind instead:
 * browsers throttle timers in a background tab to once a minute or less, so a
 * tab left behind for an hour came back showing a few minutes. A difference of
 * two local readings carries neither error.
 */
export function useTimerElapsed(): number {
    const timer = useProjectTimerStore((state) => state.timer);
    const receivedAt = useProjectTimerStore((state) => state.receivedAt);
    const [, tick] = useReducer((count: number) => count + 1, 0);

    const running = Boolean(timer);
    useEffect(() => {
        if (!running) return;
        const handle = setInterval(tick, 1000);
        return () => clearInterval(handle);
    }, [running]);

    if (!timer) return 0;
    return timer.elapsed_seconds + Math.max(0, Math.floor((Date.now() - receivedAt) / 1000));
}
