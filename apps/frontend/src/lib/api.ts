const DEFAULT_PROD_API_BASE = 'https://erp71-backend.onrender.com';
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

        throw new Error(message);
    }

    const json = await response.json();
    // Backend wraps all responses in { data: T } — unwrap transparently
    return 'data' in json ? json.data : json;
}