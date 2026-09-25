'use client';

import { useEffect } from 'react';
import { Play, Square } from 'lucide-react';
import { Button } from '@/components/ui';
import { useProjectTimerStore } from '@/lib/project-timer-store';
import { useProjectTimerActions } from '../use-project-timer';
import { useI18n } from '@/lib/i18n';

/**
 * Start the clock on this task, or stop it if it is already running on one.
 *
 * The module has had a `ProjectTimer` and a working `POST /project-time/timer`
 * since Phase 2, driven only from `/projects/hour-logs` — so the person looking
 * at the task they are about to work on had to go to another screen to say so,
 * or type the hours in afterwards from memory. This is the same endpoint, put
 * where the decision is made.
 *
 * There is one timer per person, not one per task, so the button has three
 * states: start, stop (this task), and running-elsewhere — which is disabled
 * rather than hidden, because silently doing nothing is how you end up with two
 * people certain they had a timer going.
 */
export default function TimerButton({
    taskId,
    onChanged,
    full = false,
}: {
    taskId: string;
    onChanged: () => Promise<void>;
    /** Fill the column, for the narrow sidebar the button now lives in. */
    full?: boolean;
}) {
    const { t } = useI18n();
    const m = t.projects;

    // The one running clock lives in the store, not here. A private copy was
    // what kept the floating tracker hidden after starting from a task card:
    // the POST succeeded, this button flipped to "Stop", and the store — which
    // is the only thing the tracker renders from — never heard about it.
    const timer = useProjectTimerStore((state) => state.timer);
    const loaded = useProjectTimerStore((state) => state.loaded);
    const busy = useProjectTimerStore((state) => state.busy);
    const { load, start, stop } = useProjectTimerActions();

    useEffect(() => {
        // The layout's tracker loads this too, but a task card can be opened on
        // a route where the tracker is gated off, so it asks once itself.
        if (!loaded) load();
    }, [loaded, load]);

    const run = async (action: () => Promise<unknown>) => {
        await action();
        await onChanged();
    };

    const runningOn = timer?.task?.id ?? null;
    const mine = runningOn === taskId;
    const elsewhere = runningOn != null && !mine;

    return (
        <Button
            type="button"
            variant={mine ? 'secondary' : 'ghost'}
            className={`max-md:min-h-touch${full ? ' mt-2 w-full justify-center' : ''}`}
            disabled={busy || elsewhere}
            title={elsewhere ? m.timer.elsewhere : undefined}
            onClick={() => run(() => (mine ? stop() : start({ taskId, tagIds: [] })))}
        >
            {mine ? (
                <>
                    <Square className="h-4 w-4" aria-hidden />
                    {m.timer.stop}
                </>
            ) : (
                <>
                    <Play className="h-4 w-4" aria-hidden />
                    {elsewhere ? m.timer.elsewhere : m.timer.start}
                </>
            )}
        </Button>
    );
}
