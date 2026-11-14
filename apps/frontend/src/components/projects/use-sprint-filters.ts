'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { parseSprintFilters, sprintFiltersToQuery, type SprintFilterState } from './sprint-filters';

type FilterUpdate = SprintFilterState | ((prev: SprintFilterState) => SprintFilterState);

/**
 * The sprint page's filters, seeded from the URL and written back as they change
 * so a view can be pasted to someone else.
 *
 * Back/forward is the only time the address bar overwrites the controls. A
 * replace we just issued must not be read back — two keystrokes in a row would
 * otherwise let the slower navigation put the older text back in the box.
 */
export function useSprintFilters(): [SprintFilterState, (update: FilterUpdate) => void] {
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();
    const [filters, setFilters] = useState<SprintFilterState>(() => parseSprintFilters(searchParams));
    /** The query string we last decided the page should show. */
    const written = useRef<string | null>(null);
    const skipWrite = useRef(false);

    useEffect(() => {
        const onPop = () => {
            const next = window.location.search.replace(/^\?/, '');
            skipWrite.current = true;
            written.current = next;
            setFilters(parseSprintFilters(new URLSearchParams(next)));
        };
        window.addEventListener('popstate', onPop);
        return () => window.removeEventListener('popstate', onPop);
    }, []);

    useEffect(() => {
        if (skipWrite.current) {
            skipWrite.current = false;
            return;
        }
        // Once we have written, that string is the base — not whatever
        // `searchParams` last reported, which can be a navigation behind.
        const current = written.current ?? searchParams.toString();
        const next = sprintFiltersToQuery(new URLSearchParams(current), filters);
        if (next === current) {
            written.current = next;
            return;
        }
        written.current = next;
        router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
    }, [filters, pathname, router, searchParams]);

    return [filters, setFilters];
}
