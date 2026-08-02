'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

const POLL_MS = 60_000;

/** Dispatched by the voucher pages after an approve/reject so the badge updates without waiting for the next poll. */
export const VOUCHER_APPROVAL_CHANGED_EVENT = 'erp71:voucher-approval-changed';

export function notifyVoucherApprovalChanged() {
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(VOUCHER_APPROVAL_CHANGED_EVENT));
    }
}

/**
 * Size of the voucher approval queue, for the sidebar badge.
 *
 * The endpoint short-circuits to 0 without touching the vouchers table when the
 * tenant does not require approval, and this hook stops polling once it learns
 * that — so a tenant with the feature off pays for exactly one request per
 * session, not one per minute.
 */
export function usePendingVoucherCount() {
    const [count, setCount] = useState(0);
    const [approvalEnabled, setApprovalEnabled] = useState<boolean | null>(null);

    const refresh = useCallback(async () => {
        try {
            const result = await api.getPendingVoucherCount();
            setApprovalEnabled(Boolean(result?.approvalEnabled));
            setCount(Number(result?.count ?? 0));
        } catch {
            // A sidebar badge is never worth surfacing an error for.
            setCount(0);
        }
    }, []);

    useEffect(() => {
        void refresh();

        const onChanged = () => void refresh();
        window.addEventListener(VOUCHER_APPROVAL_CHANGED_EVENT, onChanged);

        return () => window.removeEventListener(VOUCHER_APPROVAL_CHANGED_EVENT, onChanged);
    }, [refresh]);

    useEffect(() => {
        if (approvalEnabled !== true) {
            return;
        }

        const timer = setInterval(() => void refresh(), POLL_MS);
        return () => clearInterval(timer);
    }, [approvalEnabled, refresh]);

    return { count, approvalEnabled: approvalEnabled === true, refresh };
}
