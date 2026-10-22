'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MyPreferencesResponse } from '@erp71/shared-types';
import { currentViewUserKey } from '@/components/table/useTableViewSettings';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { workspaceScope } from '@/lib/query-client';
import { getWorkspaceItem } from '@/lib/session-store';
import { onPreferencesSettled, setPreferenceSaveFailedMessage, usePreferencesStore } from './store';

const CACHE_PREFIX = 'erp71:prefs:';

function readCache(scopeKey: string): MyPreferencesResponse | null {
    try {
        const raw = window.localStorage.getItem(CACHE_PREFIX + scopeKey);
        const parsed = raw ? JSON.parse(raw) : null;
        // Whatever an older build left behind is only used if it still has the shape of a response.
        return parsed && typeof parsed === 'object' && parsed.sections && Array.isArray(parsed.legacy_browser_sections)
            ? (parsed as MyPreferencesResponse)
            : null;
    } catch {
        return null;
    }
}

function writeCache(scopeKey: string, data: MyPreferencesResponse): void {
    try {
        window.localStorage.setItem(CACHE_PREFIX + scopeKey, JSON.stringify(data));
    } catch {
        // Private mode or a full quota: the first paint just waits for the network.
    }
}

/**
 * Loads the signed-in member's preferences into the store, once per workspace.
 *
 * The last response is kept at `erp71:prefs:<tenantId>:<userId>` and seeds the
 * first paint, so a returning member does not see built-in columns flash before
 * their own arrive. It is only a head start: the fetch always follows and wins.
 * Nothing is written to the server from here — a section is saved only by the
 * member's own change.
 */
export function usePreferencesLoader(enabled: boolean): void {
    const queryClient = useQueryClient();
    const { t } = useI18n();

    const tenantId = getWorkspaceItem('tenant_id');
    const userKey = currentViewUserKey();
    const scopeKey = enabled && tenantId && userKey !== 'anon' ? `${tenantId}:${userKey}` : null;

    const query = useQuery({
        queryKey: ['preferences-me', ...workspaceScope()],
        queryFn: () => api.getMyPreferences(),
        enabled: scopeKey !== null,
    });

    useEffect(() => {
        setPreferenceSaveFailedMessage(t.common.preferenceSaveFailed);
    }, [t]);

    // A different workspace or account: drop the old data, then start from this scope's cache.
    useEffect(() => {
        const store = usePreferencesStore.getState();
        if (!scopeKey) {
            store.clear();
            return;
        }
        if (store.scopeKey === scopeKey) return;
        const cached = readCache(scopeKey);
        if (cached) store.hydrate(scopeKey, cached);
        else store.clear();
    }, [scopeKey]);

    useEffect(() => {
        if (!scopeKey || !query.data) return;
        usePreferencesStore.getState().hydrate(scopeKey, query.data);
        writeCache(scopeKey, query.data);
    }, [scopeKey, query.data]);

    // After the member's own change is saved, keep the cache and the query in step so a
    // remount does not paint the answers from before it.
    useEffect(() => {
        if (!scopeKey) return;
        return onPreferencesSettled((data) => {
            if (usePreferencesStore.getState().scopeKey !== scopeKey) return;
            writeCache(scopeKey, data);
            queryClient.setQueryData(['preferences-me', ...workspaceScope()], data);
        });
    }, [scopeKey, queryClient]);
}
