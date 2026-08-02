/**
 * The projects list endpoints go through TransformInterceptor, which reshapes
 * `{ items, total, page, limit, pages }` into `{ data: items, meta }`. This
 * asserts the api client hands callers back an `{ items, total }` envelope
 * rather than the bare array `fetchWithAuth` would unwrap to.
 */
const fetchMock = jest.fn();
global.fetch = fetchMock as never;

const TRANSFORMED = {
    data: [{ id: 'p1', code: 'PRJ-0003', name: 'p', status: 'DRAFT' }],
    meta: { total: 3, page: 1, limit: 20, pages: 1 },
};

describe('projects list api shape', () => {
    beforeEach(() => {
        jest.resetModules();
        fetchMock.mockReset();
        fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => TRANSFORMED,
            text: async () => JSON.stringify(TRANSFORMED),
        });
        localStorage.setItem('token', 'diag-token');
    });

    it.each([
        ['getProjects', (api: any) => api.getProjects({ page: 1, limit: 20 })],
        ['getProjectTasks', (api: any) => api.getProjectTasks({ limit: 200 })],
        ['getProjectTimeEntries', (api: any) => api.getProjectTimeEntries({ limit: 200 })],
    ])('%s returns { items, total } from a TransformInterceptor response', async (_name, call) => {
        const { api } = require('./api');
        const result = await call(api);
        expect(Array.isArray(result)).toBe(false);
        expect(result.items).toHaveLength(1);
        expect(result.items[0].code).toBe('PRJ-0003');
        expect(result.total).toBe(3);
    });
});
