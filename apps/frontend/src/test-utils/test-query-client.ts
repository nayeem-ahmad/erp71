import { QueryClient } from '@tanstack/react-query';
import { setQueryClientForTests } from '@/lib/query-client';

/**
 * A cache for one test: no retries (a rejected mock fails now, not after a
 * backoff the test would have to wait out) and no garbage-collection timers left
 * running once the test is over.
 *
 * Kept apart from the render helpers in `./query-client` so `jest.setup.ts` can
 * load it from a `beforeEach` without pulling in Testing Library, which
 * registers hooks of its own on import and may not do that inside a test.
 */
export function createTestQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: { retry: false, gcTime: Infinity },
            mutations: { retry: false },
        },
    });
}

/**
 * Give this test its own cache and make it the tab's, so hooks (through the
 * provider) and imperative reads (`fetchMe`, `api.getStores`) share it.
 * `jest.setup.ts` calls this before every test, so a cached `/auth/me` from one
 * test can never answer the next one's mock.
 */
export function installTestQueryClient(client: QueryClient = createTestQueryClient()): QueryClient {
    setQueryClientForTests(client);
    return client;
}
