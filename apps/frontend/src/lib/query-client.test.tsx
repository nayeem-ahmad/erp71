import { act, render, screen, waitFor } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import {
    ME_QUERY_KEY,
    QueryProvider,
    getQueryClient,
    readMe,
    resetWorkspaceQueries,
    shouldRetryRequest,
    tokenSubject,
    workspaceScope,
} from './query-client';

/** A JWT-shaped string whose payload carries `sub`; the signature is never checked here. */
function tokenFor(sub: string, nonce = 'a'): string {
    const payload = btoa(JSON.stringify({ sub, nonce })).replace(/=+$/, '');
    return `header.${payload}.signature`;
}

describe('shouldRetryRequest', () => {
    it('retries a dropped connection or a 5xx once', () => {
        expect(shouldRetryRequest(0, new TypeError('Failed to fetch'))).toBe(true);
        expect(shouldRetryRequest(0, { status: 502 })).toBe(true);
        expect(shouldRetryRequest(1, { status: 502 })).toBe(false);
    });

    it('never retries a verdict: 401, 403, 429 or any other 4xx', () => {
        for (const status of [400, 401, 403, 404, 422, 429]) {
            expect(shouldRetryRequest(0, { status })).toBe(false);
        }
    });
});

describe('readMe', () => {
    it('answers from the cache without asking the server', async () => {
        const client = getQueryClient();
        client.setQueryData(ME_QUERY_KEY, { id: 'u1' });
        const fetchMe = jest.fn();

        await expect(readMe(fetchMe, client)).resolves.toEqual({ id: 'u1' });
        expect(fetchMe).not.toHaveBeenCalled();
    });

    it('shares one request between callers that ask at once', async () => {
        const fetchMe = jest.fn().mockResolvedValue({ id: 'u1' });

        const [a, b] = await Promise.all([readMe(fetchMe), readMe(fetchMe)]);

        expect(a).toEqual({ id: 'u1' });
        expect(b).toEqual({ id: 'u1' });
        expect(fetchMe).toHaveBeenCalledTimes(1);
    });

    it('serves stale data at once and refreshes it behind the answer', async () => {
        const client = getQueryClient();
        client.setQueryData(ME_QUERY_KEY, { id: 'u1', name: 'Old' }, { updatedAt: Date.now() - 120_000 });
        const fetchMe = jest.fn().mockResolvedValue({ id: 'u1', name: 'New' });

        await expect(readMe(fetchMe, client)).resolves.toEqual({ id: 'u1', name: 'Old' });
        await waitFor(() => expect(client.getQueryData(ME_QUERY_KEY)).toEqual({ id: 'u1', name: 'New' }));
        expect(fetchMe).toHaveBeenCalledTimes(1);
    });

    it('waits for the server once a write has invalidated it', async () => {
        const client = getQueryClient();
        client.setQueryData(ME_QUERY_KEY, { id: 'u1', stores: [] });
        await client.invalidateQueries({ queryKey: ME_QUERY_KEY, refetchType: 'none' });
        const fetchMe = jest.fn().mockResolvedValue({ id: 'u1', stores: [{ id: 's1' }] });

        await expect(readMe(fetchMe, client)).resolves.toEqual({ id: 'u1', stores: [{ id: 's1' }] });
    });
});

describe('tokenSubject', () => {
    it('reads the JWT subject and tolerates anything else', () => {
        expect(tokenSubject(tokenFor('user-1'))).toBe('user-1');
        expect(tokenSubject(null)).toBeNull();
        expect(tokenSubject('not-a-jwt')).toBeNull();
        expect(tokenSubject('a.%%%.c')).toBeNull();
    });
});

describe('resetWorkspaceQueries', () => {
    it('drops every workspace answer but keeps the signed-in user, marked stale', async () => {
        const client = getQueryClient();
        client.setQueryData(ME_QUERY_KEY, { id: 'u1' });
        client.setQueryData(['dashboard', 't1', 's1', 'kpis'], { total: 10 });

        resetWorkspaceQueries(client);

        expect(client.getQueryData(['dashboard', 't1', 's1', 'kpis'])).toBeUndefined();
        expect(client.getQueryData(ME_QUERY_KEY)).toEqual({ id: 'u1' });
        expect(client.getQueryState(ME_QUERY_KEY)?.isInvalidated).toBe(true);
    });

    it('keys workspace queries on the tab’s tenant and store', () => {
        sessionStorage.setItem('tenant_id', 't1');
        sessionStorage.setItem('store_id', 's2');
        expect(workspaceScope()).toEqual(['t1', 's2']);
    });
});

describe('QueryProvider', () => {
    function Probe({ fetcher }: { fetcher: () => Promise<string> }) {
        const query = useQuery({ queryKey: ['probe'], queryFn: fetcher });
        return <p>{query.data ?? 'loading'}</p>;
    }

    function fireTokenChange(oldValue: string | null, newValue: string | null) {
        act(() => {
            window.dispatchEvent(new StorageEvent('storage', { key: 'access_token', oldValue, newValue }));
        });
    }

    it('refetches everything when another tab signs in as somebody else', async () => {
        const fetcher = jest.fn()
            .mockResolvedValueOnce('first account')
            .mockResolvedValueOnce('second account');
        render(<QueryProvider><Probe fetcher={fetcher} /></QueryProvider>);
        expect(await screen.findByText('first account')).toBeInTheDocument();

        fireTokenChange(tokenFor('user-1'), tokenFor('user-2'));

        expect(await screen.findByText('second account')).toBeInTheDocument();
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('ignores a token renewal: same person, new token', async () => {
        const fetcher = jest.fn().mockResolvedValue('first account');
        render(<QueryProvider><Probe fetcher={fetcher} /></QueryProvider>);
        expect(await screen.findByText('first account')).toBeInTheDocument();

        fireTokenChange(tokenFor('user-1', 'a'), tokenFor('user-1', 'b'));

        expect(screen.getByText('first account')).toBeInTheDocument();
        expect(fetcher).toHaveBeenCalledTimes(1);
    });
});
