'use client';

import { useEffect, useState } from 'react';
import { api, type ProductFamily } from '@/lib/api';

/**
 * The shop's variant groups, for picking one to join. Read when `enabled`
 * turns true (a dialog opening), not on every render of the page behind it.
 */
export function useProductFamilies(enabled: boolean): { families: ProductFamily[]; loading: boolean } {
    const [families, setFamilies] = useState<ProductFamily[]>([]);
    // Starts loading when enabled, so a first render does not read "no groups".
    const [loading, setLoading] = useState(enabled);
    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        setLoading(true);
        api.getProductFamilies()
            .then((rows) => {
                if (!cancelled) setFamilies(Array.isArray(rows) ? rows : []);
            })
            .catch(() => {
                if (!cancelled) setFamilies([]);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [enabled]);
    return { families, loading };
}
