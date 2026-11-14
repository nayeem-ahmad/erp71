'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * Writes a list's filters into the query string as they change, the way the
 * sprint page does, so a link is the view.
 *
 * Back/forward is left to the page: this only publishes. A replace we just
 * issued is the base for the next one, not whatever `searchParams` last
 * reported, which can be a navigation behind.
 */
export function useFilterUrl<T>(
    ready: boolean,
    filters: T,
    toQuery: (current: URLSearchParams, filters: T) => string,
): void {
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();
    const written = useRef<string | null>(null);

    useEffect(() => {
        if (!ready) return;
        const current = written.current ?? searchParams.toString();
        const next = toQuery(new URLSearchParams(current), filters);
        if (next === current) {
            written.current = next;
            return;
        }
        written.current = next;
        router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
    }, [filters, pathname, ready, router, searchParams, toQuery]);
}
