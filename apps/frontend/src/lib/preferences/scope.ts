import { currentViewUserKey } from '@/components/table/view-user-key';
import { getWorkspaceItem } from '@/lib/session-store';

/**
 * `<tenantId>:<userId>` for the workspace this tab is in and the person signed
 * in, or null when either is missing.
 *
 * The loader files the member's preferences under this key, and every reader
 * trusts the store only while the store's key is this one. Sign-out and a
 * workspace switch are client-side navigations, so whatever the store held for
 * the previous person or workspace can still be in memory when the next one's
 * screens mount; comparing keys keeps it from being shown, or saved, as theirs.
 */
export function currentPreferencesScopeKey(): string | null {
    let tenantId: string | null = null;
    try {
        tenantId = getWorkspaceItem('tenant_id');
    } catch {
        // Storage blocked: no workspace we can name, so nothing is in scope.
        return null;
    }
    const userKey = currentViewUserKey();
    return tenantId && userKey !== 'anon' ? `${tenantId}:${userKey}` : null;
}

/** True when `scopeKey` (the store's) belongs to the person and workspace this tab is in now. */
export function isCurrentPreferencesScope(scopeKey: string | null): boolean {
    return scopeKey !== null && scopeKey === currentPreferencesScopeKey();
}
