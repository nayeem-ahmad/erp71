'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export interface SalesRepOption {
    id: string;
    name: string;
}

/**
 * The employees a customer's or a sale's sales rep can be picked from.
 *
 * An empty list when they cannot be read: the pickers that use it are
 * optional, and a sale or a customer must still save without one.
 */
export function useSalesReps(): SalesRepOption[] {
    const [reps, setReps] = useState<SalesRepOption[]>([]);

    useEffect(() => {
        let cancelled = false;
        Promise.resolve()
            .then(() => api.getSalesReps())
            .then((rows) => {
                if (!cancelled) setReps(Array.isArray(rows) ? rows : []);
            })
            .catch(() => {
                if (!cancelled) setReps([]);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    return reps;
}
