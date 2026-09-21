'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { NO_FILTERS, type BoardFilters } from './board-tasks';
import { pruneMissingOptions, readStoredFilters, writeStoredFilters } from './board-filter-storage';

export interface BoardFilterControls {
    filters: BoardFilters;
    /** Replaces the whole set. Written through to storage — there is no Save. */
    setFilters: (next: BoardFilters) => void;
}

/**
 * This board's filters, restored from the last visit.
 *
 * Restored once the board's cards have arrived, not on mount, because what is
 * stored is a pair of ids and the board is the only thing that can say whether
 * they still name anyone — see `pruneMissingOptions`. `ready` is the caller's
 * "the cards are in": before it turns true the board is unfiltered, which is
 * also what the first paint has to be, since the server has no `localStorage`
 * and seeding state from it during render is a hydration mismatch.
 *
 * The restore runs once per board. A reader who clears the filters and then
 * sees the board reload — a bulk move answers with the whole board — must not
 * have their cleared filters put back by the arriving cards.
 */
export function useBoardFilters(
    boardId: string,
    ready: boolean,
    available: { assignees: ReadonlySet<string>; labels: ReadonlySet<string> },
): BoardFilterControls {
    const [filters, setFiltersState] = useState<BoardFilters>(NO_FILTERS);

    // `available` is a fresh pair of Sets every render; the effect must not
    // chase it, so it is read through a ref and the effect keys off the board
    // and the readiness flag instead.
    const availableRef = useRef(available);
    availableRef.current = available;

    const restoredFor = useRef<string | null>(null);

    useEffect(() => {
        if (!ready || restoredFor.current === boardId) return;
        restoredFor.current = boardId;

        const stored = readStoredFilters(boardId);
        const pruned = pruneMissingOptions(stored, availableRef.current);
        // Write back a pruned set so the dropped id does not sit in storage
        // waiting to be pruned again on every future visit.
        if (pruned !== stored) writeStoredFilters(boardId, pruned);
        // `text` is never stored: a restored search reads as a board that has
        // lost its cards.
        setFiltersState({ ...pruned, text: '' });
    }, [boardId, ready]);

    const setFilters = useCallback(
        (next: BoardFilters) => {
            setFiltersState(next);
            // Named field by field rather than spread-minus-`text`, so a filter
            // added later has to be considered here before it is persisted.
            writeStoredFilters(boardId, {
                assignee: next.assignee,
                priority: next.priority,
                due: next.due,
                label: next.label,
            });
        },
        [boardId],
    );

    return { filters, setFilters };
}
