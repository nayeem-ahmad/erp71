import { EXPORT_FETCH_PAGE_SIZE, EXPORT_ROW_CAP, fetchAllPages } from './fetch-all-pages';

function pageOf<T>(items: T[], page: number, limit: number, total: number) {
    const start = (page - 1) * limit;
    return {
        items: items.slice(start, start + limit),
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
    };
}

describe('fetchAllPages', () => {
    it('returns an empty result when the first page is empty', async () => {
        const fetchPage = jest.fn().mockResolvedValue(pageOf([], 1, EXPORT_FETCH_PAGE_SIZE, 0));

        const result = await fetchAllPages(fetchPage);

        expect(result).toEqual({ items: [], truncated: false, total: 0 });
        expect(fetchPage).toHaveBeenCalledTimes(1);
    });

    it('stops after one request when the first page holds every row', async () => {
        const rows = [{ id: 'a' }, { id: 'b' }];
        const fetchPage = jest.fn().mockResolvedValue(pageOf(rows, 1, EXPORT_FETCH_PAGE_SIZE, 2));

        const result = await fetchAllPages(fetchPage);

        expect(result.items).toEqual(rows);
        expect(result.truncated).toBe(false);
        expect(result.total).toBe(2);
        expect(fetchPage).toHaveBeenCalledTimes(1);
    });

    it('pages through the existing list API at the backend cap until every matching row is loaded', async () => {
        const rows = Array.from({ length: 250 }, (_, i) => ({ id: String(i + 1) }));
        const fetchPage = jest.fn(async ({ page, limit }: { page: number; limit: number }) =>
            pageOf(rows, page, limit, rows.length),
        );

        const result = await fetchAllPages(fetchPage);

        expect(result.items).toHaveLength(250);
        expect(result.items[0]).toEqual({ id: '1' });
        expect(result.items[249]).toEqual({ id: '250' });
        expect(result.truncated).toBe(false);
        expect(fetchPage).toHaveBeenCalledTimes(3);
        expect(fetchPage.mock.calls.map(([args]) => args)).toEqual([
            { page: 1, limit: EXPORT_FETCH_PAGE_SIZE },
            { page: 2, limit: EXPORT_FETCH_PAGE_SIZE },
            { page: 3, limit: EXPORT_FETCH_PAGE_SIZE },
        ]);
    });

    it('forwards the current sort on every page request', async () => {
        const fetchPage = jest.fn().mockResolvedValue(pageOf([{ id: '1' }], 1, EXPORT_FETCH_PAGE_SIZE, 1));

        await fetchAllPages(fetchPage, { sort: { id: 'name', desc: true } });

        expect(fetchPage).toHaveBeenCalledWith({
            page: 1,
            limit: EXPORT_FETCH_PAGE_SIZE,
            sortBy: 'name',
            sortDir: 'desc',
        });
    });

    it('reports progress after each page', async () => {
        const rows = Array.from({ length: 150 }, (_, i) => ({ id: String(i + 1) }));
        const fetchPage = jest.fn(async ({ page, limit }: { page: number; limit: number }) =>
            pageOf(rows, page, limit, rows.length),
        );
        const onProgress = jest.fn();

        await fetchAllPages(fetchPage, { onProgress });

        expect(onProgress.mock.calls).toEqual([
            [100, 150],
            [150, 150],
        ]);
    });

    it(`stops at ${EXPORT_ROW_CAP} rows and marks the result truncated`, async () => {
        const total = EXPORT_ROW_CAP + 250;
        const fetchPage = jest.fn(async ({ page, limit }: { page: number; limit: number }) => {
            const start = (page - 1) * limit;
            return {
                items: Array.from({ length: limit }, (_, i) => ({ id: String(start + i + 1) })),
                total,
                page,
                limit,
                pages: Math.ceil(total / limit),
            };
        });

        const result = await fetchAllPages(fetchPage);

        expect(result.items).toHaveLength(EXPORT_ROW_CAP);
        expect(result.truncated).toBe(true);
        expect(result.total).toBe(total);
        expect(fetchPage).toHaveBeenCalledTimes(EXPORT_ROW_CAP / EXPORT_FETCH_PAGE_SIZE);
    });
});
