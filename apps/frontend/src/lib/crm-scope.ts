'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * "Only mine" — the CRM-wide scope preference.
 *
 * A sales rep on a shared workspace mostly cares about one slice of it: their
 * own leads, their own activities, their own numbers on the Overview. This is
 * that slice, offered as one switch on every CRM surface rather than as an owner
 * dropdown to re-pick on each of them.
 *
 * **Kept in `localStorage`, unlike the per-page filters in
 * `use-remembered-filters`.** Those are deliberately per tab and per visit,
 * because a status or date filter is a view of what you are doing right now. A
 * scope is not: someone who works only their own book expects it to still be
 * their own book tomorrow, on the list they open next and on the dashboard they
 * land on. It is also shared by every CRM screen for the same reason — the
 * Overview counting the whole team while the leads list under it shows one
 * person's is the disagreement this preference exists to prevent.
 *
 * The narrowing itself is the server's: every endpoint takes `mine=true` and
 * resolves the caller's own id from the session, so no user id crosses the wire
 * and nothing has to be looked up before the first request can be sent.
 */
const MINE_ONLY_KEY = 'crm_mine_only';

/**
 * Instances of the hook mounted at the same time, so a page holding more than
 * one (a dashboard with its own switch above a list with another) moves them
 * together instead of leaving one showing the scope it no longer has.
 */
const listeners = new Set<(value: boolean) => void>();

export function getCrmMineOnly(): boolean {
    if (typeof window === 'undefined') return false;
    try {
        return localStorage.getItem(MINE_ONLY_KEY) === 'true';
    } catch {
        // Storage blocked. Showing everything is the safe default: a list that is
        // unexpectedly wide is obvious, one that is unexpectedly narrow is not.
        return false;
    }
}

export function persistCrmMineOnly(value: boolean): void {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(MINE_ONLY_KEY, String(value));
    } catch {
        // Not remembering the choice is better than failing to make it.
    }
}

/**
 * `ready` is false until the stored preference has been read, and every caller
 * holds its first request until it flips. Reading during render is not an option
 * — the server has no `localStorage`, so seeding state from it is a hydration
 * mismatch — and fetching before it lands would show the whole team's rows for a
 * beat and then swap them out, which is exactly the flicker the gate prevents.
 */
export function useCrmMineOnly(): {
    mineOnly: boolean;
    setMineOnly: (value: boolean) => void;
    ready: boolean;
} {
    const [mineOnly, setState] = useState(false);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        setState(getCrmMineOnly());
        setReady(true);

        listeners.add(setState);
        return () => {
            listeners.delete(setState);
        };
    }, []);

    const setMineOnly = useCallback((value: boolean) => {
        persistCrmMineOnly(value);
        for (const notify of listeners) notify(value);
    }, []);

    return { mineOnly, setMineOnly, ready };
}
