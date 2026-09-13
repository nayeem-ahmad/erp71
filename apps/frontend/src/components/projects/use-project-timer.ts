'use client';

import { useCallback } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { useProjectTimerStore } from '@/lib/project-timer-store';
import type { RunningTimer } from './hour-log-day';

const errorText = (error: unknown, fallback: string): string =>
    error instanceof Error ? error.message : fallback;

/**
 * Every call that moves the one running clock, in one place.
 *
 * The floating panel owns the clock, but the hour log still restarts a row from
 * its ▷ button, and both have to leave the store saying the same thing
 * afterwards. Splitting these out of either component is what keeps a start
 * from one screen and a stop from the other behaving identically.
 */
export function useProjectTimerActions() {
    const { t } = useI18n();
    const m = t.projects;
    const hl = m.hourLogs;
    const setTimer = useProjectTimerStore((state) => state.setTimer);
    const setBusy = useProjectTimerStore((state) => state.setBusy);
    const bumpRevision = useProjectTimerStore((state) => state.bumpRevision);

    const load = useCallback(() => {
        api.getProjectTimer()
            .then((data: unknown) => setTimer((data as RunningTimer) ?? null))
            .catch(() => setTimer(null));
    }, [setTimer]);

    /**
     * One busy flag so a double press cannot double-write, one place that
     * reports a failure, and a refetch afterwards either way — a start that
     * failed and a start that succeeded both leave the panel needing to know
     * what the server thinks is running.
     */
    const run = useCallback(
        async (action: () => Promise<unknown>, fallback: string): Promise<void> => {
            setBusy(true);
            try {
                await action();
            } catch (error) {
                toast.error(errorText(error, fallback));
            } finally {
                setBusy(false);
                load();
            }
        },
        [setBusy, load],
    );

    const start = useCallback(
        (input: { taskId: string; note?: string; tagIds: string[] }) =>
            run(async () => {
                await api.startProjectTimer(input);
                toast.success(hl.timerStarted);
            }, hl.timerStartFailed),
        [run, hl],
    );

    const stop = useCallback(
        () =>
            run(async () => {
                const result = (await api.stopProjectTimer()) as
                    | { overlap?: { taskTitle?: string | null } | null }
                    | null;
                // A stop always writes the entry, however briefly the clock ran —
                // the discard button beside it is the way to throw one away.
                toast.success(m.time.logged);
                if (result?.overlap) {
                    toast.info(hl.timerOverlapped.replace('{task}', result.overlap.taskTitle ?? '—'));
                }
                bumpRevision();
            }, hl.timerStopFailed),
        [run, hl, m, bumpRevision],
    );

    const discard = useCallback(
        () =>
            run(async () => {
                await api.discardProjectTimer();
                toast.info(hl.timerDiscarded);
            }, hl.timerStopFailed),
        [run, hl],
    );

    const patch = useCallback(
        (input: { note?: string; tagIds?: string[]; startTime?: string }) =>
            run(() => api.updateProjectTimer(input), hl.timerUpdateFailed),
        [run, hl],
    );

    return { load, start, stop, discard, patch };
}
