/**
 * Used by `sync-party-branch.ts`; the backend's twin is
 * apps/backend/src/stores/online-branch-name.ts — keep the two in step.
 */

export const ONLINE_BRANCH_NAME = 'Online Store';

/**
 * "Online Store", or the first "Online Store N" that no branch of the tenant
 * uses yet. Compared case-insensitively, as `StoresService` compares branch
 * names: "online store" and "Online Store" are the same name to anyone
 * reading the branch switcher.
 */
export function nextOnlineStoreName(existing: readonly string[]): string {
    const taken = new Set(existing.map((name) => name.trim().toLowerCase()));
    if (!taken.has(ONLINE_BRANCH_NAME.toLowerCase())) return ONLINE_BRANCH_NAME;
    for (let n = 2; ; n += 1) {
        const candidate = `${ONLINE_BRANCH_NAME} ${n}`;
        if (!taken.has(candidate.toLowerCase())) return candidate;
    }
}
