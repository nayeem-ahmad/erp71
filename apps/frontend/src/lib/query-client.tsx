'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, isServer, queryOptions, type Query } from '@tanstack/react-query';
import { getWorkspaceItem } from './session-store';

/**
 * The app's one in-memory data cache.
 *
 * Users sit about 250 ms from the API, so every request a screen waits on is a
 * quarter of a second of blank page. The cache is what lets a screen paint from
 * memory on a revisit and refresh behind the data instead of in front of it, and
 * what collapses the dozen components that each want `/auth/me` on mount into a
 * single request.
 *
 * In memory only, on purpose: nothing here is persisted to storage. A cached
 * permission set that outlived a reload would outlive a role change too, and the
 * repeated fetches this exists to remove all happen within one tab's session.
 */

/** Data younger than this is served without asking the server again. */
export const DEFAULT_STALE_TIME_MS = 30_000;

/** How long a screen's data is kept once nothing on screen reads it. */
export const DEFAULT_GC_TIME_MS = 5 * 60_000;

/**
 * Whether a failed request is worth one more try.
 *
 * Only failures that said nothing about the request itself: a dropped
 * connection or a 5xx. A 4xx is the server judging the request and will judge
 * it the same way again; a 401 means the API layer already tried to renew the
 * session and is signing the user out; and a 429 asked us to slow down, which an
 * immediate retry does the opposite of.
 *
 * Duck-typed on `status` rather than `instanceof ApiError`: `api.ts` imports this
 * module, so importing it back would close a cycle.
 */
export function shouldRetryRequest(failureCount: number, error: unknown): boolean {
    if (failureCount >= 1) return false;
    const status = (error as { status?: unknown } | null)?.status;
    if (typeof status !== 'number') return true;
    return status >= 500;
}

export function makeQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: {
                staleTime: DEFAULT_STALE_TIME_MS,
                gcTime: DEFAULT_GC_TIME_MS,
                // Coming back to the tab is when someone else's change (a role
                // edit, a sale from the till) is most likely to be waiting.
                refetchOnWindowFocus: true,
                retry: shouldRetryRequest,
            },
            mutations: {
                // A write is never repeated behind the user's back.
                retry: false,
            },
        },
    });
}

let browserQueryClient: QueryClient | undefined;

/**
 * The tab's client.
 *
 * One per tab, shared by the provider and by the code that is not a component —
 * the sign-in flow, `api.getStores()` — so a hook and an imperative read are
 * always looking at the same cache. On the server every call gets a fresh client:
 * a module-level one would be shared between every request the server renders.
 */
export function getQueryClient(): QueryClient {
    if (isServer) return makeQueryClient();
    if (!browserQueryClient) browserQueryClient = makeQueryClient();
    return browserQueryClient;
}

/**
 * Test-only: make `client` the tab's client, so the hooks under test and the
 * imperative reads they trigger share one cache. `undefined` drops it.
 */
export function setQueryClientForTests(client: QueryClient | undefined): void {
    browserQueryClient = client;
}

/* -------------------------------------------------------------------------- */
/* The signed-in user                                                         */
/* -------------------------------------------------------------------------- */

/** `GET /auth/me`, the one query every screen shares. */
export const ME_QUERY_KEY = ['me'] as const;

/**
 * Longer than the default because nothing about the signed-in user changes
 * minute to minute, and every write that does change it invalidates it on the
 * spot (see `invalidatesMe` in `api.ts`).
 */
export const ME_STALE_TIME_MS = 60_000;

/**
 * The `/auth/me` payload. It has never had a frontend type — every reader so far
 * has used it as `any` — and giving it one is a change of its own.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Me = any;

/**
 * Key, fetcher and freshness for `me`, in one place so the hook, the imperative
 * read and `api.getStores()` can never disagree about any of them.
 *
 * The fetcher is passed in rather than imported: it is `api.getMe`, and `api.ts`
 * itself reads `me` through here.
 */
export function meQueryOptions(fetchMe: () => Promise<Me>) {
    return queryOptions({
        queryKey: ME_QUERY_KEY,
        queryFn: fetchMe,
        staleTime: ME_STALE_TIME_MS,
    });
}

/**
 * `me` for code that cannot use a hook: effects, event handlers, `api.ts`.
 *
 * Answers from the cache whenever there is anything in it, and refreshes behind
 * that answer once it is stale — the caller never waits a round trip for a value
 * the tab already holds. Concurrent callers share one request.
 *
 * Invalidated data is the exception and is waited for: invalidation means a write
 * just changed it (a new store, a role edit), and the caller asking straight
 * afterwards wants the result of that write, not the value from before it.
 */
export function readMe(fetchMe: () => Promise<Me>, client: QueryClient = getQueryClient()): Promise<Me> {
    const options = meQueryOptions(fetchMe);
    const state = client.getQueryState(ME_QUERY_KEY);
    if (state?.data !== undefined && !state.isInvalidated) {
        // Fetches only once stale; a failure is the next reader's problem, and
        // the screen keeps what it has meanwhile.
        client.query(options).catch(() => undefined);
        return Promise.resolve(state.data);
    }
    return client.query(options);
}

/* -------------------------------------------------------------------------- */
/* Workspace scope                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The tenant and store this tab's requests carry (`x-tenant-id`/`x-store-id`).
 *
 * Every query whose answer depends on the workspace puts this in its key, so two
 * shops — or two branches of one — can never answer for each other out of the
 * cache. Read at render time: the app shell re-renders on every workspace change
 * (its `workspaceEpoch`), and a key that moves is a fresh query.
 */
export function workspaceScope(): readonly [string | null, string | null] {
    return [getWorkspaceItem('tenant_id'), getWorkspaceItem('store_id')];
}

function isWorkspaceQuery(query: Query): boolean {
    return query.queryKey[0] !== ME_QUERY_KEY[0];
}

/**
 * Forget everything fetched for the workspace this tab just left.
 *
 * The workspace keys already keep shops apart; this is the belt to those braces,
 * for any key that forgot its scope, and it frees the memory. Queries on screen
 * are reset (back to their skeleton) and refetched under the new headers, so the
 * old shop's figures are never painted into the new one.
 *
 * `me` is not reset — it describes the person, not the workspace, and every
 * workspace's permissions are already in it. It is only marked stale, so the next
 * screen that reads it refreshes it behind the data it already has: switching
 * into a shop is exactly when its permissions are worth re-reading, but never
 * worth a blank shell.
 */
export function resetWorkspaceQueries(client: QueryClient = getQueryClient()): void {
    void client.resetQueries({ predicate: isWorkspaceQuery });
    void client.invalidateQueries({ queryKey: ME_QUERY_KEY, refetchType: 'none' });
}

/**
 * Drop the whole cache. For sign-out and sign-in: nothing one session fetched may
 * be shown to the next, which may be a different person on the same browser.
 */
export function clearQueryCache(client: QueryClient = getQueryClient()): void {
    client.clear();
}

/* -------------------------------------------------------------------------- */
/* Provider                                                                   */
/* -------------------------------------------------------------------------- */

const ACCESS_TOKEN_KEY = 'access_token';

/**
 * Who an access token belongs to — its JWT `sub` — or null when there is none or
 * it cannot be read. Only used to tell a renewal (same person, new token) from a
 * different account; nothing here trusts it for anything else.
 */
export function tokenSubject(token: string | null | undefined): string | null {
    if (!token) return null;
    try {
        const payload = token.split('.')[1];
        if (!payload) return null;
        const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
        return typeof json?.sub === 'string' ? json.sub : null;
    } catch {
        return null;
    }
}

/**
 * Credentials are shared by every tab (localStorage) but each tab has its own
 * cache. When another tab signs out, or signs in as somebody else, this tab would
 * otherwise go on painting the previous account's name, shops and permissions
 * from memory while its requests already carry the new token. Reset everything
 * the moment the token changes hands; a renewal keeps the same `sub` and is
 * ignored, which is why this compares people rather than tokens.
 */
function useResetOnAccountChange(client: QueryClient): void {
    useEffect(() => {
        const onStorage = (event: StorageEvent) => {
            // `key` is null when another tab cleared storage outright.
            if (event.key !== null && event.key !== ACCESS_TOKEN_KEY) return;
            if (event.key !== null && tokenSubject(event.oldValue) === tokenSubject(event.newValue)) return;
            void client.resetQueries();
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, [client]);
}

/**
 * Mounted by the `(app)` layout rather than the root layout, so the public pages
 * (marketing, storefront, careers) do not download a cache they never use. The
 * sign-in pages outside `(app)` still share it: they read and seed it through
 * `getQueryClient()`, which is the same tab-wide instance this provides.
 */
export function QueryProvider({ children }: Readonly<{ children: ReactNode }>) {
    const [client] = useState(getQueryClient);
    useResetOnAccountChange(client);
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
