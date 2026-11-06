'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The stats strip above a filtered list: fetched with the list's own filters,
 * so the figures describe the rows the list matches, not the page on screen.
 *
 * Only the newest request may land — filters change faster than a slow
 * summary answers. A failed load leaves the strip showing dashes rather than
 * failing the list. Call `reload` after a change to the rows (a delete, a
 * cancel) so the figures follow.
 */
export function useListSummary<P, S>({
    fetch,
    params,
    enabled = true,
}: {
    fetch: (params: P) => Promise<S>;
    params: P;
    enabled?: boolean;
}): { summary: S | null; loading: boolean; reload: () => void } {
    const [summary, setSummary] = useState<S | null>(null);
    const [loading, setLoading] = useState(true);
    const request = useRef(0);
    // The caller's fetcher is usually an inline arrow; holding it in a ref
    // keeps `reload` keyed on the filters alone.
    const fetchRef = useRef(fetch);
    fetchRef.current = fetch;

    const reload = useCallback(() => {
        if (!enabled) return;
        const id = ++request.current;
        setLoading(true);
        // Through a promise, so a fetcher that throws outright lands in the
        // catch below like one that rejects.
        Promise.resolve()
            .then(() => fetchRef.current(params))
            .then((next) => {
                if (id === request.current) setSummary(next);
            })
            .catch(() => {
                if (id === request.current) setSummary(null);
            })
            .finally(() => {
                if (id === request.current) setLoading(false);
            });
    }, [enabled, params]);

    useEffect(() => {
        reload();
    }, [reload]);

    return { summary, loading, reload };
}
