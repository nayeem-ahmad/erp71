'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export interface PaymentMethodOption {
    id: string;
    name: string;
    type: string;
    is_active: boolean;
    show_on_entry: boolean;
    sort_order: number;
    /** The linked ledger account, when there is one; the payment posts there instead of Cash in Hand. */
    account?: { id: string; name: string; code: string | null } | null;
}

export type PaymentMethodsStatus = 'loading' | 'ready' | 'error';

/**
 * The tenant's active payment methods in their serial order. A failed load is
 * not an error the operator can act on here: the chips simply do not show and
 * the payment posts as it always has.
 */
export function usePaymentMethods(): { methods: PaymentMethodOption[]; status: PaymentMethodsStatus } {
    const [methods, setMethods] = useState<PaymentMethodOption[]>([]);
    const [status, setStatus] = useState<PaymentMethodsStatus>('loading');

    useEffect(() => {
        let cancelled = false;
        Promise.resolve(api.getPaymentMethods())
            .then((rows: PaymentMethodOption[] | null | undefined) => {
                if (cancelled) return;
                const active = (Array.isArray(rows) ? rows : [])
                    .filter((method) => method.is_active)
                    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
                setMethods(active);
                setStatus('ready');
            })
            .catch(() => {
                if (!cancelled) setStatus('error');
            });
        return () => { cancelled = true; };
    }, []);

    return { methods, status };
}

/** The chip a new payment starts on: the first one shown on entry, else the first active one. */
export function defaultPaymentMethodId(methods: PaymentMethodOption[]): string | null {
    return (methods.find((method) => method.show_on_entry) ?? methods[0])?.id ?? null;
}
