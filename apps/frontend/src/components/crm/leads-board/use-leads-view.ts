'use client';

import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_LEAD_BOARD_GROUP, isLeadBoardGroup, type LeadBoardGroup } from './board-columns';

export type LeadsView = 'list' | 'board';

/**
 * List or board, and what the board is grouped by.
 *
 * Kept in `localStorage`, not with the page's filters in `sessionStorage`: the
 * filters are the slice somebody is working right now, while how they like to
 * look at their pipeline is a preference — someone who works from the board
 * expects the board tomorrow too.
 */
const STORAGE_KEY = 'crm_leads_view';

type Stored = { view: LeadsView; groupBy: LeadBoardGroup };

const DEFAULTS: Stored = { view: 'list', groupBy: DEFAULT_LEAD_BOARD_GROUP };

function read(): Stored {
    try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
        if (!parsed || typeof parsed !== 'object') return DEFAULTS;
        return {
            view: parsed.view === 'board' ? 'board' : 'list',
            groupBy: isLeadBoardGroup(parsed.groupBy) ? parsed.groupBy : DEFAULT_LEAD_BOARD_GROUP,
        };
    } catch {
        // Storage blocked, or a hand-edited entry. The list is the safe default.
        return DEFAULTS;
    }
}

function write(value: Stored) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
        // Not remembering the choice is better than failing to make it.
    }
}

/**
 * `ready` is false until the stored choice is read — after mount, since the
 * server has no `localStorage` — and the page holds its first fetch until then,
 * so a board user does not load a page of the list first.
 */
export function useLeadsView() {
    const [state, setState] = useState<Stored>(DEFAULTS);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        setState(read());
        setReady(true);
    }, []);

    const update = useCallback((patch: Partial<Stored>) => {
        setState((prev) => {
            const next = { ...prev, ...patch };
            write(next);
            return next;
        });
    }, []);

    const setView = useCallback((view: LeadsView) => update({ view }), [update]);
    const setGroupBy = useCallback((groupBy: LeadBoardGroup) => update({ groupBy }), [update]);

    return { view: state.view, groupBy: state.groupBy, setView, setGroupBy, ready };
}
