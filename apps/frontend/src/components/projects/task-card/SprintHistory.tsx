'use client';

import { Fragment } from 'react';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import type { SprintStay } from './model';

/**
 * Worth a row only once a stay has ended. A task only ever in its current
 * sprint has no history the Sprint field above does not already show.
 */
export function hasSprintHistory(stays: SprintStay[] | undefined): stays is SprintStay[] {
    return (stays ?? []).some((stay) => stay.removed_at != null);
}

/**
 * Every sprint the task was attempted in — "Sprint 7 → Sprint 8 → Sprint 9" —
 * oldest first, each a link, the current one in bold. How a past stay ended
 * (carried over, finished, returned) is its title, so the row stays one line.
 */
export default function SprintHistory({ stays }: { stays: SprintStay[] }) {
    const { t } = useI18n();
    const m = t.projects.sprint;
    const outcome: Record<NonNullable<SprintStay['outcome']>, string> = {
        DONE: m.outcomeDone,
        CARRIED_OVER: m.outcomeCarried,
        RETURNED_TO_BACKLOG: m.outcomeReturned,
        REMOVED: m.outcomeRemoved,
    };

    return (
        <span className="flex min-w-0 flex-wrap items-center gap-x-1 px-2 py-1 text-sm text-gray-700">
            {stays.map((stay, i) => {
                const current = stay.removed_at == null;
                return (
                    <Fragment key={`${stay.sprint.id}-${stay.added_at}`}>
                        {i > 0 && (
                            // Reads oldest-first in either direction: the row
                            // flows right-to-left in Arabic and Urdu, so the arrow turns.
                            <span aria-hidden className="inline-block text-gray-400 rtl:rotate-180">
                                →
                            </span>
                        )}
                        <Link
                            href={routes.projects.sprintDetail(stay.sprint.id)}
                            title={current ? m.currentSprint : stay.outcome ? outcome[stay.outcome] : undefined}
                            aria-current={current ? 'true' : undefined}
                            className={`hover:text-blue-600 hover:underline ${current ? 'font-medium text-gray-900' : ''}`}
                        >
                            {stay.sprint.name}
                            {/* The title is hover-only; say it for screen readers too. */}
                            <span className="sr-only">
                                {` (${current ? m.currentSprint : stay.outcome ? outcome[stay.outcome] : ''})`}
                            </span>
                        </Link>
                    </Fragment>
                );
            })}
        </span>
    );
}
