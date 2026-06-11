/**
 * Tests for src/lib/api.ts
 *
 * Strategy: mock global.fetch and localStorage so we can exercise the real
 * HTTP-client logic (header injection, error handling, query-string building,
 * data-unwrapping) and every api.* helper without hitting the network.
 */

// ---------------------------------------------------------------------------
// Infrastructure mocks – must be set up before the module is imported.
// ---------------------------------------------------------------------------

const mockFetch = jest.fn();
global.fetch = mockFetch;

const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
        getItem: jest.fn((key: string) => store[key] ?? null),
        setItem: jest.fn((key: string, value: string) => { store[key] = value; }),
        removeItem: jest.fn((key: string) => { delete store[key]; }),
        clear: jest.fn(() => { store = {}; }),
        _store: () => store,
        _setAll: (entries: Record<string, string>) => { store = { ...entries }; },
    };
})();

Object.defineProperty(window, 'localStorage', {
    value: localStorageMock,
    writable: true,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal ok fetch response that resolves to `body`. */
function okJson(body: unknown) {
    return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: {
            get: (_: string) => null,
        },
        json: async () => body,
        blob: async () => new Blob([JSON.stringify(body)]),
    });
}

/** Build a minimal error fetch response. */
function errorJson(status: number, statusText: string, body?: unknown) {
    return Promise.resolve({
        ok: false,
        status,
        statusText,
        headers: {
            get: (_: string) => null,
        },
        json: async () => body,
        blob: async () => new Blob(),
    });
}

/** The API module under test (imported after mocks are wired). */
import { fetchWithAuth, fetchBlobWithAuth, api } from './api';

// ---------------------------------------------------------------------------
// Shared beforeEach
// ---------------------------------------------------------------------------

beforeEach(() => {
    jest.clearAllMocks();
    localStorageMock._setAll({
        access_token: 'test-token',
        tenant_id: 'tenant-abc',
        store_id: 'store-xyz',
    });
});

// ===========================================================================
// fetchWithAuth
// ===========================================================================

describe('fetchWithAuth', () => {
    it('sends Authorization, x-tenant-id, and x-store-id headers', async () => {
        mockFetch.mockReturnValue(okJson({ data: 'hello' }));

        await fetchWithAuth('/test-endpoint');

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [url, opts] = mockFetch.mock.calls[0];
        expect(url).toContain('/test-endpoint');

        // Headers is a real Headers object — iterate it
        const headers: Headers = opts.headers;
        expect(headers.get('Authorization')).toBe('Bearer test-token');
        expect(headers.get('x-tenant-id')).toBe('tenant-abc');
        expect(headers.get('x-store-id')).toBe('store-xyz');
    });

    it('unwraps { data: T } envelope from backend', async () => {
        mockFetch.mockReturnValue(okJson({ data: { id: 1, name: 'product' } }));

        const result = await fetchWithAuth('/products');
        expect(result).toEqual({ id: 1, name: 'product' });
    });

    it('returns raw body when no data wrapper present', async () => {
        mockFetch.mockReturnValue(okJson([{ id: 1 }, { id: 2 }]));

        const result = await fetchWithAuth('/items');
        expect(result).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it('throws on non-ok response with statusText fallback', async () => {
        mockFetch.mockReturnValue(errorJson(404, 'Not Found', null));

        await expect(fetchWithAuth('/missing')).rejects.toThrow('API error: Not Found');
    });

    it('throws with message from JSON error body (string)', async () => {
        mockFetch.mockReturnValue(errorJson(400, 'Bad Request', { message: 'Validation failed' }));

        await expect(fetchWithAuth('/bad')).rejects.toThrow('Validation failed');
    });

    it('throws with joined message when JSON body message is an array', async () => {
        mockFetch.mockReturnValue(
            errorJson(422, 'Unprocessable Entity', { message: ['field1 is required', 'field2 too short'] })
        );

        await expect(fetchWithAuth('/bad-array')).rejects.toThrow('field1 is required, field2 too short');
    });

    it('falls back to error field when message absent', async () => {
        mockFetch.mockReturnValue(errorJson(500, 'Server Error', { error: 'Internal error' }));

        await expect(fetchWithAuth('/bad-error')).rejects.toThrow('Internal error');
    });

    it('falls back to statusText when JSON parsing fails', async () => {
        mockFetch.mockReturnValue(Promise.resolve({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            headers: { get: () => null },
            json: async () => { throw new SyntaxError('not json'); },
        }));

        await expect(fetchWithAuth('/bad-json')).rejects.toThrow('API error: Internal Server Error');
    });

    it('passes custom HTTP method and body', async () => {
        mockFetch.mockReturnValue(okJson({ data: { id: 'new' } }));

        await fetchWithAuth('/things', {
            method: 'POST',
            body: JSON.stringify({ name: 'thing' }),
            headers: { 'Content-Type': 'application/json' },
        });

        const [, opts] = mockFetch.mock.calls[0];
        expect(opts.method).toBe('POST');
        expect(opts.body).toBe(JSON.stringify({ name: 'thing' }));
        expect(opts.headers.get('Content-Type')).toBe('application/json');
    });

    it('omits Authorization header when no token in localStorage', async () => {
        localStorageMock._setAll({});
        mockFetch.mockReturnValue(okJson({ data: null }));

        await fetchWithAuth('/public');

        const [, opts] = mockFetch.mock.calls[0];
        expect(opts.headers.get('Authorization')).toBeNull();
    });

    it('omits tenant and store headers when not in localStorage', async () => {
        localStorageMock._setAll({ access_token: 'tok' });
        mockFetch.mockReturnValue(okJson({ data: null }));

        await fetchWithAuth('/no-tenant');

        const [, opts] = mockFetch.mock.calls[0];
        expect(opts.headers.get('x-tenant-id')).toBeNull();
        expect(opts.headers.get('x-store-id')).toBeNull();
    });
});

// ===========================================================================
// fetchBlobWithAuth
// ===========================================================================

describe('fetchBlobWithAuth', () => {
    it('returns blob and extracted filename from Content-Disposition', async () => {
        const blob = new Blob(['csv content'], { type: 'text/csv' });
        mockFetch.mockReturnValue(Promise.resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: {
                get: (key: string) =>
                    key === 'Content-Disposition' ? 'attachment; filename="ledger.csv"' : null,
            },
            blob: async () => blob,
        }));

        const result = await fetchBlobWithAuth('/accounting/export?format=tally');
        expect(result.filename).toBe('ledger.csv');
        expect(result.blob).toBe(blob);
    });

    it('uses "export" as fallback filename when Content-Disposition absent', async () => {
        const blob = new Blob(['data']);
        mockFetch.mockReturnValue(Promise.resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: { get: () => null },
            blob: async () => blob,
        }));

        const result = await fetchBlobWithAuth('/export');
        expect(result.filename).toBe('export');
    });

    it('throws on non-ok response', async () => {
        mockFetch.mockReturnValue(errorJson(403, 'Forbidden', { message: 'Access denied' }));

        await expect(fetchBlobWithAuth('/restricted')).rejects.toThrow('Access denied');
    });

    it('falls back to statusText when blob error body has no json', async () => {
        mockFetch.mockReturnValue(Promise.resolve({
            ok: false,
            status: 403,
            statusText: 'Forbidden',
            headers: { get: () => null },
            json: async () => { throw new SyntaxError('bad json'); },
            blob: async () => new Blob(),
        }));

        await expect(fetchBlobWithAuth('/restricted')).rejects.toThrow('API error: Forbidden');
    });

    it('sends auth headers identical to fetchWithAuth', async () => {
        const blob = new Blob(['x']);
        mockFetch.mockReturnValue(Promise.resolve({
            ok: true,
            headers: { get: () => null },
            blob: async () => blob,
        }));

        await fetchBlobWithAuth('/blob-endpoint');

        const [, opts] = mockFetch.mock.calls[0];
        expect(opts.headers.get('Authorization')).toBe('Bearer test-token');
        expect(opts.headers.get('x-tenant-id')).toBe('tenant-abc');
        expect(opts.headers.get('x-store-id')).toBe('store-xyz');
    });
});

// ===========================================================================
// api.* helper methods
// ===========================================================================

// Shorthand: mock a successful response for one call
function mockOk(body: unknown = { data: {} }) {
    mockFetch.mockReturnValueOnce(okJson(body));
}

function lastCall() {
    return mockFetch.mock.calls[mockFetch.mock.calls.length - 1] as [string, RequestInit];
}

function lastUrl() { return lastCall()[0]; }
function lastOpts() { return lastCall()[1]; }

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

describe('api.getProducts', () => {
    it('fetches /products with default limit=100', async () => {
        mockOk({ data: { items: [{ id: '1' }] } });
        await api.getProducts();
        expect(lastUrl()).toContain('/products?limit=100');
    });

    it('passes groupId and subgroupId params', async () => {
        mockOk({ data: { items: [] } });
        await api.getProducts({ groupId: 'g1', subgroupId: 'sg1' });
        expect(lastUrl()).toContain('groupId=g1');
        expect(lastUrl()).toContain('subgroupId=sg1');
    });

    it('passes uncategorized=true', async () => {
        mockOk({ data: { items: [] } });
        await api.getProducts({ uncategorized: true });
        expect(lastUrl()).toContain('uncategorized=true');
    });

    it('passes custom limit and page', async () => {
        mockOk({ data: { items: [] } });
        await api.getProducts({ limit: 50, page: 2 });
        expect(lastUrl()).toContain('limit=50');
        expect(lastUrl()).toContain('page=2');
    });

    it('unwraps items array from response', async () => {
        mockOk({ data: { items: [{ id: 'p1' }] } });
        const result = await api.getProducts();
        expect(result).toEqual([{ id: 'p1' }]);
    });

    it('returns raw response when no items key', async () => {
        mockOk({ data: [{ id: 'p1' }] });
        const result = await api.getProducts();
        expect(result).toEqual([{ id: 'p1' }]);
    });
});

describe('api.createProduct', () => {
    it('posts to /products with JSON body', async () => {
        mockOk({ data: { id: 'new' } });
        await api.createProduct({ name: 'Widget', price: 10 });
        expect(lastUrl()).toContain('/products');
        expect(lastOpts().method).toBe('POST');
        expect(lastOpts().body).toBe(JSON.stringify({ name: 'Widget', price: 10 }));
    });
});

describe('api.updateProduct', () => {
    it('patches /products/:id', async () => {
        mockOk({ data: { id: 'p1' } });
        await api.updateProduct('p1', { price: 20 });
        expect(lastUrl()).toContain('/products/p1');
        expect(lastOpts().method).toBe('PATCH');
    });
});

describe('api.deleteProduct', () => {
    it('deletes /products/:id', async () => {
        mockOk({ data: null });
        await api.deleteProduct('p1');
        expect(lastUrl()).toContain('/products/p1');
        expect(lastOpts().method).toBe('DELETE');
    });
});

// ---------------------------------------------------------------------------
// Product Groups
// ---------------------------------------------------------------------------

describe('api.getProductGroups', () => {
    it('fetches /product-groups', async () => {
        mockOk({ data: [] });
        await api.getProductGroups();
        expect(lastUrl()).toContain('/product-groups');
    });
});

describe('api.getProductGroup', () => {
    it('fetches /product-groups/:id', async () => {
        mockOk({ data: { id: 'g1' } });
        await api.getProductGroup('g1');
        expect(lastUrl()).toContain('/product-groups/g1');
    });
});

describe('api.createProductGroup', () => {
    it('posts to /product-groups', async () => {
        mockOk({ data: { id: 'g-new' } });
        await api.createProductGroup({ name: 'Electronics' });
        expect(lastOpts().method).toBe('POST');
        expect(lastUrl()).toContain('/product-groups');
    });
});

describe('api.updateProductGroup', () => {
    it('patches /product-groups/:id', async () => {
        mockOk({ data: {} });
        await api.updateProductGroup('g1', { name: 'Updated' });
        expect(lastOpts().method).toBe('PATCH');
        expect(lastUrl()).toContain('/product-groups/g1');
    });
});

describe('api.deleteProductGroup', () => {
    it('deletes /product-groups/:id', async () => {
        mockOk({ data: null });
        await api.deleteProductGroup('g1');
        expect(lastOpts().method).toBe('DELETE');
    });
});

// ---------------------------------------------------------------------------
// Product Subgroups
// ---------------------------------------------------------------------------

describe('api.getProductSubgroups', () => {
    it('fetches /product-subgroups without params', async () => {
        mockOk({ data: [] });
        await api.getProductSubgroups();
        expect(lastUrl()).toContain('/product-subgroups');
        expect(lastUrl()).not.toContain('?');
    });

    it('appends groupId when provided', async () => {
        mockOk({ data: [] });
        await api.getProductSubgroups({ groupId: 'g1' });
        expect(lastUrl()).toContain('groupId=g1');
    });
});

describe('api.getProductSubgroup', () => {
    it('fetches /product-subgroups/:id', async () => {
        mockOk({ data: {} });
        await api.getProductSubgroup('sg1');
        expect(lastUrl()).toContain('/product-subgroups/sg1');
    });
});

describe('api.createProductSubgroup', () => {
    it('posts to /product-subgroups', async () => {
        mockOk({ data: {} });
        await api.createProductSubgroup({ name: 'Phones' });
        expect(lastOpts().method).toBe('POST');
    });
});

describe('api.updateProductSubgroup', () => {
    it('patches /product-subgroups/:id', async () => {
        mockOk({ data: {} });
        await api.updateProductSubgroup('sg1', { name: 'Tablets' });
        expect(lastOpts().method).toBe('PATCH');
        expect(lastUrl()).toContain('/product-subgroups/sg1');
    });
});

describe('api.deleteProductSubgroup', () => {
    it('deletes /product-subgroups/:id', async () => {
        mockOk({ data: null });
        await api.deleteProductSubgroup('sg1');
        expect(lastOpts().method).toBe('DELETE');
    });
});

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

describe('api.getInventoryWarehouses', () => {
    it('fetches /inventory/warehouses', async () => {
        mockOk({ data: [] });
        await api.getInventoryWarehouses();
        expect(lastUrl()).toContain('/inventory/warehouses');
    });
});

describe('api.createInventoryWarehouse', () => {
    it('posts to /inventory/warehouses', async () => {
        mockOk({ data: {} });
        await api.createInventoryWarehouse({ name: 'Main WH' });
        expect(lastOpts().method).toBe('POST');
    });
});

describe('api.updateInventoryWarehouse', () => {
    it('patches /inventory/warehouses/:id', async () => {
        mockOk({ data: {} });
        await api.updateInventoryWarehouse('wh1', { name: 'Updated' });
        expect(lastOpts().method).toBe('PATCH');
        expect(lastUrl()).toContain('/inventory/warehouses/wh1');
    });
});

describe('api.getInventorySettings', () => {
    it('fetches /inventory/settings', async () => {
        mockOk({ data: {} });
        await api.getInventorySettings();
        expect(lastUrl()).toContain('/inventory/settings');
    });
});

describe('api.updateInventorySettings', () => {
    it('patches /inventory/settings', async () => {
        mockOk({ data: {} });
        await api.updateInventorySettings({ allowNegative: true });
        expect(lastOpts().method).toBe('PATCH');
    });
});

describe('api.getInventoryReasons', () => {
    it('fetches /inventory/reasons without params', async () => {
        mockOk({ data: [] });
        await api.getInventoryReasons();
        expect(lastUrl()).toContain('/inventory/reasons');
        expect(lastUrl()).not.toContain('?');
    });

    it('appends type param', async () => {
        mockOk({ data: [] });
        await api.getInventoryReasons({ type: 'SHRINKAGE' });
        expect(lastUrl()).toContain('type=SHRINKAGE');
    });
});

describe('api.createInventoryReason', () => {
    it('posts to /inventory/reasons', async () => {
        mockOk({ data: {} });
        await api.createInventoryReason({ name: 'Damaged' });
        expect(lastOpts().method).toBe('POST');
    });
});

describe('api.updateInventoryReason', () => {
    it('patches /inventory/reasons/:id', async () => {
        mockOk({ data: {} });
        await api.updateInventoryReason('r1', { name: 'Expired' });
        expect(lastOpts().method).toBe('PATCH');
        expect(lastUrl()).toContain('/inventory/reasons/r1');
    });
});

describe('api.getInventoryLedger', () => {
    it('fetches /inventory/ledger without params', async () => {
        mockOk({ data: [] });
        await api.getInventoryLedger();
        expect(lastUrl()).toContain('/inventory/ledger');
    });

    it('appends all optional params', async () => {
        mockOk({ data: [] });
        await api.getInventoryLedger({
            productId: 'p1',
            warehouseId: 'wh1',
            movementType: 'IN',
            from: '2026-01-01',
            to: '2026-06-01',
            limit: 50,
        });
        const url = lastUrl();
        expect(url).toContain('productId=p1');
        expect(url).toContain('warehouseId=wh1');
        expect(url).toContain('movementType=IN');
        expect(url).toContain('from=2026-01-01');
        expect(url).toContain('to=2026-06-01');
        expect(url).toContain('limit=50');
    });
});

// ---------------------------------------------------------------------------
// Warehouse Transfers
// ---------------------------------------------------------------------------

describe('api.getWarehouseTransfers', () => {
    it('fetches /warehouse-transfers without params', async () => {
        mockOk({ data: [] });
        await api.getWarehouseTransfers();
        expect(lastUrl()).toContain('/warehouse-transfers');
    });

    it('appends filter params', async () => {
        mockOk({ data: [] });
        await api.getWarehouseTransfers({ status: 'PENDING', sourceWarehouseId: 'w1' });
        expect(lastUrl()).toContain('status=PENDING');
        expect(lastUrl()).toContain('sourceWarehouseId=w1');
    });
});

describe('api.getWarehouseTransfer', () => {
    it('fetches /warehouse-transfers/:id', async () => {
        mockOk({ data: {} });
        await api.getWarehouseTransfer('wt1');
        expect(lastUrl()).toContain('/warehouse-transfers/wt1');
    });
});

describe('api.createWarehouseTransfer', () => {
    it('posts to /warehouse-transfers', async () => {
        mockOk({ data: {} });
        await api.createWarehouseTransfer({ items: [] });
        expect(lastOpts().method).toBe('POST');
    });
});

describe('api.sendWarehouseTransfer', () => {
    it('posts to /warehouse-transfers/:id/send', async () => {
        mockOk({ data: {} });
        await api.sendWarehouseTransfer('wt1');
        expect(lastOpts().method).toBe('POST');
        expect(lastUrl()).toContain('/warehouse-transfers/wt1/send');
    });
});

describe('api.receiveWarehouseTransfer', () => {
    it('posts to /warehouse-transfers/:id/receive', async () => {
        mockOk({ data: {} });
        await api.receiveWarehouseTransfer('wt1', { items: [] });
        expect(lastOpts().method).toBe('POST');
        expect(lastUrl()).toContain('/warehouse-transfers/wt1/receive');
    });
});

// ---------------------------------------------------------------------------
// Inventory Shrinkage
// ---------------------------------------------------------------------------

describe('api.getInventoryShrinkage', () => {
    it('fetches /inventory-shrinkage', async () => {
        mockOk({ data: [] });
        await api.getInventoryShrinkage();
        expect(lastUrl()).toContain('/inventory-shrinkage');
    });
});

describe('api.getInventoryShrinkageRecord', () => {
    it('fetches /inventory-shrinkage/:id', async () => {
        mockOk({ data: {} });
        await api.getInventoryShrinkageRecord('sr1');
        expect(lastUrl()).toContain('/inventory-shrinkage/sr1');
    });
});

describe('api.createInventoryShrinkage', () => {
    it('posts to /inventory-shrinkage', async () => {
        mockOk({ data: {} });
        await api.createInventoryShrinkage({ quantity: 5 });
        expect(lastOpts().method).toBe('POST');
    });
});

// ---------------------------------------------------------------------------
// Stock Takes
// ---------------------------------------------------------------------------

describe('api.getStockTakes', () => {
    it('fetches /stock-takes', async () => {
        mockOk({ data: [] });
        await api.getStockTakes();
        expect(lastUrl()).toContain('/stock-takes');
    });
});

describe('api.getStockTake', () => {
    it('fetches /stock-takes/:id', async () => {
        mockOk({ data: {} });
        await api.getStockTake('st1');
        expect(lastUrl()).toContain('/stock-takes/st1');
    });
});

describe('api.createStockTake', () => {
    it('posts to /stock-takes', async () => {
        mockOk({ data: {} });
        await api.createStockTake({ warehouseId: 'wh1' });
        expect(lastOpts().method).toBe('POST');
    });
});

describe('api.updateStockTakeCounts', () => {
    it('patches /stock-takes/:id/counts', async () => {
        mockOk({ data: {} });
        await api.updateStockTakeCounts('st1', { counts: [] });
        expect(lastOpts().method).toBe('PATCH');
        expect(lastUrl()).toContain('/stock-takes/st1/counts');
    });
});

describe('api.updateStockTakeStatus', () => {
    it('patches /stock-takes/:id/status', async () => {
        mockOk({ data: {} });
        await api.updateStockTakeStatus('st1', { status: 'COMPLETED' });
        expect(lastOpts().method).toBe('PATCH');
        expect(lastUrl()).toContain('/stock-takes/st1/status');
    });
});

describe('api.postStockTake', () => {
    it('posts to /stock-takes/:id/post', async () => {
        mockOk({ data: {} });
        await api.postStockTake('st1');
        expect(lastOpts().method).toBe('POST');
        expect(lastUrl()).toContain('/stock-takes/st1/post');
    });
});

// ---------------------------------------------------------------------------
// Inventory Reports
// ---------------------------------------------------------------------------

describe('api.getReorderSuggestions', () => {
    it('fetches /inventory-reports/reorder-suggestions', async () => {
        mockOk({ data: [] });
        await api.getReorderSuggestions();
        expect(lastUrl()).toContain('/inventory-reports/reorder-suggestions');
    });

    it('appends warehouseId, groupId, subgroupId params', async () => {
        mockOk({ data: [] });
        await api.getReorderSuggestions({ warehouseId: 'wh1', groupId: 'g1', subgroupId: 'sg1' });
        expect(lastUrl()).toContain('warehouseId=wh1');
        expect(lastUrl()).toContain('groupId=g1');
        expect(lastUrl()).toContain('subgroupId=sg1');
    });
});

describe('api.getInventoryValuation', () => {
    it('fetches /inventory-reports/valuation', async () => {
        mockOk({ data: {} });
        await api.getInventoryValuation({ warehouseId: 'wh1' });
        expect(lastUrl()).toContain('/inventory-reports/valuation');
        expect(lastUrl()).toContain('warehouseId=wh1');
    });
});

describe('api.getShrinkageSummary', () => {
    it('fetches /inventory-reports/shrinkage-summary with all params', async () => {
        mockOk({ data: {} });
        await api.getShrinkageSummary({
            warehouseId: 'wh1', reasonId: 'r1', productId: 'p1',
            groupId: 'g1', subgroupId: 'sg1', from: '2026-01-01', to: '2026-06-01',
        });
        const url = lastUrl();
        expect(url).toContain('warehouseId=wh1');
        expect(url).toContain('reasonId=r1');
        expect(url).toContain('productId=p1');
        expect(url).toContain('from=2026-01-01');
        expect(url).toContain('to=2026-06-01');
    });
});

// ---------------------------------------------------------------------------
// Sales Reports
// ---------------------------------------------------------------------------

describe('api.getSalesSummary', () => {
    it('fetches /sales-reports/summary', async () => {
        mockOk({ data: {} });
        await api.getSalesSummary({ storeId: 's1', from: '2026-01-01', to: '2026-06-01' });
        const url = lastUrl();
        expect(url).toContain('/sales-reports/summary');
        expect(url).toContain('storeId=s1');
    });
});

describe('api.getSalesByProduct', () => {
    it('fetches /sales-reports/by-product', async () => {
        mockOk({ data: {} });
        await api.getSalesByProduct({ groupId: 'g1', subgroupId: 'sg1' });
        expect(lastUrl()).toContain('/sales-reports/by-product');
    });
});

describe('api.getConsolidatedReport', () => {
    it('fetches /sales-reports/consolidated', async () => {
        mockOk({ data: {} });
        await api.getConsolidatedReport({ from: '2026-01-01', to: '2026-06-01' });
        expect(lastUrl()).toContain('/sales-reports/consolidated');
    });
});

describe('api.getSalesByCustomer', () => {
    it('fetches /sales-reports/by-customer', async () => {
        mockOk({ data: {} });
        await api.getSalesByCustomer({ storeId: 's1' });
        expect(lastUrl()).toContain('/sales-reports/by-customer');
    });
});

describe('api.getMonthlySalesByCustomer', () => {
    it('fetches /sales-reports/monthly-by-customer', async () => {
        mockOk({ data: {} });
        await api.getMonthlySalesByCustomer({ customerId: 'c1' });
        expect(lastUrl()).toContain('/sales-reports/monthly-by-customer');
        expect(lastUrl()).toContain('customerId=c1');
    });
});

describe('api.getBranchReport', () => {
    it('fetches /sales-reports/branch-report with storeId required', async () => {
        mockOk({ data: {} });
        await api.getBranchReport({ storeId: 's1', from: '2026-01-01', to: '2026-06-01' });
        const url = lastUrl();
        expect(url).toContain('/sales-reports/branch-report');
        expect(url).toContain('storeId=s1');
    });
});

// ---------------------------------------------------------------------------
// File Upload
// ---------------------------------------------------------------------------

describe('api.uploadFile', () => {
    it('posts FormData to /assets/upload', async () => {
        mockOk({ data: { url: 'https://example.com/img.png' } });
        const file = new File(['content'], 'img.png', { type: 'image/png' });
        await api.uploadFile(file);
        expect(lastOpts().method).toBe('POST');
        expect(lastUrl()).toContain('/assets/upload');
        expect(lastOpts().body).toBeInstanceOf(FormData);
    });
});

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

describe('api.createSale', () => {
    it('posts to /sales', async () => {
        mockOk({ data: { id: 'sale1' } });
        await api.createSale({ items: [] });
        expect(lastOpts().method).toBe('POST');
        expect(lastUrl()).toContain('/sales');
    });
});

describe('api.getSales', () => {
    it('fetches /sales and unwraps items', async () => {
        mockOk({ data: { items: [{ id: 's1' }] } });
        const result = await api.getSales();
        expect(result).toEqual([{ id: 's1' }]);
    });

    it('returns raw result when no items key', async () => {
        mockOk({ data: [{ id: 's1' }] });
        const result = await api.getSales();
        expect(result).toEqual([{ id: 's1' }]);
    });
});

describe('api.getSale', () => {
    it('fetches /sales/:id', async () => {
        mockOk({ data: {} });
        await api.getSale('s1');
        expect(lastUrl()).toContain('/sales/s1');
    });
});

describe('api.getSaleInvoice', () => {
    it('fetches /sales/:id/invoice', async () => {
        mockOk({ data: {} });
        await api.getSaleInvoice('s1');
        expect(lastUrl()).toContain('/sales/s1/invoice');
    });
});

describe('api.updateSale', () => {
    it('patches /sales/:id', async () => {
        mockOk({ data: {} });
        await api.updateSale('s1', { status: 'COMPLETE' });
        expect(lastOpts().method).toBe('PATCH');
        expect(lastUrl()).toContain('/sales/s1');
    });
});

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

describe('api.getCustomers', () => {
    it('fetches /customers with default limit=100', async () => {
        mockOk({ data: { items: [] } });
        await api.getCustomers();
        expect(lastUrl()).toContain('/customers?limit=100');
    });

    it('passes search param', async () => {
        mockOk({ data: { items: [] } });
        await api.getCustomers({ search: 'John' });
        expect(lastUrl()).toContain('search=John');
    });

    it('unwraps items array', async () => {
        mockOk({ data: { items: [{ id: 'c1' }] } });
        const result = await api.getCustomers();
        expect(result).toEqual([{ id: 'c1' }]);
    });
});

describe('api.getCustomer', () => {
    it('fetches /customers/:id', async () => {
        mockOk({ data: {} });
        await api.getCustomer('c1');
        expect(lastUrl()).toContain('/customers/c1');
    });
});

describe('api.getCustomerPurchaseHistory', () => {
    it('fetches /customers/:id/history without params', async () => {
        mockOk({ data: {} });
        await api.getCustomerPurchaseHistory('c1');
        expect(lastUrl()).toContain('/customers/c1/history');
        expect(lastUrl()).not.toContain('?');
    });

    it('appends optional params', async () => {
        mockOk({ data: {} });
        await api.getCustomerPurchaseHistory('c1', { page: 2, limit: 10, from: '2026-01-01', to: '2026-06-01' });
        const url = lastUrl();
        expect(url).toContain('page=2');
        expect(url).toContain('limit=10');
        expect(url).toContain('from=2026-01-01');
    });
});

describe('api.getCustomerHistory', () => {
    it('fetches /customers/:id/history', async () => {
        mockOk({ data: [] });
        await api.getCustomerHistory('c1');
        expect(lastUrl()).toContain('/customers/c1/history');
    });
});

describe('api.getCustomerSegmentStats', () => {
    it('fetches /customers/segment-stats', async () => {
        mockOk({ data: {} });
        await api.getCustomerSegmentStats();
        expect(lastUrl()).toContain('/customers/segment-stats');
    });
});

describe('api.runCustomerSegmentation', () => {
    it('posts to /customers/run-segmentation', async () => {
        mockOk({ data: {} });
        await api.runCustomerSegmentation();
        expect(lastOpts().method).toBe('POST');
        expect(lastUrl()).toContain('/customers/run-segmentation');
    });
});

describe('api.evaluateCustomerSegments', () => {
    it('posts to /customers/segments/evaluate', async () => {
        mockOk({ data: {} });
        await api.evaluateCustomerSegments();
        expect(lastOpts().method).toBe('POST');
        expect(lastUrl()).toContain('/customers/segments/evaluate');
    });
});

describe('api.createCustomer', () => {
    it('posts to /customers', async () => {
        mockOk({ data: {} });
        await api.createCustomer({ name: 'Alice' });
        expect(lastOpts().method).toBe('POST');
    });
});

describe('api.updateCustomer', () => {
    it('patches /customers/:id', async () => {
        mockOk({ data: {} });
        await api.updateCustomer('c1', { name: 'Bob' });
        expect(lastOpts().method).toBe('PATCH');
        expect(lastUrl()).toContain('/customers/c1');
    });
});

// ---------------------------------------------------------------------------
// Customer Groups
// ---------------------------------------------------------------------------

describe('api.getCustomerGroups', () => {
    it('fetches /customer-groups', async () => {
        mockOk({ data: [] });
        await api.getCustomerGroups();
        expect(lastUrl()).toContain('/customer-groups');
    });
});

describe('api.getCustomerGroup', () => {
    it('fetches /customer-groups/:id', async () => {
        mockOk({ data: {} });
        await api.getCustomerGroup('cg1');
        expect(lastUrl()).toContain('/customer-groups/cg1');
    });
});

describe('api.createCustomerGroup', () => {
    it('posts to /customer-groups', async () => {
        mockOk({ data: {} });
        await api.createCustomerGroup({ name: 'VIP' });
        expect(lastOpts().method).toBe('POST');
    });
});

describe('api.updateCustomerGroup', () => {
    it('patches /customer-groups/:id', async () => {
        mockOk({ data: {} });
        await api.updateCustomerGroup('cg1', { name: 'Premium' });
        expect(lastOpts().method).toBe('PATCH');
    });
});

describe('api.deleteCustomerGroup', () => {
    it('deletes /customer-groups/:id', async () => {
        mockOk({ data: null });
        await api.deleteCustomerGroup('cg1');
        expect(lastOpts().method).toBe('DELETE');
    });
});

// ---------------------------------------------------------------------------
// Territories
// ---------------------------------------------------------------------------

describe('api.getTerritories', () => {
    it('fetches /territories', async () => {
        mockOk({ data: [] });
        await api.getTerritories();
        expect(lastUrl()).toContain('/territories');
    });
});

describe('api.getTerritory', () => {
    it('fetches /territories/:id', async () => {
        mockOk({ data: {} });
        await api.getTerritory('t1');
        expect(lastUrl()).toContain('/territories/t1');
    });
});

describe('api.createTerritory', () => {
    it('posts to /territories', async () => {
        mockOk({ data: {} });
        await api.createTerritory({ name: 'North' });
        expect(lastOpts().method).toBe('POST');
    });
});

describe('api.updateTerritory', () => {
    it('patches /territories/:id', async () => {
        mockOk({ data: {} });
        await api.updateTerritory('t1', { name: 'South' });
        expect(lastOpts().method).toBe('PATCH');
    });
});

describe('api.deleteTerritory', () => {
    it('deletes /territories/:id', async () => {
        mockOk({ data: null });
        await api.deleteTerritory('t1');
        expect(lastOpts().method).toBe('DELETE');
    });
});

// ---------------------------------------------------------------------------
// Accounting
// ---------------------------------------------------------------------------

describe('api.getAccountingOverview', () => {
    it('fetches /accounting', async () => {
        mockOk({ data: {} });
        await api.getAccountingOverview();
        expect(lastUrl()).toContain('/accounting');
    });
});

describe('api.getAccountGroups', () => {
    it('fetches /accounting/account-groups', async () => {
        mockOk({ data: [] });
        await api.getAccountGroups();
        expect(lastUrl()).toContain('/accounting/account-groups');
    });
});

describe('api.createAccountGroup', () => {
    it('posts to /accounting/account-groups', async () => {
        mockOk({ data: {} });
        await api.createAccountGroup({ name: 'Assets' });
        expect(lastOpts().method).toBe('POST');
    });
});

describe('api.getAccountSubgroups', () => {
    it('fetches /accounting/account-subgroups without params', async () => {
        mockOk({ data: [] });
        await api.getAccountSubgroups();
        expect(lastUrl()).toContain('/accounting/account-subgroups');
    });

    it('appends groupId param', async () => {
        mockOk({ data: [] });
        await api.getAccountSubgroups({ groupId: 'ag1' });
        expect(lastUrl()).toContain('groupId=ag1');
    });
});

describe('api.createAccountSubgroup', () => {
    it('posts to /accounting/account-subgroups', async () => {
        mockOk({ data: {} });
        await api.createAccountSubgroup({ name: 'Fixed Assets' });
        expect(lastOpts().method).toBe('POST');
    });
});

describe('api.getAccounts', () => {
    it('fetches /accounting/accounts without params', async () => {
        mockOk({ data: [] });
        await api.getAccounts();
        expect(lastUrl()).toContain('/accounting/accounts');
    });

    it('appends search, groupId, type, category params', async () => {
        mockOk({ data: [] });
        await api.getAccounts({ search: 'cash', groupId: 'ag1', type: 'ASSET', category: 'BANK' });
        const url = lastUrl();
        expect(url).toContain('search=cash');
        expect(url).toContain('groupId=ag1');
        expect(url).toContain('type=ASSET');
        expect(url).toContain('category=BANK');
    });
});

describe('api.createAccount', () => {
    it('posts to /accounting/accounts', async () => {
        mockOk({ data: {} });
        await api.createAccount({ name: 'Cash' });
        expect(lastOpts().method).toBe('POST');
    });
});

describe('api.getVoucherNumberPreview', () => {
    it('fetches /accounting/vouchers/next-number with voucherType param', async () => {
        mockOk({ data: { nextNumber: 'JV-001' } });
        await api.getVoucherNumberPreview('JOURNAL');
        expect(lastUrl()).toContain('/accounting/vouchers/next-number');
        expect(lastUrl()).toContain('voucherType=JOURNAL');
    });
});

describe('api.getVouchers', () => {
    it('fetches /accounting/vouchers without params', async () => {
        mockOk({ data: [] });
        await api.getVouchers();
        expect(lastUrl()).toContain('/accounting/vouchers');
    });

    it('appends all filter params', async () => {
        mockOk({ data: [] });
        await api.getVouchers({ voucherType: 'JV', from: '2026-01-01', to: '2026-06-01', page: 1, limit: 20 });
        const url = lastUrl();
        expect(url).toContain('voucherType=JV');
        expect(url).toContain('from=2026-01-01');
        expect(url).toContain('limit=20');
    });
});

describe('api.getVoucher', () => {
    it('fetches /accounting/vouchers/:id', async () => {
        mockOk({ data: {} });
        await api.getVoucher('v1');
        expect(lastUrl()).toContain('/accounting/vouchers/v1');
    });
});

describe('api.getLedger', () => {
    it('fetches /accounting/reports/ledger/:accountId', async () => {
        mockOk({ data: {} });
        await api.getLedger('acc1');
        expect(lastUrl()).toContain('/accounting/reports/ledger/acc1');
    });

    it('appends from/to params', async () => {
        mockOk({ data: {} });
        await api.getLedger('acc1', { from: '2026-01-01', to: '2026-06-01' });
        expect(lastUrl()).toContain('from=2026-01-01');
        expect(lastUrl()).toContain('to=2026-06-01');
    });
});

describe('api.getFinancialKpis', () => {
    it('fetches /accounting/dashboard/kpis', async () => {
        mockOk({ data: {} });
        await api.getFinancialKpis({ from: '2026-01-01', to: '2026-06-01' });
        expect(lastUrl()).toContain('/accounting/dashboard/kpis');
    });
});

describe('api.getFinancialTrends', () => {
    it('fetches /accounting/dashboard/trends', async () => {
        mockOk({ data: {} });
        await api.getFinancialTrends();
        expect(lastUrl()).toContain('/accounting/dashboard/trends');
    });
});

describe('api.createVoucher', () => {
    it('posts to /accounting/vouchers', async () => {
        mockOk({ data: {} });
        await api.createVoucher({ lines: [] });
        expect(lastOpts().method).toBe('POST');
    });
});

describe('api.getPostingRules', () => {
    it('fetches /accounting/settings/posting-rules', async () => {
        mockOk({ data: [] });
        await api.getPostingRules();
        expect(lastUrl()).toContain('/accounting/settings/posting-rules');
    });

    it('appends eventType and isActive', async () => {
        mockOk({ data: [] });
        await api.getPostingRules({ eventType: 'SALE', isActive: true });
        expect(lastUrl()).toContain('eventType=SALE');
        expect(lastUrl()).toContain('isActive=true');
    });

    it('passes isActive=false correctly', async () => {
        mockOk({ data: [] });
        await api.getPostingRules({ isActive: false });
        expect(lastUrl()).toContain('isActive=false');
    });
});

describe('api.updatePostingRule', () => {
    it('patches /accounting/settings/posting-rules/:id', async () => {
        mockOk({ data: {} });
        await api.updatePostingRule('pr1', {
            debitAccountId: 'a1', creditAccountId: 'a2',
            conditionKey: 'paymentMethod', priority: 1, isActive: true,
        });
        expect(lastOpts().method).toBe('PATCH');
        expect(lastUrl()).toContain('/accounting/settings/posting-rules/pr1');
    });
});

describe('api.getPostingExceptions', () => {
    it('fetches /accounting/reconciliation/posting-exceptions', async () => {
        mockOk({ data: [] });
        await api.getPostingExceptions({ status: 'FAILED', module: 'SALES' });
        const url = lastUrl();
        expect(url).toContain('/accounting/reconciliation/posting-exceptions');
        expect(url).toContain('status=FAILED');
    });
});

describe('api.retryPostingException', () => {
    it('posts to /accounting/reconciliation/posting-exceptions/:id/retry', async () => {
        mockOk({ data: {} });
        await api.retryPostingException('pe1');
        expect(lastOpts().method).toBe('POST');
        expect(lastUrl()).toContain('/posting-exceptions/pe1/retry');
    });
});

describe('api.getProfitLoss', () => {
    it('fetches /accounting/reports/profit-loss', async () => {
        mockOk({ data: {} });
        await api.getProfitLoss({ from: '2026-01-01', to: '2026-06-01' });
        expect(lastUrl()).toContain('/accounting/reports/profit-loss');
    });
});

describe('api.getBalanceSheet', () => {
    it('fetches /accounting/reports/balance-sheet', async () => {
        mockOk({ data: {} });
        await api.getBalanceSheet({ asOfDate: '2026-06-01' });
        expect(lastUrl()).toContain('/accounting/reports/balance-sheet');
        expect(lastUrl()).toContain('asOfDate=2026-06-01');
    });
});

describe('api.getCashbook', () => {
    it('fetches /accounting/reports/cashbook', async () => {
        mockOk({ data: {} });
        await api.getCashbook({ accountId: 'a1' });
        expect(lastUrl()).toContain('/accounting/reports/cashbook');
    });
});

describe('api.getBankbook', () => {
    it('fetches /accounting/reports/bankbook', async () => {
        mockOk({ data: {} });
        await api.getBankbook({ from: '2026-01-01' });
        expect(lastUrl()).toContain('/accounting/reports/bankbook');
    });
});

describe('api.getTrialBalance', () => {
    it('fetches /accounting/reports/trial-balance', async () => {
        mockOk({ data: {} });
        await api.getTrialBalance({ asOfDate: '2026-06-01' });
        expect(lastUrl()).toContain('/accounting/reports/trial-balance');
    });
});

describe('api.getArAging', () => {
    it('fetches /accounting/reports/ar-aging', async () => {
        mockOk({ data: {} });
        await api.getArAging();
        expect(lastUrl()).toContain('/accounting/reports/ar-aging');
    });
});

describe('api.getApAging', () => {
    it('fetches /accounting/reports/ap-aging', async () => {
        mockOk({ data: {} });
        await api.getApAging({ asOfDate: '2026-06-01' });
        expect(lastUrl()).toContain('/accounting/reports/ap-aging');
    });
});

describe('api.getComparativePL', () => {
    it('fetches /accounting/reports/comparative-pl', async () => {
        mockOk({ data: {} });
        await api.getComparativePL({ from: '2026-01-01', to: '2026-06-01' });
        expect(lastUrl()).toContain('/accounting/reports/comparative-pl');
    });
});

describe('api.getVatTaxReport', () => {
    it('fetches /accounting/reports/vat-tax', async () => {
        mockOk({ data: {} });
        await api.getVatTaxReport();
        expect(lastUrl()).toContain('/accounting/reports/vat-tax');
    });
});

describe('api.getFinancialRatios', () => {
    it('fetches /accounting/reports/financial-ratios', async () => {
        mockOk({ data: {} });
        await api.getFinancialRatios({ asOfDate: '2026-06-01', from: '2026-01-01', to: '2026-06-01' });
        expect(lastUrl()).toContain('/accounting/reports/financial-ratios');
    });
});

describe('api.getCashFlow', () => {
    it('fetches /accounting/reports/cash-flow', async () => {
        mockOk({ data: {} });
        await api.getCashFlow({ from: '2026-01-01', to: '2026-06-01' });
        expect(lastUrl()).toContain('/accounting/reports/cash-flow');
    });
});

// ---------------------------------------------------------------------------
// Fiscal Periods
// ---------------------------------------------------------------------------

describe('api.getFiscalPeriods', () => {
    it('fetches /accounting/settings/fiscal-periods', async () => {
        mockOk({ data: [] });
        await api.getFiscalPeriods({ year: 2026 });
        expect(lastUrl()).toContain('/accounting/settings/fiscal-periods');
        expect(lastUrl()).toContain('year=2026');
    });
});

describe('api.lockFiscalPeriod', () => {
    it('posts to /accounting/settings/fiscal-periods/lock', async () => {
        mockOk({ data: {} });
        await api.lockFiscalPeriod({ year: 2026, month: 5 });
        expect(lastOpts().method).toBe('POST');
        expect(lastUrl()).toContain('/fiscal-periods/lock');
    });
});

describe('api.unlockFiscalPeriod', () => {
    it('posts to /accounting/settings/fiscal-periods/unlock', async () => {
        mockOk({ data: {} });
        await api.unlockFiscalPeriod({ year: 2026, month: 5 });
        expect(lastOpts().method).toBe('POST');
        expect(lastUrl()).toContain('/fiscal-periods/unlock');
    });
});

// ---------------------------------------------------------------------------
// Opening Balances / Budget
// ---------------------------------------------------------------------------

describe('api.importOpeningBalances', () => {
    it('posts to /accounting/opening-balances', async () => {
        mockOk({ data: {} });
        await api.importOpeningBalances({ entries: [] });
        expect(lastOpts().method).toBe('POST');
        expect(lastUrl()).toContain('/accounting/opening-balances');
    });
});

describe('api.upsertBudget', () => {
    it('posts to /accounting/budgets', async () => {
        mockOk({ data: {} });
        await api.upsertBudget({ fiscalYear: 2026, lines: [] });
        expect(lastOpts().method).toBe('POST');
    });
});

describe('api.getBudgetVsActual', () => {
    it('fetches /accounting/reports/budget-vs-actual', async () => {
        mockOk({ data: {} });
        await api.getBudgetVsActual({ fiscalYear: 2026, month: 5 });
        const url = lastUrl();
        expect(url).toContain('/accounting/reports/budget-vs-actual');
        expect(url).toContain('fiscalYear=2026');
        expect(url).toContain('month=5');
    });
});

// ---------------------------------------------------------------------------
// Cost Centers
// ---------------------------------------------------------------------------

describe('api.listCostCenters', () => {
    it('fetches /accounting/cost-centers', async () => {
        mockOk({ data: [] });
        await api.listCostCenters();
        expect(lastUrl()).toContain('/accounting/cost-centers');
    });
});

describe('api.createCostCenter', () => {
    it('posts to /accounting/cost-centers', async () => {
        mockOk({ data: {} });
        await api.createCostCenter({ name: 'Operations' });
        expect(lastOpts().method).toBe('POST');
    });
});

describe('api.getCostCenterPL', () => {
    it('fetches /accounting/reports/cost-center-pl', async () => {
        mockOk({ data: {} });
        await api.getCostCenterPL({ costCenterId: 'cc1', from: '2026-01-01' });
        const url = lastUrl();
        expect(url).toContain('/accounting/reports/cost-center-pl');
        expect(url).toContain('costCenterId=cc1');
    });
});

// ---------------------------------------------------------------------------
// Fixed Assets
// ---------------------------------------------------------------------------

describe('api.listFixedAssets', () => {
    it('fetches /accounting/fixed-assets', async () => {
        mockOk({ data: [] });
        await api.listFixedAssets();
        expect(lastUrl()).toContain('/accounting/fixed-assets');
    });
});

describe('api.createFixedAsset', () => {
    it('posts to /accounting/fixed-assets', async () => {
        mockOk({ data: {} });
        await api.createFixedAsset({ name: 'Server', value: 50000 });
        expect(lastOpts().method).toBe('POST');
    });
});

describe('api.runDepreciation', () => {
    it('posts to /accounting/fixed-assets/run-depreciation', async () => {
        mockOk({ data: {} });
        await api.runDepreciation({ year: 2026, month: 5 });
        expect(lastOpts().method).toBe('POST');
        expect(lastUrl()).toContain('/fixed-assets/run-depreciation');
    });
});

describe('api.getDepreciationSchedule', () => {
    it('fetches /accounting/fixed-assets/:id/schedule', async () => {
        mockOk({ data: {} });
        await api.getDepreciationSchedule('fa1');
        expect(lastUrl()).toContain('/accounting/fixed-assets/fa1/schedule');
    });
});

// ---------------------------------------------------------------------------
// Recurring Journals
// ---------------------------------------------------------------------------

describe('api.listRecurringJournals', () => {
    it('fetches /accounting/recurring-journals', async () => {
        mockOk({ data: [] });
        await api.listRecurringJournals();
        expect(lastUrl()).toContain('/accounting/recurring-journals');
    });
});

describe('api.createRecurringJournal', () => {
    it('posts to /accounting/recurring-journals', async () => {
        mockOk({ data: {} });
        await api.createRecurringJournal({ lines: [] });
        expect(lastOpts().method).toBe('POST');
    });
});

describe('api.postRecurringJournal', () => {
    it('posts to /accounting/recurring-journals/:id/post', async () => {
        mockOk({ data: {} });
        await api.postRecurringJournal('rj1');
        expect(lastOpts().method).toBe('POST');
        expect(lastUrl()).toContain('/recurring-journals/rj1/post');
    });
});

// ---------------------------------------------------------------------------
// Bank Reconciliation
// ---------------------------------------------------------------------------

describe('api.createBankReconciliation', () => {
    it('posts to /accounting/bank-reconciliations', async () => {
        mockOk({ data: {} });
        await api.createBankReconciliation({ accountId: 'a1' });
        expect(lastOpts().method).toBe('POST');
    });
});

describe('api.importBankStatementEntries', () => {
    it('posts to /accounting/bank-reconciliations/import', async () => {
        mockOk({ data: {} });
        await api.importBankStatementEntries({ entries: [] });
        expect(lastOpts().method).toBe('POST');
        expect(lastUrl()).toContain('/bank-reconciliations/import');
    });
});

describe('api.autoMatchBankEntries', () => {
    it('posts to /accounting/bank-reconciliations/:id/auto-match', async () => {
        mockOk({ data: {} });
        await api.autoMatchBankEntries('br1');
        expect(lastOpts().method).toBe('POST');
        expect(lastUrl()).toContain('/bank-reconciliations/br1/auto-match');
    });
});

describe('api.matchBankEntry', () => {
    it('posts to /accounting/bank-reconciliations/match-entry', async () => {
        mockOk({ data: {} });
        await api.matchBankEntry({ statementEntryId: 'se1', voucherId: 'v1' });
        expect(lastOpts().method).toBe('POST');
        expect(lastUrl()).toContain('/bank-reconciliations/match-entry');
    });
});

describe('api.getBankReconciliationReport', () => {
    it('fetches /accounting/bank-reconciliations/:id/report', async () => {
        mockOk({ data: {} });
        await api.getBankReconciliationReport('br1');
        expect(lastUrl()).toContain('/bank-reconciliations/br1/report');
    });
});

// ---------------------------------------------------------------------------
// Accounting Export (blob)
// ---------------------------------------------------------------------------

describe('api.exportAccountingLedger', () => {
    it('calls fetchBlobWithAuth with correct URL for tally', async () => {
        const blob = new Blob(['xml']);
        mockFetch.mockReturnValueOnce(Promise.resolve({
            ok: true,
            headers: { get: (k: string) => k === 'Content-Disposition' ? 'attachment; filename="tally.xml"' : null },
            blob: async () => blob,
        }));

        const result = await api.exportAccountingLedger({ format: 'tally' });
        expect(lastUrl()).toContain('/accounting/export');
        expect(lastUrl()).toContain('format=tally');
        expect(result.filename).toBe('tally.xml');
    });

    it('appends from/to params', async () => {
        const blob = new Blob(['xml']);
        mockFetch.mockReturnValueOnce(Promise.resolve({
            ok: true,
            headers: { get: () => null },
            blob: async () => blob,
        }));

        await api.exportAccountingLedger({ format: 'quickbooks', from: '2026-01-01', to: '2026-06-01' });
        expect(lastUrl()).toContain('from=2026-01-01');
        expect(lastUrl()).toContain('format=quickbooks');
    });
});

// ---------------------------------------------------------------------------
// Returns
// ---------------------------------------------------------------------------

describe('api.getReturns', () => {
    it('fetches /sales-returns', async () => {
        mockOk({ data: [] });
        await api.getReturns();
        expect(lastUrl()).toContain('/sales-returns');
    });
});

describe('api.getReturn', () => {
    it('fetches /sales-returns/:id', async () => {
        mockOk({ data: {} });
        await api.getReturn('r1');
        expect(lastUrl()).toContain('/sales-returns/r1');
    });
});

describe('api.createReturn', () => {
    it('posts to /sales-returns', async () => {
        mockOk({ data: {} });
        await api.createReturn({ saleId: 's1' });
        expect(lastOpts().method).toBe('POST');
    });
});

describe('api.deleteReturn', () => {
    it('deletes /sales-returns/:id', async () => {
        mockOk({ data: null });
        await api.deleteReturn('r1');
        expect(lastOpts().method).toBe('DELETE');
    });
});

describe('api.updateReturn', () => {
    it('patches /sales-returns/:id', async () => {
        mockOk({ data: {} });
        await api.updateReturn('r1', { status: 'APPROVED' });
        expect(lastOpts().method).toBe('PATCH');
    });
});

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

describe('api.getOrders', () => {
    it('fetches /sales-orders', async () => {
        mockOk({ data: [] });
        await api.getOrders();
        expect(lastUrl()).toContain('/sales-orders');
    });
});

describe('api.getOrder', () => {
    it('fetches /sales-orders/:id', async () => {
        mockOk({ data: {} });
        await api.getOrder('o1');
        expect(lastUrl()).toContain('/sales-orders/o1');
    });
});

describe('api.createOrder', () => {
    it('posts to /sales-orders', async () => {
        mockOk({ data: {} });
        await api.createOrder({ items: [] });
        expect(lastOpts().method).toBe('POST');
    });
});

describe('api.updateOrder', () => {
    it('patches /sales-orders/:id', async () => {
        mockOk({ data: {} });
        await api.updateOrder('o1', { status: 'CONFIRMED' });
        expect(lastOpts().method).toBe('PATCH');
    });
});

describe('api.deleteOrder', () => {
    it('deletes /sales-orders/:id', async () => {
        mockOk({ data: null });
        await api.deleteOrder('o1');
        expect(lastOpts().method).toBe('DELETE');
    });
});

describe('api.updateOrderStatus', () => {
    it('patches /sales-orders/:id/status', async () => {
        mockOk({ data: {} });
        await api.updateOrderStatus('o1', 'SHIPPED');
        expect(lastOpts().method).toBe('PATCH');
        expect(lastUrl()).toContain('/sales-orders/o1/status');
        expect(lastOpts().body).toContain('"status":"SHIPPED"');
    });
});

describe('api.addOrderDeposit', () => {
    it('posts to /sales-orders/:id/deposits', async () => {
        mockOk({ data: {} });
        await api.addOrderDeposit('o1', { amount: 500 });
        expect(lastOpts().method).toBe('POST');
        expect(lastUrl()).toContain('/sales-orders/o1/deposits');
    });
});

// ---------------------------------------------------------------------------
// Brands
// ---------------------------------------------------------------------------

describe('api.getBrands', () => {
    it('fetches /brands', async () => {
        mockOk({ data: [] });
        await api.getBrands();
        expect(lastUrl()).toContain('/brands');
    });
});

describe('api.createBrand', () => {
    it('posts to /brands', async () => {
        mockOk({ data: {} });
        await api.createBrand({ name: 'Nike' });
        expect(lastOpts().method).toBe('POST');
    });
});

describe('api.updateBrand', () => {
    it('patches /brands/:id', async () => {
        mockOk({ data: {} });
        await api.updateBrand('b1', { name: 'Adidas' });
        expect(lastOpts().method).toBe('PATCH');
    });
});

describe('api.deleteBrand', () => {
    it('deletes /brands/:id', async () => {
        mockOk({ data: null });
        await api.deleteBrand('b1');
        expect(lastOpts().method).toBe('DELETE');
    });
});

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

describe('api.getSuppliers', () => {
    it('fetches /suppliers', async () => {
        mockOk({ data: [] });
        await api.getSuppliers();
        expect(lastUrl()).toContain('/suppliers');
    });
});

describe('api.createSupplier', () => {
    it('posts to /suppliers', async () => {
        mockOk({ data: {} });
        await api.createSupplier({ name: 'Acme Corp' });
        expect(lastOpts().method).toBe('POST');
    });
});

describe('api.updateSupplier', () => {
    it('patches /suppliers/:id', async () => {
        mockOk({ data: {} });
        await api.updateSupplier('sup1', { name: 'Globex' });
        expect(lastOpts().method).toBe('PATCH');
    });
});

describe('api.deleteSupplier', () => {
    it('deletes /suppliers/:id', async () => {
        mockOk({ data: null });
        await api.deleteSupplier('sup1');
        expect(lastOpts().method).toBe('DELETE');
    });
});

// ---------------------------------------------------------------------------
// Purchase Reports
// ---------------------------------------------------------------------------

describe('api.getPurchaseSummary', () => {
    it('fetches /purchase-reports/summary', async () => {
        mockOk({ data: {} });
        await api.getPurchaseSummary({ from: '2026-01-01' });
        expect(lastUrl()).toContain('/purchase-reports/summary');
    });
});

describe('api.getPurchasesByProduct', () => {
    it('fetches /purchase-reports/by-product', async () => {
        mockOk({ data: {} });
        await api.getPurchasesByProduct({ groupId: 'g1' });
        expect(lastUrl()).toContain('/purchase-reports/by-product');
    });
});

describe('api.getPurchasesBySupplier', () => {
    it('fetches /purchase-reports/by-supplier', async () => {
        mockOk({ data: {} });
        await api.getPurchasesBySupplier({ storeId: 's1' });
        expect(lastUrl()).toContain('/purchase-reports/by-supplier');
    });
});

// ---------------------------------------------------------------------------
// Purchases
// ---------------------------------------------------------------------------

describe('api.getPurchaseInvoice', () => {
    it('fetches /purchases/:id/invoice', async () => {
        mockOk({ data: {} });
        await api.getPurchaseInvoice('pu1');
        expect(lastUrl()).toContain('/purchases/pu1/invoice');
    });
});

describe('api.getPurchaseOrders', () => {
    it('fetches /purchase-orders', async () => {
        mockOk({ data: [] });
        await api.getPurchaseOrders();
        expect(lastUrl()).toContain('/purchase-orders');
    });
});

describe('api.getPurchaseOrder', () => {
    it('fetches /purchase-orders/:id', async () => {
        mockOk({ data: {} });
        await api.getPurchaseOrder('po1');
        expect(lastUrl()).toContain('/purchase-orders/po1');
    });
});

describe('api.createPurchaseOrder', () => {
    it('posts to /purchase-orders', async () => {
        mockOk({ data: {} });
        await api.createPurchaseOrder({ items: [] });
        expect(lastOpts().method).toBe('POST');
    });
});

describe('api.updatePurchaseOrderStatus', () => {
    it('patches /purchase-orders/:id/status', async () => {
        mockOk({ data: {} });
        await api.updatePurchaseOrderStatus('po1', 'RECEIVED');
        expect(lastOpts().method).toBe('PATCH');
        expect(lastUrl()).toContain('/purchase-orders/po1/status');
    });
});

describe('api.getPurchaseOrderInvoice', () => {
    it('fetches /purchase-orders/:id/invoice', async () => {
        mockOk({ data: {} });
        await api.getPurchaseOrderInvoice('po1');
        expect(lastUrl()).toContain('/purchase-orders/po1/invoice');
    });
});

describe('api.getPurchaseQuotations', () => {
    it('fetches /purchase-quotations', async () => {
        mockOk({ data: [] });
        await api.getPurchaseQuotations();
        expect(lastUrl()).toContain('/purchase-quotations');
    });
});

describe('api.getPurchaseQuotation', () => {
    it('fetches /purchase-quotations/:id', async () => {
        mockOk({ data: {} });
        await api.getPurchaseQuotation('pq1');
        expect(lastUrl()).toContain('/purchase-quotations/pq1');
    });
});

describe('api.createPurchaseQuotation', () => {
    it('posts to /purchase-quotations', async () => {
        mockOk({ data: {} });
        await api.createPurchaseQuotation({ items: [] });
        expect(lastOpts().method).toBe('POST');
    });
});

describe('api.updatePurchaseQuotationStatus', () => {
    it('patches /purchase-quotations/:id/status', async () => {
        mockOk({ data: {} });
        await api.updatePurchaseQuotationStatus('pq1', 'APPROVED');
        expect(lastOpts().method).toBe('PATCH');
    });
});

describe('api.convertPurchaseQuotation', () => {
    it('posts to /purchase-quotations/:id/convert', async () => {
        mockOk({ data: {} });
        await api.convertPurchaseQuotation('pq1');
        expect(lastOpts().method).toBe('POST');
        expect(lastUrl()).toContain('/purchase-quotations/pq1/convert');
    });
});

describe('api.deletePurchaseQuotation', () => {
    it('deletes /purchase-quotations/:id', async () => {
        mockOk({ data: null });
        await api.deletePurchaseQuotation('pq1');
        expect(lastOpts().method).toBe('DELETE');
    });
});

describe('api.getPurchases', () => {
    it('fetches /purchases', async () => {
        mockOk({ data: [] });
        await api.getPurchases();
        expect(lastUrl()).toContain('/purchases');
    });
});

describe('api.getPurchase', () => {
    it('fetches /purchases/:id', async () => {
        mockOk({ data: {} });
        await api.getPurchase('pu1');
        expect(lastUrl()).toContain('/purchases/pu1');
    });
});

describe('api.createPurchase', () => {
    it('posts to /purchases', async () => {
        mockOk({ data: {} });
        await api.createPurchase({ supplierId: 'sup1' });
        expect(lastOpts().method).toBe('POST');
    });
});

describe('api.getPurchaseReturns', () => {
    it('fetches /purchase-returns', async () => {
        mockOk({ data: [] });
        await api.getPurchaseReturns();
        expect(lastUrl()).toContain('/purchase-returns');
    });
});

describe('api.getPurchaseReturn', () => {
    it('fetches /purchase-returns/:id', async () => {
        mockOk({ data: {} });
        await api.getPurchaseReturn('pr1');
        expect(lastUrl()).toContain('/purchase-returns/pr1');
    });
});

describe('api.createPurchaseReturn', () => {
    it('posts to /purchase-returns', async () => {
        mockOk({ data: {} });
        await api.createPurchaseReturn({ purchaseId: 'pu1' });
        expect(lastOpts().method).toBe('POST');
    });
});

describe('api.updatePurchaseReturn', () => {
    it('patches /purchase-returns/:id', async () => {
        mockOk({ data: {} });
        await api.updatePurchaseReturn('pr1', { status: 'APPROVED' });
        expect(lastOpts().method).toBe('PATCH');
    });
});

describe('api.deletePurchaseReturn', () => {
    it('deletes /purchase-returns/:id', async () => {
        mockOk({ data: null });
        await api.deletePurchaseReturn('pr1');
        expect(lastOpts().method).toBe('DELETE');
    });
});

// ---------------------------------------------------------------------------
// Quotations (Sales)
// ---------------------------------------------------------------------------

describe('api.getQuotations', () => {
    it('fetches /sales-quotations', async () => {
        mockOk({ data: [] });
        await api.getQuotations();
        expect(lastUrl()).toContain('/sales-quotations');
    });
});

describe('api.getQuotation', () => {
    it('fetches /sales-quotations/:id', async () => {
        mockOk({ data: {} });
        await api.getQuotation('q1');
        expect(lastUrl()).toContain('/sales-quotations/q1');
    });
});

describe('api.createQuotation', () => {
    it('posts to /sales-quotations', async () => {
        mockOk({ data: {} });
        await api.createQuotation({ items: [] });
        expect(lastOpts().method).toBe('POST');
    });
});

describe('api.updateQuotation', () => {
    it('patches /sales-quotations/:id', async () => {
        mockOk({ data: {} });
        await api.updateQuotation('q1', { status: 'SENT' });
        expect(lastOpts().method).toBe('PATCH');
    });
});

describe('api.deleteQuotation', () => {
    it('deletes /sales-quotations/:id', async () => {
        mockOk({ data: null });
        await api.deleteQuotation('q1');
        expect(lastOpts().method).toBe('DELETE');
    });
});

describe('api.updateQuotationStatus', () => {
    it('patches /sales-quotations/:id/status', async () => {
        mockOk({ data: {} });
        await api.updateQuotationStatus('q1', 'ACCEPTED');
        expect(lastOpts().method).toBe('PATCH');
        expect(lastUrl()).toContain('/sales-quotations/q1/status');
    });
});

describe('api.reviseQuotation', () => {
    it('posts to /sales-quotations/:id/revise', async () => {
        mockOk({ data: {} });
        await api.reviseQuotation('q1');
        expect(lastOpts().method).toBe('POST');
        expect(lastUrl()).toContain('/sales-quotations/q1/revise');
    });
});

describe('api.convertQuotation', () => {
    it('posts to /sales-quotations/:id/convert', async () => {
        mockOk({ data: {} });
        await api.convertQuotation('q1');
        expect(lastOpts().method).toBe('POST');
        expect(lastUrl()).toContain('/sales-quotations/q1/convert');
    });
});

// ---------------------------------------------------------------------------
// Discount Codes
// ---------------------------------------------------------------------------

describe('api.getDiscountCodes', () => {
    it('fetches /discount-codes', async () => {
        mockOk({ data: [] });
        await api.getDiscountCodes();
        expect(lastUrl()).toContain('/discount-codes');
    });
});

describe('api.createDiscountCode', () => {
    it('posts to /discount-codes', async () => {
        mockOk({ data: {} });
        await api.createDiscountCode({ code: 'SAVE10' });
        expect(lastOpts().method).toBe('POST');
    });
});

describe('api.toggleDiscountCode', () => {
    it('patches /discount-codes/:id/toggle', async () => {
        mockOk({ data: {} });
        await api.toggleDiscountCode('dc1');
        expect(lastOpts().method).toBe('PATCH');
        expect(lastUrl()).toContain('/discount-codes/dc1/toggle');
    });
});

describe('api.deleteDiscountCode', () => {
    it('deletes /discount-codes/:id', async () => {
        mockOk({ data: null });
        await api.deleteDiscountCode('dc1');
        expect(lastOpts().method).toBe('DELETE');
    });
});

describe('api.validateDiscountCode', () => {
    it('posts to /discount-codes/validate', async () => {
        mockOk({ data: { discount: 50 } });
        await api.validateDiscountCode('SAVE10', 500);
        expect(lastOpts().method).toBe('POST');
        expect(lastUrl()).toContain('/discount-codes/validate');
        const body = JSON.parse(lastOpts().body as string);
        expect(body.code).toBe('SAVE10');
        expect(body.cart_total).toBe(500);
    });
});

describe('api.useDiscountCode', () => {
    it('posts to /discount-codes/:code/use', async () => {
        mockOk({ data: {} });
        await api.useDiscountCode('SAVE10');
        expect(lastOpts().method).toBe('POST');
        expect(lastUrl()).toContain('/discount-codes/SAVE10/use');
    });
});

// ---------------------------------------------------------------------------
// Cashier Sessions
// ---------------------------------------------------------------------------

describe('api.openCashierSession', () => {
    it('posts to /cashier-sessions/open', async () => {
        mockOk({ data: {} });
        await api.openCashierSession({ openingBalance: 1000 });
        expect(lastOpts().method).toBe('POST');
        expect(lastUrl()).toContain('/cashier-sessions/open');
    });
});

describe('api.closeCashierSession', () => {
    it('posts to /cashier-sessions/:sessionId/close', async () => {
        mockOk({ data: {} });
        await api.closeCashierSession('sess1', { closingBalance: 2000 });
        expect(lastOpts().method).toBe('POST');
        expect(lastUrl()).toContain('/cashier-sessions/sess1/close');
    });
});

describe('api.getOpenCashierSession', () => {
    it('fetches /cashier-sessions/open', async () => {
        mockOk({ data: {} });
        await api.getOpenCashierSession();
        expect(lastUrl()).toContain('/cashier-sessions/open');
    });
});

describe('api.getCashierSession', () => {
    it('fetches /cashier-sessions/:sessionId', async () => {
        mockOk({ data: {} });
        await api.getCashierSession('sess1');
        expect(lastUrl()).toContain('/cashier-sessions/sess1');
    });
});

describe('api.addCashTransaction', () => {
    it('posts to /cashier-sessions/:sessionId/cash-transaction', async () => {
        mockOk({ data: {} });
        await api.addCashTransaction('sess1', { amount: 100 });
        expect(lastOpts().method).toBe('POST');
        expect(lastUrl()).toContain('/cashier-sessions/sess1/cash-transaction');
    });
});

describe('api.getCashTransactions', () => {
    it('fetches /cashier-sessions/:sessionId/cash-transactions', async () => {
        mockOk({ data: [] });
        await api.getCashTransactions('sess1');
        expect(lastUrl()).toContain('/cashier-sessions/sess1/cash-transactions');
    });
});

// ---------------------------------------------------------------------------
// POS Counters
// ---------------------------------------------------------------------------

describe('api.getCounters', () => {
    it('fetches /counters?storeId=...', async () => {
        mockOk({ data: [] });
        await api.getCounters('s1');
        expect(lastUrl()).toContain('/counters?storeId=s1');
    });
});

describe('api.getActiveCounters', () => {
    it('fetches /counters/active?storeId=...', async () => {
        mockOk({ data: [] });
        await api.getActiveCounters('s1');
        expect(lastUrl()).toContain('/counters/active?storeId=s1');
    });
});

describe('api.createCounter', () => {
    it('posts to /counters', async () => {
        mockOk({ data: {} });
        await api.createCounter({ name: 'Counter 1', storeId: 's1' });
        expect(lastOpts().method).toBe('POST');
    });
});

describe('api.updateCounter', () => {
    it('patches /counters/:id', async () => {
        mockOk({ data: {} });
        await api.updateCounter('cnt1', { name: 'Counter A' });
        expect(lastOpts().method).toBe('PATCH');
    });
});

describe('api.deleteCounter', () => {
    it('deletes /counters/:id', async () => {
        mockOk({ data: null });
        await api.deleteCounter('cnt1');
        expect(lastOpts().method).toBe('DELETE');
    });
});

// ---------------------------------------------------------------------------
// Auth (unauthenticated fetch)
// ---------------------------------------------------------------------------

describe('api.login', () => {
    it('posts to /auth/login and returns body', async () => {
        mockFetch.mockReturnValueOnce(Promise.resolve({
            ok: true,
            json: async () => ({ data: { access_token: 'tok', user: { id: 'u1' } } }),
        }));

        const result = await api.login({ email: 'test@example.com', password: 'pass' });
        expect(lastUrl()).toContain('/auth/login');
        expect(lastOpts().method).toBe('POST');
        expect(result).toEqual({ access_token: 'tok', user: { id: 'u1' } });
    });

    it('throws on failed login with message', async () => {
        mockFetch.mockReturnValueOnce(Promise.resolve({
            ok: false,
            json: async () => ({ message: 'Invalid credentials' }),
        }));

        await expect(api.login({ email: 'x', password: 'y' })).rejects.toThrow('Invalid credentials');
    });

    it('throws "Login failed" when response body is null', async () => {
        mockFetch.mockReturnValueOnce(Promise.resolve({
            ok: false,
            json: async () => null,
        }));

        await expect(api.login({ email: 'x', password: 'y' })).rejects.toThrow('Login failed');
    });
});

describe('api.signup', () => {
    it('posts to /auth/signup and unwraps data', async () => {
        mockFetch.mockReturnValueOnce(Promise.resolve({
            ok: true,
            json: async () => ({ data: { id: 'u1' } }),
        }));

        const result = await api.signup({ email: 'new@example.com', password: 'pass' });
        expect(lastUrl()).toContain('/auth/signup');
        expect(result).toEqual({ id: 'u1' });
    });

    it('throws on failed signup', async () => {
        mockFetch.mockReturnValueOnce(Promise.resolve({
            ok: false,
            json: async () => ({ message: 'Email already taken' }),
        }));

        await expect(api.signup({})).rejects.toThrow('Email already taken');
    });

    it('returns raw body when no data key', async () => {
        mockFetch.mockReturnValueOnce(Promise.resolve({
            ok: true,
            json: async () => ({ token: 'abc' }),
        }));

        const result = await api.signup({ email: 'a@b.com' });
        expect(result).toEqual({ token: 'abc' });
    });
});

describe('api.getSubscriptionPlans', () => {
    it('fetches /auth/plans and unwraps data', async () => {
        mockFetch.mockReturnValueOnce(Promise.resolve({
            ok: true,
            json: async () => ({ data: [{ code: 'BASIC' }] }),
        }));

        const result = await api.getSubscriptionPlans();
        expect(lastUrl()).toContain('/auth/plans');
        expect(result).toEqual([{ code: 'BASIC' }]);
    });

    it('throws when plans fetch fails', async () => {
        mockFetch.mockReturnValueOnce(Promise.resolve({
            ok: false,
            json: async () => ({ message: 'Service unavailable' }),
        }));

        await expect(api.getSubscriptionPlans()).rejects.toThrow('Service unavailable');
    });
});

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

describe('api.getBillingSummary', () => {
    it('fetches /billing/summary', async () => {
        mockOk({ data: {} });
        await api.getBillingSummary();
        expect(lastUrl()).toContain('/billing/summary');
    });
});

describe('api.createBillingCheckoutSession', () => {
    it('posts to /billing/checkout-session', async () => {
        mockOk({ data: { url: 'https://pay.example.com' } });
        await api.createBillingCheckoutSession({ planCode: 'PRO' });
        expect(lastOpts().method).toBe('POST');
    });
});

describe('api.confirmBillingCheckout', () => {
    it('posts to /billing/confirm', async () => {
        mockOk({ data: {} });
        await api.confirmBillingCheckout({ sessionId: 'sess1' });
        expect(lastOpts().method).toBe('POST');
        expect(lastUrl()).toContain('/billing/confirm');
    });
});

describe('api.cancelBillingAtPeriodEnd', () => {
    it('posts to /billing/cancel-at-period-end', async () => {
        mockOk({ data: {} });
        await api.cancelBillingAtPeriodEnd();
        expect(lastOpts().method).toBe('POST');
        expect(lastUrl()).toContain('/billing/cancel-at-period-end');
    });
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

describe('api.getAdminTenants', () => {
    it('fetches /admin/tenants without params', async () => {
        mockOk({ data: [] });
        await api.getAdminTenants();
        expect(lastUrl()).toContain('/admin/tenants');
    });

    it('appends search, planCode, status', async () => {
        mockOk({ data: [] });
        await api.getAdminTenants({ search: 'acme', planCode: 'PRO', status: 'ACTIVE' });
        const url = lastUrl();
        expect(url).toContain('search=acme');
        expect(url).toContain('planCode=PRO');
        expect(url).toContain('status=ACTIVE');
    });
});

describe('api.getAdminTenant', () => {
    it('fetches /admin/tenants/:tenantId', async () => {
        mockOk({ data: {} });
        await api.getAdminTenant('t1');
        expect(lastUrl()).toContain('/admin/tenants/t1');
    });
});

describe('api.updateAdminTenantSubscription', () => {
    it('patches /admin/tenants/:tenantId/subscription', async () => {
        mockOk({ data: {} });
        await api.updateAdminTenantSubscription('t1', { planCode: 'PRO' });
        expect(lastOpts().method).toBe('PATCH');
        expect(lastUrl()).toContain('/admin/tenants/t1/subscription');
    });
});

describe('api.suspendTenant', () => {
    it('patches /admin/tenants/:tenantId/suspend', async () => {
        mockOk({ data: {} });
        await api.suspendTenant('t1', 'Fraud detected');
        expect(lastOpts().method).toBe('PATCH');
        expect(lastUrl()).toContain('/admin/tenants/t1/suspend');
        const body = JSON.parse(lastOpts().body as string);
        expect(body.reason).toBe('Fraud detected');
    });

    it('works without reason', async () => {
        mockOk({ data: {} });
        await api.suspendTenant('t1');
        const body = JSON.parse(lastOpts().body as string);
        expect(body.reason).toBeUndefined();
    });
});

describe('api.impersonateTenant', () => {
    it('posts to /admin/tenants/:tenantId/impersonate', async () => {
        mockOk({ data: {} });
        await api.impersonateTenant('t1');
        expect(lastOpts().method).toBe('POST');
        expect(lastUrl()).toContain('/admin/tenants/t1/impersonate');
    });
});

describe('api.getAdminMetrics', () => {
    it('fetches /admin/metrics', async () => {
        mockOk({ data: {} });
        await api.getAdminMetrics();
        expect(lastUrl()).toContain('/admin/metrics');
    });
});

describe('api.getAdminUsers', () => {
    it('fetches /admin/users', async () => {
        mockOk({ data: [] });
        await api.getAdminUsers();
        expect(lastUrl()).toContain('/admin/users');
    });

    it('appends search, page, limit', async () => {
        mockOk({ data: [] });
        await api.getAdminUsers({ search: 'alice', page: 2, limit: 25 });
        const url = lastUrl();
        expect(url).toContain('search=alice');
        expect(url).toContain('page=2');
        expect(url).toContain('limit=25');
    });
});

describe('api.promoteUser', () => {
    it('posts to /admin/users/:userId/promote', async () => {
        mockOk({ data: {} });
        await api.promoteUser('u1');
        expect(lastOpts().method).toBe('POST');
        expect(lastUrl()).toContain('/admin/users/u1/promote');
    });
});

describe('api.demoteUser', () => {
    it('deletes /admin/users/:userId/promote', async () => {
        mockOk({ data: {} });
        await api.demoteUser('u1');
        expect(lastOpts().method).toBe('DELETE');
        expect(lastUrl()).toContain('/admin/users/u1/promote');
    });
});

// ---------------------------------------------------------------------------
// Auth - Me / Profile / 2FA
// ---------------------------------------------------------------------------

describe('api.getMe', () => {
    it('fetches /auth/me', async () => {
        mockOk({ data: { id: 'u1' } });
        await api.getMe();
        expect(lastUrl()).toContain('/auth/me');
    });
});

describe('api.updateProfile', () => {
    it('patches /auth/me', async () => {
        mockOk({ data: {} });
        await api.updateProfile({ name: 'Alice', preferred_locale: 'en' });
        expect(lastOpts().method).toBe('PATCH');
        expect(lastUrl()).toContain('/auth/me');
    });
});

describe('api.changePassword', () => {
    it('posts to /auth/change-password', async () => {
        mockOk({ data: {} });
        await api.changePassword({ currentPassword: 'old', newPassword: 'new' });
        expect(lastOpts().method).toBe('POST');
        expect(lastUrl()).toContain('/auth/change-password');
    });
});

describe('api.setup2FA', () => {
    it('posts to /auth/2fa/setup', async () => {
        mockOk({ data: { qrCode: 'base64...' } });
        await api.setup2FA();
        expect(lastOpts().method).toBe('POST');
        expect(lastUrl()).toContain('/auth/2fa/setup');
    });
});

describe('api.enable2FA', () => {
    it('posts to /auth/2fa/enable', async () => {
        mockOk({ data: {} });
        await api.enable2FA('123456');
        expect(lastOpts().method).toBe('POST');
        expect(lastUrl()).toContain('/auth/2fa/enable');
        const body = JSON.parse(lastOpts().body as string);
        expect(body.code).toBe('123456');
    });
});

describe('api.disable2FA', () => {
    it('posts to /auth/2fa/disable', async () => {
        mockOk({ data: {} });
        await api.disable2FA('654321');
        expect(lastOpts().method).toBe('POST');
        expect(lastUrl()).toContain('/auth/2fa/disable');
    });
});

// ---------------------------------------------------------------------------
// Tenant Localization
// ---------------------------------------------------------------------------

describe('api.getTenantLocalizationSettings', () => {
    it('fetches /tenants/localization-settings', async () => {
        mockOk({ data: {} });
        await api.getTenantLocalizationSettings();
        expect(lastUrl()).toContain('/tenants/localization-settings');
    });
});

describe('api.updateTenantLocalizationSettings', () => {
    it('patches /tenants/localization-settings', async () => {
        mockOk({ data: {} });
        await api.updateTenantLocalizationSettings({ default_locale: 'bn' });
        expect(lastOpts().method).toBe('PATCH');
    });
});

// ---------------------------------------------------------------------------
// Stores (derived from /auth/me)
// ---------------------------------------------------------------------------

describe('api.getStores', () => {
    it('returns stores for the current tenant from /auth/me', async () => {
        localStorageMock._setAll({
            access_token: 'tok',
            tenant_id: 'tenant-abc',
            store_id: 'store-xyz',
        });
        mockOk({
            data: {
                tenants: [
                    { id: 'tenant-abc', stores: [{ id: 'store-xyz', name: 'Main Store' }] },
                ],
            },
        });

        const stores = await api.getStores();
        expect(stores).toEqual([{ id: 'store-xyz', name: 'Main Store' }]);
    });

    it('returns [] when tenantId not in me.tenants', async () => {
        localStorageMock._setAll({ access_token: 'tok', tenant_id: 'other-tenant' });
        mockOk({
            data: {
                tenants: [{ id: 'tenant-abc', stores: [{ id: 's1' }] }],
            },
        });

        const stores = await api.getStores();
        expect(stores).toEqual([]);
    });

    it('returns [] when me has no tenants', async () => {
        localStorageMock._setAll({ access_token: 'tok', tenant_id: 'tenant-abc' });
        mockOk({ data: {} });

        const stores = await api.getStores();
        expect(stores).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Warranty Claims
// ---------------------------------------------------------------------------

describe('api.lookupWarrantySerial', () => {
    it('fetches /warranty-claims/lookup with serialNumber', async () => {
        mockOk({ data: {} });
        await api.lookupWarrantySerial('SN-12345');
        expect(lastUrl()).toContain('/warranty-claims/lookup');
        expect(lastUrl()).toContain('serialNumber=SN-12345');
    });
});

describe('api.getWarrantyClaims', () => {
    it('fetches /warranty-claims', async () => {
        mockOk({ data: [] });
        await api.getWarrantyClaims();
        expect(lastUrl()).toContain('/warranty-claims');
    });
});

describe('api.getWarrantyClaim', () => {
    it('fetches /warranty-claims/:id', async () => {
        mockOk({ data: {} });
        await api.getWarrantyClaim('wc1');
        expect(lastUrl()).toContain('/warranty-claims/wc1');
    });
});

describe('api.createWarrantyClaim', () => {
    it('posts to /warranty-claims', async () => {
        mockOk({ data: {} });
        await api.createWarrantyClaim({ serialNumber: 'SN-1' });
        expect(lastOpts().method).toBe('POST');
    });
});

describe('api.updateWarrantyClaimStatus', () => {
    it('patches /warranty-claims/:id/status', async () => {
        mockOk({ data: {} });
        await api.updateWarrantyClaimStatus('wc1', { status: 'RESOLVED', resolutionNotes: 'Fixed' });
        expect(lastOpts().method).toBe('PATCH');
        expect(lastUrl()).toContain('/warranty-claims/wc1/status');
    });
});

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

describe('api.getEmployees', () => {
    it('fetches /employees with default limit=100', async () => {
        mockOk({ data: { items: [] } });
        await api.getEmployees();
        expect(lastUrl()).toContain('/employees?limit=100');
    });

    it('appends all optional params', async () => {
        mockOk({ data: { items: [] } });
        await api.getEmployees({ page: 2, limit: 50, search: 'John', status: 'ACTIVE', departmentId: 'd1' });
        const url = lastUrl();
        expect(url).toContain('page=2');
        expect(url).toContain('limit=50');
        expect(url).toContain('search=John');
        expect(url).toContain('status=ACTIVE');
        expect(url).toContain('departmentId=d1');
    });

    it('unwraps items array', async () => {
        mockOk({ data: { items: [{ id: 'e1' }] } });
        const result = await api.getEmployees();
        expect(result).toEqual([{ id: 'e1' }]);
    });
});

describe('api.getEmployee', () => {
    it('fetches /employees/:id', async () => {
        mockOk({ data: {} });
        await api.getEmployee('e1');
        expect(lastUrl()).toContain('/employees/e1');
    });
});

describe('api.createEmployee', () => {
    it('posts to /employees', async () => {
        mockOk({ data: {} });
        await api.createEmployee({ name: 'Bob' });
        expect(lastOpts().method).toBe('POST');
    });
});

describe('api.updateEmployee', () => {
    it('patches /employees/:id', async () => {
        mockOk({ data: {} });
        await api.updateEmployee('e1', { name: 'Alice' });
        expect(lastOpts().method).toBe('PATCH');
    });
});

describe('api.deleteEmployee', () => {
    it('deletes /employees/:id', async () => {
        mockOk({ data: null });
        await api.deleteEmployee('e1');
        expect(lastOpts().method).toBe('DELETE');
    });
});

describe('api.getDepartments', () => {
    it('fetches /employees/departments', async () => {
        mockOk({ data: [] });
        await api.getDepartments();
        expect(lastUrl()).toContain('/employees/departments');
    });
});

describe('api.createDepartment', () => {
    it('posts to /employees/departments', async () => {
        mockOk({ data: {} });
        await api.createDepartment({ name: 'Sales' });
        expect(lastOpts().method).toBe('POST');
    });
});

describe('api.getDesignations', () => {
    it('fetches /employees/designations', async () => {
        mockOk({ data: [] });
        await api.getDesignations();
        expect(lastUrl()).toContain('/employees/designations');
    });
});

describe('api.createDesignation', () => {
    it('posts to /employees/designations', async () => {
        mockOk({ data: {} });
        await api.createDesignation({ name: 'Manager' });
        expect(lastOpts().method).toBe('POST');
    });
});

describe('api.linkEmployeeUser', () => {
    it('posts to /employees/:id/link-user', async () => {
        mockOk({ data: {} });
        await api.linkEmployeeUser('e1', 'u1');
        expect(lastOpts().method).toBe('POST');
        expect(lastUrl()).toContain('/employees/e1/link-user');
        const body = JSON.parse(lastOpts().body as string);
        expect(body.user_id).toBe('u1');
    });
});

describe('api.unlinkEmployeeUser', () => {
    it('deletes /employees/:id/link-user', async () => {
        mockOk({ data: {} });
        await api.unlinkEmployeeUser('e1');
        expect(lastOpts().method).toBe('DELETE');
        expect(lastUrl()).toContain('/employees/e1/link-user');
    });
});

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

describe('api.getAttendance', () => {
    it('fetches /attendance', async () => {
        mockOk({ data: [] });
        await api.getAttendance();
        expect(lastUrl()).toContain('/attendance');
    });

    it('appends all params', async () => {
        mockOk({ data: [] });
        await api.getAttendance({ employeeId: 'e1', startDate: '2026-01-01', endDate: '2026-06-01', status: 'PRESENT', page: 1, limit: 20 });
        const url = lastUrl();
        expect(url).toContain('employeeId=e1');
        expect(url).toContain('startDate=2026-01-01');
        expect(url).toContain('status=PRESENT');
    });
});

describe('api.upsertAttendance', () => {
    it('posts to /attendance', async () => {
        mockOk({ data: {} });
        await api.upsertAttendance({ employeeId: 'e1', date: '2026-06-01' });
        expect(lastOpts().method).toBe('POST');
    });
});

describe('api.deleteAttendance', () => {
    it('deletes /attendance/:id', async () => {
        mockOk({ data: null });
        await api.deleteAttendance('att1');
        expect(lastOpts().method).toBe('DELETE');
    });
});

describe('api.getAttendanceSummary', () => {
    it('fetches /attendance/summary/:employeeId with year/month', async () => {
        mockOk({ data: {} });
        await api.getAttendanceSummary('e1', 2026, 6);
        const url = lastUrl();
        expect(url).toContain('/attendance/summary/e1');
        expect(url).toContain('year=2026');
        expect(url).toContain('month=6');
    });
});

// ---------------------------------------------------------------------------
// Leave Types
// ---------------------------------------------------------------------------

describe('api.getLeaveTypes', () => {
    it('fetches /attendance/leave-types', async () => {
        mockOk({ data: [] });
        await api.getLeaveTypes();
        expect(lastUrl()).toContain('/attendance/leave-types');
    });
});

describe('api.createLeaveType', () => {
    it('posts to /attendance/leave-types', async () => {
        mockOk({ data: {} });
        await api.createLeaveType({ name: 'Sick' });
        expect(lastOpts().method).toBe('POST');
    });
});

describe('api.updateLeaveType', () => {
    it('patches /attendance/leave-types/:id', async () => {
        mockOk({ data: {} });
        await api.updateLeaveType('lt1', { name: 'Annual' });
        expect(lastOpts().method).toBe('PATCH');
    });
});

describe('api.deleteLeaveType', () => {
    it('deletes /attendance/leave-types/:id', async () => {
        mockOk({ data: null });
        await api.deleteLeaveType('lt1');
        expect(lastOpts().method).toBe('DELETE');
    });
});

// ---------------------------------------------------------------------------
// Leave Balances
// ---------------------------------------------------------------------------

describe('api.getLeaveBalances', () => {
    it('fetches /attendance/leave-balances/:employeeId', async () => {
        mockOk({ data: {} });
        await api.getLeaveBalances('e1');
        expect(lastUrl()).toContain('/attendance/leave-balances/e1');
    });
});

describe('api.setLeaveBalance', () => {
    it('posts to /attendance/leave-balances', async () => {
        mockOk({ data: {} });
        await api.setLeaveBalance({ employeeId: 'e1', leaveTypeId: 'lt1', balance: 10 });
        expect(lastOpts().method).toBe('POST');
    });
});

// ---------------------------------------------------------------------------
// Leave Requests
// ---------------------------------------------------------------------------

describe('api.getLeaveRequests', () => {
    it('fetches /attendance/leave-requests', async () => {
        mockOk({ data: [] });
        await api.getLeaveRequests();
        expect(lastUrl()).toContain('/attendance/leave-requests');
    });

    it('appends filter params', async () => {
        mockOk({ data: [] });
        await api.getLeaveRequests({ employeeId: 'e1', status: 'PENDING', page: 1, limit: 10 });
        const url = lastUrl();
        expect(url).toContain('employeeId=e1');
        expect(url).toContain('status=PENDING');
    });
});

describe('api.createLeaveRequest', () => {
    it('posts to /attendance/leave-requests', async () => {
        mockOk({ data: {} });
        await api.createLeaveRequest({ employeeId: 'e1', leaveTypeId: 'lt1' });
        expect(lastOpts().method).toBe('POST');
    });
});

describe('api.reviewLeaveRequest', () => {
    it('patches /attendance/leave-requests/:id/review', async () => {
        mockOk({ data: {} });
        await api.reviewLeaveRequest('lr1', { status: 'APPROVED', approver_note: 'OK' });
        expect(lastOpts().method).toBe('PATCH');
        expect(lastUrl()).toContain('/attendance/leave-requests/lr1/review');
    });
});

describe('api.cancelLeaveRequest', () => {
    it('patches /attendance/leave-requests/:id/cancel', async () => {
        mockOk({ data: {} });
        await api.cancelLeaveRequest('lr1');
        expect(lastOpts().method).toBe('PATCH');
        expect(lastUrl()).toContain('/attendance/leave-requests/lr1/cancel');
    });
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

describe('api.getNotifications', () => {
    it('fetches /notifications', async () => {
        mockOk({ data: [] });
        await api.getNotifications();
        expect(lastUrl()).toContain('/notifications');
    });
});

describe('api.getNotificationUnreadCount', () => {
    it('fetches /notifications/unread-count', async () => {
        mockOk({ data: { count: 3 } });
        await api.getNotificationUnreadCount();
        expect(lastUrl()).toContain('/notifications/unread-count');
    });
});

describe('api.markNotificationRead', () => {
    it('patches /notifications/:id/read', async () => {
        mockOk({ data: {} });
        await api.markNotificationRead('n1');
        expect(lastOpts().method).toBe('PATCH');
        expect(lastUrl()).toContain('/notifications/n1/read');
    });
});

describe('api.markAllNotificationsRead', () => {
    it('patches /notifications/read-all', async () => {
        mockOk({ data: {} });
        await api.markAllNotificationsRead();
        expect(lastOpts().method).toBe('PATCH');
        expect(lastUrl()).toContain('/notifications/read-all');
    });
});
