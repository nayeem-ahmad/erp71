'use client';

import { useCallback, useEffect, useState } from 'react';
import {
    DEFAULT_BOARD_VIEW,
    readStoredBoardView,
    writeStoredBoardView,
    type BoardCardField,
    type BoardView,
} from './board-view';

export interface BoardViewControls {
    view: BoardView;
    /** Change one setting. Written through to storage immediately — there is no Save. */
    set: <K extends keyof BoardView>(key: K, value: BoardView[K]) => void;
    toggleField: (field: BoardCardField) => void;
    reset: () => void;
}

/**
 * The board's appearance settings, held for this browser.
 *
 * Seeded with the defaults and read from storage after mount, never during
 * render: the server has no `localStorage`, so seeding state from it directly
 * is a hydration mismatch. The first paint is therefore the default board for
 * one frame — acceptable here because nothing is fetched off the back of it,
 * unlike a remembered filter, which has to hold its request until it knows the
 * slice.
 */
export function useBoardView(): BoardViewControls {
    const [view, setView] = useState<BoardView>(DEFAULT_BOARD_VIEW);

    useEffect(() => {
        setView(readStoredBoardView());
    }, []);

    const set = useCallback(<K extends keyof BoardView>(key: K, value: BoardView[K]) => {
        setView((prev) => {
            const next = { ...prev, [key]: value };
            writeStoredBoardView(next);
            return next;
        });
    }, []);

    const toggleField = useCallback((field: BoardCardField) => {
        setView((prev) => {
            const next = { ...prev, fields: { ...prev.fields, [field]: !prev.fields[field] } };
            writeStoredBoardView(next);
            return next;
        });
    }, []);

    const reset = useCallback(() => {
        writeStoredBoardView(DEFAULT_BOARD_VIEW);
        setView(DEFAULT_BOARD_VIEW);
    }, []);

    return { view, set, toggleField, reset };
}
