'use client';

import { useQuery, type QueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
    getQueryClient,
    ME_QUERY_KEY,
    meQueryOptions,
    readMe,
    type Me,
} from '@/lib/query-client';

export type { Me } from '@/lib/query-client';

/**
 * `api.getMe` is the network read; everything else goes through the cache.
 * Looked up on each call rather than captured once, so a test that spies on or
 * replaces `api.getMe` after this module loaded is still the one asked.
 */
const fetchFromServer = () => api.getMe();

/**
 * The signed-in user, shared by every component that asks.
 *
 * The app shell, the dashboard and a dozen hooks all read `/auth/me`; under this
 * they share one request when they mount together, render straight from memory
 * when the data is under a minute old, and refresh it in the background after
 * that (and when the tab regains focus).
 */
export function useMe() {
    return useQuery(meQueryOptions(fetchFromServer));
}

/**
 * `me` for effects and event handlers. Cached when the tab has it, one shared
 * request when it does not — see `readMe` for the rules.
 */
export function fetchMe(client: QueryClient = getQueryClient()): Promise<Me> {
    return readMe(fetchFromServer, client);
}

/**
 * Mark `me` out of date. Whatever is on screen refetches it straight away, and
 * the next `fetchMe` waits for that answer rather than serving the old one.
 *
 * Most writes that change `me` never need to call this: `api.ts` does it for
 * every successful write to an endpoint that feeds `/auth/me`.
 */
export function invalidateMe(client: QueryClient = getQueryClient()): Promise<void> {
    return client.invalidateQueries({ queryKey: ME_QUERY_KEY });
}

/**
 * Put a `/auth/me` answer the caller already holds into the cache, so the next
 * screen does not ask for it again. Sign-in is the case: it has just fetched it
 * to decide where to send the user.
 */
export function seedMe(me: Me, client: QueryClient = getQueryClient()): void {
    client.setQueryData(ME_QUERY_KEY, me);
}
