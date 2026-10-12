/**
 * The online branch's name. Kept in step with `nextOnlineStoreName` in
 * packages/database/prisma/party-branch.utils.ts, which the deploy-time sync
 * uses; duplicated rather than imported because that package ships hand-built
 * CommonJS (`index.js`) and its `prisma/*.ts` files do not resolve at runtime.
 */
export const ONLINE_BRANCH_NAME = 'Online Store';

/** "Online Store", or the first "Online Store N" no branch uses yet, compared case-insensitively. */
export function nextOnlineStoreName(existing: readonly string[]): string {
    const taken = new Set(existing.map((name) => name.trim().toLowerCase()));
    if (!taken.has(ONLINE_BRANCH_NAME.toLowerCase())) return ONLINE_BRANCH_NAME;
    for (let n = 2; ; n += 1) {
        const candidate = `${ONLINE_BRANCH_NAME} ${n}`;
        if (!taken.has(candidate.toLowerCase())) return candidate;
    }
}
