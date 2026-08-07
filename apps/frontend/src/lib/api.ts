import type {
    AiChatConversationDetail,
    AiChatConversationSummary,
    AiChatResponse,
    DashboardPreference,
    PlatformFeatureKey,
    PlatformFeatures,
    TenantFeatureOverrides,
} from '@erp71/shared-types';
import type { ReferralCommissionStatus } from '@/components/admin/referrals/types';
import { normalizeApiBase } from './api-base';
import { handleExpiredSession } from './session-expiry';

/** Per-tenant feature state: platform defaults, this tenant's overrides, and the result. */
export type AdminTenantFeatures = {
    platform_defaults: PlatformFeatures;
    overrides: TenantFeatureOverrides;
    effective: PlatformFeatures;
};

/**
 * One tenant's own outbound sender, as a platform admin sees it. Everything
 * blank plus both switches off means "this tenant sends from the platform
 * sender", which is the state every workspace starts in. The access token comes
 * back masked — sending the mask straight back leaves the stored value alone.
 */
export type AdminTenantMessagingIdentity = {
    email_enabled: boolean;
    email_from: string;
    email_from_name: string;
    email_reply_to: string;
    whatsapp_enabled: boolean;
    whatsapp_phone_number_id: string;
    whatsapp_access_token: string;
    whatsapp_api_version: string;
    notes: string;
    updated_at: string | null;
    updated_by: string | null;
};

/** A tenant's active/trialing add-on subscription, as shown to a platform admin. */
export type AdminTenantAddonSubscription = {
    addon: {
        id: string;
        code: string;
        name: string;
        features_json: Record<string, boolean | number>;
    };
    status: 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'TRIALING';
    current_period_start: string;
    current_period_end: string;
    cancel_at_period_end: boolean;
};

const DEFAULT_PROD_API_BASE = 'https://erp71-backend.onrender.com';
// In dev (remote container) use a relative path so browser calls go to the
// Next.js dev server which proxies them to the backend via next.config rewrites.
// In production keep the explicit backend URL.
//
// `normalizeApiBase` lives in ./api-base so the server-side public routes
// (/s, /q, /store/../p, /r) apply the identical `/api/v1` rule instead of each
// re-deriving it — see that file for why that mattered.
const API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_API_BASE || process.env.NEXT_PUBLIC_API_URL)
    || (process.env.NODE_ENV === 'production' ? `${DEFAULT_PROD_API_BASE}/api/v1` : '/api/v1');

/**
 * An API failure that keeps its HTTP status.
 *
 * Callers used to branch on substrings of the server's message, which silently
 * stops working the moment that copy is reworded. Extends `Error`, so existing
 * `error.message` handling is unaffected.
 */
export class ApiError extends Error {
    constructor(message: string, public readonly status: number) {
        super(message);
        this.name = 'ApiError';
    }
}

/** Read an auth token from localStorage first, falling back to sessionStorage. */
function getAccessToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('access_token') ?? sessionStorage.getItem('access_token');
}

export async function fetchBlobWithAuth(endpoint: string, options: RequestInit = {}): Promise<{ blob: Blob; filename: string }> {
    const token = getAccessToken();
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
        // Only authenticated endpoints reach here, so a 401 means the session died.
        if (response.status === 401) {
            handleExpiredSession();
        }
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
        throw new ApiError(message, response.status);
    }

    const disposition = response.headers.get('Content-Disposition') ?? '';
    const filenameMatch = disposition.match(/filename="([^"]+)"/);
    const filename = filenameMatch ? filenameMatch[1] : 'export';

    const blob = await response.blob();
    return { blob, filename };
}

/**
 * Core authenticated request. Returns the FULL parsed response body, including
 * the `{ data, meta }` envelope the backend's TransformInterceptor produces for
 * paginated endpoints. Most callers should use `fetchWithAuth` (which unwraps
 * `.data`); paginated callers use `fetchPaginated` (which also reads `meta`).
 */
async function requestWithAuth(endpoint: string, options: RequestInit = {}): Promise<any> {
    const token = getAccessToken();
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
    if (options.body && !headers.has('Content-Type') && !(options.body instanceof FormData)) {
        headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
    });

    if (!response.ok) {
        // Only authenticated endpoints reach here, so a 401 means the session died.
        if (response.status === 401) {
            handleExpiredSession();
        }

        let message = `API error: ${response.statusText}`;

        try {
            const errorBody = await response.json();
            const nested = errorBody?.error;
            const apiMessage = typeof nested === 'object' && nested !== null && nested.message
                ? (Array.isArray(nested.message) ? nested.message.join(', ') : nested.message)
                : Array.isArray(errorBody?.message)
                    ? errorBody.message.join(', ')
                    : typeof errorBody?.message === 'string'
                        ? errorBody.message
                        : typeof errorBody?.error === 'string'
                            ? errorBody.error
                            : undefined;

            if (apiMessage) {
                message = apiMessage;
            }
        } catch {
            // Fall back to the response status text when no JSON error payload is available.
        }

        throw new ApiError(message, response.status);
    }

    return response.json();
}

export async function fetchWithAuth(endpoint: string, options: RequestInit = {}) {
    const json = await requestWithAuth(endpoint, options);
    // Backend wraps all responses in { data: T } — unwrap transparently
    return json && typeof json === 'object' && 'data' in json ? json.data : json;
}

export interface Paginated<T = any> {
    items: T[];
    total: number;
    page: number;
    limit: number;
    pages: number;
}

/**
 * Fetch a paginated list endpoint, preserving the server total.
 *
 * The backend's TransformInterceptor reshapes a `{ items, total, page, limit, pages }`
 * result into `{ data: items, meta: { total, page, limit, pages } }`. Plain
 * `fetchWithAuth` unwraps `.data` and DROPS `meta`, so the caller loses the real
 * total (and can only ever see one page's worth of rows). This helper reads
 * `meta` back into a normal `{ items, total, page, limit, pages }` envelope for
 * server-side pagination. Falls back gracefully for endpoints that return a bare
 * array or an un-wrapped paginated object.
 */
export async function fetchPaginated<T = any>(endpoint: string, options: RequestInit = {}): Promise<Paginated<T>> {
    const json = await requestWithAuth(endpoint, options);

    // `{ data: { items } }` is what the interceptor produces for a service that returns an
    // `{ items }` object without pagination meta — the totals below then fall back to the
    // row count, which is correct for those endpoints since they return the whole set.
    const items: T[] = Array.isArray(json?.data)
        ? json.data
        : Array.isArray(json?.data?.items)
            ? json.data.items
            : Array.isArray(json?.items)
                ? json.items
                : Array.isArray(json)
                    ? json
                    : [];
    const meta = (json && typeof json === 'object' && json.meta) ? json.meta : {};
    const inner = (json && typeof json === 'object' && json.data && typeof json.data === 'object') ? json.data : {};
    const total = typeof meta.total === 'number'
        ? meta.total
        : typeof json?.total === 'number'
            ? json.total
            : typeof inner.total === 'number'
                ? inner.total
                : items.length;
    const page = meta.page ?? json?.page ?? inner.page ?? 1;
    const limit = meta.limit ?? json?.limit ?? inner.limit ?? items.length;
    const pages = meta.pages ?? json?.pages ?? inner.pages ?? 1;

    return { items, total, page, limit, pages };
}

/** Backend `PaginationDto` caps `limit` at 100, so that is the largest useful page. */
const MAX_PAGE_SIZE = 100;
/** Backstop against an endpoint that never reports a shrinking remainder. */
const MAX_PAGES_FETCHED = 100;

/**
 * Fetch every page of a paginated list endpoint and return the rows as one flat array.
 *
 * For lookup data — dropdown options, autocomplete sources, id→name maps — where the
 * caller genuinely needs the whole set. Previously these called the endpoint once with
 * `limit=100` and silently dropped row 101 onward, so a tenant with 400 suppliers saw
 * 100 in the supplier picker with nothing indicating the rest existed.
 *
 * Do NOT use this to populate a table. Tables should page against the server via
 * `fetchPaginated` + `useServerList`; pulling every row to count them defeats the point.
 */
export async function fetchAllPages<T = any>(endpoint: string): Promise<T[]> {
    const join = endpoint.includes('?') ? '&' : '?';
    const first = await fetchPaginated<T>(`${endpoint}${join}page=1&limit=${MAX_PAGE_SIZE}`);
    const all = [...first.items];

    // A non-paginated endpoint reports total === items.length, so this loop never runs.
    const pages = Math.min(first.pages || 1, MAX_PAGES_FETCHED);
    for (let page = 2; page <= pages; page++) {
        const next = await fetchPaginated<T>(`${endpoint}${join}page=${page}&limit=${MAX_PAGE_SIZE}`);
        if (!next.items.length) break;
        all.push(...next.items);
    }
    return all;
}

/**
 * Cursor-pagination equivalent of `fetchAllPages`, for endpoints built on
 * `cursorPaginate` ({ items, nextCursor, hasMore }) rather than page/limit.
 */
export async function fetchAllCursorPages<T = any>(endpoint: string): Promise<T[]> {
    const join = endpoint.includes('?') ? '&' : '?';
    const all: T[] = [];
    let cursor: string | null = null;

    for (let fetched = 0; fetched < MAX_PAGES_FETCHED; fetched++) {
        const qs = `${join}limit=${MAX_PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        const page = await fetchWithAuth(`${endpoint}${qs}`);
        const items: T[] = Array.isArray(page) ? page : (page?.items ?? []);
        all.push(...items);
        if (!page?.hasMore || !page?.nextCursor || !items.length) break;
        cursor = page.nextCursor;
    }
    return all;
}

export type ReportScope = 'branch' | 'company' | 'compare';

export type ReportScopeParams = {
    scope?: ReportScope;
    storeId?: string;
    storeIds?: string[];
    includeCompanyBucket?: boolean;
};

/** Row granularity, supported by the COA-grained reports (P&L, balance sheet, trial balance). */
export type ReportLevel = 'account' | 'subgroup' | 'group';

export type ReportLevelParams = { level?: ReportLevel };

/**
 * Per-request override of the tenant's `reports_approved_only` setting. Omitted,
 * the server falls back to that setting — so `undefined` is meaningful and must
 * not be coerced to false.
 */
export type ApprovedOnlyParams = { approvedOnly?: boolean };

export type CustomFieldDef = { key: string; label: string; order: number };

/**
 * The tenant-managed CRM lookup lists, all served by `/crm/lead-taxonomy/:kind`
 * and all edited from the CRM Setup screen.
 */
export type CrmListKind = 'sources' | 'categories' | 'channels';

export type ExternalSyncTally = { created: number; updated: number; skipped: number };

export type ExternalSyncWarning = {
    entity: string;
    externalId: string;
    code: string;
    message: string;
};

export type ExternalSyncConnection = {
    id: string;
    tenant_id: string;
    provider: string;
    base_url: string;
    username: string;
    external_org_id: string | null;
    store_id: string;
    store?: { id: string; name: string };
    document_prefix: string;
    enabled: boolean;
    post_impacts: boolean;
    window_days: number;
    history_start_date: string | null;
    last_run_at: string | null;
    last_success_at: string | null;
    hasPassword: boolean;
    nextWindowFrom: string;
};

export type ExternalSyncStep =
    | 'MASTERS'
    | 'SALES'
    | 'PURCHASES'
    | 'CUSTOMER_PAYMENTS'
    | 'SUPPLIER_PAYMENTS'
    | 'SALE_RETURNS';

export type ExternalSyncRun = {
    id: string;
    trigger: 'MANUAL' | 'SCHEDULED';
    status: 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'CANCELLED';
    /** What the run is doing right now; null once finished. */
    phase: string | null;
    progress: { done: number; total: number; warnings: number } | null;
    steps: ExternalSyncStep[] | null;
    window_from: string;
    window_to: string;
    dry_run: boolean;
    stats: Record<
        | 'products'
        | 'customers'
        | 'suppliers'
        | 'sales'
        | 'purchases'
        | 'customerPayments'
        | 'supplierPayments'
        | 'saleReturns',
        ExternalSyncTally
    > | null;
    warnings: ExternalSyncWarning[] | null;
    error_message: string | null;
    started_at: string;
    finished_at: string | null;
};

function appendReportScopeParams(
    query: URLSearchParams,
    params?: ReportScopeParams & ReportLevelParams & ApprovedOnlyParams,
) {
    if (params?.scope) query.set('scope', params.scope);
    if (params?.storeId) query.set('storeId', params.storeId);
    if (params?.storeIds?.length) query.set('storeIds', params.storeIds.join(','));
    if (params?.includeCompanyBucket) query.set('includeCompanyBucket', 'true');
    if (params?.level) query.set('level', params.level);
    appendApprovedOnly(query, params);
}

/** `false` is a real instruction ("include pending"), so only undefined is dropped. */
function appendApprovedOnly(query: URLSearchParams, params?: ApprovedOnlyParams) {
    if (params?.approvedOnly !== undefined) query.set('approvedOnly', String(params.approvedOnly));
}

/**
 * Serialises a flat report filter object, dropping empty values.
 *
 * `offset: 0` and `includeX: false` are meaningful and must survive, so this
 * tests for null/undefined/'' rather than falsiness — the shorthand would
 * silently drop the first page of every paged report.
 */
function buildReportQuery(params: Record<string, string | number | boolean | undefined | null>): string {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === '') continue;
        query.set(key, String(value));
    }
    return query.toString();
}

/** Filters shared by the conversations list and its summary tiles. */
export type LeadConversationFilters = {
    leadId?: string;
    search?: string;
    type?: string;
    direction?: string;
    createdBy?: string;
    /** `true` narrows to the caller's own conversations; the server resolves the id. */
    mine?: boolean;
    dateFrom?: string;
    dateTo?: string;
    leadStatus?: string;
    leadAssignedTo?: string;
    sortBy?: string;
    sortDir?: string;
};

function leadConversationQuery(
    params?: LeadConversationFilters & { page?: number; limit?: number },
): string {
    if (!params) return '';
    const { mine, ...rest } = params;
    const query = buildReportQuery({ ...rest, mine: mine ? 'true' : undefined });
    return query ? `?${query}` : '';
}

/**
 * Every module dashboard endpoint takes the same optional window and answers in
 * one payload, so they share one caller rather than seven copies of this.
 */
function dashboardWindowFetcher(path: string) {
    return (params?: { from?: string; to?: string }) => {
        const query = new URLSearchParams();
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        return fetchWithAuth(`${path}${query.toString() ? `?${query.toString()}` : ''}`);
    };
}

export const api = {
    /**
     * Every product as a flat array — for pickers, POS and id→product maps.
     * Use `getProductsPaged` for the products table; this walks all pages.
     */
    getProducts: (params?: { groupId?: string; subgroupId?: string; uncategorized?: boolean }) => {
        const query = new URLSearchParams();
        if (params?.groupId) query.set('groupId', params.groupId);
        if (params?.subgroupId) query.set('subgroupId', params.subgroupId);
        if (params?.uncategorized) query.set('uncategorized', 'true');
        return fetchAllPages(`/products${query.toString() ? `?${query.toString()}` : ''}`);
    },
    getProductsPaged: (params?: {
        groupId?: string;
        subgroupId?: string;
        uncategorized?: boolean;
        search?: string;
        stockStatus?: string;
        page?: number;
        limit?: number;
        sortBy?: string;
        sortDir?: string;
    }) => {
        const query = new URLSearchParams();
        if (params?.groupId) query.set('groupId', params.groupId);
        if (params?.subgroupId) query.set('subgroupId', params.subgroupId);
        if (params?.uncategorized) query.set('uncategorized', 'true');
        if (params?.search) query.set('search', params.search);
        if (params?.stockStatus) query.set('stockStatus', params.stockStatus);
        if (params?.page) query.set('page', String(params.page));
        if (params?.limit) query.set('limit', String(params.limit));
        if (params?.sortBy) query.set('sortBy', params.sortBy);
        if (params?.sortDir) query.set('sortDir', params.sortDir);
        return fetchPaginated(`/products${query.toString() ? `?${query.toString()}` : ''}`);
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
    getProductGroups: () => fetchAllPages('/product-groups'),
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
    importProductGroups: (rows: Record<string, unknown>[], mode: 'skip' | 'upsert') =>
        fetchWithAuth('/product-groups/import', {
            method: 'POST',
            body: JSON.stringify({ rows, mode }),
            headers: { 'Content-Type': 'application/json' },
        }),
    getProductSubgroups: (params?: { groupId?: string }) => {
        const query = new URLSearchParams();
        if (params?.groupId) query.set('groupId', params.groupId);
        return fetchAllPages(`/product-subgroups${query.toString() ? `?${query.toString()}` : ''}`);
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
    importProductSubgroups: (rows: Record<string, unknown>[], mode: 'skip' | 'upsert') =>
        fetchWithAuth('/product-subgroups/import', {
            method: 'POST',
            body: JSON.stringify({ rows, mode }),
            headers: { 'Content-Type': 'application/json' },
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
    importWarehouses: (rows: Record<string, unknown>[], mode: 'skip' | 'upsert') =>
        fetchWithAuth('/inventory/warehouses/import', {
            method: 'POST',
            body: JSON.stringify({ rows, mode }),
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
    getInventoryLedger: (params?: {
        productId?: string;
        warehouseId?: string;
        movementType?: string;
        from?: string;
        to?: string;
        page?: number;
        limit?: number;
        sortBy?: string;
        sortDir?: string;
    }) => {
        const query = new URLSearchParams();
        if (params?.productId) query.set('productId', params.productId);
        if (params?.warehouseId) query.set('warehouseId', params.warehouseId);
        if (params?.movementType) query.set('movementType', params.movementType);
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        if (params?.page) query.set('page', String(params.page));
        if (params?.limit) query.set('limit', String(params.limit));
        if (params?.sortBy) query.set('sortBy', params.sortBy);
        if (params?.sortDir) query.set('sortDir', params.sortDir);
        return fetchPaginated(`/inventory/ledger${query.toString() ? `?${query.toString()}` : ''}`);
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
    getStockTakes: () => fetchAllPages('/stock-takes'),
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
    getStockOnHand: (params?: { warehouseId?: string; groupId?: string; subgroupId?: string; brandId?: string; includeZeroStock?: boolean }) => {
        const query = new URLSearchParams();
        if (params?.warehouseId) query.set('warehouseId', params.warehouseId);
        if (params?.groupId) query.set('groupId', params.groupId);
        if (params?.subgroupId) query.set('subgroupId', params.subgroupId);
        if (params?.brandId) query.set('brandId', params.brandId);
        if (params?.includeZeroStock) query.set('includeZeroStock', 'true');
        return fetchWithAuth(`/inventory-reports/stock-on-hand${query.toString() ? `?${query.toString()}` : ''}`);
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
    getSalesByCategory: (params?: { storeId?: string; from?: string; to?: string }) => {
        const query = new URLSearchParams();
        if (params?.storeId) query.set('storeId', params.storeId);
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        return fetchWithAuth(`/sales-reports/by-category${query.toString() ? `?${query.toString()}` : ''}`);
    },
    getSalesTrend: (params: {
        from: string;
        to: string;
        storeId?: string;
        granularity?: 'day' | 'week' | 'month';
        compareTo?: 'previous_period' | 'previous_year';
    }) => {
        const query = buildReportQuery(params);
        return fetchWithAuth(`/sales-reports/trend?${query}`);
    },
    getSalesBreakdown: (params: {
        from: string;
        to: string;
        groupBy: 'product' | 'category' | 'brand' | 'branch' | 'customer' | 'payment_method' | 'staff' | 'hour_of_day' | 'day_of_week';
        storeId?: string;
        compareTo?: 'previous_period' | 'previous_year';
        limit?: number;
        offset?: number;
    }) => {
        const query = buildReportQuery(params);
        return fetchWithAuth(`/sales-reports/breakdown?${query}`);
    },
    getTopMovers: (params: {
        from: string;
        to: string;
        dimension?: 'product' | 'category' | 'brand' | 'branch' | 'customer';
        storeId?: string;
        compareTo?: 'previous_period' | 'previous_year';
        limit?: number;
    }) => {
        const query = buildReportQuery(params);
        return fetchWithAuth(`/sales-reports/top-movers?${query}`);
    },
    getReturnsAnalysis: (params: { from: string; to: string; storeId?: string }) => {
        const query = buildReportQuery(params);
        return fetchWithAuth(`/sales-reports/returns-analysis?${query}`);
    },
    getCustomerRetention: (params: { from: string; to: string; storeId?: string; lapsedAfterDays?: number }) => {
        const query = buildReportQuery(params);
        return fetchWithAuth(`/sales-reports/customer-retention?${query}`);
    },
    getStockAging: (params?: { warehouseId?: string; groupId?: string; subgroupId?: string; slowMovingAfterDays?: number }) => {
        const query = buildReportQuery(params ?? {});
        return fetchWithAuth(`/inventory-reports/stock-aging${query ? `?${query}` : ''}`);
    },
    getPurchaseTrend: (params: {
        from: string;
        to: string;
        storeId?: string;
        granularity?: 'day' | 'week' | 'month';
        compareTo?: 'previous_period' | 'previous_year';
    }) => {
        const query = buildReportQuery(params);
        return fetchWithAuth(`/purchase-reports/trend?${query}`);
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
    getPrintTemplates: () => fetchWithAuth('/print-templates'),
    createPrintTemplate: (data: any) => fetchWithAuth('/print-templates', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    updatePrintTemplate: (id: string, data: any) => fetchWithAuth(`/print-templates/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    deletePrintTemplate: (id: string) => fetchWithAuth(`/print-templates/${id}`, {
        method: 'DELETE',
    }),
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
    /**
     * Every sale as a flat array. `/sales` is cursor-paginated at 20 per page, so a single
     * request returned 20 rows and the list footer reported "of 20" regardless of how many
     * sales existed; this walks the cursor to the end.
     */
    /**
     * Every sale, flattened. For callers that genuinely need the whole set
     * (dashboard aggregates, the return picker). NOT for tables — the sales
     * list pages against the server via `getSalesList`, because a migrated
     * tenant can have thousands of sales and pulling them all to render 20
     * rows is what made the list appear empty.
     */
    getSales: (params?: { mine?: boolean }) =>
        fetchAllPages(`/sales${params?.mine ? '?mine=true' : ''}`),
    /** One server-paginated page, for `useServerList`. */
    getSalesList: (params: {
        page?: number;
        limit?: number;
        search?: string;
        status?: string;
        sortBy?: string;
        sortDir?: 'asc' | 'desc';
        mine?: boolean;
    }) => {
        const query = new URLSearchParams();
        if (params.page) query.set('page', String(params.page));
        if (params.limit) query.set('limit', String(params.limit));
        if (params.search) query.set('search', params.search);
        if (params.status) query.set('status', params.status);
        if (params.sortBy) query.set('sortBy', params.sortBy);
        if (params.sortDir) query.set('sortDir', params.sortDir);
        if (params.mine) query.set('mine', 'true');
        return fetchPaginated(`/sales?${query.toString()}`);
    },
    /** The most recent few sales — callers that do not need the whole history. */
    getSalesPage: (params?: { page?: number; limit?: number; mine?: boolean }) => {
        const query = new URLSearchParams();
        if (params?.page) query.set('page', String(params.page));
        if (params?.limit) query.set('limit', String(params.limit));
        if (params?.mine) query.set('mine', 'true');
        const qs = query.toString();
        // fetchPaginated, not fetchWithAuth: the interceptor moves `items` up to
        // `data`, so unwrapping would hand callers a bare array and drop the total.
        return fetchPaginated(`/sales${qs ? `?${qs}` : ''}`);
    },
    /** Every customer as a flat array — for pickers and id→customer maps. */
    getCustomers: (params?: { search?: string }) => {
        const query = new URLSearchParams();
        if (params?.search) query.set('search', params.search);
        return fetchAllPages(`/customers${query.toString() ? `?${query.toString()}` : ''}`);
    },
    /** Bounded typeahead lookup — deliberately capped, unlike `getCustomers`. */
    searchCustomers: (search: string, limit = 8) =>
        fetchPaginated(`/customers?search=${encodeURIComponent(search)}&limit=${limit}`).then((r) => r.items),
    getCustomersPaged: (params?: {
        page?: number;
        limit?: number;
        search?: string;
        segment?: string;
        customerType?: string;
        sortBy?: string;
        sortDir?: string;
    }) => {
        const query = new URLSearchParams();
        if (params?.page) query.set('page', String(params.page));
        if (params?.limit) query.set('limit', String(params.limit));
        if (params?.search) query.set('search', params.search);
        if (params?.segment) query.set('segment', params.segment);
        if (params?.customerType) query.set('customerType', params.customerType);
        if (params?.sortBy) query.set('sortBy', params.sortBy);
        if (params?.sortDir) query.set('sortDir', params.sortDir);
        return fetchPaginated(`/customers${query.toString() ? `?${query.toString()}` : ''}`);
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
    importCustomers: (rows: Record<string, unknown>[], mode: 'skip' | 'upsert') =>
        fetchWithAuth('/customers/import', {
            method: 'POST',
            body: JSON.stringify({ rows, mode }),
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
    // The GL-derived customer ledger (AR voucher lines tagged to the customer).
    // Same shape as getCustomerCreditLedger, so the ledger page can read either.
    getCustomerGlLedger: (id: string, params?: { from?: string; to?: string }) => {
        const query = new URLSearchParams();
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        return fetchWithAuth(`/customers/${id}/gl-ledger${query.toString() ? `?${query.toString()}` : ''}`).then(
            (r: { transactions?: unknown[] } | unknown[]) => {
                if (Array.isArray(r)) return { transactions: r, opening_balance: 0, closing_balance: 0, due_balance: 0 };
                const transactions = r?.transactions ?? [];
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
        from?: string;
        to?: string;
        customerId?: string;
        search?: string;
    }) => {
        const query = new URLSearchParams();
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        if (params?.customerId) query.set('customerId', params.customerId);
        if (params?.search) query.set('search', params.search);
        return fetchAllPages(`/customers/credit/payments${query.toString() ? `?${query.toString()}` : ''}`);
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
    getLeads: (params?: { status?: string; source?: string; category?: string; priority?: string; assignedTo?: string; myActionsToday?: boolean; search?: string; page?: number; limit?: number; sortBy?: string; sortDir?: string }) => {
        const query = new URLSearchParams();
        if (params?.status) query.set('status', params.status);
        if (params?.source) query.set('source', params.source);
        if (params?.category) query.set('category', params.category);
        if (params?.priority) query.set('priority', params.priority);
        if (params?.assignedTo) query.set('assignedTo', params.assignedTo);
        if (params?.myActionsToday) query.set('myActionsToday', 'true');
        if (params?.search) query.set('search', params.search);
        if (params?.page) query.set('page', String(params.page));
        if (params?.limit) query.set('limit', String(params.limit));
        if (params?.sortBy) query.set('sortBy', params.sortBy);
        if (params?.sortDir) query.set('sortDir', params.sortDir);
        return fetchPaginated(`/crm/leads${query.toString() ? `?${query.toString()}` : ''}`);
    },
    getLead: (id: string) => fetchWithAuth(`/crm/leads/${id}`),
    getLeadsSummary: () => fetchWithAuth('/crm/leads/summary'),
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
    bulkLeadAction: (ids: string[], action: 'delete' | 'status' | 'assign', value?: string) =>
        fetchWithAuth('/crm/leads/bulk-actions', {
            method: 'POST',
            body: JSON.stringify({ ids, action, ...(value !== undefined ? { value } : {}) }),
            headers: { 'Content-Type': 'application/json' },
        }),
    importLeads: (rows: Record<string, unknown>[], mode: 'skip' | 'upsert') =>
        fetchWithAuth('/crm/leads/import', {
            method: 'POST',
            body: JSON.stringify({ rows, mode }),
            headers: { 'Content-Type': 'application/json' },
        }),
    // CRM Contacts
    getContacts: (params?: { search?: string; company?: string; assignedTo?: string; captureSource?: string; page?: number; limit?: number; sortBy?: string; sortDir?: string }) => {
        const query = new URLSearchParams();
        if (params?.search) query.set('search', params.search);
        if (params?.company) query.set('company', params.company);
        if (params?.assignedTo) query.set('assignedTo', params.assignedTo);
        if (params?.captureSource) query.set('captureSource', params.captureSource);
        if (params?.page) query.set('page', String(params.page));
        if (params?.limit) query.set('limit', String(params.limit));
        if (params?.sortBy) query.set('sortBy', params.sortBy);
        if (params?.sortDir) query.set('sortDir', params.sortDir);
        return fetchPaginated(`/crm/contacts${query.toString() ? `?${query.toString()}` : ''}`);
    },
    getContact: (id: string) => fetchWithAuth(`/crm/contacts/${id}`),
    createContact: (data: any) => fetchWithAuth('/crm/contacts', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    updateContact: (id: string, data: any) => fetchWithAuth(`/crm/contacts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    deleteContact: (id: string) => fetchWithAuth(`/crm/contacts/${id}`, { method: 'DELETE' }),
    bulkContactAction: (ids: string[], action: 'delete' | 'assign', value?: string) =>
        fetchWithAuth('/crm/contacts/bulk-actions', {
            method: 'POST',
            body: JSON.stringify({ ids, action, ...(value !== undefined ? { value } : {}) }),
            headers: { 'Content-Type': 'application/json' },
        }),
    importContacts: (rows: Record<string, unknown>[], mode: 'skip' | 'upsert') =>
        fetchWithAuth('/crm/contacts/import', {
            method: 'POST',
            body: JSON.stringify({ rows, mode }),
            headers: { 'Content-Type': 'application/json' },
        }),
    /** Reads a business-card photo and returns the fields on it — nothing is saved. */
    scanBusinessCard: (imageBase64: string, mimeType?: string) =>
        fetchWithAuth('/crm/contacts/scan-card', {
            method: 'POST',
            body: JSON.stringify({ imageBase64, ...(mimeType ? { mimeType } : {}) }),
            headers: { 'Content-Type': 'application/json' },
        }),
    getContactAttachments: (id: string) => fetchWithAuth(`/crm/contacts/${id}/attachments`),
    /** Sent only after the contact exists, so an abandoned scan stores nothing. */
    addContactAttachment: (
        id: string,
        payload: { imageBase64: string; mimeType?: string; fileName?: string },
    ) =>
        fetchWithAuth(`/crm/contacts/${id}/attachments`, {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'application/json' },
        }),
    deleteContactAttachment: (id: string, attachmentId: string) =>
        fetchWithAuth(`/crm/contacts/${id}/attachments/${attachmentId}`, { method: 'DELETE' }),
    // CRM lookup lists (tenant-managed lead sources / categories / conversation channels)
    getLeadTaxonomy: (kind: CrmListKind, includeInactive = false) =>
        fetchWithAuth(`/crm/lead-taxonomy/${kind}${includeInactive ? '?includeInactive=true' : ''}`),
    getLeadTaxonomyUsage: (kind: CrmListKind) =>
        fetchWithAuth(`/crm/lead-taxonomy/${kind}/usage`),
    createLeadTaxonomy: (
        kind: CrmListKind,
        data: { name: string; score_weight?: number; icon?: string; sort_order?: number },
    ) => fetchWithAuth(`/crm/lead-taxonomy/${kind}`, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    updateLeadTaxonomy: (
        kind: CrmListKind,
        id: string,
        data: { name?: string; score_weight?: number; icon?: string; sort_order?: number; is_active?: boolean },
    ) => fetchWithAuth(`/crm/lead-taxonomy/${kind}/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    deleteLeadTaxonomy: (kind: CrmListKind, id: string, reassignTo?: string) =>
        fetchWithAuth(
            `/crm/lead-taxonomy/${kind}/${id}${reassignTo ? `?reassignTo=${encodeURIComponent(reassignTo)}` : ''}`,
            { method: 'DELETE' },
        ),
    // Custom Fields
    getCustomFields: (entity: string) =>
        fetchWithAuth(`/custom-fields?entity=${encodeURIComponent(entity)}`),
    saveCustomFields: (entity: string, fields: { key?: string; label: string; order?: number }[]) =>
        fetchWithAuth(`/custom-fields?entity=${encodeURIComponent(entity)}`, {
            method: 'PUT',
            body: JSON.stringify({ fields }),
        }),
    // CRM Lead Conversations
    // Every key here must be declared on QueryLeadConversationsDto: the API runs
    // ValidationPipe with `forbidNonWhitelisted`, so an undeclared param is a 400.
    getLeadConversations: (params?: LeadConversationFilters & { page?: number; limit?: number }) =>
        // fetchPaginated, not fetchWithAuth — the latter unwraps `.data` and drops `meta`,
        // which loses `total` and leaves DataTable's server-mode footer at zero rows.
        fetchPaginated(`/crm/lead-conversations${leadConversationQuery(params)}`),
    getLeadConversationSummary: (params?: LeadConversationFilters) =>
        fetchWithAuth(`/crm/lead-conversations/summary${leadConversationQuery(params)}`),
    createLeadConversation: (data: any) => fetchWithAuth('/crm/lead-conversations', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    deleteLeadConversation: (id: string) => fetchWithAuth(`/crm/lead-conversations/${id}`, { method: 'DELETE' }),
    // CRM Follow-ups (named to leave "Task" for the Project Management module)
    getCrmFollowUps: (params?: {
        customerId?: string;
        leadId?: string;
        target?: 'customer' | 'lead';
        status?: string;
        dueToday?: boolean;
    }) => {
        const query = new URLSearchParams();
        if (params?.customerId) query.set('customerId', params.customerId);
        if (params?.leadId) query.set('leadId', params.leadId);
        if (params?.target) query.set('target', params.target);
        if (params?.status) query.set('status', params.status);
        if (params?.dueToday) query.set('dueToday', 'true');
        return fetchAllPages(`/crm/follow-ups${query.toString() ? `?${query.toString()}` : ''}`);
    },
    getCrmFollowUpSummary: () => fetchWithAuth('/crm/follow-ups/summary'),
    createCrmFollowUp: (data: any) => fetchWithAuth('/crm/follow-ups', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    updateCrmFollowUp: (id: string, data: any) => fetchWithAuth(`/crm/follow-ups/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    deleteCrmFollowUp: (id: string) => fetchWithAuth(`/crm/follow-ups/${id}`, { method: 'DELETE' }),
    // CRM dashboard — one aggregate per paint. The per-page summary endpoints
    // (`/crm/leads/summary` and friends) still serve their own list screens.
    getCrmDashboardOverview: dashboardWindowFetcher('/crm/dashboard/overview'),
    getCrmDashboardTrends: dashboardWindowFetcher('/crm/dashboard/trends'),
    // Module Overview dashboards — same contract, one per module.
    getInventoryDashboardOverview: dashboardWindowFetcher('/inventory/dashboard/overview'),
    getInventoryDashboardTrends: dashboardWindowFetcher('/inventory/dashboard/trends'),
    getPurchaseDashboardOverview: dashboardWindowFetcher('/purchases/dashboard/overview'),
    getPurchaseDashboardTrends: dashboardWindowFetcher('/purchases/dashboard/trends'),
    getSalesDashboardOverview: dashboardWindowFetcher('/sales/dashboard/overview'),
    getSalesDashboardTrends: dashboardWindowFetcher('/sales/dashboard/trends'),
    getHrDashboardOverview: dashboardWindowFetcher('/hr/dashboard/overview'),
    getHrDashboardTrends: dashboardWindowFetcher('/hr/dashboard/trends'),
    getAdminDashboardOverview: dashboardWindowFetcher('/admin/dashboard/overview'),
    getAdminDashboardTrends: dashboardWindowFetcher('/admin/dashboard/trends'),
    // CRM Campaigns
    getCrmCampaigns: () => fetchAllPages('/crm/campaigns'),
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
    getCustomerGroups: () => fetchAllPages('/customer-groups'),
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
    importCustomerGroups: (rows: Record<string, unknown>[], mode: 'skip' | 'upsert') =>
        fetchWithAuth('/customer-groups/import', {
            method: 'POST',
            body: JSON.stringify({ rows, mode }),
            headers: { 'Content-Type': 'application/json' },
        }),
    // Price Lists
    getPriceLists: () => fetchAllPages('/price-lists'),
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
    importPriceLists: (rows: Record<string, unknown>[], mode: 'skip' | 'upsert') =>
        fetchWithAuth('/price-lists/import', {
            method: 'POST',
            body: JSON.stringify({ rows, mode }),
            headers: { 'Content-Type': 'application/json' },
        }),
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
    getTerritories: () => fetchAllPages('/territories'),
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
    importTerritories: (rows: Record<string, unknown>[], mode: 'skip' | 'upsert') =>
        fetchWithAuth('/territories/import', {
            method: 'POST',
            body: JSON.stringify({ rows, mode }),
            headers: { 'Content-Type': 'application/json' },
        }),
    // Accounting
    getAccountingOverview: () => fetchWithAuth('/accounting'),
    getAccountGroups: () => fetchWithAuth('/accounting/account-groups'),
    createAccountGroup: (data: any) => fetchWithAuth('/accounting/account-groups', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    updateAccountGroup: (id: string, data: { name: string }) => fetchWithAuth(`/accounting/account-groups/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    deleteAccountGroup: (id: string) => fetchWithAuth(`/accounting/account-groups/${id}`, { method: 'DELETE' }),
    getNextAccountGroupCode: (type: string) =>
        fetchWithAuth(`/accounting/account-groups/next-code?type=${encodeURIComponent(type)}`),
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
    updateAccountSubgroup: (id: string, data: { name: string }) => fetchWithAuth(`/accounting/account-subgroups/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    deleteAccountSubgroup: (id: string) => fetchWithAuth(`/accounting/account-subgroups/${id}`, { method: 'DELETE' }),
    getNextAccountSubgroupCode: (groupId: string) =>
        fetchWithAuth(`/accounting/account-subgroups/next-code?groupId=${encodeURIComponent(groupId)}`),
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
    updateAccount: (id: string, data: any) => fetchWithAuth(`/accounting/accounts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    deleteAccount: (id: string) => fetchWithAuth(`/accounting/accounts/${id}`, { method: 'DELETE' }),
    getNextAccountCode: (groupId: string, subgroupId?: string) => {
        const query = new URLSearchParams({ groupId });
        if (subgroupId) query.set('subgroupId', subgroupId);
        return fetchWithAuth(`/accounting/accounts/next-code?${query.toString()}`);
    },
    getVoucherNumberPreview: (voucherType: string) => fetchWithAuth(`/accounting/vouchers/next-number?voucherType=${encodeURIComponent(voucherType)}`),
    getVouchers: (params?: { voucherType?: string; from?: string; to?: string; approvalStatus?: string; page?: number; limit?: number }) => {
        const query = new URLSearchParams();
        if (params?.voucherType) query.set('voucherType', params.voucherType);
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        if (params?.approvalStatus) query.set('approvalStatus', params.approvalStatus);
        if (params?.page) query.set('page', String(params.page));
        if (params?.limit) query.set('limit', String(params.limit));
        return fetchWithAuth(`/accounting/vouchers${query.toString() ? `?${query.toString()}` : ''}`);
    },
    getVoucher: (id: string) => fetchWithAuth(`/accounting/vouchers/${id}`),
    getLedger: (accountId: string, params?: { from?: string; to?: string } & ApprovedOnlyParams) => {
        const query = new URLSearchParams();
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        appendApprovedOnly(query, params);
        return fetchWithAuth(`/accounting/reports/ledger/${accountId}${query.toString() ? `?${query.toString()}` : ''}`);
    },
    getFinancialKpis: (params?: { from?: string; to?: string } & ApprovedOnlyParams) => {
        const query = new URLSearchParams();
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        appendApprovedOnly(query, params);
        return fetchWithAuth(`/accounting/dashboard/kpis${query.toString() ? `?${query.toString()}` : ''}`);
    },
    // One request for the whole accounting dashboard. The equivalent report
    // endpoints each rescan the tenant's voucher details, so this exists to keep
    // the page to a single pass over them.
    getAccountingDashboardOverview: (params?: { from?: string; to?: string } & ApprovedOnlyParams) => {
        const query = new URLSearchParams();
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        appendApprovedOnly(query, params);
        return fetchWithAuth(`/accounting/dashboard/overview${query.toString() ? `?${query.toString()}` : ''}`);
    },
    getFinancialTrends: (params?: { from?: string; to?: string } & ApprovedOnlyParams) => {
        const query = new URLSearchParams();
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        appendApprovedOnly(query, params);
        return fetchWithAuth(`/accounting/dashboard/trends${query.toString() ? `?${query.toString()}` : ''}`);
    },
    createVoucher: (data: any) => fetchWithAuth('/accounting/vouchers', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    updateVoucher: (id: string, data: any) => fetchWithAuth(`/accounting/vouchers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    deleteVoucher: (id: string) => fetchWithAuth(`/accounting/vouchers/${id}`, {
        method: 'DELETE',
    }),
    approveVoucher: (id: string) => fetchWithAuth(`/accounting/vouchers/${id}/approve`, {
        method: 'POST',
    }),
    rejectVoucher: (id: string, reason?: string) => fetchWithAuth(`/accounting/vouchers/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
        headers: { 'Content-Type': 'application/json' },
    }),
    bulkApproveVouchers: (ids: string[]) => fetchWithAuth('/accounting/vouchers/bulk-approve', {
        method: 'POST',
        body: JSON.stringify({ ids }),
        headers: { 'Content-Type': 'application/json' },
    }),
    bulkRejectVouchers: (ids: string[], reason?: string) => fetchWithAuth('/accounting/vouchers/bulk-reject', {
        method: 'POST',
        body: JSON.stringify({ ids, reason }),
        headers: { 'Content-Type': 'application/json' },
    }),
    getPendingVoucherCount: () => fetchWithAuth('/accounting/vouchers/pending-count'),
    getAccountingSettings: () => fetchWithAuth('/accounting/settings/accounting'),
    updateAccountingSettings: (data: {
        requireVoucherApproval?: boolean;
        autoApproveSystemVouchers?: boolean;
        reportsApprovedOnly?: boolean;
    }) => fetchWithAuth('/accounting/settings/accounting', {
        method: 'PATCH',
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
    getProfitLoss: (params?: { from?: string; to?: string } & ReportScopeParams & ReportLevelParams & ApprovedOnlyParams) => {
        const query = new URLSearchParams();
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        appendReportScopeParams(query, params);
        return fetchWithAuth(`/accounting/reports/profit-loss${query.toString() ? `?${query.toString()}` : ''}`);
    },
    getBalanceSheet: (params?: { asOfDate?: string } & ReportScopeParams & ReportLevelParams & ApprovedOnlyParams) => {
        const query = new URLSearchParams();
        if (params?.asOfDate) query.set('asOfDate', params.asOfDate);
        appendReportScopeParams(query, params);
        return fetchWithAuth(`/accounting/reports/balance-sheet${query.toString() ? `?${query.toString()}` : ''}`);
    },
    getCashbook: (params?: { from?: string; to?: string; accountId?: string } & ApprovedOnlyParams) => {
        const query = new URLSearchParams();
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        if (params?.accountId) query.set('accountId', params.accountId);
        appendApprovedOnly(query, params);
        return fetchWithAuth(`/accounting/reports/cashbook${query.toString() ? `?${query.toString()}` : ''}`);
    },
    getBankbook: (params?: { from?: string; to?: string; accountId?: string } & ApprovedOnlyParams) => {
        const query = new URLSearchParams();
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        if (params?.accountId) query.set('accountId', params.accountId);
        appendApprovedOnly(query, params);
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
    updateStore: (id: string, data: { name: string }) =>
        fetchWithAuth(`/stores/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    exportAccountingLedger: (params: { format: 'tally' | 'quickbooks'; from?: string; to?: string }) => {
        const query = new URLSearchParams();
        query.set('format', params.format);
        if (params.from) query.set('from', params.from);
        if (params.to) query.set('to', params.to);
        return fetchBlobWithAuth(`/accounting/export?${query.toString()}`);
    },
    getReturns: () => fetchAllPages('/sales-returns'),
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
    getOrders: () => fetchAllPages('/sales-orders'),
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
    getBrands: () => fetchAllPages('/brands'),
    createBrand: (data: any) => fetchWithAuth('/brands', { method: 'POST', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } }),
    updateBrand: (id: string, data: any) => fetchWithAuth(`/brands/${id}`, { method: 'PATCH', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } }),
    deleteBrand: (id: string) => fetchWithAuth(`/brands/${id}`, { method: 'DELETE' }),
    importBrands: (rows: Record<string, unknown>[], mode: 'skip' | 'upsert') =>
        fetchWithAuth('/brands/import', {
            method: 'POST',
            body: JSON.stringify({ rows, mode }),
            headers: { 'Content-Type': 'application/json' },
        }),
    /** Every supplier as a flat array — for pickers and id→supplier maps. */
    getSuppliers: () => fetchAllPages('/suppliers'),
    getSuppliersPaged: (params?: {
        page?: number;
        limit?: number;
        search?: string;
        sortBy?: string;
        sortDir?: string;
    }) => {
        const query = new URLSearchParams();
        if (params?.page) query.set('page', String(params.page));
        if (params?.limit) query.set('limit', String(params.limit));
        if (params?.search) query.set('search', params.search);
        if (params?.sortBy) query.set('sortBy', params.sortBy);
        if (params?.sortDir) query.set('sortDir', params.sortDir);
        return fetchPaginated(`/suppliers${query.toString() ? `?${query.toString()}` : ''}`);
    },
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
    // The GL-derived supplier ledger (Purchase Payable voucher lines tagged to the
    // supplier). Same shape as getSupplierCreditLedger.
    getSupplierGlLedger: (id: string, params?: { from?: string; to?: string }) => {
        const query = new URLSearchParams();
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        return fetchWithAuth(`/suppliers/${id}/gl-ledger${query.toString() ? `?${query.toString()}` : ''}`).then(
            (r: { transactions?: unknown[] } | unknown[]) => {
                if (Array.isArray(r)) return { transactions: r, opening_balance: 0, closing_balance: 0, due_balance: 0 };
                const transactions = r?.transactions ?? [];
                return { ...r, transactions: Array.isArray(transactions) ? transactions : [] };
            },
        );
    },
    recordSupplierCreditPayment: (id: string, data: {
        amount: number;
        direction?: 'pay' | 'receive';
        notes?: string;
        allocations?: { purchaseId: string; amount: number }[];
    }) =>
        fetchWithAuth(`/suppliers/${id}/credit/payment`, {
            method: 'POST',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    getSupplierBillingSummary: (id: string) => fetchWithAuth(`/suppliers/${id}/billing-summary`),
    allocateSupplierPayment: (paymentId: string, allocations: { purchaseId: string; amount: number }[]) =>
        fetchWithAuth(`/suppliers/credit/payments/${paymentId}/allocate`, {
            method: 'POST',
            body: JSON.stringify({ allocations }),
            headers: { 'Content-Type': 'application/json' },
        }),
    removeSupplierPaymentAllocation: (allocationId: string) =>
        fetchWithAuth(`/suppliers/credit/allocations/${allocationId}`, { method: 'DELETE' }),
    getSupplierCreditPayments: (params?: {
        from?: string;
        to?: string;
        supplierId?: string;
        search?: string;
    }) => {
        const query = new URLSearchParams();
        if (params?.from) query.set('from', params.from);
        if (params?.to) query.set('to', params.to);
        if (params?.supplierId) query.set('supplierId', params.supplierId);
        if (params?.search) query.set('search', params.search);
        return fetchAllPages(`/suppliers/credit/payments${query.toString() ? `?${query.toString()}` : ''}`);
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
    importSuppliers: (rows: Record<string, unknown>[], mode: 'skip' | 'upsert') =>
        fetchWithAuth('/suppliers/import', {
            method: 'POST',
            body: JSON.stringify({ rows, mode }),
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
    getPurchaseOrders: () => fetchAllPages('/purchase-orders'),
    getPurchaseOrder: (id: string) => fetchWithAuth(`/purchase-orders/${id}`),
    createPurchaseOrder: (data: any) => fetchWithAuth('/purchase-orders', { method: 'POST', body: JSON.stringify(data) }),
    updatePurchaseOrderStatus: (id: string, status: string) => fetchWithAuth(`/purchase-orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    getPurchaseOrderInvoice: (id: string) => fetchWithAuth(`/purchase-orders/${id}/invoice`),
    getPurchaseQuotations: () => fetchAllPages('/purchase-quotations'),
    getPurchaseQuotation: (id: string) => fetchWithAuth(`/purchase-quotations/${id}`),
    createPurchaseQuotation: (data: any) => fetchWithAuth('/purchase-quotations', { method: 'POST', body: JSON.stringify(data) }),
    updatePurchaseQuotationStatus: (id: string, status: string) => fetchWithAuth(`/purchase-quotations/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    convertPurchaseQuotation: (id: string) => fetchWithAuth(`/purchase-quotations/${id}/convert`, { method: 'POST' }),
    deletePurchaseQuotation: (id: string) => fetchWithAuth(`/purchase-quotations/${id}`, { method: 'DELETE' }),
    getPurchases: () => fetchAllPages('/purchases'),
    getPurchase: (id: string) => fetchWithAuth(`/purchases/${id}`),
    createPurchase: (data: any) => fetchWithAuth('/purchases', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    getPurchaseReturns: () => fetchAllPages('/purchase-returns'),
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
    getQuotations: () => fetchAllPages('/sales-quotations'),
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
    /** Idempotent — calling this again returns the same live code rather than minting a new one. */
    shareQuotation: (id: string) => fetchWithAuth(`/sales-quotations/${id}/share`, { method: 'POST' }),
    /** Clears the share token, killing every link ever sent for this quotation. */
    revokeQuotationShare: (id: string) => fetchWithAuth(`/sales-quotations/${id}/share`, { method: 'DELETE' }),
    getShortLinks: () => fetchWithAuth('/short-links'),
    createShortLink: (data: { target_url: string; label?: string }) =>
        fetchWithAuth('/short-links', {
            method: 'POST',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    revokeShortLink: (id: string) => fetchWithAuth(`/short-links/${id}`, { method: 'DELETE' }),
    getAdminShortLinks: () => fetchWithAuth('/admin/short-links'),
    createAdminShortLink: (data: { target_url: string; label?: string }) =>
        fetchWithAuth('/admin/short-links', {
            method: 'POST',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    revokeAdminShortLink: (id: string) => fetchWithAuth(`/admin/short-links/${id}`, { method: 'DELETE' }),
    // Sales detail
    getSale: (id: string) => fetchWithAuth(`/sales/${id}`),
    getSaleInvoice: (id: string) => fetchWithAuth(`/sales/${id}/invoice`),
    getDiscountCodes: () => fetchAllPages('/discount-codes'),
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
    deleteSale: (id: string) => fetchWithAuth(`/sales/${id}`, { method: 'DELETE' }),
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
        if (!res.ok) {
            const raw = body?.message;
            throw new Error(Array.isArray(raw) ? raw[0] : (raw || 'Signup failed'));
        }
        return body && 'data' in body ? body.data : body;
    }),
    getSubscriptionPlans: () => fetch(`${API_BASE}/auth/plans`).then(async res => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.message || 'Failed to load plans');
        return body && 'data' in body ? body.data : body;
    }),
    getSignupDefaults: () => fetch(`${API_BASE}/auth/signup-defaults`).then(async res => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.message || 'Failed to load signup defaults');
        return body && 'data' in body ? body.data : body;
    }),
    validateReferralCode: (code: string) => fetch(`${API_BASE}/auth/referral-code/${encodeURIComponent(code.trim())}`).then(async res => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.message || 'Failed to validate referral code');
        return body && 'data' in body ? body.data : body;
    }),
    setupTenant: (data: { tenantName: string; name: string; address?: string; planCode?: string; businessType?: string }) =>
        fetchWithAuth('/auth/setup-tenant', {
            method: 'POST',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    // Records "setup finished/skipped" on the workspace so the wizard stays gone for
    // every member on every device — localStorage alone can't survive a new browser.
    dismissOnboarding: () => fetchWithAuth('/auth/onboarding/dismiss', { method: 'POST' }),
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
    updateAdminTenantLocalization: (
        tenantId: string,
        data: { localization_enabled?: boolean; secondary_locale?: 'bn' | 'ms' | null },
    ) => fetchWithAuth(`/admin/tenants/${tenantId}/localization`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    getAdminTenantFeatures: (tenantId: string): Promise<AdminTenantFeatures> =>
        fetchWithAuth(`/admin/tenants/${tenantId}/features`),
    /** `null` for a feature clears the override so the tenant inherits the platform default. */
    updateAdminTenantFeatures: (
        tenantId: string,
        data: Partial<Record<PlatformFeatureKey, boolean | null>>,
    ): Promise<AdminTenantFeatures> => fetchWithAuth(`/admin/tenants/${tenantId}/features`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    getAdminTenantMessagingIdentity: (tenantId: string): Promise<AdminTenantMessagingIdentity> =>
        fetchWithAuth(`/admin/tenants/${tenantId}/messaging-identity`),
    /** Omit a field to keep it; send an empty string to clear it. */
    updateAdminTenantMessagingIdentity: (
        tenantId: string,
        data: Partial<Omit<AdminTenantMessagingIdentity, 'updated_at' | 'updated_by'>>,
    ): Promise<AdminTenantMessagingIdentity> =>
        fetchWithAuth(`/admin/tenants/${tenantId}/messaging-identity`, {
            method: 'PATCH',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    testAdminTenantMessagingEmail: (
        tenantId: string,
        to: string,
    ): Promise<{ sender: 'tenant' | 'platform'; from: string | null }> =>
        fetchWithAuth(`/admin/tenants/${tenantId}/messaging-identity/test-email`, {
            method: 'POST',
            body: JSON.stringify({ to }),
            headers: { 'Content-Type': 'application/json' },
        }),
    testAdminTenantMessagingWhatsApp: (
        tenantId: string,
        to: string,
    ): Promise<{ sender: 'tenant' | 'platform'; phone_number_id: string | null }> =>
        fetchWithAuth(`/admin/tenants/${tenantId}/messaging-identity/test-whatsapp`, {
            method: 'POST',
            body: JSON.stringify({ to }),
            headers: { 'Content-Type': 'application/json' },
        }),
    setAdminTenantBusinessType: (tenantId: string, businessType: string) => fetchWithAuth(`/admin/tenants/${tenantId}/business-type`, {
        method: 'PATCH',
        body: JSON.stringify({ businessType }),
        headers: { 'Content-Type': 'application/json' },
    }),
    importAdminTenantCatalog: (tenantId: string): Promise<{
        business_type: string;
        created: number;
        skipped: number;
        groups: number;
        subgroups: number;
        brands: number;
    }> => fetchWithAuth(`/admin/tenants/${tenantId}/catalog-import`, {
        method: 'POST',
    }),
    loadAdminTenantDemoData: (tenantId: string): Promise<{ batchId: string; batchNumber: number }> =>
        fetchWithAuth(`/admin/tenants/${tenantId}/demo-data`, { method: 'POST' }),
    getAdminTenantDemoDataStatus: (tenantId: string): Promise<{
        status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
        phase?: string | null;
        processed: number;
        total: number;
        batch_number: number;
        error?: string | null;
    } | null> => fetchWithAuth(`/admin/tenants/${tenantId}/demo-data/status`),
    // --- External ERP sync (platform admin only) ---
    getExternalSync: (tenantId: string): Promise<ExternalSyncConnection | null> =>
        fetchWithAuth(`/admin/tenants/${tenantId}/external-sync`),
    saveExternalSync: (tenantId: string, data: {
        baseUrl: string;
        username: string;
        password?: string;
        storeId: string;
        documentPrefix?: string;
        enabled?: boolean;
        postImpacts?: boolean;
        windowDays?: number;
        historyStartDate?: string;
    }): Promise<ExternalSyncConnection> => fetchWithAuth(`/admin/tenants/${tenantId}/external-sync`, {
        method: 'PUT',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    deleteExternalSync: (tenantId: string) =>
        fetchWithAuth(`/admin/tenants/${tenantId}/external-sync`, { method: 'DELETE' }),
    testExternalSync: (tenantId: string, data: { baseUrl: string; username: string; password?: string }): Promise<{
        ok: boolean;
        organizationId: string;
        user: { name: string; username: string; role: string };
    }> => fetchWithAuth(`/admin/tenants/${tenantId}/external-sync/test`, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    startExternalSyncRun: (tenantId: string, data: {
        dateFrom?: string;
        dateTo?: string;
        dryRun?: boolean;
        fullResync?: boolean;
        steps?: ExternalSyncStep[];
    }): Promise<ExternalSyncRun> => fetchWithAuth(`/admin/tenants/${tenantId}/external-sync/runs`, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    listExternalSyncRuns: (tenantId: string, limit = 20): Promise<ExternalSyncRun[]> =>
        fetchWithAuth(`/admin/tenants/${tenantId}/external-sync/runs?limit=${limit}`),
    cancelExternalSyncRun: (tenantId: string, runId: string): Promise<{ cancelling: boolean }> =>
        fetchWithAuth(`/admin/tenants/${tenantId}/external-sync/runs/${runId}/cancel`, { method: 'POST' }),
    // --- External ERP import, tenant-facing (Settings > Data Management).
    // Same shapes as the admin calls above; the tenant route resolves the
    // workspace from the session instead of taking a tenant id, and refuses
    // anything but the owner of a feature-enabled workspace.
    getMyExternalSync: (): Promise<ExternalSyncConnection | null> =>
        fetchWithAuth('/tenants/external-sync'),
    saveMyExternalSync: (data: {
        baseUrl: string;
        username: string;
        password?: string;
        storeId: string;
        documentPrefix?: string;
        enabled?: boolean;
        windowDays?: number;
        historyStartDate?: string;
    }): Promise<ExternalSyncConnection> => fetchWithAuth('/tenants/external-sync', {
        method: 'PUT',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    deleteMyExternalSync: () => fetchWithAuth('/tenants/external-sync', { method: 'DELETE' }),
    testMyExternalSync: (data: { baseUrl: string; username: string; password?: string }): Promise<{
        ok: boolean;
        organizationId: string;
        user: { name: string; username: string; role: string };
    }> => fetchWithAuth('/tenants/external-sync/test', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    startMyExternalSyncRun: (data: {
        dateFrom?: string;
        dateTo?: string;
        dryRun?: boolean;
        fullResync?: boolean;
        steps?: ExternalSyncStep[];
    }): Promise<ExternalSyncRun> => fetchWithAuth('/tenants/external-sync/runs', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    listMyExternalSyncRuns: (limit = 20): Promise<ExternalSyncRun[]> =>
        fetchWithAuth(`/tenants/external-sync/runs?limit=${limit}`),
    cancelMyExternalSyncRun: (runId: string): Promise<{ cancelling: boolean }> =>
        fetchWithAuth(`/tenants/external-sync/runs/${runId}/cancel`, { method: 'POST' }),
    suspendTenant: (tenantId: string, reason?: string) => fetchWithAuth(`/admin/tenants/${tenantId}/suspend`, {
        method: 'PATCH',
        body: JSON.stringify({ reason }),
        headers: { 'Content-Type': 'application/json' },
    }),
    impersonateTenant: (tenantId: string) => fetchWithAuth(`/admin/tenants/${tenantId}/impersonate`, {
        method: 'POST',
    }),
    deleteAdminTenant: (tenantId: string, reason?: string) => fetchWithAuth(`/admin/tenants/${tenantId}`, {
        method: 'DELETE',
        body: JSON.stringify({ reason }),
        headers: { 'Content-Type': 'application/json' },
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
        discountType?: 'PERCENTAGE' | 'FIXED';
        discountValue?: number;
    }) => fetchWithAuth('/admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    }),
    getTenantLedger: (tenantId: string) => fetchWithAuth(`/admin/tenants/${tenantId}/ledger`),
    getAdminTenantLedger: (params?: { tenantId?: string }) => {
        const query = new URLSearchParams();
        if (params?.tenantId) query.set('tenantId', params.tenantId);
        const suffix = query.toString() ? `?${query.toString()}` : '';
        return fetchWithAuth(`/admin/tenants/ledger${suffix}`);
    },
    getAdminTenantReminders: (params?: { tenantId?: string }) => {
        const query = new URLSearchParams();
        if (params?.tenantId) query.set('tenantId', params.tenantId);
        const suffix = query.toString() ? `?${query.toString()}` : '';
        return fetchWithAuth(`/admin/tenants/reminders${suffix}`);
    },
    recordTenantPayment: (tenantId: string, data: { amount: number; notes?: string; method?: string }) =>
        fetchWithAuth(`/admin/tenants/${tenantId}/payments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        }),
    recordTenantRefund: (tenantId: string, data: { amount: number; notes?: string }) =>
        fetchWithAuth(`/admin/tenants/${tenantId}/refunds`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        }),
    sellTenantSmsCredits: (tenantId: string, data: { credits: number; amount?: number; notes?: string }) =>
        fetchWithAuth(`/admin/tenants/${tenantId}/sms-credits`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        }),
    sellTenantAiCredits: (tenantId: string, data: { credits: number; amount?: number; notes?: string }) =>
        fetchWithAuth(`/admin/tenants/${tenantId}/ai-credits`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        }),
    getAdminTenantAddons: (tenantId: string): Promise<AdminTenantAddonSubscription[]> =>
        fetchWithAuth(`/admin/tenants/${tenantId}/addons`),
    grantAdminTenantAddon: (
        tenantId: string,
        data: { addonCode: string; durationDays?: number; notes?: string },
    ): Promise<AdminTenantAddonSubscription[]> => fetchWithAuth(`/admin/tenants/${tenantId}/addons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    }),
    revokeAdminTenantAddon: (tenantId: string, addonCode: string): Promise<AdminTenantAddonSubscription[]> =>
        fetchWithAuth(`/admin/tenants/${tenantId}/addons/${encodeURIComponent(addonCode)}`, {
            method: 'DELETE',
        }),
    lookupAdminUser: (email: string) =>
        fetchWithAuth(`/admin/users/lookup?email=${encodeURIComponent(email)}`),
    getAdminMetrics: () => fetchWithAuth('/admin/metrics'),
    getSystemHealth: () => fetchWithAuth('/admin/system-health'),
    getSystemHealthJobs: () => fetchWithAuth('/admin/system-health/jobs'),
    getAdminUsers: (params?: { search?: string; isAdmin?: boolean }) => {
        const query = new URLSearchParams();
        if (params?.search) query.set('search', params.search);
        if (params?.isAdmin !== undefined) query.set('isAdmin', String(params.isAdmin));
        return fetchAllPages(`/admin/users${query.toString() ? `?${query.toString()}` : ''}`);
    },
    promoteUser: (userId: string) => fetchWithAuth(`/admin/users/${userId}/promote`, { method: 'POST' }),
    demoteUser: (userId: string) => fetchWithAuth(`/admin/users/${userId}/promote`, { method: 'DELETE' }),
    createPlatformAdminUser: (data: {
        email: string;
        password: string;
        name?: string;
        mobile?: string;
        mobile_country_code?: string;
    }) => fetchWithAuth('/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    }),
    updatePlatformAdminUser: (userId: string, data: {
        email?: string;
        name?: string;
        mobile?: string;
        mobile_country_code?: string;
    }) => fetchWithAuth(`/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    }),
    deletePlatformAdminUser: (userId: string) => fetchWithAuth(`/admin/users/${userId}`, { method: 'DELETE' }),
    resetPlatformAdminUserPassword: (userId: string, newPassword: string) =>
        fetchWithAuth(`/admin/users/${userId}/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newPassword }),
        }),
    sendPlatformAdminUserResetEmail: (userId: string) =>
        fetchWithAuth(`/admin/users/${userId}/send-reset-email`, { method: 'POST' }),
    /** Archived referees are excluded unless `include_archived` is set. */
    getAdminReferees: (params?: { include_archived?: boolean }) => {
        const suffix = params?.include_archived ? '?include_archived=true' : '';
        return fetchWithAuth(`/admin/referrals/referees${suffix}`);
    },
    createAdminReferee: (data: {
        name: string;
        email: string;
        phone?: string;
        commission_rate: number;
        signup_discount: number;
        notes?: string;
    }) => fetchWithAuth('/admin/referrals/referees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    }),
    getAdminReferee: (id: string) => fetchWithAuth(`/admin/referrals/referees/${id}`),
    updateAdminReferee: (id: string, data: {
        name?: string;
        email?: string;
        phone?: string;
        referral_code?: string;
        commission_rate?: number;
        signup_discount?: number;
        is_active?: boolean;
        notes?: string;
    }) => fetchWithAuth(`/admin/referrals/referees/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    }),
    deleteAdminReferee: (id: string) =>
        fetchWithAuth(`/admin/referrals/referees/${id}`, { method: 'DELETE' }),
    getAdminRefereeLedger: (id: string) => fetchWithAuth(`/admin/referrals/referees/${id}/ledger`),
    recordAdminRefereePayment: (id: string, data: {
        /** Omit to settle exactly what the selected commissions are worth. */
        amount?: number;
        /** Required to record a payout that does not settle the full amount owed. */
        allow_partial?: boolean;
        method?: string;
        reference?: string;
        notes?: string;
        commission_ids?: string[];
    }) => fetchWithAuth(`/admin/referrals/referees/${id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    }),
    getRefereePortalLedger: () => fetchWithAuth('/referrals/me/ledger'),
    sendAdminRefereeInvite: (id: string) =>
        fetchWithAuth(`/admin/referrals/referees/${id}/send-invite`, { method: 'POST' }),
    /** Paged: returns `{ items, total, limit, offset, has_more }`, not a bare array. */
    getAdminReferralCommissions: (params?: {
        referee_id?: string;
        status?: ReferralCommissionStatus;
        limit?: number;
        offset?: number;
    }) => {
        const query = new URLSearchParams();
        if (params?.referee_id) query.set('referee_id', params.referee_id);
        if (params?.status) query.set('status', params.status);
        if (params?.limit !== undefined) query.set('limit', String(params.limit));
        if (params?.offset !== undefined) query.set('offset', String(params.offset));
        const suffix = query.toString() ? `?${query.toString()}` : '';
        return fetchWithAuth(`/admin/referrals/commissions${suffix}`);
    },
    getAdminFeedback: (params?: { type?: string; search?: string; page?: number; limit?: number }) => {
        const query = new URLSearchParams();
        if (params?.type) query.set('type', params.type);
        if (params?.search) query.set('search', params.search);
        if (params?.page) query.set('page', String(params.page));
        if (params?.limit) query.set('limit', String(params.limit));
        return fetchWithAuth(`/admin/feedback${query.toString() ? `?${query.toString()}` : ''}`);
    },
    // Feedback automation (propose plan -> admin approve -> implement -> PR -> rollback)
    getAdminFeedbackDetail: (id: string) => fetchWithAuth(`/admin/feedback/${id}`),
    saveFeedbackInstruction: (id: string, instruction: string) =>
        fetchWithAuth(`/admin/feedback/${id}/instruction`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ instruction }),
        }),
    proposeFeedbackPlan: (id: string) => fetchWithAuth(`/admin/feedback/${id}/propose-plan`, { method: 'POST' }),
    reviewFeedbackPlan: (
        planId: string,
        data: { decision: 'APPROVE' | 'REQUEST_CHANGES'; comment?: string; confirmMigration?: boolean },
    ) =>
        fetchWithAuth(`/admin/feedback/plans/${planId}/review`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        }),
    implementFeedbackNow: (id: string) => fetchWithAuth(`/admin/feedback/${id}/implement`, { method: 'POST' }),
    getFeedbackPrStatus: (id: string) => fetchWithAuth(`/admin/feedback/${id}/pr-status`),
    mergeFeedback: (id: string) => fetchWithAuth(`/admin/feedback/${id}/merge`, { method: 'POST' }),
    rollbackFeedback: (id: string) => fetchWithAuth(`/admin/feedback/${id}/rollback`, { method: 'POST' }),
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
    getTeamRoles: () => fetchWithAuth('/team/roles'),
    createTeamRole: (data: { name: string; description?: string; permissions: string[] }) =>
        fetchWithAuth('/team/roles', {
            method: 'POST',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    updateTeamRole: (id: string, data: { name?: string; description?: string; permissions?: string[] }) =>
        fetchWithAuth(`/team/roles/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    deleteTeamRole: (id: string) => fetchWithAuth(`/team/roles/${id}`, { method: 'DELETE' }),
    getTeamMembers: () => fetchAllPages('/team/members'),
    getTeamMember: (userId: string) => fetchWithAuth(`/team/members/${userId}`),
    getTeamStores: () => fetchWithAuth('/team/stores'),
    getTeamInvitations: () => fetchWithAuth('/team/invitations'),
    sendTeamInvitation: (data: { email: string; tenantRoleId: string }) => fetchWithAuth('/team/invitations', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    revokeTeamInvitation: (id: string) => fetchWithAuth(`/team/invitations/${id}`, { method: 'DELETE' }),
    updateMemberRole: (userId: string, data: { tenantRoleId: string }) =>
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
    getNavLayout: (scope: 'tenant' | 'platform_admin') =>
        fetchWithAuth(`/navigation/layout?scope=${scope}`),
    getAdminNavLayout: (scope: 'tenant' | 'platform_admin') =>
        fetchWithAuth(`/admin/navigation/layout/${scope}`),
    getAdminNavRegistry: () => fetchWithAuth('/admin/navigation/registry'),
    saveAdminNavLayout: (scope: 'tenant' | 'platform_admin', layout: unknown[]) =>
        fetchWithAuth(`/admin/navigation/layout/${scope}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ layout }),
        }),
    resetAdminNavLayout: (scope: 'tenant' | 'platform_admin') =>
        fetchWithAuth(`/admin/navigation/layout/${scope}/reset`, { method: 'POST' }),
    getAdminTenantNavOverrides: () => fetchWithAuth('/admin/navigation/tenant-overrides'),
    getAdminTenantNavOverride: (tenantId: string) =>
        fetchWithAuth(`/admin/navigation/tenant-overrides/${tenantId}`),
    resetAdminTenantNavLayout: (tenantId: string) =>
        fetchWithAuth(`/admin/navigation/tenant-overrides/${tenantId}/reset`, { method: 'POST' }),
    resetAllAdminTenantNavLayouts: () =>
        fetchWithAuth('/admin/navigation/tenant-overrides/reset-all', { method: 'POST' }),
    getAdminSubscriptionPlans: () => fetchWithAuth('/admin/subscription-plans'),
    getAdminSubscriptionPlanRegistry: () => fetchWithAuth('/admin/subscription-plans/registry'),
    updateAdminSubscriptionPlan: (code: string, payload: unknown) =>
        fetchWithAuth(`/admin/subscription-plans/${code}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        }),
    getAdminAddonModules: () => fetchWithAuth('/admin/addon-modules'),
    getAdminAddonModule: (id: string) => fetchWithAuth(`/admin/addon-modules/${id}`),
    createAdminAddonModule: (payload: unknown) =>
        fetchWithAuth('/admin/addon-modules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        }),
    updateAdminAddonModule: (id: string, payload: unknown) =>
        fetchWithAuth(`/admin/addon-modules/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        }),
    getAddonCatalog: () => fetchWithAuth('/addon-modules'),
    getMyAddonSubscriptions: () => fetchWithAuth('/addon-modules/mine'),
    cancelAddonAtPeriodEnd: (code: string) =>
        fetchWithAuth(`/addon-modules/${code}/cancel-at-period-end`, { method: 'POST' }),
    updateProfile: (data: { name?: string; preferred_locale?: 'en' | 'bn' | 'ms' }) => fetchWithAuth('/auth/me', {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    getTenantDashboardSettings: () => fetchWithAuth('/tenants/dashboard-settings'),
    // Typed off the shared list so a new variant cannot be added on one side only —
    // the backend DTO validates against the same constant.
    updateTenantDashboardSettings: (data: { dashboard_preference: DashboardPreference }) =>
        fetchWithAuth('/tenants/dashboard-settings', {
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
    getWarrantyClaims: () => fetchAllPages('/warranty-claims'),
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
    getEmployees: (params?: { search?: string; status?: string; departmentId?: string }) => {
        const query = new URLSearchParams();
        if (params?.search) query.set('search', params.search);
        if (params?.status) query.set('status', params.status);
        if (params?.departmentId) query.set('departmentId', params.departmentId);
        return fetchAllPages(`/employees${query.toString() ? `?${query.toString()}` : ''}`);
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
    grantEmployeePortalAccess: (id: string) =>
        fetchWithAuth(`/employees/${id}/portal-access`, { method: 'POST' }),
    revokeEmployeePortalAccess: (id: string) =>
        fetchWithAuth(`/employees/${id}/portal-access/revoke`, { method: 'PATCH' }),

    // Holidays & work schedules (HRIS Phase 2)
    getHolidays: (year?: number) =>
        fetchWithAuth(`/hr/holidays${year ? `?year=${year}` : ''}`),
    createHoliday: (data: { date: string; name: string }) => fetchWithAuth('/hr/holidays', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    updateHoliday: (id: string, data: { date?: string; name?: string }) =>
        fetchWithAuth(`/hr/holidays/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    deleteHoliday: (id: string) => fetchWithAuth(`/hr/holidays/${id}`, { method: 'DELETE' }),

    getWorkSchedules: () => fetchWithAuth('/hr/work-schedules'),
    getWorkSchedule: (id: string) => fetchWithAuth(`/hr/work-schedules/${id}`),
    createWorkSchedule: (data: any) => fetchWithAuth('/hr/work-schedules', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    updateWorkSchedule: (id: string, data: any) => fetchWithAuth(`/hr/work-schedules/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    deleteWorkSchedule: (id: string) => fetchWithAuth(`/hr/work-schedules/${id}`, { method: 'DELETE' }),
    assignWorkSchedule: (data: { employee_id: string; schedule_id: string; effective_from: string }) =>
        fetchWithAuth('/hr/work-schedules/assign', {
            method: 'POST',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    getEmployeeSchedules: (employeeId: string) =>
        fetchWithAuth(`/hr/employees/${employeeId}/schedules`),

    // Employee self-service portal. Every endpoint resolves the employee from
    // the token, so none of these take an employee id.
    getMyProfile: () => fetchWithAuth('/employee-portal/me'),
    getMySummary: (params?: { year?: number; month?: number }) => {
        const query = new URLSearchParams();
        if (params?.year) query.set('year', String(params.year));
        if (params?.month) query.set('month', String(params.month));
        return fetchWithAuth(`/employee-portal/summary${query.toString() ? `?${query}` : ''}`);
    },
    getMyAttendance: (params?: { year?: number; month?: number }) => {
        const query = new URLSearchParams();
        if (params?.year) query.set('year', String(params.year));
        if (params?.month) query.set('month', String(params.month));
        return fetchWithAuth(`/employee-portal/attendance${query.toString() ? `?${query}` : ''}`);
    },
    getMyToday: () => fetchWithAuth('/employee-portal/attendance/today'),
    checkIn: (location?: { latitude: number; longitude: number }) =>
        fetchWithAuth('/employee-portal/attendance/check-in', {
            method: 'POST',
            body: JSON.stringify(location ?? {}),
            headers: { 'Content-Type': 'application/json' },
        }),
    checkOut: (location?: { latitude: number; longitude: number }) =>
        fetchWithAuth('/employee-portal/attendance/check-out', {
            method: 'POST',
            body: JSON.stringify(location ?? {}),
            headers: { 'Content-Type': 'application/json' },
        }),

    getAttendanceSettings: () => fetchWithAuth('/attendance/settings'),
    updateAttendanceSettings: (data: {
        self_service_enabled?: boolean;
        geofence_enabled?: boolean;
        geofence_radius_m?: number;
        grace_minutes?: number;
    }) => fetchWithAuth('/attendance/settings', {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),

    getMyLeaveBalances: (year?: number) =>
        fetchWithAuth(`/employee-portal/leave-balances${year ? `?year=${year}` : ''}`),
    getMyLeaveRequests: () => fetchWithAuth('/employee-portal/leave-requests'),
    applyForLeave: (data: {
        leave_type_id: string; start_date: string; end_date: string; days: number; reason?: string;
    }) => fetchWithAuth('/employee-portal/leave-requests', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    cancelMyLeaveRequest: (id: string) =>
        fetchWithAuth(`/employee-portal/leave-requests/${id}/cancel`, { method: 'PATCH' }),
    getMySalaryPayments: () => fetchWithAuth('/employee-portal/salary-payments'),
    importEmployees: (rows: Record<string, unknown>[], mode: 'skip' | 'upsert') =>
        fetchWithAuth('/employees/import', {
            method: 'POST',
            body: JSON.stringify({ rows, mode }),
            headers: { 'Content-Type': 'application/json' },
        }),
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
    getAttendance: (params?: { employeeId?: string; startDate?: string; endDate?: string; status?: string }) => {
        const q = new URLSearchParams();
        if (params?.employeeId) q.set('employeeId', params.employeeId);
        if (params?.startDate) q.set('startDate', params.startDate);
        if (params?.endDate) q.set('endDate', params.endDate);
        if (params?.status) q.set('status', params.status);
        return fetchAllPages(`/attendance${q.toString() ? `?${q}` : ''}`);
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
    getLeaveRequests: (params?: { employeeId?: string; status?: string }) => {
        const q = new URLSearchParams();
        if (params?.employeeId) q.set('employeeId', params.employeeId);
        if (params?.status) q.set('status', params.status);
        return fetchAllPages(`/attendance/leave-requests${q.toString() ? `?${q}` : ''}`);
    },
    createLeaveRequest: (data: any) => fetchWithAuth('/attendance/leave-requests', { method: 'POST', body: JSON.stringify(data) }),
    reviewLeaveRequest: (id: string, data: { status: string; approver_note?: string }) =>
        fetchWithAuth(`/attendance/leave-requests/${id}/review`, { method: 'PATCH', body: JSON.stringify(data) }),
    cancelLeaveRequest: (id: string) =>
        fetchWithAuth(`/attendance/leave-requests/${id}/cancel`, { method: 'PATCH' }),
    // In-app notifications
    getNotifications: (params?: { page?: number; limit?: number }) => {
        const q = new URLSearchParams();
        if (params?.page) q.set('page', String(params.page));
        if (params?.limit) q.set('limit', String(params.limit));
        const query = q.toString();
        return fetchWithAuth(`/notifications${query ? `?${query}` : ''}`).then((r: any) => ({
            items: Array.isArray(r?.items) ? r.items : (Array.isArray(r) ? r : []),
            total: Number(r?.total ?? 0),
            page: Number(r?.page ?? 1),
            limit: Number(r?.limit ?? 20),
            pages: Number(r?.pages ?? 1),
        }));
    },
    getNotificationUnreadCount: () => fetchWithAuth('/notifications/unread-count'),
    markNotificationRead: (id: string) => fetchWithAuth(`/notifications/${id}/read`, { method: 'PATCH' }),
    markAllNotificationsRead: () => fetchWithAuth('/notifications/read-all', { method: 'PATCH' }),
    // Accounting — Mid-Size Features
    getTrialBalance: (params?: { asOfDate?: string } & ReportScopeParams & ReportLevelParams & ApprovedOnlyParams) => {
        const q = new URLSearchParams();
        if (params?.asOfDate) q.set('asOfDate', params.asOfDate);
        appendReportScopeParams(q, params);
        return fetchWithAuth(`/accounting/reports/trial-balance${q.toString() ? `?${q}` : ''}`);
    },
    listFundTransfers: (params?: { status?: string; sourceStoreId?: string; destinationStoreId?: string }) => {
        const q = new URLSearchParams();
        if (params?.status) q.set('status', params.status);
        if (params?.sourceStoreId) q.set('sourceStoreId', params.sourceStoreId);
        if (params?.destinationStoreId) q.set('destinationStoreId', params.destinationStoreId);
        return fetchWithAuth(`/fund-transfers${q.toString() ? `?${q}` : ''}`);
    },
    getFundTransfer: (id: string) => fetchWithAuth(`/fund-transfers/${id}`),
    initiateFundTransfer: (data: {
        sourceStoreId: string;
        destinationStoreId: string;
        amount: number;
        method?: string;
        description?: string;
    }) => fetchWithAuth('/fund-transfers', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    receiveFundTransfer: (id: string) => fetchWithAuth(`/fund-transfers/${id}/receive`, { method: 'POST' }),
    getArAging: (params?: { asOfDate?: string } & ApprovedOnlyParams) => {
        const q = new URLSearchParams();
        if (params?.asOfDate) q.set('asOfDate', params.asOfDate);
        appendApprovedOnly(q, params);
        return fetchWithAuth(`/accounting/reports/ar-aging${q.toString() ? `?${q}` : ''}`);
    },
    getApAging: (params?: { asOfDate?: string } & ApprovedOnlyParams) => {
        const q = new URLSearchParams();
        if (params?.asOfDate) q.set('asOfDate', params.asOfDate);
        appendApprovedOnly(q, params);
        return fetchWithAuth(`/accounting/reports/ap-aging${q.toString() ? `?${q}` : ''}`);
    },
    getComparativePL: (params?: { from?: string; to?: string } & ApprovedOnlyParams) => {
        const q = new URLSearchParams();
        if (params?.from) q.set('from', params.from);
        if (params?.to) q.set('to', params.to);
        appendApprovedOnly(q, params);
        return fetchWithAuth(`/accounting/reports/comparative-pl${q.toString() ? `?${q}` : ''}`);
    },
    getVatTaxReport: (params?: { from?: string; to?: string } & ApprovedOnlyParams) => {
        const q = new URLSearchParams();
        if (params?.from) q.set('from', params.from);
        if (params?.to) q.set('to', params.to);
        appendApprovedOnly(q, params);
        return fetchWithAuth(`/accounting/reports/vat-tax${q.toString() ? `?${q}` : ''}`);
    },
    getFinancialRatios: (params?: { asOfDate?: string; from?: string; to?: string } & ApprovedOnlyParams) => {
        const q = new URLSearchParams();
        if (params?.asOfDate) q.set('asOfDate', params.asOfDate);
        if (params?.from) q.set('from', params.from);
        if (params?.to) q.set('to', params.to);
        appendApprovedOnly(q, params);
        return fetchWithAuth(`/accounting/reports/financial-ratios${q.toString() ? `?${q}` : ''}`);
    },
    getCashFlow: (params?: { from?: string; to?: string } & ApprovedOnlyParams) => {
        const q = new URLSearchParams();
        if (params?.from) q.set('from', params.from);
        if (params?.to) q.set('to', params.to);
        appendApprovedOnly(q, params);
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
    getBudgetVsActual: (params: { fiscalYear: number; month?: number } & ApprovedOnlyParams) => {
        const q = new URLSearchParams();
        q.set('fiscalYear', String(params.fiscalYear));
        if (params.month) q.set('month', String(params.month));
        appendApprovedOnly(q, params);
        return fetchWithAuth(`/accounting/reports/budget-vs-actual?${q}`);
    },
    // Cost Centers
    listCostCenters: () => fetchWithAuth('/accounting/cost-centers'),
    createCostCenter: (data: any) =>
        fetchWithAuth('/accounting/cost-centers', { method: 'POST', body: JSON.stringify(data) }),
    getCostCenterPL: (params: { costCenterId: string; from?: string; to?: string } & ApprovedOnlyParams) => {
        const q = new URLSearchParams();
        q.set('costCenterId', params.costCenterId);
        if (params.from) q.set('from', params.from);
        if (params.to) q.set('to', params.to);
        appendApprovedOnly(q, params);
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
    // Recurring Vouchers (any voucher type)
    listRecurringVouchers: (params?: { voucherType?: string }) => {
        const query = new URLSearchParams();
        if (params?.voucherType) query.set('voucherType', params.voucherType);
        return fetchWithAuth(`/accounting/recurring-vouchers${query.toString() ? `?${query.toString()}` : ''}`);
    },
    createRecurringVoucher: (data: any) =>
        fetchWithAuth('/accounting/recurring-vouchers', { method: 'POST', body: JSON.stringify(data) }),
    postRecurringVoucher: (id: string) =>
        fetchWithAuth(`/accounting/recurring-vouchers/${id}/post`, { method: 'POST' }),
    deleteRecurringVoucher: (id: string) =>
        fetchWithAuth(`/accounting/recurring-vouchers/${id}`, { method: 'DELETE' }),
    // Voucher Templates
    listVoucherTemplates: (params?: { voucherType?: string }) => {
        const query = new URLSearchParams();
        if (params?.voucherType) query.set('voucherType', params.voucherType);
        return fetchWithAuth(`/accounting/voucher-templates${query.toString() ? `?${query.toString()}` : ''}`);
    },
    getVoucherTemplate: (id: string) => fetchWithAuth(`/accounting/voucher-templates/${id}`),
    createVoucherTemplate: (data: any) =>
        fetchWithAuth('/accounting/voucher-templates', { method: 'POST', body: JSON.stringify(data) }),
    deleteVoucherTemplate: (id: string) =>
        fetchWithAuth(`/accounting/voucher-templates/${id}`, { method: 'DELETE' }),
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
    getExpenseEntries: (params?: { from?: string; to?: string; categoryId?: string }) => {
        const q = new URLSearchParams();
        if (params?.from) q.set('from', params.from);
        if (params?.to) q.set('to', params.to);
        if (params?.categoryId) q.set('categoryId', params.categoryId);
        return fetchAllPages(`/expenses/entries${q.toString() ? `?${q}` : ''}`);
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
    getLoans: (params?: { direction?: string; status?: string; storeId?: string; search?: string }) => {
        const q = new URLSearchParams();
        if (params?.direction) q.set('direction', params.direction);
        if (params?.status) q.set('status', params.status);
        if (params?.storeId) q.set('storeId', params.storeId);
        if (params?.search) q.set('search', params.search);
        return fetchAllPages(`/loans${q.toString() ? `?${q}` : ''}`);
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
    // Investors & profit sharing
    getInvestors: (params?: { status?: string; storeId?: string; search?: string }) => {
        const q = new URLSearchParams();
        if (params?.status) q.set('status', params.status);
        if (params?.storeId) q.set('storeId', params.storeId);
        if (params?.search) q.set('search', params.search);
        return fetchAllPages(`/investors${q.toString() ? `?${q}` : ''}`);
    },
    getInvestorSummary: () => fetchWithAuth('/investors/summary'),
    getInvestor: (id: string) => fetchWithAuth(`/investors/${id}`),
    createInvestor: (data: any) => fetchWithAuth('/investors', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    updateInvestor: (id: string, data: any) => fetchWithAuth(`/investors/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    deleteInvestor: (id: string) => fetchWithAuth(`/investors/${id}`, { method: 'DELETE' }),
    addInvestorCapital: (id: string, data: any) => fetchWithAuth(`/investors/${id}/capital`, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    deleteInvestorCapital: (id: string, txnId: string) =>
        fetchWithAuth(`/investors/${id}/capital/${txnId}`, { method: 'DELETE' }),
    getInvestorProfitRuns: (params?: { year?: number; storeId?: string }) => {
        const q = new URLSearchParams();
        if (params?.year) q.set('year', String(params.year));
        if (params?.storeId) q.set('storeId', params.storeId);
        return fetchAllPages(`/investors/profit-runs${q.toString() ? `?${q}` : ''}`);
    },
    getInvestorProfitRun: (id: string) => fetchWithAuth(`/investors/profit-runs/${id}`),
    previewInvestorProfitRun: (data: any) => fetchWithAuth('/investors/profit-runs/preview', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    createInvestorProfitRun: (data: any) => fetchWithAuth('/investors/profit-runs', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    }),
    deleteInvestorProfitRun: (id: string) =>
        fetchWithAuth(`/investors/profit-runs/${id}`, { method: 'DELETE' }),
    payInvestorProfitShare: (shareId: string, data: any) =>
        fetchWithAuth(`/investors/shares/${shareId}/pay`, {
            method: 'POST',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    // Salary Payments
    getSalaryPayments: (params?: { employeeId?: string; payPeriod?: string; from?: string; to?: string }) => {
        const q = new URLSearchParams();
        if (params?.employeeId) q.set('employeeId', params.employeeId);
        if (params?.payPeriod) q.set('payPeriod', params.payPeriod);
        if (params?.from) q.set('from', params.from);
        if (params?.to) q.set('to', params.to);
        return fetchAllPages(`/salary-payments${q.toString() ? `?${q.toString()}` : ''}`);
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
    // Public — creates an account for an invitee with no existing user, then joins
    // them to the inviting tenant. Caller logs in afterward with the same password.
    acceptInvitationSignup: (data: { token: string; name: string; mobile: string; password: string }) =>
        fetch(`${API_BASE}/invitations/accept-signup`, {
            method: 'POST',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }).then(async res => {
            const body = await res.json().catch(() => null);
            if (!res.ok) {
                const raw = body?.error?.message || body?.message;
                throw new Error(Array.isArray(raw) ? raw[0] : (raw || 'Could not create your account'));
            }
            return body && 'data' in body ? body.data : body;
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
    aiParseVoiceEntry: (data: {
        entryType: string;
        transcript?: string;
        audioBase64?: string;
        audioFormat?: string;
        locale?: string;
    }) =>
        fetchWithAuth('/ai/parse-voice-entry', {
            method: 'POST',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    aiParseVoiceSale: (data: { transcript?: string; audioBase64?: string; audioFormat?: string; locale?: string }) =>
        fetchWithAuth('/ai/parse-voice-sale', {
            method: 'POST',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    // AI data chatbot
    aiChat: (data: { message: string; conversationId?: string; locale?: string }): Promise<AiChatResponse> =>
        fetchWithAuth('/ai/chat', {
            method: 'POST',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    getAiChatTools: (): Promise<{ tools: string[] }> => fetchWithAuth('/ai/chat/tools'),
    getAiConversations: (): Promise<AiChatConversationSummary[]> => fetchWithAuth('/ai/chat/conversations'),
    getAiConversation: (id: string): Promise<AiChatConversationDetail> =>
        fetchWithAuth(`/ai/chat/conversations/${id}`),
    deleteAiConversation: (id: string) => fetchWithAuth(`/ai/chat/conversations/${id}`, { method: 'DELETE' }),
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
    importPaymentMethods: (rows: Record<string, unknown>[], mode: 'skip' | 'upsert') =>
        fetchWithAuth('/payment-methods/import', {
            method: 'POST',
            body: JSON.stringify({ rows, mode }),
            headers: { 'Content-Type': 'application/json' },
        }),
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
    /** Post a parked DRAFT sale for real (stock, payments, accounting). */
    finalizeSale: (id: string, data: any = {}) => fetchWithAuth(`/sales/${id}/finalize`, {
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

    // ── Projects ───────────────────────────────────────────────────────────

    /** One server-paginated page of projects, for `useServerList`. */
    getProjects: (params: {
        page?: number;
        limit?: number;
        search?: string;
        status?: string;
        projectTypeId?: string;
        managerId?: string;
        customerId?: string;
        sortBy?: string;
        sortDir?: 'asc' | 'desc';
    }) => {
        const query = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
        }
        // fetchPaginated, not fetchWithAuth: TransformInterceptor reshapes the
        // service's `{ items, total, … }` into `{ data: items, meta }`, and
        // fetchWithAuth returns the unwrapped `data` — a bare array with no
        // `.items`, which every caller here reads.
        return fetchPaginated(`/projects?${query}`);
    },
    getProject: (id: string) => fetchWithAuth(`/projects/${id}`),
    createProject: (data: Record<string, unknown>) =>
        fetchWithAuth('/projects', {
            method: 'POST',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    updateProject: (id: string, data: Record<string, unknown>) =>
        fetchWithAuth(`/projects/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    deleteProject: (id: string) => fetchWithAuth(`/projects/${id}`, { method: 'DELETE' }),
    getProjectTimeSummary: (id: string) => fetchWithAuth(`/projects/${id}/time-summary`),

    addProjectMember: (projectId: string, data: { userId?: string; employeeId?: string; role?: string }) =>
        fetchWithAuth(`/projects/${projectId}/members`, {
            method: 'POST',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    /** Keyed on the member row — an employee member has no user id. */
    removeProjectMember: (projectId: string, memberId: string) =>
        fetchWithAuth(`/projects/${projectId}/members/${memberId}`, { method: 'DELETE' }),

    createProjectMilestone: (projectId: string, data: Record<string, unknown>) =>
        fetchWithAuth(`/projects/${projectId}/milestones`, {
            method: 'POST',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    updateProjectMilestone: (milestoneId: string, data: Record<string, unknown>) =>
        fetchWithAuth(`/projects/milestones/${milestoneId}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    deleteProjectMilestone: (milestoneId: string) =>
        fetchWithAuth(`/projects/milestones/${milestoneId}`, { method: 'DELETE' }),

    getProjectTypes: (includeInactive = false) =>
        fetchWithAuth(`/projects/types${includeInactive ? '?includeInactive=true' : ''}`),
    createProjectType: (data: { name: string; sortOrder?: number }) =>
        fetchWithAuth('/projects/types', {
            method: 'POST',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    updateProjectType: (id: string, data: Record<string, unknown>) =>
        fetchWithAuth(`/projects/types/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    deleteProjectType: (id: string) => fetchWithAuth(`/projects/types/${id}`, { method: 'DELETE' }),

    getProjectTaskStatuses: (includeInactive = false) =>
        fetchWithAuth(`/projects/task-statuses${includeInactive ? '?includeInactive=true' : ''}`),
    createProjectTaskStatus: (data: { name: string; category: string; sortOrder?: number }) =>
        fetchWithAuth('/projects/task-statuses', {
            method: 'POST',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    updateProjectTaskStatus: (id: string, data: Record<string, unknown>) =>
        fetchWithAuth(`/projects/task-statuses/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    deleteProjectTaskStatus: (id: string) =>
        fetchWithAuth(`/projects/task-statuses/${id}`, { method: 'DELETE' }),

    // Per-project board columns (3L). `getProjectTaskStatuses` above stays the
    // tenant template that new projects are seeded from.
    getProjectColumns: (projectId: string, includeInactive = false) =>
        fetchWithAuth(`/projects/${projectId}/columns?includeInactive=${includeInactive}`),
    createProjectColumn: (
        projectId: string,
        data: { name: string; category: string; wipLimit?: number },
    ) =>
        fetchWithAuth(`/projects/${projectId}/columns`, {
            method: 'POST',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),

    getTaskAttachments: (taskId: string) => fetchWithAuth(`/project-tasks/${taskId}/attachments`),
    addTaskAttachment: (
        taskId: string,
        data: { fileBase64: string; fileName?: string; mimeType?: string },
    ) =>
        fetchWithAuth(`/project-tasks/${taskId}/attachments`, {
            method: 'POST',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    deleteTaskAttachment: (attachmentId: string) =>
        fetchWithAuth(`/project-tasks/attachments/${attachmentId}`, { method: 'DELETE' }),

    getProjectLabels: () => fetchWithAuth('/projects/labels'),
    createProjectLabel: (data: { name: string; color?: string }) =>
        fetchWithAuth('/projects/labels', {
            method: 'POST',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    updateProjectLabel: (id: string, data: Record<string, unknown>) =>
        fetchWithAuth(`/projects/labels/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    deleteProjectLabel: (id: string) =>
        fetchWithAuth(`/projects/labels/${id}`, { method: 'DELETE' }),

    getProjectTasks: (params: Record<string, string | number | undefined>) => {
        const query = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
        }
        return fetchPaginated(`/project-tasks?${query}`);
    },
    /** Kanban passes no sprintId; scrum passes the active sprint's. */
    getProjectBoard: (projectId: string, sprintId?: string) =>
        fetchWithAuth(`/project-tasks/board/${projectId}${sprintId ? `?sprintId=${sprintId}` : ''}`),
    getProjectTask: (id: string) => fetchWithAuth(`/project-tasks/${id}`),
    getTaskRemainingHistory: (id: string) =>
        fetchWithAuth(`/project-tasks/${id}/remaining-history`),
    createProjectTask: (data: Record<string, unknown>) =>
        fetchWithAuth('/project-tasks', {
            method: 'POST',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    updateProjectTask: (id: string, data: Record<string, unknown>) =>
        fetchWithAuth(`/project-tasks/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    moveProjectTask: (
        id: string,
        data: { statusId: string; sortOrder: number; sprintId?: string; clearSprint?: boolean },
    ) =>
        fetchWithAuth(`/project-tasks/${id}/move`, {
            method: 'PATCH',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    deleteProjectTask: (id: string) => fetchWithAuth(`/project-tasks/${id}`, { method: 'DELETE' }),
    addTaskChecklistItem: (taskId: string, data: { text: string }) =>
        fetchWithAuth(`/project-tasks/${taskId}/checklist`, {
            method: 'POST',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    updateTaskChecklistItem: (itemId: string, data: Record<string, unknown>) =>
        fetchWithAuth(`/project-tasks/checklist/${itemId}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    deleteTaskChecklistItem: (itemId: string) =>
        fetchWithAuth(`/project-tasks/checklist/${itemId}`, { method: 'DELETE' }),
    getTaskComments: (taskId: string) => fetchWithAuth(`/project-tasks/${taskId}/comments`),
    addTaskComment: (taskId: string, body: string) =>
        fetchWithAuth(`/project-tasks/${taskId}/comments`, {
            method: 'POST',
            body: JSON.stringify({ body }),
            headers: { 'Content-Type': 'application/json' },
        }),
    updateTaskComment: (commentId: string, body: string) =>
        fetchWithAuth(`/project-tasks/comments/${commentId}`, {
            method: 'PATCH',
            body: JSON.stringify({ body }),
            headers: { 'Content-Type': 'application/json' },
        }),
    deleteTaskComment: (commentId: string) =>
        fetchWithAuth(`/project-tasks/comments/${commentId}`, { method: 'DELETE' }),

    getTaskActivity: (taskId: string) => fetchWithAuth(`/project-tasks/${taskId}/activity`),
    getTaskWatchers: (taskId: string) => fetchWithAuth(`/project-tasks/${taskId}/watchers`),
    watchTask: (taskId: string) =>
        fetchWithAuth(`/project-tasks/${taskId}/watch`, { method: 'POST' }),
    unwatchTask: (taskId: string) =>
        fetchWithAuth(`/project-tasks/${taskId}/watch`, { method: 'DELETE' }),

    // Sends the whole order, not the moved pair — see ReorderChecklistDto.
    reorderTaskChecklist: (taskId: string, itemIds: string[]) =>
        fetchWithAuth(`/project-tasks/${taskId}/checklist/reorder`, {
            method: 'PATCH',
            body: JSON.stringify({ itemIds }),
            headers: { 'Content-Type': 'application/json' },
        }),

    getProjectTimeEntries: (params: Record<string, string | number | undefined>) => {
        const query = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
        }
        return fetchPaginated(`/project-time?${query}`);
    },
    logProjectTime: (data: {
        taskId: string;
        workDate: string;
        hours: number;
        note?: string;
        remainingHours?: number;
    }) =>
        fetchWithAuth('/project-time', {
            method: 'POST',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    deleteProjectTimeEntry: (id: string) => fetchWithAuth(`/project-time/${id}`, { method: 'DELETE' }),

    /** Omit projectId for every sprint in the tenant; pass one to filter by participation. */
    getSprints: (projectId?: string) =>
        fetchWithAuth(`/sprints${projectId ? `?projectId=${projectId}` : ''}`),
    getSprint: (id: string) => fetchWithAuth(`/sprints/${id}`),
    getSprintBurndown: (id: string) => fetchWithAuth(`/sprints/${id}/burndown`),
    rebuildSprintSnapshots: (id: string, overwrite = false) =>
        fetchWithAuth(`/sprints/${id}/rebuild-snapshots${overwrite ? '?overwrite=true' : ''}`, {
            method: 'POST',
        }),
    createSprint: (data: Record<string, unknown>) =>
        fetchWithAuth('/sprints', {
            method: 'POST',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    updateSprint: (id: string, data: Record<string, unknown>) =>
        fetchWithAuth(`/sprints/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
    startSprint: (id: string) => fetchWithAuth(`/sprints/${id}/start`, { method: 'POST' }),
    completeSprint: (id: string) => fetchWithAuth(`/sprints/${id}/complete`, { method: 'POST' }),
    assignTasksToSprint: (id: string, taskIds: string[]) =>
        fetchWithAuth(`/sprints/${id}/tasks`, {
            method: 'POST',
            body: JSON.stringify({ taskIds }),
            headers: { 'Content-Type': 'application/json' },
        }),
    removeTasksFromSprint: (id: string, taskIds: string[]) =>
        fetchWithAuth(`/sprints/${id}/tasks`, {
            method: 'DELETE',
            body: JSON.stringify({ taskIds }),
            headers: { 'Content-Type': 'application/json' },
        }),
    deleteSprint: (id: string) => fetchWithAuth(`/sprints/${id}`, { method: 'DELETE' }),
};
