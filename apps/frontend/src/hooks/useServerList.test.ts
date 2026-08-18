import { renderHook, waitFor } from '@testing-library/react';
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
