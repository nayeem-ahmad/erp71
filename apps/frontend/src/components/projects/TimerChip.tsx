'use client';

import { useEffect, useId } from 'react';
import { Square, Timer } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useProjectTimerStore } from '@/lib/project-timer-store';
import { useTimerElapsed } from './use-timer-elapsed';
import { formatElapsed, projectDotClass, type RunningTimer } from './hour-log-day';
import { useProjectTimerActions } from './use-project-timer';

/**
 * Marks the element the tracker panel opens beneath. An attribute rather than a
 * ref because the chip and the panel are mounted in different parts of the
 * layout, and threading a ref between them would couple both to the header.
 */
export const TIMER_ANCHOR_ATTR = 'data-timer-anchor';

export const findTimerAnchor = (): HTMLElement | null =>
    document.querySelector<HTMLElement>(`[${TIMER_ANCHOR_ATTR}]`);

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
 * opens — a chip is not the place for a form. Hovering it says a little more
 * than fits in the chip: the task, its project, when it started and the note.
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

    // Coming back to the tab re-asks the server. The clock on screen is the
    // server's count plus local time since, and the local half is only as good
    // as the device clock: a laptop waking from sleep or an OS time correction
    // moves it, and until now only a reload put it right. It also catches a
    // timer started or stopped on another device while this tab sat hidden.
    // The chip is on every `(app)` page, so this is the one place that listens.
    useEffect(() => {
        const resync = () => {
            if (document.visibilityState === 'visible') load();
        };
        document.addEventListener('visibilitychange', resync);
        window.addEventListener('online', resync);
        return () => {
            document.removeEventListener('visibilitychange', resync);
            window.removeEventListener('online', resync);
        };
    }, [load]);

    const elapsed = useTimerElapsed();
    const cardId = useId();

    // Not while the panel is open: it sits right where the card would, and
    // says everything the card does and more.
    const card = open ? null : (
        <TimerHoverCard
            id={cardId}
            timer={timer}
            elapsed={elapsed}
            labels={{
                title: m.timer.open,
                running: m.timer.running,
                noTask: m.timer.noTask,
                idleHint: m.timer.idleHint,
                startedAt: m.timer.startedAt,
                clickToOpen: m.timer.clickToOpen,
            }}
        />
    );

    if (!timer) {
        // Nothing running: one button that opens the tracker, so a timer can be
        // started from any page rather than only from the hour log.
        return (
            <div {...{ [TIMER_ANCHOR_ATTR]: '' }} className="group relative">
                <button
                    type="button"
                    onClick={() => setOpen(!open)}
                    aria-label={m.timer.open}
                    aria-describedby={card ? cardId : undefined}
                    aria-expanded={open}
                    className="inline-flex min-h-touch items-center justify-center rounded-md p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-600 md:min-h-0"
                >
                    <Timer className="h-5 w-5" aria-hidden />
                </button>
                {card}
            </div>
        );
    }

    const task = timer.task?.title ?? m.timer.noTask;

    return (
        <div {...{ [TIMER_ANCHOR_ATTR]: '' }} className="group relative flex items-center gap-1">
            <button
                type="button"
                onClick={() => setOpen(!open)}
                aria-describedby={card ? cardId : undefined}
                aria-expanded={open}
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
            {card}
        </div>
    );
}

interface HoverCardLabels {
    title: string;
    running: string;
    noTask: string;
    idleHint: string;
    startedAt: string;
    clickToOpen: string;
}

/** `HH:mm` in the viewer's clock, for a timer the server sent no wall time for. */
const localClock = (iso: string): string => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
        ? ''
        : `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

/**
 * What hovering (or focusing) the chip shows. CSS-only — the group's hover and
 * focus-within — so it costs nothing until it is wanted and never lingers.
 * Hidden below `md`, where there is no hover and a tap opens the tracker.
 */
function TimerHoverCard({
    id,
    timer,
    elapsed,
    labels,
}: {
    id: string;
    timer: RunningTimer | null;
    elapsed: number;
    labels: HoverCardLabels;
}) {
    const startedAt = timer ? (timer.start_time ?? localClock(timer.started_at)) : '';

    return (
        <div
            id={id}
            role="tooltip"
            className="pointer-events-none invisible absolute end-0 top-full z-30 mt-1 hidden w-64 rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-600 opacity-0 shadow-lg transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100 md:block"
        >
            {timer ? (
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-emerald-700">{labels.running}</span>
                        <span className="font-mono text-sm font-semibold tabular-nums text-gray-900">
                            {formatElapsed(elapsed)}
                        </span>
                    </div>
                    <p className="text-sm font-medium text-gray-900">{timer.task?.title ?? labels.noTask}</p>
                    {timer.project ? (
                        <p className="flex min-w-0 items-center gap-1.5">
                            <span
                                className={`h-2 w-2 flex-shrink-0 rounded-full ${projectDotClass(timer.project.code)}`}
                                aria-hidden
                            />
                            <span className="truncate">
                                {timer.project.code} · {timer.project.name}
                            </span>
                        </p>
                    ) : null}
                    {startedAt ? (
                        <p>
                            {labels.startedAt}{' '}
                            <span className="font-medium tabular-nums text-gray-900">{startedAt}</span>
                        </p>
                    ) : null}
                    {timer.note ? <p className="line-clamp-2 italic text-gray-500">{timer.note}</p> : null}
                    {timer.tags && timer.tags.length > 0 ? (
                        <p className="flex flex-wrap gap-1">
                            {timer.tags.map((tag) => (
                                <span key={tag.id} className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">
                                    {tag.name}
                                </span>
                            ))}
                        </p>
                    ) : null}
                </div>
            ) : (
                <div className="space-y-1">
                    <p className="text-sm font-medium text-gray-900">{labels.title}</p>
                    <p>{labels.idleHint}</p>
                </div>
            )}
            {timer ? (
                <p className="mt-2 border-t border-gray-100 pt-2 text-gray-400">{labels.clickToOpen}</p>
            ) : null}
        </div>
    );
}

/** Shown on a task card that the running clock belongs to. */
export function useIsTimerRunningFor(taskId: string | null | undefined): boolean {
    return useProjectTimerStore((state) => Boolean(taskId) && state.timer?.task?.id === taskId);
}
