'use client';

import { useEffect, useState } from 'react';
import { Square, Timer } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useProjectTimerStore } from '@/lib/project-timer-store';
import { formatElapsed } from './hour-log-day';
import { useProjectTimerActions } from './use-project-timer';

/**
 * The running clock, in the header.
 *
 * The floating tracker can be dragged out of the way, collapsed, or left on a
 * page you have navigated away from — all deliberate, but it means the one
 * thing a running timer must do, stay visible, depends on where somebody put
 * it. The header does that by construction: it is on every `(app)` page, in the
 * same place, and covers nothing.
 *
 * This is display and stop only. Starting with a note, picking tags, choosing a
 * task and logging time by hand all still belong to the tracker, which this
 * opens — a chip is not the place for a form.
 */
export default function TimerChip() {
    const { t } = useI18n();
    const m = t.projects;

    const timer = useProjectTimerStore((state) => state.timer);
    const loaded = useProjectTimerStore((state) => state.loaded);
    const busy = useProjectTimerStore((state) => state.busy);
    const open = useProjectTimerStore((state) => state.open);
    const setOpen = useProjectTimerStore((state) => state.setOpen);
    const { load, stop } = useProjectTimerActions();

    useEffect(() => {
        if (!loaded) load();
    }, [loaded, load]);

    // Seeded from the server and ticked locally, keyed on the two fields rather
    // than the object so a refetch does not restart the count. Same approach as
    // the tracker, which may be showing the very same clock beside this one.
    const [elapsed, setElapsed] = useState(0);
    useEffect(() => {
        if (!timer) return;
        setElapsed(timer.elapsed_seconds);
        const handle = setInterval(() => setElapsed((value) => value + 1), 1000);
        return () => clearInterval(handle);
        // Keyed on the two fields, not on `timer`: it is a fresh object on every
        // refetch, and depending on it would restart the interval — and the
        // count — several times a minute.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [timer?.id, timer?.elapsed_seconds]);

    if (!timer) {
        // Nothing running: one button that opens the tracker, so a timer can be
        // started from any page rather than only from the hour log.
        return (
            <button
                type="button"
                onClick={() => setOpen(!open)}
                aria-label={m.timer.open}
                title={m.timer.open}
                className="inline-flex min-h-touch items-center justify-center rounded-md p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-600 md:min-h-0"
            >
                <Timer className="h-5 w-5" aria-hidden />
            </button>
        );
    }

    const task = timer.task?.title ?? m.timer.noTask;

    return (
        <div className="flex items-center gap-1">
            <button
                type="button"
                onClick={() => setOpen(true)}
                title={`${task} — ${m.timer.openTracker}`}
                className="inline-flex min-h-touch items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-emerald-700 transition-colors hover:bg-emerald-100 focus:outline-none focus:ring-2 focus:ring-blue-600 md:min-h-0"
            >
                <span className="relative flex h-2 w-2" aria-hidden>
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                {/* The clock is the point, so it survives every breakpoint; the
                    task name is the first thing to go on a narrow screen. */}
                <span className="font-mono text-xs tabular-nums">{formatElapsed(elapsed)}</span>
                <span className="hidden max-w-[10rem] truncate text-xs lg:inline">{task}</span>
            </button>
            <button
                type="button"
                onClick={() => void stop()}
                disabled={busy}
                aria-label={m.timer.stop}
                title={m.timer.stop}
                className="inline-flex min-h-touch items-center justify-center rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:opacity-50 md:min-h-0"
            >
                <Square className="h-4 w-4" aria-hidden />
            </button>
        </div>
    );
}

/** Shown on a task card that the running clock belongs to. */
export function useIsTimerRunningFor(taskId: string | null | undefined): boolean {
    return useProjectTimerStore((state) => Boolean(taskId) && state.timer?.task?.id === taskId);
}
