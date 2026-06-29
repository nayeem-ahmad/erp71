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
    getProductGroups: () => fetchWithAuth('/product-groups?limit=100').then((r: any) => r?.items ?? r),
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
        if (!query.has('limit')) query.set('limit', '100');
        return fetchWithAuth(`/product-subgroups${query.toString() ? `?${query.toString()}` : ''}`).then((r: any) => r?.items ?? r);
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
    getStockTakes: () => fetchWithAuth('/stock-takes').then((r: any) => r?.items ?? r),
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
    getCustomerAnalytics: (id: string) => fetchWithAuth(`/customers/${id}/analytics`),
    getCustomerCreditLedger: (id: string, params?: { page?: number; limit?: number; from?: string; to?: string }) => {
        const query = new URLSearchParams();
        if (params?.page) query.set('page', String(params.page));
        if (params?.limit) query.set('limit', String(params.limit));
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        return fetchWithAuth(`/customers/${id}/credit${query.toString() ? `?${query.toString()}` : ''}`).then(
            (r: { transactions?: unknown[]; items?: unknown[] } | unknown[]) => {
                if (Array.isArray(r)) {
                    return { transactions: r, opening_balance: 0, closing_balance: 0, due_balance: 0 };
                }
                const transactions = r?.transactions ?? r?.items ?? [];
                return { ...r, transactions: Array.isArray(transactions) ? transactions : [] };
            },
        );
    },
    recordCreditPayment: (id: string, data: { amount: number; direction?: 'receive' | 'pay'; notes?: string }) => fetchWithAuth(`/customers/${id}/credit/payment`, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    getCustomerCreditPayments: (params?: {
        page?: number;
        limit?: number;
        from?: string;
        to?: string;
        customerId?: string;
        search?: string;
    }) => {
        const query = new URLSearchParams();
        if (params?.page) query.set('page', String(params.page));
        if (params?.limit) query.set('limit', String(params.limit));
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        if (params?.customerId) query.set('customerId', params.customerId);
        if (params?.search) query.set('search', params.search);
        return fetchWithAuth(`/customers/credit/payments${query.toString() ? `?${query.toString()}` : ''}`).then(
            (r: { items?: unknown[] } | unknown[]) => (Array.isArray(r) ? r : (r?.items ?? [])),
        );
    },
    getCustomerCreditPayment: (paymentId: string) => fetchWithAuth(`/customers/credit/payments/${paymentId}`),
    updateCustomerCreditPayment: (paymentId: string, data: { amount?: number; direction?: 'receive' | 'pay'; notes?: string }) =>
        fetchWithAuth(`/customers/credit/payments/${paymentId}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    deleteCustomerCreditPayment: (paymentId: string) =>
        fetchWithAuth(`/customers/credit/payments/${paymentId}`, { method: 'DELETE' }),
    getDueAgingReport: () => fetchWithAuth('/customers/reports/due-aging'),
    // CRM Interactions
    getCrmInteractions: (params?: { customerId?: string; page?: number; limit?: number }) => {
        const query = new URLSearchParams();
        if (params?.customerId) query.set('customerId', params.customerId);
        if (params?.page) query.set('page', String(params.page));
        if (params?.limit) query.set('limit', String(params.limit));
        return fetchWithAuth(`/crm/interactions${query.toString() ? `?${query.toString()}` : ''}`);
    },
    createCrmInteraction: (data: any) => fetchWithAuth('/crm/interactions', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    deleteCrmInteraction: (id: string) => fetchWithAuth(`/crm/interactions/${id}`, { method: 'DELETE' }),
    // CRM Leads
    getLeads: (params?: { status?: string; source?: string; category?: string; priority?: string; assignedTo?: string; search?: string; page?: number; limit?: number }) => {
        const query = new URLSearchParams();
        if (params?.status) query.set('status', params.status);
        if (params?.source) query.set('source', params.source);
        if (params?.category) query.set('category', params.category);
        if (params?.priority) query.set('priority', params.priority);
        if (params?.assignedTo) query.set('assignedTo', params.assignedTo);
        if (params?.search) query.set('search', params.search);
        if (params?.page) query.set('page', String(params.page));
        if (params?.limit) query.set('limit', String(params.limit));
        return fetchWithAuth(`/crm/leads${query.toString() ? `?${query.toString()}` : ''}`);
    },
    getLead: (id: string) => fetchWithAuth(`/crm/leads/${id}`),
    createLead: (data: any) => fetchWithAuth('/crm/leads', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    updateLead: (id: string, data: any) => fetchWithAuth(`/crm/leads/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    convertLead: (id: string) => fetchWithAuth(`/crm/leads/${id}/convert`, { method: 'POST' }),
    deleteLead: (id: string) => fetchWithAuth(`/crm/leads/${id}`, { method: 'DELETE' }),
    // CRM Lead Conversations
    getLeadConversations: (params?: { leadId?: string; page?: number; limit?: number }) => {
        const query = new URLSearchParams();
        if (params?.leadId) query.set('leadId', params.leadId);
        if (params?.page) query.set('page', String(params.page));
        if (params?.limit) query.set('limit', String(params.limit));
        return fetchWithAuth(`/crm/lead-conversations${query.toString() ? `?${query.toString()}` : ''}`);
    },
    createLeadConversation: (data: any) => fetchWithAuth('/crm/lead-conversations', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    deleteLeadConversation: (id: string) => fetchWithAuth(`/crm/lead-conversations/${id}`, { method: 'DELETE' }),
    // CRM Tasks
    getCrmTasks: (params?: {
        customerId?: string;
        leadId?: string;
        target?: 'customer' | 'lead';
        status?: string;
        dueToday?: boolean;
        page?: number;
        limit?: number;
    }) => {
        const query = new URLSearchParams();
        if (params?.customerId) query.set('customerId', params.customerId);
        if (params?.leadId) query.set('leadId', params.leadId);
        if (params?.target) query.set('target', params.target);
        if (params?.status) query.set('status', params.status);
        if (params?.dueToday) query.set('dueToday', 'true');
        if (params?.page) query.set('page', String(params.page));
        if (params?.limit) query.set('limit', String(params.limit));
        return fetchWithAuth(`/crm/tasks${query.toString() ? `?${query.toString()}` : ''}`);
    },
    getCrmTaskSummary: () => fetchWithAuth('/crm/tasks/summary'),
    createCrmTask: (data: any) => fetchWithAuth('/crm/tasks', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    updateCrmTask: (id: string, data: any) => fetchWithAuth(`/crm/tasks/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    deleteCrmTask: (id: string) => fetchWithAuth(`/crm/tasks/${id}`, { method: 'DELETE' }),
    // CRM Campaigns
    getCrmCampaigns: (params?: { page?: number; limit?: number }) => {
        const query = new URLSearchParams();
        if (params?.page) query.set('page', String(params.page));
        if (params?.limit) query.set('limit', String(params.limit));
        return fetchWithAuth(`/crm/campaigns${query.toString() ? `?${query.toString()}` : ''}`);
    },
    getCrmCampaign: (id: string) => fetchWithAuth(`/crm/campaigns/${id}`),
    previewCampaignRecipients: (id: string) => fetchWithAuth(`/crm/campaigns/${id}/preview`),
    createCrmCampaign: (data: any) => fetchWithAuth('/crm/campaigns', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    updateCrmCampaign: (id: string, data: any) => fetchWithAuth(`/crm/campaigns/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    sendCrmCampaign: (id: string) => fetchWithAuth(`/crm/campaigns/${id}/send`, { method: 'POST' }),
    deleteCrmCampaign: (id: string) => fetchWithAuth(`/crm/campaigns/${id}`, { method: 'DELETE' }),
    // Customer Groups
    getCustomerGroups: () => fetchWithAuth('/customer-groups?limit=100').then((r: any) => r?.items ?? r),
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
    // Price Lists
    getPriceLists: () => fetchWithAuth('/price-lists?limit=100').then((r: any) => r?.items ?? r),
    getPriceList: (id: string) => fetchWithAuth(`/price-lists/${id}`),
    createPriceList: (data: any) => fetchWithAuth('/price-lists', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    updatePriceList: (id: string, data: any) => fetchWithAuth(`/price-lists/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    deletePriceList: (id: string) => fetchWithAuth(`/price-lists/${id}`, { method: 'DELETE' }),
    getPriceListItems: (id: string, params?: { page?: number; limit?: number; search?: string }) => {
        const query = new URLSearchParams();
        if (params?.page) query.set('page', String(params.page));
        if (params?.limit) query.set('limit', String(params.limit));
        if (params?.search) query.set('search', params.search);
        const qs = query.toString();
        return fetchWithAuth(`/price-lists/${id}/items${qs ? `?${qs}` : ''}`);
    },
    updatePriceListItem: (listId: string, productId: string, data: any) => fetchWithAuth(`/price-lists/${listId}/items/${productId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    syncPriceListProducts: (id: string) => fetchWithAuth(`/price-lists/${id}/sync`, { method: 'POST' }),
    // Territories
    getTerritories: () => fetchWithAuth('/territories?limit=100').then((r: any) => r?.items ?? r),
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
    getReturns: () => fetchWithAuth('/sales-returns').then((r: any) => r?.items ?? r),
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
    getOrders: () => fetchWithAuth('/sales-orders').then((r: any) => r?.items ?? r),
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
    getBrands: () => fetchWithAuth('/brands?limit=100').then((r: any) => r?.items ?? r),
    createBrand: (data: any) => fetchWithAuth('/brands', { method: 'POST', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } }),
    updateBrand: (id: string, data: any) => fetchWithAuth(`/brands/${id}`, { method: 'PATCH', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } }),
    deleteBrand: (id: string) => fetchWithAuth(`/brands/${id}`, { method: 'DELETE' }),
    getSuppliers: () => fetchWithAuth('/suppliers?limit=100').then((r: any) => r?.items ?? r),
    getSupplierCreditLedger: (id: string, params?: { page?: number; limit?: number; from?: string; to?: string }) => {
        const query = new URLSearchParams();
        if (params?.page) query.set('page', String(params.page));
        if (params?.limit) query.set('limit', String(params.limit));
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        return fetchWithAuth(`/suppliers/${id}/credit${query.toString() ? `?${query.toString()}` : ''}`).then(
            (r: { transactions?: unknown[]; items?: unknown[] } | unknown[]) => {
                if (Array.isArray(r)) {
                    return { transactions: r, opening_balance: 0, closing_balance: 0, due_balance: 0 };
                }
                const transactions = r?.transactions ?? r?.items ?? [];
                return { ...r, transactions: Array.isArray(transactions) ? transactions : [] };
            },
        );
    },
    recordSupplierCreditPayment: (id: string, data: { amount: number; direction?: 'pay' | 'receive'; notes?: string }) =>
        fetchWithAuth(`/suppliers/${id}/credit/payment`, {
            method: 'POST',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    getSupplierCreditPayments: (params?: {
        page?: number;
        limit?: number;
        from?: string;
        to?: string;
        supplierId?: string;
        search?: string;
    }) => {
        const query = new URLSearchParams();
        if (params?.page) query.set('page', String(params.page));
        if (params?.limit) query.set('limit', String(params.limit));
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        if (params?.supplierId) query.set('supplierId', params.supplierId);
        if (params?.search) query.set('search', params.search);
        return fetchWithAuth(`/suppliers/credit/payments${query.toString() ? `?${query.toString()}` : ''}`).then(
            (r: { items?: unknown[] } | unknown[]) => (Array.isArray(r) ? r : (r?.items ?? [])),
        );
    },
    getSupplierCreditPayment: (paymentId: string) => fetchWithAuth(`/suppliers/credit/payments/${paymentId}`),
    updateSupplierCreditPayment: (paymentId: string, data: { amount?: number; direction?: 'pay' | 'receive'; notes?: string }) =>
        fetchWithAuth(`/suppliers/credit/payments/${paymentId}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    deleteSupplierCreditPayment: (paymentId: string) =>
        fetchWithAuth(`/suppliers/credit/payments/${paymentId}`, { method: 'DELETE' }),
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
    getPurchaseOrders: () => fetchWithAuth('/purchase-orders').then((r: any) => r?.items ?? r),
    getPurchaseOrder: (id: string) => fetchWithAuth(`/purchase-orders/${id}`),
    createPurchaseOrder: (data: any) => fetchWithAuth('/purchase-orders', { method: 'POST', body: JSON.stringify(data) }),
    updatePurchaseOrderStatus: (id: string, status: string) => fetchWithAuth(`/purchase-orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    getPurchaseOrderInvoice: (id: string) => fetchWithAuth(`/purchase-orders/${id}/invoice`),
    getPurchaseQuotations: () => fetchWithAuth('/purchase-quotations').then((r: any) => r?.items ?? r),
    getPurchaseQuotation: (id: string) => fetchWithAuth(`/purchase-quotations/${id}`),
    createPurchaseQuotation: (data: any) => fetchWithAuth('/purchase-quotations', { method: 'POST', body: JSON.stringify(data) }),
    updatePurchaseQuotationStatus: (id: string, status: string) => fetchWithAuth(`/purchase-quotations/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    convertPurchaseQuotation: (id: string) => fetchWithAuth(`/purchase-quotations/${id}/convert`, { method: 'POST' }),
    deletePurchaseQuotation: (id: string) => fetchWithAuth(`/purchase-quotations/${id}`, { method: 'DELETE' }),
    getPurchases: () => fetchWithAuth('/purchases').then((r: any) => r?.items ?? r),
    getPurchase: (id: string) => fetchWithAuth(`/purchases/${id}`),
    createPurchase: (data: any) => fetchWithAuth('/purchases', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    getPurchaseReturns: () => fetchWithAuth('/purchase-returns').then((r: any) => r?.items ?? r),
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
    getQuotations: () => fetchWithAuth('/sales-quotations').then((r: any) => r?.items ?? r),
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
    getDiscountCodes: () => fetchWithAuth('/discount-codes?limit=100').then((r: any) => r?.items ?? r),
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
    demoLogin: () => fetch(`${API_BASE}/auth/demo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
    }).then(async res => {
        const body = await res.json().catch(() => null);
        if (!res.ok) {
            throw new Error(body?.message || body?.error?.message || 'Demo account not available');
        }
        return body && 'data' in body ? body.data : body;
    }),
    login: (data: any) => fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }).then(async res => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error?.message || body?.message || 'Login failed');
        return body && 'data' in body ? body.data : body;
    }),
    verify2FALogin: (userId: string, code: string) => fetch(`${API_BASE}/auth/2fa/verify`, {
        method: 'POST',
        body: JSON.stringify({ userId, code }),
        headers: { 'Content-Type': 'application/json' },
    }).then(async res => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error?.message || body?.message || '2FA verification failed');
        return body && 'data' in body ? body.data : body;
    }),
    resendVerificationEmail: () => fetchWithAuth('/auth/resend-verification', { method: 'POST' }),
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
    setupTenant: (data: { tenantName: string; name: string; address?: string; planCode?: string; businessType?: string }) =>
        fetchWithAuth('/auth/setup-tenant', {
            method: 'POST',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
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
    getSmsCreditSummary: () => fetchWithAuth('/sms-credits/summary'),
    purchaseSmsCredits: (data: { packageId: string }) => fetchWithAuth('/sms-credits/purchase', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    confirmSmsCreditsPurchase: (data: { packageId: string; reference?: string }) => fetchWithAuth('/sms-credits/confirm', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
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
    createAdminTenant: (data: {
        ownerMode: 'new' | 'existing';
        ownerEmail?: string;
        ownerName?: string;
        ownerUserId?: string;
        tenantName: string;
        storeName: string;
        address?: string;
        businessType?: string;
        planCode: string;
    }) => fetchWithAuth('/admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    }),
    lookupAdminUser: (email: string) =>
        fetchWithAuth(`/admin/users/lookup?email=${encodeURIComponent(email)}`),
    getAdminMetrics: () => fetchWithAuth('/admin/metrics'),
    getSystemHealth: () => fetchWithAuth('/admin/system-health'),
    getSystemHealthJobs: () => fetchWithAuth('/admin/system-health/jobs'),
    getAdminUsers: (params?: { search?: string; page?: number; limit?: number }) => {
        const query = new URLSearchParams();
        if (params?.search) query.set('search', params.search);
        if (params?.page) query.set('page', String(params.page));
        if (params?.limit) query.set('limit', String(params.limit));
        return fetchWithAuth(`/admin/users${query.toString() ? `?${query.toString()}` : ''}`);
    },
    promoteUser: (userId: string) => fetchWithAuth(`/admin/users/${userId}/promote`, { method: 'POST' }),
    demoteUser: (userId: string) => fetchWithAuth(`/admin/users/${userId}/promote`, { method: 'DELETE' }),
    getAdminFeedback: (params?: { type?: string; search?: string; page?: number; limit?: number }) => {
        const query = new URLSearchParams();
        if (params?.type) query.set('type', params.type);
        if (params?.search) query.set('search', params.search);
        if (params?.page) query.set('page', String(params.page));
        if (params?.limit) query.set('limit', String(params.limit));
        return fetchWithAuth(`/admin/feedback${query.toString() ? `?${query.toString()}` : ''}`);
    },
    // Support chat (shop owner)
    getSupportThreads: () => fetchWithAuth('/support/threads'),
    createSupportThread: (data: { subject: string; body: string }) =>
        fetchWithAuth('/support/threads', {
            method: 'POST',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    getSupportMessages: (threadId: string) => fetchWithAuth(`/support/threads/${threadId}/messages`),
    sendSupportMessage: (threadId: string, body: string) =>
        fetchWithAuth(`/support/threads/${threadId}/messages`, {
            method: 'POST',
            body: JSON.stringify({ body }),
            headers: { 'Content-Type': 'application/json' },
        }),
    // Support chat (admin)
    getAdminSupportThreads: (params?: { status?: string; search?: string; page?: number; limit?: number }) => {
        const query = new URLSearchParams();
        if (params?.status) query.set('status', params.status);
        if (params?.search) query.set('search', params.search);
        if (params?.page) query.set('page', String(params.page));
        if (params?.limit) query.set('limit', String(params.limit));
        return fetchWithAuth(`/admin/support/threads${query.toString() ? `?${query.toString()}` : ''}`);
    },
    getAdminSupportMessages: (threadId: string) =>
        fetchWithAuth(`/admin/support/threads/${threadId}/messages`),
    sendAdminSupportMessage: (threadId: string, body: string) =>
        fetchWithAuth(`/admin/support/threads/${threadId}/messages`, {
            method: 'POST',
            body: JSON.stringify({ body }),
            headers: { 'Content-Type': 'application/json' },
        }),
    resolveThread: (threadId: string) =>
        fetchWithAuth(`/admin/support/threads/${threadId}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'resolved' }),
            headers: { 'Content-Type': 'application/json' },
        }),
    reopenThread: (threadId: string) =>
        fetchWithAuth(`/admin/support/threads/${threadId}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'open' }),
            headers: { 'Content-Type': 'application/json' },
        }),
    // Team & permissions (tenant-scoped staff management)
    getTeamMembers: () => fetchWithAuth('/team/members?limit=100').then((r: any) => r?.items ?? r),
    getTeamMember: (userId: string) => fetchWithAuth(`/team/members/${userId}`),
    getTeamStores: () => fetchWithAuth('/team/stores'),
    getTeamInvitations: () => fetchWithAuth('/team/invitations'),
    sendTeamInvitation: (data: { email: string; role: string }) => fetchWithAuth('/team/invitations', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    revokeTeamInvitation: (id: string) => fetchWithAuth(`/team/invitations/${id}`, { method: 'DELETE' }),
    updateMemberRole: (userId: string, data: { role: string; reseedPermissions?: boolean }) =>
        fetchWithAuth(`/team/members/${userId}/role`, {
            method: 'PATCH',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    grantMemberStoreAccess: (
        userId: string,
        data: { storeId: string; accessLevel: 'STORE_ONLY' | 'MULTI_STORE_CAPABLE'; seedDefaults?: boolean },
    ) =>
        fetchWithAuth(`/team/members/${userId}/stores`, {
            method: 'POST',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    revokeMemberStoreAccess: (userId: string, storeId: string) =>
        fetchWithAuth(`/team/members/${userId}/stores/${storeId}`, { method: 'DELETE' }),
    setMemberStorePermissions: (userId: string, storeId: string, permissions: string[]) =>
        fetchWithAuth(`/team/members/${userId}/stores/${storeId}/permissions`, {
            method: 'PUT',
            body: JSON.stringify({ permissions }),
            headers: { 'Content-Type': 'application/json' },
        }),
    removeMember: (userId: string) => fetchWithAuth(`/team/members/${userId}`, { method: 'DELETE' }),
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
    getWarrantyClaims: () => fetchWithAuth('/warranty-claims').then((r: any) => r?.items ?? r),
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
    updateDepartment: (id: string, data: { name: string }) => fetchWithAuth(`/employees/departments/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    deleteDepartment: (id: string) => fetchWithAuth(`/employees/departments/${id}`, { method: 'DELETE' }),
    getDesignations: () => fetchWithAuth('/employees/designations'),
    createDesignation: (data: { name: string }) => fetchWithAuth('/employees/designations', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    updateDesignation: (id: string, data: { name: string }) => fetchWithAuth(`/employees/designations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    deleteDesignation: (id: string) => fetchWithAuth(`/employees/designations/${id}`, { method: 'DELETE' }),
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
    getNotifications: () => fetchWithAuth('/notifications').then((r: any) => r?.items ?? r),
    getNotificationUnreadCount: () => fetchWithAuth('/notifications/unread-count'),
    markNotificationRead: (id: string) => fetchWithAuth(`/notifications/${id}/read`, { method: 'PATCH' }),
    markAllNotificationsRead: () => fetchWithAuth('/notifications/read-all', { method: 'PATCH' }),
    // Accounting — Mid-Size Features
    getTrialBalance: (params?: { asOfDate?: string }) => {
        const q = new URLSearchParams();
        if (params?.asOfDate) q.set('asOfDate', params.asOfDate);
        return fetchWithAuth(`/accounting/reports/trial-balance${q.toString() ? `?${q}` : ''}`);
    },
    getArAging: (params?: { asOfDate?: string }) => {
        const q = new URLSearchParams();
        if (params?.asOfDate) q.set('asOfDate', params.asOfDate);
        return fetchWithAuth(`/accounting/reports/ar-aging${q.toString() ? `?${q}` : ''}`);
    },
    getApAging: (params?: { asOfDate?: string }) => {
        const q = new URLSearchParams();
        if (params?.asOfDate) q.set('asOfDate', params.asOfDate);
        return fetchWithAuth(`/accounting/reports/ap-aging${q.toString() ? `?${q}` : ''}`);
    },
    getComparativePL: (params?: { from?: string; to?: string }) => {
        const q = new URLSearchParams();
        if (params?.from) q.set('from', params.from);
        if (params?.to) q.set('to', params.to);
        return fetchWithAuth(`/accounting/reports/comparative-pl${q.toString() ? `?${q}` : ''}`);
    },
    getVatTaxReport: (params?: { from?: string; to?: string }) => {
        const q = new URLSearchParams();
        if (params?.from) q.set('from', params.from);
        if (params?.to) q.set('to', params.to);
        return fetchWithAuth(`/accounting/reports/vat-tax${q.toString() ? `?${q}` : ''}`);
    },
    getFinancialRatios: (params?: { asOfDate?: string; from?: string; to?: string }) => {
        const q = new URLSearchParams();
        if (params?.asOfDate) q.set('asOfDate', params.asOfDate);
        if (params?.from) q.set('from', params.from);
        if (params?.to) q.set('to', params.to);
        return fetchWithAuth(`/accounting/reports/financial-ratios${q.toString() ? `?${q}` : ''}`);
    },
    getCashFlow: (params?: { from?: string; to?: string }) => {
        const q = new URLSearchParams();
        if (params?.from) q.set('from', params.from);
        if (params?.to) q.set('to', params.to);
        return fetchWithAuth(`/accounting/reports/cash-flow${q.toString() ? `?${q}` : ''}`);
    },
    // Fiscal Periods
    getFiscalPeriods: (params?: { year?: number }) => {
        const q = new URLSearchParams();
        if (params?.year) q.set('year', String(params.year));
        return fetchWithAuth(`/accounting/settings/fiscal-periods${q.toString() ? `?${q}` : ''}`);
    },
    lockFiscalPeriod: (data: { year: number; month: number }) =>
        fetchWithAuth('/accounting/settings/fiscal-periods/lock', { method: 'POST', body: JSON.stringify(data) }),
    unlockFiscalPeriod: (data: { year: number; month: number }) =>
        fetchWithAuth('/accounting/settings/fiscal-periods/unlock', { method: 'POST', body: JSON.stringify(data) }),
    // Opening Balances
    importOpeningBalances: (data: any) =>
        fetchWithAuth('/accounting/opening-balances', { method: 'POST', body: JSON.stringify(data) }),
    // Budget vs Actual
    upsertBudget: (data: any) =>
        fetchWithAuth('/accounting/budgets', { method: 'POST', body: JSON.stringify(data) }),
    getBudgetVsActual: (params: { fiscalYear: number; month?: number }) => {
        const q = new URLSearchParams();
        q.set('fiscalYear', String(params.fiscalYear));
        if (params.month) q.set('month', String(params.month));
        return fetchWithAuth(`/accounting/reports/budget-vs-actual?${q}`);
    },
    // Cost Centers
    listCostCenters: () => fetchWithAuth('/accounting/cost-centers'),
    createCostCenter: (data: any) =>
        fetchWithAuth('/accounting/cost-centers', { method: 'POST', body: JSON.stringify(data) }),
    getCostCenterPL: (params: { costCenterId: string; from?: string; to?: string }) => {
        const q = new URLSearchParams();
        q.set('costCenterId', params.costCenterId);
        if (params.from) q.set('from', params.from);
        if (params.to) q.set('to', params.to);
        return fetchWithAuth(`/accounting/reports/cost-center-pl?${q}`);
    },
    // Fixed Assets
    listFixedAssets: () => fetchWithAuth('/accounting/fixed-assets'),
    createFixedAsset: (data: any) =>
        fetchWithAuth('/accounting/fixed-assets', { method: 'POST', body: JSON.stringify(data) }),
    runDepreciation: (data: { year: number; month: number }) =>
        fetchWithAuth('/accounting/fixed-assets/run-depreciation', { method: 'POST', body: JSON.stringify(data) }),
    getDepreciationSchedule: (id: string) => fetchWithAuth(`/accounting/fixed-assets/${id}/schedule`),
    // Recurring Journals
    listRecurringJournals: () => fetchWithAuth('/accounting/recurring-journals'),
    createRecurringJournal: (data: any) =>
        fetchWithAuth('/accounting/recurring-journals', { method: 'POST', body: JSON.stringify(data) }),
    postRecurringJournal: (id: string) =>
        fetchWithAuth(`/accounting/recurring-journals/${id}/post`, { method: 'POST' }),
    // Bank Reconciliation
    createBankReconciliation: (data: any) =>
        fetchWithAuth('/accounting/bank-reconciliations', { method: 'POST', body: JSON.stringify(data) }),
    importBankStatementEntries: (data: any) =>
        fetchWithAuth('/accounting/bank-reconciliations/import', { method: 'POST', body: JSON.stringify(data) }),
    autoMatchBankEntries: (id: string) =>
        fetchWithAuth(`/accounting/bank-reconciliations/${id}/auto-match`, { method: 'POST' }),
    matchBankEntry: (data: any) =>
        fetchWithAuth('/accounting/bank-reconciliations/match-entry', { method: 'POST', body: JSON.stringify(data) }),
    getBankReconciliationReport: (id: string) => fetchWithAuth(`/accounting/bank-reconciliations/${id}/report`),
    // Team invitations (settings flow)
    getPendingInvitations: () => fetchWithAuth('/invitations/pending'),
    sendInvitation: (data: { email: string; role: string }) => fetchWithAuth('/invitations/send', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    cancelInvitation: (id: string) => fetchWithAuth(`/invitations/${id}`, { method: 'DELETE' }),
    getInvitationInfo: (token: string) => fetch(`${API_BASE}/invitations/info?token=${encodeURIComponent(token)}`).then(async (response) => {
        if (!response.ok) {
            let message = 'Invalid or expired invitation';
            try {
                const errorBody = await response.json();
                const apiMessage = Array.isArray(errorBody?.message)
                    ? errorBody.message.join(', ')
                    : errorBody?.message || errorBody?.error;
                if (apiMessage) message = apiMessage;
            } catch {
                // ignore
            }
            throw new Error(message);
        }
        return response.json().then((body) => (body?.data !== undefined ? body.data : body));
    }),
    getLoyaltySettings: () => fetchWithAuth('/loyalty/settings'),
    getCustomerLoyaltyPoints: (customerId: string) => fetchWithAuth(`/loyalty/customers/${customerId}/points`),
    getAuditLogs: (params?: {
        entity?: string;
        action?: string;
        from?: string;
        to?: string;
        limit?: number;
        offset?: number;
    }) => {
        const q = new URLSearchParams();
        if (params?.entity) q.set('entity', params.entity);
        if (params?.action) q.set('action', params.action);
        if (params?.from) q.set('from', params.from);
        if (params?.to) q.set('to', params.to);
        if (params?.limit) q.set('limit', String(params.limit));
        if (params?.offset) q.set('offset', String(params.offset));
        const query = q.toString();
        return fetchWithAuth(`/audit-logs${query ? `?${query}` : ''}`);
    },
    getExpenseCategories: () => fetchWithAuth('/expenses/categories'),
    createExpenseCategory: (data: { name: string; description?: string }) => fetchWithAuth('/expenses/categories', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    updateExpenseCategory: (id: string, data: { name?: string; description?: string }) => fetchWithAuth(`/expenses/categories/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    deleteExpenseCategory: (id: string) => fetchWithAuth(`/expenses/categories/${id}`, { method: 'DELETE' }),
    getExpenseEntries: (params?: { page?: number; limit?: number; from?: string; to?: string; categoryId?: string }) => {
        const q = new URLSearchParams();
        if (params?.page) q.set('page', String(params.page));
        if (params?.limit) q.set('limit', String(params.limit));
        if (params?.from) q.set('from', params.from);
        if (params?.to) q.set('to', params.to);
        if (params?.categoryId) q.set('categoryId', params.categoryId);
        return fetchWithAuth(`/expenses/entries?${q}`);
    },
    createExpenseEntry: (data: any) => fetchWithAuth('/expenses/entries', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    updateExpenseEntry: (id: string, data: any) => fetchWithAuth(`/expenses/entries/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    deleteExpenseEntry: (id: string) => fetchWithAuth(`/expenses/entries/${id}`, { method: 'DELETE' }),
    getExpenseSummary: (params?: { from?: string; to?: string }) => {
        const q = new URLSearchParams();
        if (params?.from) q.set('from', params.from);
        if (params?.to) q.set('to', params.to);
        return fetchWithAuth(`/expenses/summary?${q}`);
    },
    // Loans
    getLoans: (params?: { page?: number; limit?: number; direction?: string; status?: string; storeId?: string; search?: string }) => {
        const q = new URLSearchParams();
        if (params?.page) q.set('page', String(params.page));
        if (params?.limit) q.set('limit', String(params.limit));
        if (params?.direction) q.set('direction', params.direction);
        if (params?.status) q.set('status', params.status);
        if (params?.storeId) q.set('storeId', params.storeId);
        if (params?.search) q.set('search', params.search);
        return fetchWithAuth(`/loans?${q}`);
    },
    getLoanSummary: () => fetchWithAuth('/loans/summary'),
    getLoan: (id: string) => fetchWithAuth(`/loans/${id}`),
    createLoan: (data: any) => fetchWithAuth('/loans', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    updateLoan: (id: string, data: any) => fetchWithAuth(`/loans/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    deleteLoan: (id: string) => fetchWithAuth(`/loans/${id}`, { method: 'DELETE' }),
    addLoanPayment: (id: string, data: any) => fetchWithAuth(`/loans/${id}/payments`, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    deleteLoanPayment: (id: string, paymentId: string) => fetchWithAuth(`/loans/${id}/payments/${paymentId}`, { method: 'DELETE' }),
    // Salary Payments
    getSalaryPayments: (params?: { page?: number; limit?: number; employeeId?: string; payPeriod?: string; from?: string; to?: string }) => {
        const q = new URLSearchParams();
        q.set('limit', String(params?.limit ?? 100));
        if (params?.page) q.set('page', String(params.page));
        if (params?.employeeId) q.set('employeeId', params.employeeId);
        if (params?.payPeriod) q.set('payPeriod', params.payPeriod);
        if (params?.from) q.set('from', params.from);
        if (params?.to) q.set('to', params.to);
        return fetchWithAuth(`/salary-payments?${q.toString()}`);
    },
    getSalaryPayment: (id: string) => fetchWithAuth(`/salary-payments/${id}`),
    createSalaryPayment: (data: {
        employeeId: string;
        amount: number;
        payPeriod: string;
        paymentDate: string;
        paymentMethod?: string;
        notes?: string;
    }) => fetchWithAuth('/salary-payments', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    updateSalaryPayment: (id: string, data: Record<string, unknown>) => fetchWithAuth(`/salary-payments/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    deleteSalaryPayment: (id: string) => fetchWithAuth(`/salary-payments/${id}`, { method: 'DELETE' }),
    getSalaryPaymentSummary: (params?: { from?: string; to?: string }) => {
        const q = new URLSearchParams();
        if (params?.from) q.set('from', params.from);
        if (params?.to) q.set('to', params.to);
        return fetchWithAuth(`/salary-payments/summary?${q}`);
    },
    acceptInvitation: (token: string) => fetchWithAuth('/invitations/accept', {
        method: 'POST',
        body: JSON.stringify({ token }),
        headers: { 'Content-Type': 'application/json' },
    }),
    getAiUsage: () => fetchWithAuth('/ai/usage'),
    aiNarrateReport: (data: { reportType: string; reportData: Record<string, unknown>; locale?: string }) =>
        fetchWithAuth('/ai/narrate-report', {
            method: 'POST',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    aiDraftMessage: (data: { channel: string; purpose: string; customerContext: Record<string, unknown>; locale?: string }) =>
        fetchWithAuth('/ai/draft-message', {
            method: 'POST',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    // Payment Methods
    getPaymentMethods: (type?: string) => {
        const q = type ? `?type=${type}` : '';
        return fetchWithAuth(`/payment-methods${q}`);
    },
    createPaymentMethod: (data: any) => fetchWithAuth('/payment-methods', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    updatePaymentMethod: (id: string, data: any) => fetchWithAuth(`/payment-methods/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    deletePaymentMethod: (id: string) => fetchWithAuth(`/payment-methods/${id}`, { method: 'DELETE' }),
    // Sales Settings
    getSalesSettings: () => fetchWithAuth('/sales-settings'),
    updateSalesSettings: (data: any) => fetchWithAuth('/sales-settings', {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    // New Sales
    createNewSale: (data: any) => fetchWithAuth('/sales', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    updateProfileAvatar: (formData: FormData) =>
        fetchWithAuth('/auth/me/avatar', {
            method: 'PATCH',
            body: formData,
        }),
    searchProductsByQuantity: (query: string, limit?: number) => {
        const q = new URLSearchParams();
        q.set('q', query);
        if (limit) q.set('limit', String(limit));
        return fetchWithAuth(`/products/search/by-quantity?${q}`);
    },
    getCurrentUser: () => fetchWithAuth('/auth/me'),
};
