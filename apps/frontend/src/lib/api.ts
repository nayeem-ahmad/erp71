const DEFAULT_PROD_API_BASE = 'https://retail-saas-backend.onrender.com';
// In dev (remote container) use a relative path so browser calls go to the
// Next.js dev server which proxies them to the backend via next.config rewrites.
// In production keep the explicit backend URL.
function normalizeApiBase(rawBase?: string) {
    const base = rawBase?.trim().replace(/\/$/, '');

    if (!base) {
        return null;
    }

    return base.endsWith('/api/v1') ? base : `${base}/api/v1`;
}

const API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_API_BASE || process.env.NEXT_PUBLIC_API_URL)
    || (process.env.NODE_ENV === 'production' ? `${DEFAULT_PROD_API_BASE}/api/v1` : '/api/v1');

export async function fetchBlobWithAuth(endpoint: string, options: RequestInit = {}): Promise<{ blob: Blob; filename: string }> {
    const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
    const tenantId = typeof window !== 'undefined' ? localStorage.getItem('tenant_id') : null;
    const storeId = typeof window !== 'undefined' ? localStorage.getItem('store_id') : null;

    const headers = new Headers(options.headers);
    if (token) {
        headers.set('Authorization', `Bearer ${token}`);
    }
    if (tenantId) {
        headers.set('x-tenant-id', tenantId);
    }
    if (storeId) {
        headers.set('x-store-id', storeId);
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
    });

    if (!response.ok) {
        let message = `API error: ${response.statusText}`;
        try {
            const errorBody = await response.json();
            const apiMessage = Array.isArray(errorBody?.message)
                ? errorBody.message.join(', ')
                : errorBody?.message || errorBody?.error;
            if (apiMessage) {
                message = apiMessage;
            }
        } catch {
            // Fall back to the response status text when no JSON error payload is available.
        }
        throw new Error(message);
    }

    const disposition = response.headers.get('Content-Disposition') ?? '';
    const filenameMatch = disposition.match(/filename="([^"]+)"/);
    const filename = filenameMatch ? filenameMatch[1] : 'export';

    const blob = await response.blob();
    return { blob, filename };
}

export async function fetchWithAuth(endpoint: string, options: RequestInit = {}) {
    const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
    const tenantId = typeof window !== 'undefined' ? localStorage.getItem('tenant_id') : null;
    const storeId = typeof window !== 'undefined' ? localStorage.getItem('store_id') : null;

    const headers = new Headers(options.headers);
    if (token) {
        headers.set('Authorization', `Bearer ${token}`);
    }
    if (tenantId) {
        headers.set('x-tenant-id', tenantId);
    }
    if (storeId) {
        headers.set('x-store-id', storeId);
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
    });

    if (!response.ok) {
        let message = `API error: ${response.statusText}`;

        try {
            const errorBody = await response.json();
            const apiMessage = Array.isArray(errorBody?.message)
                ? errorBody.message.join(', ')
                : errorBody?.message || errorBody?.error;

            if (apiMessage) {
                message = apiMessage;
            }
        } catch {
            // Fall back to the response status text when no JSON error payload is available.
        }

        throw new Error(message);
    }

    const json = await response.json();
    // Backend wraps all responses in { data: T } — unwrap transparently
    return 'data' in json ? json.data : json;
}

export const api = {
    getProducts: (params?: { groupId?: string; subgroupId?: string; uncategorized?: boolean; page?: number; limit?: number }) => {
        const query = new URLSearchParams();
        if (params?.groupId) query.set('groupId', params.groupId);
        if (params?.subgroupId) query.set('subgroupId', params.subgroupId);
        if (params?.uncategorized) query.set('uncategorized', 'true');
        // Default to a large limit so callers expecting a flat array still work
        query.set('limit', String(params?.limit ?? 100));
        if (params?.page) query.set('page', String(params.page));
        return fetchWithAuth(`/products?${query.toString()}`).then((r: any) => r?.items ?? r);
    },
    createProduct: (data: any) => fetchWithAuth('/products', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    updateProduct: (id: string, data: any) => fetchWithAuth(`/products/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    deleteProduct: (id: string) => fetchWithAuth(`/products/${id}`, {
        method: 'DELETE',
    }),
    getProductGroups: () => fetchWithAuth('/product-groups'),
    getProductGroup: (id: string) => fetchWithAuth(`/product-groups/${id}`),
    createProductGroup: (data: any) => fetchWithAuth('/product-groups', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    updateProductGroup: (id: string, data: any) => fetchWithAuth(`/product-groups/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    deleteProductGroup: (id: string) => fetchWithAuth(`/product-groups/${id}`, {
        method: 'DELETE',
    }),
    getProductSubgroups: (params?: { groupId?: string }) => {
        const query = new URLSearchParams();
        if (params?.groupId) query.set('groupId', params.groupId);
        return fetchWithAuth(`/product-subgroups${query.toString() ? `?${query.toString()}` : ''}`);
    },
    getProductSubgroup: (id: string) => fetchWithAuth(`/product-subgroups/${id}`),
    createProductSubgroup: (data: any) => fetchWithAuth('/product-subgroups', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    updateProductSubgroup: (id: string, data: any) => fetchWithAuth(`/product-subgroups/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    deleteProductSubgroup: (id: string) => fetchWithAuth(`/product-subgroups/${id}`, {
        method: 'DELETE',
    }),
    getInventoryWarehouses: () => fetchWithAuth('/inventory/warehouses'),
    createInventoryWarehouse: (data: any) => fetchWithAuth('/inventory/warehouses', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    updateInventoryWarehouse: (id: string, data: any) => fetchWithAuth(`/inventory/warehouses/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    getInventorySettings: () => fetchWithAuth('/inventory/settings'),
    updateInventorySettings: (data: any) => fetchWithAuth('/inventory/settings', {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    getInventoryReasons: (params?: { type?: string }) => {
        const query = new URLSearchParams();
        if (params?.type) query.set('type', params.type);
        return fetchWithAuth(`/inventory/reasons${query.toString() ? `?${query.toString()}` : ''}`);
    },
    createInventoryReason: (data: any) => fetchWithAuth('/inventory/reasons', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    updateInventoryReason: (id: string, data: any) => fetchWithAuth(`/inventory/reasons/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    getInventoryLedger: (params?: { productId?: string; warehouseId?: string; movementType?: string; from?: string; to?: string; limit?: number }) => {
        const query = new URLSearchParams();
        if (params?.productId) query.set('productId', params.productId);
        if (params?.warehouseId) query.set('warehouseId', params.warehouseId);
        if (params?.movementType) query.set('movementType', params.movementType);
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        if (params?.limit) query.set('limit', String(params.limit));
        return fetchWithAuth(`/inventory/ledger${query.toString() ? `?${query.toString()}` : ''}`);
    },
    getWarehouseTransfers: (params?: { status?: string; sourceWarehouseId?: string; destinationWarehouseId?: string; productId?: string; from?: string; to?: string }) => {
        const query = new URLSearchParams();
        if (params?.status) query.set('status', params.status);
        if (params?.sourceWarehouseId) query.set('sourceWarehouseId', params.sourceWarehouseId);
        if (params?.destinationWarehouseId) query.set('destinationWarehouseId', params.destinationWarehouseId);
        if (params?.productId) query.set('productId', params.productId);
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        return fetchWithAuth(`/warehouse-transfers${query.toString() ? `?${query.toString()}` : ''}`);
    },
    getWarehouseTransfer: (id: string) => fetchWithAuth(`/warehouse-transfers/${id}`),
    createWarehouseTransfer: (data: any) => fetchWithAuth('/warehouse-transfers', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    sendWarehouseTransfer: (id: string) => fetchWithAuth(`/warehouse-transfers/${id}/send`, {
        method: 'POST',
    }),
    receiveWarehouseTransfer: (id: string, data: any) => fetchWithAuth(`/warehouse-transfers/${id}/receive`, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    getInventoryShrinkage: () => fetchWithAuth('/inventory-shrinkage'),
    getInventoryShrinkageRecord: (id: string) => fetchWithAuth(`/inventory-shrinkage/${id}`),
    createInventoryShrinkage: (data: any) => fetchWithAuth('/inventory-shrinkage', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    getStockTakes: () => fetchWithAuth('/stock-takes'),
    getStockTake: (id: string) => fetchWithAuth(`/stock-takes/${id}`),
    createStockTake: (data: any) => fetchWithAuth('/stock-takes', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    updateStockTakeCounts: (id: string, data: any) => fetchWithAuth(`/stock-takes/${id}/counts`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    updateStockTakeStatus: (id: string, data: any) => fetchWithAuth(`/stock-takes/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    postStockTake: (id: string) => fetchWithAuth(`/stock-takes/${id}/post`, {
        method: 'POST',
    }),
    getReorderSuggestions: (params?: { warehouseId?: string; groupId?: string; subgroupId?: string }) => {
        const query = new URLSearchParams();
        if (params?.warehouseId) query.set('warehouseId', params.warehouseId);
        if (params?.groupId) query.set('groupId', params.groupId);
        if (params?.subgroupId) query.set('subgroupId', params.subgroupId);
        return fetchWithAuth(`/inventory-reports/reorder-suggestions${query.toString() ? `?${query.toString()}` : ''}`);
    },
    getInventoryValuation: (params?: { warehouseId?: string; groupId?: string; subgroupId?: string }) => {
        const query = new URLSearchParams();
        if (params?.warehouseId) query.set('warehouseId', params.warehouseId);
        if (params?.groupId) query.set('groupId', params.groupId);
        if (params?.subgroupId) query.set('subgroupId', params.subgroupId);
        return fetchWithAuth(`/inventory-reports/valuation${query.toString() ? `?${query.toString()}` : ''}`);
    },
    getSalesSummary: (params?: { storeId?: string; from?: string; to?: string }) => {
        const query = new URLSearchParams();
        if (params?.storeId) query.set('storeId', params.storeId);
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        return fetchWithAuth(`/sales-reports/summary${query.toString() ? `?${query.toString()}` : ''}`);
    },
    getSalesByProduct: (params?: { storeId?: string; groupId?: string; subgroupId?: string; from?: string; to?: string }) => {
        const query = new URLSearchParams();
        if (params?.storeId) query.set('storeId', params.storeId);
        if (params?.groupId) query.set('groupId', params.groupId);
        if (params?.subgroupId) query.set('subgroupId', params.subgroupId);
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        return fetchWithAuth(`/sales-reports/by-product${query.toString() ? `?${query.toString()}` : ''}`);
    },
    getConsolidatedReport: (params?: { from?: string; to?: string }) => {
        const query = new URLSearchParams();
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        return fetchWithAuth(`/sales-reports/consolidated${query.toString() ? `?${query.toString()}` : ''}`);
    },
    getShrinkageSummary: (params?: { warehouseId?: string; reasonId?: string; productId?: string; groupId?: string; subgroupId?: string; from?: string; to?: string }) => {
        const query = new URLSearchParams();
        if (params?.warehouseId) query.set('warehouseId', params.warehouseId);
        if (params?.reasonId) query.set('reasonId', params.reasonId);
        if (params?.productId) query.set('productId', params.productId);
        if (params?.groupId) query.set('groupId', params.groupId);
        if (params?.subgroupId) query.set('subgroupId', params.subgroupId);
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        return fetchWithAuth(`/inventory-reports/shrinkage-summary${query.toString() ? `?${query.toString()}` : ''}`);
    },
    uploadFile: (file: File) => {
        const formData = new FormData();
        formData.append('file', file);
        return fetchWithAuth('/assets/upload', {
            method: 'POST',
            body: formData,
        });
    },
    createSale: (data: any) => fetchWithAuth('/sales', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    getSales: () => fetchWithAuth('/sales').then((r: any) => r?.items ?? r),
    getCustomers: (params?: { page?: number; limit?: number; search?: string }) => {
        const query = new URLSearchParams();
        query.set('limit', String(params?.limit ?? 100));
        if (params?.page) query.set('page', String(params.page));
        if (params?.search) query.set('search', params.search);
        return fetchWithAuth(`/customers?${query.toString()}`).then((r: any) => r?.items ?? r);
    },
    getCustomer: (id: string) => fetchWithAuth(`/customers/${id}`),
    getCustomerPurchaseHistory: (id: string, params?: { page?: number; limit?: number; from?: string; to?: string }) => {
        const query = new URLSearchParams();
        if (params?.page) query.set('page', String(params.page));
        if (params?.limit) query.set('limit', String(params.limit));
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        return fetchWithAuth(`/customers/${id}/history${query.toString() ? `?${query.toString()}` : ''}`);
    },
    getCustomerHistory: (id: string) => fetchWithAuth(`/customers/${id}/history`),
    getCustomerSegmentStats: () => fetchWithAuth('/customers/segment-stats'),
    runCustomerSegmentation: () => fetchWithAuth('/customers/run-segmentation', { method: 'POST' }),
    evaluateCustomerSegments: () => fetchWithAuth('/customers/segments/evaluate', { method: 'POST' }),
    createCustomer: (data: any) => fetchWithAuth('/customers', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    updateCustomer: (id: string, data: any) => fetchWithAuth(`/customers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    // Customer Groups
    getCustomerGroups: () => fetchWithAuth('/customer-groups'),
    getCustomerGroup: (id: string) => fetchWithAuth(`/customer-groups/${id}`),
    createCustomerGroup: (data: any) => fetchWithAuth('/customer-groups', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    updateCustomerGroup: (id: string, data: any) => fetchWithAuth(`/customer-groups/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    deleteCustomerGroup: (id: string) => fetchWithAuth(`/customer-groups/${id}`, {
        method: 'DELETE',
    }),
    // Territories
    getTerritories: () => fetchWithAuth('/territories'),
    getTerritory: (id: string) => fetchWithAuth(`/territories/${id}`),
    createTerritory: (data: any) => fetchWithAuth('/territories', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    updateTerritory: (id: string, data: any) => fetchWithAuth(`/territories/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    deleteTerritory: (id: string) => fetchWithAuth(`/territories/${id}`, {
        method: 'DELETE',
    }),
    // Accounting
    getAccountingOverview: () => fetchWithAuth('/accounting'),
    getAccountGroups: () => fetchWithAuth('/accounting/account-groups'),
    createAccountGroup: (data: any) => fetchWithAuth('/accounting/account-groups', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    getAccountSubgroups: (params?: { groupId?: string }) => {
        const query = new URLSearchParams();
        if (params?.groupId) query.set('groupId', params.groupId);
        return fetchWithAuth(`/accounting/account-subgroups${query.toString() ? `?${query.toString()}` : ''}`);
    },
    createAccountSubgroup: (data: any) => fetchWithAuth('/accounting/account-subgroups', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    getAccounts: (params?: { search?: string; groupId?: string; type?: string; category?: string }) => {
        const query = new URLSearchParams();
        if (params?.search) query.set('search', params.search);
        if (params?.groupId) query.set('groupId', params.groupId);
        if (params?.type) query.set('type', params.type);
        if (params?.category) query.set('category', params.category);
        return fetchWithAuth(`/accounting/accounts${query.toString() ? `?${query.toString()}` : ''}`);
    },
    createAccount: (data: any) => fetchWithAuth('/accounting/accounts', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    getVoucherNumberPreview: (voucherType: string) => fetchWithAuth(`/accounting/vouchers/next-number?voucherType=${encodeURIComponent(voucherType)}`),
    getVouchers: (params?: { voucherType?: string; from?: string; to?: string; page?: number; limit?: number }) => {
        const query = new URLSearchParams();
        if (params?.voucherType) query.set('voucherType', params.voucherType);
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        if (params?.page) query.set('page', String(params.page));
        if (params?.limit) query.set('limit', String(params.limit));
        return fetchWithAuth(`/accounting/vouchers${query.toString() ? `?${query.toString()}` : ''}`);
    },
    getVoucher: (id: string) => fetchWithAuth(`/accounting/vouchers/${id}`),
    getLedger: (accountId: string, params?: { from?: string; to?: string }) => {
        const query = new URLSearchParams();
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        return fetchWithAuth(`/accounting/reports/ledger/${accountId}${query.toString() ? `?${query.toString()}` : ''}`);
    },
    getFinancialKpis: (params?: { from?: string; to?: string }) => {
        const query = new URLSearchParams();
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        return fetchWithAuth(`/accounting/dashboard/kpis${query.toString() ? `?${query.toString()}` : ''}`);
    },
    getFinancialTrends: (params?: { from?: string; to?: string }) => {
        const query = new URLSearchParams();
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        return fetchWithAuth(`/accounting/dashboard/trends${query.toString() ? `?${query.toString()}` : ''}`);
    },
    createVoucher: (data: any) => fetchWithAuth('/accounting/vouchers', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    getPostingRules: (params?: { eventType?: string; isActive?: boolean }) => {
        const query = new URLSearchParams();
        if (params?.eventType) query.set('eventType', params.eventType);
        if (params?.isActive !== undefined) query.set('isActive', String(params.isActive));
        return fetchWithAuth(`/accounting/settings/posting-rules${query.toString() ? `?${query.toString()}` : ''}`);
    },
    updatePostingRule: (id: string, data: {
        debitAccountId: string;
        creditAccountId: string;
        conditionKey: string;
        conditionValue?: string | null;
        priority: number;
        isActive: boolean;
    }) => fetchWithAuth(`/accounting/settings/posting-rules/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    getPostingExceptions: (params?: { status?: string; module?: string; from?: string; to?: string; page?: number; limit?: number }) => {
        const query = new URLSearchParams();
        if (params?.status) query.set('status', params.status);
        if (params?.module) query.set('module', params.module);
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        if (params?.page) query.set('page', String(params.page));
        if (params?.limit) query.set('limit', String(params.limit));
        return fetchWithAuth(`/accounting/reconciliation/posting-exceptions${query.toString() ? `?${query.toString()}` : ''}`);
    },
    retryPostingException: (id: string) => fetchWithAuth(`/accounting/reconciliation/posting-exceptions/${id}/retry`, {
        method: 'POST',
    }),
    getProfitLoss: (params?: { from?: string; to?: string }) => {
        const query = new URLSearchParams();
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        return fetchWithAuth(`/accounting/reports/profit-loss${query.toString() ? `?${query.toString()}` : ''}`);
    },
    getBalanceSheet: (params?: { asOfDate?: string }) => {
        const query = new URLSearchParams();
        if (params?.asOfDate) query.set('asOfDate', params.asOfDate);
        return fetchWithAuth(`/accounting/reports/balance-sheet${query.toString() ? `?${query.toString()}` : ''}`);
    },
    getCashbook: (params?: { from?: string; to?: string; accountId?: string }) => {
        const query = new URLSearchParams();
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        if (params?.accountId) query.set('accountId', params.accountId);
        return fetchWithAuth(`/accounting/reports/cashbook${query.toString() ? `?${query.toString()}` : ''}`);
    },
    getBankbook: (params?: { from?: string; to?: string; accountId?: string }) => {
        const query = new URLSearchParams();
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        if (params?.accountId) query.set('accountId', params.accountId);
        return fetchWithAuth(`/accounting/reports/bankbook${query.toString() ? `?${query.toString()}` : ''}`);
    },
    getSalesByCustomer: (params?: { storeId?: string; from?: string; to?: string }) => {
        const query = new URLSearchParams();
        if (params?.storeId) query.set('storeId', params.storeId);
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        return fetchWithAuth(`/sales-reports/by-customer${query.toString() ? `?${query.toString()}` : ''}`);
    },
    getMonthlySalesByCustomer: (params?: { from?: string; to?: string; customerId?: string }) => {
        const query = new URLSearchParams();
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        if (params?.customerId) query.set('customerId', params.customerId);
        return fetchWithAuth(`/sales-reports/monthly-by-customer${query.toString() ? `?${query.toString()}` : ''}`);
    },
    getBranchReport: (params: { storeId: string; from?: string; to?: string }) => {
        const query = new URLSearchParams();
        query.set('storeId', params.storeId);
        if (params.from) query.set('from', params.from);
        if (params.to) query.set('to', params.to);
        return fetchWithAuth(`/sales-reports/branch-report?${query.toString()}`);
    },
    getStores: () => {
        const tenantId = typeof window !== 'undefined' ? localStorage.getItem('tenant_id') : null;
        return fetchWithAuth('/auth/me').then((me: any) => {
            if (!tenantId || !me?.tenants) return [];
            const tenant = me.tenants.find((t: any) => t.id === tenantId);
            return tenant?.stores ?? [];
        });
    },
    exportAccountingLedger: (params: { format: 'tally' | 'quickbooks'; from?: string; to?: string }) => {
        const query = new URLSearchParams();
        query.set('format', params.format);
        if (params.from) query.set('from', params.from);
        if (params.to) query.set('to', params.to);
        return fetchBlobWithAuth(`/accounting/export?${query.toString()}`);
    },
    getReturns: () => fetchWithAuth('/sales-returns'),
    getReturn: (id: string) => fetchWithAuth(`/sales-returns/${id}`),
    createReturn: (data: any) => fetchWithAuth('/sales-returns', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    deleteReturn: (id: string) => fetchWithAuth(`/sales-returns/${id}`, {
        method: 'DELETE',
    }),
    updateReturn: (id: string, data: any) => fetchWithAuth(`/sales-returns/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    getOrders: () => fetchWithAuth('/sales-orders'),
    getOrder: (id: string) => fetchWithAuth(`/sales-orders/${id}`),
    createOrder: (data: any) => fetchWithAuth('/sales-orders', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    updateOrder: (id: string, data: any) => fetchWithAuth(`/sales-orders/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    deleteOrder: (id: string) => fetchWithAuth(`/sales-orders/${id}`, {
        method: 'DELETE',
    }),
    updateOrderStatus: (id: string, status: string) => fetchWithAuth(`/sales-orders/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
        headers: { 'Content-Type': 'application/json' },
    }),
    addOrderDeposit: (id: string, data: any) => fetchWithAuth(`/sales-orders/${id}/deposits`, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    getSuppliers: () => fetchWithAuth('/suppliers'),
    createSupplier: (data: any) => fetchWithAuth('/suppliers', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    getPurchaseSummary: (params?: { storeId?: string; from?: string; to?: string }) => {
        const query = new URLSearchParams();
        if (params?.storeId) query.set('storeId', params.storeId);
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        return fetchWithAuth(`/purchase-reports/summary${query.toString() ? `?${query.toString()}` : ''}`);
    },
    getPurchasesByProduct: (params?: { storeId?: string; groupId?: string; subgroupId?: string; from?: string; to?: string }) => {
        const query = new URLSearchParams();
        if (params?.storeId) query.set('storeId', params.storeId);
        if (params?.groupId) query.set('groupId', params.groupId);
        if (params?.subgroupId) query.set('subgroupId', params.subgroupId);
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        return fetchWithAuth(`/purchase-reports/by-product${query.toString() ? `?${query.toString()}` : ''}`);
    },
    getPurchasesBySupplier: (params?: { storeId?: string; from?: string; to?: string }) => {
        const query = new URLSearchParams();
        if (params?.storeId) query.set('storeId', params.storeId);
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        return fetchWithAuth(`/purchase-reports/by-supplier${query.toString() ? `?${query.toString()}` : ''}`);
    },
    updateSupplier: (id: string, data: any) => fetchWithAuth(`/suppliers/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    deleteSupplier: (id: string) => fetchWithAuth(`/suppliers/${id}`, { method: 'DELETE' }),
    getPurchaseInvoice: (id: string) => fetchWithAuth(`/purchases/${id}/invoice`),
    getPurchases: () => fetchWithAuth('/purchases'),
    getPurchase: (id: string) => fetchWithAuth(`/purchases/${id}`),
    createPurchase: (data: any) => fetchWithAuth('/purchases', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    getPurchaseReturns: () => fetchWithAuth('/purchase-returns'),
    getPurchaseReturn: (id: string) => fetchWithAuth(`/purchase-returns/${id}`),
    createPurchaseReturn: (data: any) => fetchWithAuth('/purchase-returns', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    updatePurchaseReturn: (id: string, data: any) => fetchWithAuth(`/purchase-returns/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    deletePurchaseReturn: (id: string) => fetchWithAuth(`/purchase-returns/${id}`, {
        method: 'DELETE',
    }),
    getQuotations: () => fetchWithAuth('/sales-quotations'),
    getQuotation: (id: string) => fetchWithAuth(`/sales-quotations/${id}`),
    createQuotation: (data: any) => fetchWithAuth('/sales-quotations', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    updateQuotation: (id: string, data: any) => fetchWithAuth(`/sales-quotations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    deleteQuotation: (id: string) => fetchWithAuth(`/sales-quotations/${id}`, {
        method: 'DELETE',
    }),
    updateQuotationStatus: (id: string, status: string) => fetchWithAuth(`/sales-quotations/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
        headers: { 'Content-Type': 'application/json' },
    }),
    reviseQuotation: (id: string) => fetchWithAuth(`/sales-quotations/${id}/revise`, {
        method: 'POST',
    }),
    convertQuotation: (id: string) => fetchWithAuth(`/sales-quotations/${id}/convert`, {
        method: 'POST',
    }),
    // Sales detail
    getSale: (id: string) => fetchWithAuth(`/sales/${id}`),
    getSaleInvoice: (id: string) => fetchWithAuth(`/sales/${id}/invoice`),
    getDiscountCodes: () => fetchWithAuth('/discount-codes'),
    createDiscountCode: (data: any) => fetchWithAuth('/discount-codes', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    toggleDiscountCode: (id: string) => fetchWithAuth(`/discount-codes/${id}/toggle`, { method: 'PATCH' }),
    deleteDiscountCode: (id: string) => fetchWithAuth(`/discount-codes/${id}`, { method: 'DELETE' }),
    validateDiscountCode: (code: string, cartTotal: number) => fetchWithAuth('/discount-codes/validate', {
        method: 'POST',
        body: JSON.stringify({ code, cart_total: cartTotal }),
        headers: { 'Content-Type': 'application/json' },
    }),
    useDiscountCode: (code: string) => fetchWithAuth(`/discount-codes/${encodeURIComponent(code)}/use`, { method: 'POST' }),
    updateSale: (id: string, data: any) => fetchWithAuth(`/sales/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    // Cashier sessions
    openCashierSession: (data: any) => fetchWithAuth('/cashier-sessions/open', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    closeCashierSession: (sessionId: string, data: any) => fetchWithAuth(`/cashier-sessions/${sessionId}/close`, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    getOpenCashierSession: () => fetchWithAuth('/cashier-sessions/open'),
    getCashierSession: (sessionId: string) => fetchWithAuth(`/cashier-sessions/${sessionId}`),
    addCashTransaction: (sessionId: string, data: any) => fetchWithAuth(`/cashier-sessions/${sessionId}/cash-transaction`, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    getCashTransactions: (sessionId: string) => fetchWithAuth(`/cashier-sessions/${sessionId}/cash-transactions`),
    // POS Counters
    getCounters: (storeId: string) => fetchWithAuth(`/counters?storeId=${storeId}`),
    getActiveCounters: (storeId: string) => fetchWithAuth(`/counters/active?storeId=${storeId}`),
    createCounter: (data: any) => fetchWithAuth('/counters', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    updateCounter: (id: string, data: any) => fetchWithAuth(`/counters/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    deleteCounter: (id: string) => fetchWithAuth(`/counters/${id}`, { method: 'DELETE' }),
    login: (data: any) => fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }).then(async res => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.message || 'Login failed');
        return body && 'data' in body ? body.data : body;
    }),
    signup: (data: any) => fetch(`${API_BASE}/auth/signup`, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }).then(async res => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.message || 'Signup failed');
        return body && 'data' in body ? body.data : body;
    }),
    getSubscriptionPlans: () => fetch(`${API_BASE}/auth/plans`).then(async res => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.message || 'Failed to load plans');
        return body && 'data' in body ? body.data : body;
    }),
    getBillingSummary: () => fetchWithAuth('/billing/summary'),
    createBillingCheckoutSession: (data: any) => fetchWithAuth('/billing/checkout-session', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    confirmBillingCheckout: (data: any) => fetchWithAuth('/billing/confirm', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    cancelBillingAtPeriodEnd: () => fetchWithAuth('/billing/cancel-at-period-end', {
        method: 'POST',
    }),
    getAdminTenants: (params?: { search?: string; planCode?: string; status?: string }) => {
        const query = new URLSearchParams();
        if (params?.search) query.set('search', params.search);
        if (params?.planCode) query.set('planCode', params.planCode);
        if (params?.status) query.set('status', params.status);
        return fetchWithAuth(`/admin/tenants${query.toString() ? `?${query.toString()}` : ''}`);
    },
    getAdminTenant: (tenantId: string) => fetchWithAuth(`/admin/tenants/${tenantId}`),
    updateAdminTenantSubscription: (tenantId: string, data: any) => fetchWithAuth(`/admin/tenants/${tenantId}/subscription`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    suspendTenant: (tenantId: string, reason?: string) => fetchWithAuth(`/admin/tenants/${tenantId}/suspend`, {
        method: 'PATCH',
        body: JSON.stringify({ reason }),
        headers: { 'Content-Type': 'application/json' },
    }),
    impersonateTenant: (tenantId: string) => fetchWithAuth(`/admin/tenants/${tenantId}/impersonate`, {
        method: 'POST',
    }),
    getAdminMetrics: () => fetchWithAuth('/admin/metrics'),
    getAdminUsers: (params?: { search?: string; page?: number; limit?: number }) => {
        const query = new URLSearchParams();
        if (params?.search) query.set('search', params.search);
        if (params?.page) query.set('page', String(params.page));
        if (params?.limit) query.set('limit', String(params.limit));
        return fetchWithAuth(`/admin/users${query.toString() ? `?${query.toString()}` : ''}`);
    },
    promoteUser: (userId: string) => fetchWithAuth(`/admin/users/${userId}/promote`, { method: 'POST' }),
    demoteUser: (userId: string) => fetchWithAuth(`/admin/users/${userId}/promote`, { method: 'DELETE' }),
    getMe: () => fetchWithAuth('/auth/me'),
    updateProfile: (data: { name?: string; preferred_locale?: 'en' | 'bn' | 'ms' }) => fetchWithAuth('/auth/me', {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    getTenantLocalizationSettings: () => fetchWithAuth('/tenants/localization-settings'),
    updateTenantLocalizationSettings: (data: { default_locale: 'en' | 'bn' | 'ms' }) => fetchWithAuth('/tenants/localization-settings', {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    changePassword: (data: { currentPassword: string; newPassword: string }) => fetchWithAuth('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    setup2FA: () => fetchWithAuth('/auth/2fa/setup', { method: 'POST' }),
    enable2FA: (code: string) => fetchWithAuth('/auth/2fa/enable', {
        method: 'POST',
        body: JSON.stringify({ code }),
        headers: { 'Content-Type': 'application/json' },
    }),
    disable2FA: (code: string) => fetchWithAuth('/auth/2fa/disable', {
        method: 'POST',
        body: JSON.stringify({ code }),
        headers: { 'Content-Type': 'application/json' },
    }),
    // Warranty Claims
    lookupWarrantySerial: (serialNumber: string) =>
        fetchWithAuth(`/warranty-claims/lookup?serialNumber=${encodeURIComponent(serialNumber)}`),
    getWarrantyClaims: () => fetchWithAuth('/warranty-claims'),
    getWarrantyClaim: (id: string) => fetchWithAuth(`/warranty-claims/${id}`),
    createWarrantyClaim: (data: any) => fetchWithAuth('/warranty-claims', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    updateWarrantyClaimStatus: (id: string, data: { status: string; resolutionNotes?: string; replacementSerialNumber?: string }) =>
        fetchWithAuth(`/warranty-claims/${id}/status`, {
            method: 'PATCH',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    // Employees
    getEmployees: (params?: { page?: number; limit?: number; search?: string; status?: string; departmentId?: string }) => {
        const query = new URLSearchParams();
        query.set('limit', String(params?.limit ?? 100));
        if (params?.page) query.set('page', String(params.page));
        if (params?.search) query.set('search', params.search);
        if (params?.status) query.set('status', params.status);
        if (params?.departmentId) query.set('departmentId', params.departmentId);
        return fetchWithAuth(`/employees?${query.toString()}`).then((r: any) => r?.items ?? r);
    },
    getEmployee: (id: string) => fetchWithAuth(`/employees/${id}`),
    createEmployee: (data: any) => fetchWithAuth('/employees', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    updateEmployee: (id: string, data: any) => fetchWithAuth(`/employees/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    deleteEmployee: (id: string) => fetchWithAuth(`/employees/${id}`, { method: 'DELETE' }),
    getDepartments: () => fetchWithAuth('/employees/departments'),
    createDepartment: (data: { name: string }) => fetchWithAuth('/employees/departments', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    getDesignations: () => fetchWithAuth('/employees/designations'),
    createDesignation: (data: { name: string }) => fetchWithAuth('/employees/designations', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    linkEmployeeUser: (id: string, user_id: string) => fetchWithAuth(`/employees/${id}/link-user`, {
        method: 'POST',
        body: JSON.stringify({ user_id }),
        headers: { 'Content-Type': 'application/json' },
    }),
    unlinkEmployeeUser: (id: string) => fetchWithAuth(`/employees/${id}/link-user`, { method: 'DELETE' }),
    // Attendance
    getAttendance: (params?: { employeeId?: string; startDate?: string; endDate?: string; status?: string; page?: number; limit?: number }) => {
        const q = new URLSearchParams();
        if (params?.employeeId) q.set('employeeId', params.employeeId);
        if (params?.startDate) q.set('startDate', params.startDate);
        if (params?.endDate) q.set('endDate', params.endDate);
        if (params?.status) q.set('status', params.status);
        if (params?.page) q.set('page', String(params.page));
        if (params?.limit) q.set('limit', String(params.limit));
        return fetchWithAuth(`/attendance?${q}`);
    },
    upsertAttendance: (data: any) => fetchWithAuth('/attendance', { method: 'POST', body: JSON.stringify(data) }),
    deleteAttendance: (id: string) => fetchWithAuth(`/attendance/${id}`, { method: 'DELETE' }),
    getAttendanceSummary: (employeeId: string, year: number, month: number) =>
        fetchWithAuth(`/attendance/summary/${employeeId}?year=${year}&month=${month}`),
    // Leave Types
    getLeaveTypes: () => fetchWithAuth('/attendance/leave-types'),
    createLeaveType: (data: any) => fetchWithAuth('/attendance/leave-types', { method: 'POST', body: JSON.stringify(data) }),
    updateLeaveType: (id: string, data: any) => fetchWithAuth(`/attendance/leave-types/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    deleteLeaveType: (id: string) => fetchWithAuth(`/attendance/leave-types/${id}`, { method: 'DELETE' }),
    // Leave Balances
    getLeaveBalances: (employeeId: string) => fetchWithAuth(`/attendance/leave-balances/${employeeId}`),
    setLeaveBalance: (data: any) => fetchWithAuth('/attendance/leave-balances', { method: 'POST', body: JSON.stringify(data) }),
    // Leave Requests
    getLeaveRequests: (params?: { employeeId?: string; status?: string; page?: number; limit?: number }) => {
        const q = new URLSearchParams();
        if (params?.employeeId) q.set('employeeId', params.employeeId);
        if (params?.status) q.set('status', params.status);
        if (params?.page) q.set('page', String(params.page));
        if (params?.limit) q.set('limit', String(params.limit));
        return fetchWithAuth(`/attendance/leave-requests?${q}`);
    },
    createLeaveRequest: (data: any) => fetchWithAuth('/attendance/leave-requests', { method: 'POST', body: JSON.stringify(data) }),
    reviewLeaveRequest: (id: string, data: { status: string; approver_note?: string }) =>
        fetchWithAuth(`/attendance/leave-requests/${id}/review`, { method: 'PATCH', body: JSON.stringify(data) }),
    cancelLeaveRequest: (id: string) =>
        fetchWithAuth(`/attendance/leave-requests/${id}/cancel`, { method: 'PATCH' }),
    // In-app notifications
    getNotifications: () => fetchWithAuth('/notifications'),
    getNotificationUnreadCount: () => fetchWithAuth('/notifications/unread-count'),
    markNotificationRead: (id: string) => fetchWithAuth(`/notifications/${id}/read`, { method: 'PATCH' }),
    markAllNotificationsRead: () => fetchWithAuth('/notifications/read-all', { method: 'PATCH' }),
};
