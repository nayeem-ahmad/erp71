'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/**
 * Whether a sale may only be made to a customer of its own branch —
 * `SalesSettings.branch_customers_only`. The sale screens list that branch's
 * customers while it is on; the server refuses any other either way.
 *
 * On until the settings say otherwise, matching the server's default: a shop
 * that has turned it off sees a narrower list for a moment, never a customer
 * the server would then refuse. Pass `enabled = false` where no customer is
 * being picked (a read-only sale) to skip the request.
 */
export function useBranchCustomersOnly(enabled = true): boolean {
    const [on, setOn] = useState(true);

    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        (async () => {
            try {
                const settings: any = await api.getSalesSettings?.();
                if (!cancelled) setOn(settings?.branch_customers_only !== false);
            } catch {
                // Keep the default: the narrower list is the safe one.
            }
        })();
        return () => { cancelled = true; };
    }, [enabled]);

    return on;
}
