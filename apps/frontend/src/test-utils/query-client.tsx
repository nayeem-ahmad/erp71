import type { ReactElement, ReactNode } from 'react';
import { render, renderHook, type RenderOptions, type RenderHookOptions } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { getQueryClient, setQueryClientForTests } from '@/lib/query-client';

export { createTestQueryClient, installTestQueryClient } from './test-query-client';

function providerFor(client: QueryClient) {
    return function QueryWrapper({ children }: { children: ReactNode }) {
        return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    };
}

/**
 * `render` inside a `QueryClientProvider`, for anything that reads through
 * `useMe` or another query hook. Uses the cache `jest.setup.ts` installed for
 * this test unless one is passed, and returns it so a test can seed or inspect
 * it.
 */
export function renderWithQueryClient(
    ui: ReactElement,
    { client = getQueryClient(), ...options }: Omit<RenderOptions, 'wrapper'> & { client?: QueryClient } = {},
) {
    setQueryClientForTests(client);
    return { client, ...render(ui, { ...options, wrapper: providerFor(client) }) };
}

/** `renderHook` with the same provider and cache as `renderWithQueryClient`. */
export function renderHookWithQueryClient<Result, Props>(
    hook: (props: Props) => Result,
    { client = getQueryClient(), ...options }: Omit<RenderHookOptions<Props>, 'wrapper'> & { client?: QueryClient } = {},
) {
    setQueryClientForTests(client);
    return { client, ...renderHook(hook, { ...options, wrapper: providerFor(client) }) };
}
