'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { tenantDateOnly } from '@/lib/created-range';
import type { FilterOption } from './SearchFilterPicker';

/** Days in the window a line-item search opens on, today included. */
const DEFAULT_WINDOW_DAYS = 30;

/**
 * The last 30 days, ending today as the workspace's calendar reads it.
 *
 * The bounds go to the server as `YYYY-MM-DD` and are read there in the
 * workspace's zone, so "today" has to be the workspace's today — the device's
 * (or UTC's, via `toISOString`) is a different day for six hours of every
 * Dhaka evening.
 */
export function defaultLineItemWindow(now: Date = new Date()): { from: string; to: string } {
    const to = tenantDateOnly(now);
    const [year, month, day] = to.split('-').map(Number);
    const from = new Date(Date.UTC(year, month - 1, day - (DEFAULT_WINDOW_DAYS - 1))).toISOString().slice(0, 10);
    return { from, to };
}

type NamedFilters = {
    product?: { id: string; name: string; sku?: string | null } | null;
    party?: { id: string; name: string; phone?: string | null } | null;
};

/**
 * Filter state for a line-item search: period, branch, counterparty, product
 * and free text.
 *
 * `partyParam` is the query key the counterparty travels under — `customerId`
 * on the sales side, `supplierId` on the purchase side — both in the page's
 * own URL (so a customer or product screen can deep-link into the report) and
 * in the API request built by `query`.
 */
export function useLineItemFilters(partyParam: 'customerId' | 'supplierId') {
    const searchParams = useSearchParams();

    // Read once: the URL seeds the filters, it does not follow them.
    const [initial] = useState(() => {
        const fallback = defaultLineItemWindow();
        const partyId = searchParams.get(partyParam);
        const productId = searchParams.get('productId');
        return {
            from: searchParams.get('from') ?? fallback.from,
            to: searchParams.get('to') ?? fallback.to,
            storeId: searchParams.get('storeId') ?? '',
            // Named by the first response, which echoes what it was narrowed by.
            party: partyId ? { id: partyId, name: '' } : null,
            product: productId ? { id: productId, name: '' } : null,
        };
    });

    const [from, setFrom] = useState(initial.from);
    const [to, setTo] = useState(initial.to);
    const [storeId, setStoreId] = useState(initial.storeId);
    const [party, setParty] = useState<FilterOption | null>(initial.party);
    const [product, setProduct] = useState<FilterOption | null>(initial.product);
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [stores, setStores] = useState<Array<{ id: string; name: string }>>([]);

    // Typing must not fire a request per keystroke.
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
        return () => clearTimeout(timer);
    }, [search]);

    useEffect(() => {
        let cancelled = false;
        api.getStores()
            .then((data: unknown) => {
                if (!cancelled) setStores(Array.isArray(data) ? (data as Array<{ id: string; name: string }>) : []);
            })
            .catch((err: unknown) => console.error('Failed to load branches', err));
        return () => {
            cancelled = true;
        };
    }, []);

    /** Back to the opening window with nothing narrowed. */
    const reset = useCallback(() => {
        const fallback = defaultLineItemWindow();
        setFrom(fallback.from);
        setTo(fallback.to);
        setStoreId('');
        setParty(null);
        setProduct(null);
        setSearch('');
        setDebouncedSearch('');
    }, []);

    /** Fills in the names of pickers seeded from the URL with an id alone. */
    const nameFromResponse = useCallback((named: NamedFilters) => {
        setParty((current) =>
            current && !current.name && named.party?.id === current.id
                ? { id: current.id, name: named.party.name, detail: named.party.phone ?? null }
                : current,
        );
        setProduct((current) =>
            current && !current.name && named.product?.id === current.id
                ? { id: current.id, name: named.product.name, detail: named.product.sku ?? null }
                : current,
        );
    }, []);

    const query = useMemo(
        () => ({
            from: from || undefined,
            to: to || undefined,
            storeId: storeId || undefined,
            productId: product?.id,
            [partyParam]: party?.id,
            search: debouncedSearch || undefined,
        }),
        [from, to, storeId, product?.id, party?.id, debouncedSearch, partyParam],
    );

    return {
        from,
        setFrom,
        to,
        setTo,
        storeId,
        setStoreId,
        party,
        setParty,
        product,
        setProduct,
        search,
        setSearch,
        stores,
        reset,
        nameFromResponse,
        query,
        /** Changes whenever the request would — for `useServerList`'s `deps`. */
        deps: [from, to, storeId, product?.id, party?.id, debouncedSearch],
    };
}
