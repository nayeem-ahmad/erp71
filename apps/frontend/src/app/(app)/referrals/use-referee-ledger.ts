'use client';

import { useCallback, useEffect, useState } from 'react';
import type { RefereeLedger } from '@/components/admin/referrals/types';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

/**
 * The portal's three pages all read the same ledger endpoint. Without this hook
 * the fetch/error/loading block gets copy-pasted three times and drifts.
 */
export function useRefereeLedger() {
    const { t } = useI18n();
    const loadFailed = t.referralPortal.loadFailed;
    const [ledger, setLedger] = useState<RefereeLedger | null>(null);
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(true);

    const reload = useCallback(async () => {
        setIsLoading(true);
        setError('');
        try {
            setLedger(await api.getRefereePortalLedger());
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : loadFailed);
        } finally {
            setIsLoading(false);
        }
    }, [loadFailed]);

    useEffect(() => {
        void reload();
    }, [reload]);

    return { ledger, error, isLoading, reload };
}
