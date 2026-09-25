'use client';

import { useEffect } from 'react';
import { Play, Square } from 'lucide-react';
import { Button } from '@/components/ui';
import { useProjectTimerStore } from '@/lib/project-timer-store';
import { useProjectTimerActions } from '../use-project-timer';
import { useTimerElapsed } from '../use-timer-elapsed';
import { formatElapsed } from '../hour-log-day';
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
    className = '',
}: {
    taskId: string;
    onChanged: () => Promise<void>;
    className?: string;
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
            // Tinted while it runs here: the clock is live, and a button that
            // looks the same running and idle is how a timer gets forgotten.
            // Blue, not red — stopping a clock loses nothing.
            variant={mine ? 'tinted' : 'secondary'}
            className={`justify-center ${className}`}
            disabled={busy || elsewhere}
            title={elsewhere ? m.timer.elsewhere : undefined}
            onClick={() => run(() => (mine ? stop() : start({ taskId, tagIds: [] })))}
        >
            {mine ? (
                <>
                    <Square className="h-3.5 w-3.5 fill-current" aria-hidden />
                    {m.timer.stop}
                    <Elapsed />
                </>
            ) : (
                <>
                    <Play className="h-4 w-4" aria-hidden />
                    <span className="truncate">{elsewhere ? m.timer.elsewhere : m.timer.start}</span>
                </>
            )}
        </Button>
    );
}

/**
 * The running figure, in its own component so the once-a-second re-render it
 * drives stays inside the button rather than re-rendering the whole card.
 */
function Elapsed() {
    const elapsed = formatElapsed(useTimerElapsed());
    return <span className="font-mono text-xs font-medium tabular-nums">{elapsed}</span>;
}
