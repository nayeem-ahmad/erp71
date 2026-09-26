import { act, renderHook, waitFor } from '@testing-library/react';
import type { Paginated } from '@/lib/api';
import { useServerList } from './useServerList';
import { EXPORT_FETCH_PAGE_SIZE } from '@/components/data-table/fetch-all-pages';

describe('useServerList fetchAllRows', () => {
    it('walks the current fetch with the active sort until every matching row is loaded', async () => {
        const all = Array.from({ length: 150 }, (_, i) => ({ id: String(i + 1) }));
        const fetch = jest.fn(async ({ page, limit }: { page: number; limit: number }) => ({
            items: all.slice((page - 1) * limit, page * limit),
            total: all.length,
            page,
            limit,
            pages: Math.ceil(all.length / limit),
        }));

        const { result } = renderHook(() =>
            useServerList({
                fetch,
                tableId: 'test-list',
                initialSort: { id: 'name', desc: true },
            }),
        );

        await waitFor(() => expect(result.current.loading).toBe(false));

        const exported = await result.current.serverPagination.fetchAllRows!();

        expect(exported.items).toHaveLength(150);
        expect(exported.truncated).toBe(false);
        expect(exported.total).toBe(150);
        expect(fetch).toHaveBeenCalledWith(
            expect.objectContaining({
                page: 1,
                limit: EXPORT_FETCH_PAGE_SIZE,
                sortBy: 'name',
                sortDir: 'desc',
            }),
        );
    });
});

describe('useServerList response', () => {
    type Row = { id: string };
    type Payload = Paginated<Row> & { summary: { amount: number } };

    const payload = (amount: number): Payload => ({
        items: [{ id: String(amount) }],
        total: 1,
        page: 1,
        limit: 10,
        pages: 1,
        summary: { amount },
    });

    it('exposes the whole payload of the response that committed', async () => {
        const fetch = jest.fn(async () => payload(42));

        const { result } = renderHook(() => useServerList<Row, Payload>({ fetch }));

        expect(result.current.response).toBeNull();
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.response?.summary).toEqual({ amount: 42 });
        expect(result.current.items).toEqual([{ id: '42' }]);
    });

    it('keeps the payload of the newest request when an older one lands after it', async () => {
        const pending: Array<(value: Payload) => void> = [];
        const fetch = jest.fn(() => new Promise<Payload>((resolve) => pending.push(resolve)));

        const { result, rerender } = renderHook(
            ({ filter }: { filter: string }) => useServerList<Row, Payload>({ fetch, deps: [filter] }),
            { initialProps: { filter: 'old' } },
        );
        rerender({ filter: 'new' });
        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

        await act(async () => {
            pending[1](payload(2));
        });
        await act(async () => {
            pending[0](payload(1));
        });

        expect(result.current.response?.summary).toEqual({ amount: 2 });
        expect(result.current.items).toEqual([{ id: '2' }]);
    });

    it('drops the payload when a request fails, so no stale totals outlive their rows', async () => {
        const fetch = jest.fn().mockResolvedValueOnce(payload(7)).mockRejectedValueOnce(new Error('offline'));

        const { result } = renderHook(() => useServerList<Row, Payload>({ fetch }));
        await waitFor(() => expect(result.current.response?.summary).toEqual({ amount: 7 }));

        await act(async () => {
            await result.current.reload();
        });

        expect(result.current.response).toBeNull();
        expect(result.current.error).toBeInstanceOf(Error);
    });
});
