import { getAccessToken } from '@/lib/session-store';
import { tokenSubject } from '@/lib/query-client';

/** The signed-in user's id from their token, or a shared bucket when signed out. */
export function currentViewUserKey(): string {
    if (typeof window === 'undefined') return 'anon';
    try {
        return tokenSubject(getAccessToken()) ?? 'anon';
    } catch {
        return 'anon';
    }
}
