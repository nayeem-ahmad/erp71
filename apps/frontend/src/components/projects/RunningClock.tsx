'use client';

import { Square } from 'lucide-react';
import { useTimerElapsed } from './use-timer-elapsed';
import { formatElapsed } from './hour-log-day';

/**
 * The running clock on the card it belongs to, with its stop button.
 *
 * A component of its own so that only the one card with a running clock
 * re-renders every second, not every card on the board. The count is the same
 * `useTimerElapsed` the header chip and the tracker read, so all three show the
 * same time.
 */
export default function RunningClock({
    label,
    stopLabel,
    busy,
    onStop,
}: {
    label: string;
    stopLabel: string;
    busy: boolean;
    onStop: () => void;
}) {
    const elapsed = formatElapsed(useTimerElapsed());
    return (
        <>
            <span
                className="inline-flex items-center gap-1.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700"
                title={label}
            >
                <span className="relative flex h-1.5 w-1.5" aria-hidden>
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                </span>
                <span className="sr-only">{label}: </span>
                <span className="font-mono tabular-nums">{elapsed}</span>
            </span>
            <button
                type="button"
                aria-label={stopLabel}
                title={stopLabel}
                tabIndex={-1}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                    e.stopPropagation();
                    onStop();
                }}
                disabled={busy}
                className="max-md:min-h-touch max-md:min-w-touch inline-flex items-center justify-center rounded px-1 text-emerald-600 hover:text-emerald-700 disabled:opacity-40"
            >
                <Square className="h-3.5 w-3.5" />
            </button>
        </>
    );
}
