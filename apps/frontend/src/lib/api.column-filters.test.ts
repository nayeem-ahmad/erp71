/**
 * The server-paginated lists send a table's advanced filters as one JSON
 * `filters` param. Several of these clients build their query by stringifying
 * every value, which would turn the object into `[object Object]` — so each is
 * checked on the URL it actually requests.
 */
const fetchMock = jest.fn();
global.fetch = fetchMock as never;

const PAGE = { data: [], meta: { total: 0, page: 1, limit: 20, pages: 0 } };
const FILTERS = { name: 'Gold & Co' };

const requestedUrl = () => new URL(String(fetchMock.mock.calls.at(-1)![0]), 'http://localhost');

describe('column filters on the list endpoints', () => {
    beforeEach(() => {
        jest.resetModules();
        fetchMock.mockReset();
        fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => PAGE,
            text: async () => JSON.stringify(PAGE),
        });
        localStorage.setItem('access_token', 'diag-token');
    });

    it.each([
        ['getLeads', (api: any, filters?: object) => api.getLeads({ page: 1, filters })],
        ['getContacts', (api: any, filters?: object) => api.getContacts({ page: 1, filters })],
        ['getCustomersPaged', (api: any, filters?: object) => api.getCustomersPaged({ page: 1, filters })],
        ['getSalesList', (api: any, filters?: object) => api.getSalesList({ page: 1, filters })],
        ['getSalesLineItems', (api: any, filters?: object) => api.getSalesLineItems({ page: 1, filters })],
        ['getPurchaseLineItems', (api: any, filters?: object) => api.getPurchaseLineItems({ page: 1, filters })],
        ['getImportShipments', (api: any, filters?: object) => api.getImportShipments({ page: 1, filters })],
        ['getSuppliersPaged', (api: any, filters?: object) => api.getSuppliersPaged({ page: 1, filters })],
        ['getProjects', (api: any, filters?: object) => api.getProjects({ page: 1, filters })],
        ['getProjectTasks', (api: any, filters?: object) => api.getProjectTasks({ page: 1, filters })],
        ['getInventoryLedger', (api: any, filters?: object) => api.getInventoryLedger({ page: 1, filters })],
        ['getProductsPaged', (api: any, filters?: object) => api.getProductsPaged({ page: 1, filters })],
    ])('%s sends them as one JSON param, and nothing when there are none', async (_name, call) => {
        const { api } = require('./api');

        await call(api, FILTERS);
        expect(requestedUrl().searchParams.get('filters')).toBe(JSON.stringify(FILTERS));
        expect(requestedUrl().search).not.toContain('object');

        await call(api, {});
        expect(requestedUrl().searchParams.has('filters')).toBe(false);
    });
});
