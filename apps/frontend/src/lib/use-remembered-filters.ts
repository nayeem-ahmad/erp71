'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * List filters that survive leaving the page and coming back.
 *
 * Someone narrowing a long list to "my open leads, this month" then opening one
 * row is not done with that slice — they come back to it. Re-picking every
 * filter on every return is the kind of small tax that makes a list feel hostile
 * to actual work.
 *
 * Kept in `sessionStorage`, not `localStorage`: a filter is a view of what you
 * are doing right now, not a preference. Surviving a tab is right; silently
 * surviving until next week — so a list opens short and nobody remembers why —
 * is not. Each tab also gets its own, so two windows can hold two slices.
 */
const STORAGE_PREFIX = 'filters:';

function storageKey(key: string): string {
    return `${STORAGE_PREFIX}${key}`;
}

function readStored<T>(key: string): Partial<T> | null {
    try {
        const raw = sessionStorage.getItem(storageKey(key));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        // An object is the only shape the writer produces; anything else is a
        // stale or hand-edited entry and is better ignored than spread.
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Partial<T>)
            : null;
    } catch {
        // Storage blocked, or the entry is not JSON. Defaults are fine.
        return null;
    }
}

/**
 * `defaults` is the state as the page would open with nothing remembered —
 * including anything a URL parameter seeded, which is why the caller passes it
 * in already resolved. A remembered value never overrides one that arrived in
 * the URL: a deep link from the dashboard names the exact slice it counted, and
 * a link that opens somebody's leftover filter instead is a wrong answer.
 *
 * `overrides` names the keys the URL supplied, so those keep the passed default.
 *
 * The stored object is merged **over** the defaults key by key, so adding a
 * filter to a page does not invalidate what is already remembered — the new one
 * simply starts at its default.
 */
export function useRememberedFilters<T extends Record<string, unknown>>(
    key: string,
    defaults: T,
    overrides?: ReadonlyArray<keyof T>,
): [T, <K extends keyof T>(field: K, value: T[K]) => void, boolean] {
    const [filters, setFilters] = useState<T>(defaults);
    // Until the stored values are read, the page is showing defaults that may be
    // about to change. Callers use this to hold off the first fetch, so a return
    // visit does not fire one request for the default slice and another for the
    // remembered one.
    const [hydrated, setHydrated] = useState(false);

    // Read after mount, never during render: the server has no sessionStorage,
    // so seeding state from it directly is a hydration mismatch.
    // Refs keep this a mount-only effect — `defaults` is a fresh object every
    // render, and the URL-seeded values inside it are already fixed by then.
    const defaultsRef = useRef(defaults);
    const overridesRef = useRef(overrides);

    useEffect(() => {
        const stored = readStored<T>(key);
        if (stored) {
            const urlOwned = new Set(overridesRef.current ?? []);
            const merged = { ...defaultsRef.current };
            for (const field of Object.keys(stored) as (keyof T)[]) {
                // Only keys the page actually has, so a filter removed in a later
                // release cannot resurrect itself out of an old entry.
                if (field in merged && !urlOwned.has(field)) {
                    merged[field] = stored[field] as T[keyof T];
                }
            }
            setFilters(merged);
        }
        setHydrated(true);
    }, [key]);

    const setFilter = useCallback(
        <K extends keyof T>(field: K, value: T[K]) => {
            setFilters((prev) => {
                const next = { ...prev, [field]: value };
                try {
                    sessionStorage.setItem(storageKey(key), JSON.stringify(next));
                } catch {
                    // Not remembering the choice is better than failing to make it.
                }
                return next;
            });
        },
        [key],
    );

    return [filters, setFilter, hydrated];
}
