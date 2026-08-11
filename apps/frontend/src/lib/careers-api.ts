import type {
    CareersApplication,
    CareersJobDetail,
    CareersJobSummary,
    CareersProfile,
} from '@erp71/shared-types';
import { ApiError } from './api';
import { normalizeApiBase, DEFAULT_LOCAL_API_BASE } from './api-base';

/**
 * The careers portal's API client.
 *
 * Deliberately **not** `lib/api.ts`. That client reads `access_token` and
 * attaches `x-tenant-id`/`x-store-id`, which is exactly wrong here: an
 * applicant token is a different scope the ERP API rejects, and a job seeker
 * belongs to no tenant. Sharing the client would also mean a workspace owner
 * who is also job-hunting could not hold both sessions in one browser —
 * signing into the careers portal would clobber their ERP session and vice
 * versa.
 *
 * Hence a separate storage key. The two sessions are independent on the server
 * (`token_version` vs `applicant_token_version`), and this keeps them
 * independent in the browser too.
 */
const CAREERS_TOKEN_KEY = 'careers_access_token';
const CAREERS_PROFILE_KEY = 'careers_profile';

const API_BASE =
    normalizeApiBase(process.env.NEXT_PUBLIC_API_BASE || process.env.NEXT_PUBLIC_API_URL)
    ?? (process.env.NODE_ENV === 'production' ? '/api/v1' : DEFAULT_LOCAL_API_BASE);

export type CareersSessionProfile = {
    id: string;
    full_name: string;
    email: string;
};

export function getCareersToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(CAREERS_TOKEN_KEY);
}

export function getCareersSessionProfile(): CareersSessionProfile | null {
    if (typeof window === 'undefined') return null;
    const raw = localStorage.getItem(CAREERS_PROFILE_KEY);
    if (!raw) return null;
    try {
        return JSON.parse(raw) as CareersSessionProfile;
    } catch {
        return null;
    }
}

export function saveCareersSession(token: string, profile: CareersSessionProfile) {
    localStorage.setItem(CAREERS_TOKEN_KEY, token);
    localStorage.setItem(CAREERS_PROFILE_KEY, JSON.stringify(profile));
}

export function clearCareersSession() {
    localStorage.removeItem(CAREERS_TOKEN_KEY);
    localStorage.removeItem(CAREERS_PROFILE_KEY);
}

/** The full `{ data, meta }` envelope the backend's TransformInterceptor emits. */
async function requestFull(endpoint: string, options: RequestInit = {}, withAuth = true): Promise<any> {
    const headers = new Headers(options.headers);
    const token = withAuth ? getCareersToken() : null;

    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });

    if (!response.ok) {
        // A dead applicant session drops the local copy so the UI stops
        // pretending to be signed in, then lets the caller redirect.
        if (response.status === 401 && token) clearCareersSession();

        let message = `Request failed: ${response.statusText}`;
        try {
            const body = await response.json();
            const apiMessage = Array.isArray(body?.message)
                ? body.message.join(', ')
                : body?.message || body?.error?.message || body?.error;
            if (typeof apiMessage === 'string') message = apiMessage;
        } catch {
            // Keep the status-text fallback.
        }
        throw new ApiError(message, response.status);
    }

    if (response.status === 204) return null;
    return response.json();
}

/** Returns the unwrapped `data` — see `requestFull` for the paginated endpoint. */
async function request(endpoint: string, options: RequestInit = {}, withAuth = true): Promise<any> {
    const json = await requestFull(endpoint, options, withAuth);
    return json && typeof json === 'object' && 'data' in json ? json.data : json;
}

export type CareersJobFilters = {
    search?: string;
    location?: string;
    employment_type?: string;
    company_id?: string;
    page?: number;
};

function toQuery(filters: Record<string, unknown>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
        if (value === undefined || value === null || value === '' || value === false) continue;
        params.set(key, String(value));
    }
    const query = params.toString();
    return query ? `?${query}` : '';
}

export const careersApi = {
    // ── Public board. Sends the applicant token when there is one, so the
    // listing can mark jobs already applied to; works fine without it.
    listJobs: async (
        filters: CareersJobFilters = {},
    ): Promise<{
        jobs: CareersJobSummary[];
        meta: { page: number; limit: number; total: number; pages: number };
    }> => {
        const json = await requestFull(`/careers/jobs${toQuery(filters)}`);
        const jobs: CareersJobSummary[] = json?.data ?? [];
        return {
            jobs,
            meta: json?.meta ?? { page: 1, limit: jobs.length, total: jobs.length, pages: 1 },
        };
    },

    getJob: (id: string): Promise<CareersJobDetail> => request(`/careers/jobs/${id}`),

    listCompanies: (): Promise<{ id: string; name: string; open_jobs: number }[]> =>
        request('/careers/companies', {}, false),

    // ── Auth ──────────────────────────────────────────────────────────────────
    register: (payload: {
        email: string;
        password: string;
        full_name: string;
        phone: string;
    }): Promise<{
        access_token?: string;
        applicant?: CareersSessionProfile;
        requires_2fa?: boolean;
        user_id?: string;
    }> => request('/careers/auth/register', { method: 'POST', body: JSON.stringify(payload) }, false),

    login: (payload: {
        email: string;
        password: string;
    }): Promise<{
        access_token?: string;
        applicant?: CareersSessionProfile;
        requires_2fa?: boolean;
        user_id?: string;
    }> => request('/careers/auth/login', { method: 'POST', body: JSON.stringify(payload) }, false),

    verifyTwoFactor: (payload: {
        userId: string;
        code: string;
    }): Promise<{ access_token: string; applicant: CareersSessionProfile }> =>
        request('/careers/auth/2fa/verify', { method: 'POST', body: JSON.stringify(payload) }, false),

    logout: (): Promise<{ success: boolean }> =>
        request('/careers/auth/logout', { method: 'POST' }),

    // ── Portal ────────────────────────────────────────────────────────────────
    getProfile: (): Promise<CareersProfile> => request('/careers/portal/me'),

    updateProfile: (payload: Partial<CareersProfile>): Promise<CareersProfile> =>
        request('/careers/portal/me', { method: 'PATCH', body: JSON.stringify(payload) }),

    uploadResume: (file: File): Promise<CareersProfile> => {
        const form = new FormData();
        form.append('file', file);
        return request('/careers/portal/me/resume', { method: 'POST', body: form });
    },

    listApplications: (): Promise<CareersApplication[]> => request('/careers/portal/applications'),

    getApplication: (id: string): Promise<CareersApplication> =>
        request(`/careers/portal/applications/${id}`),

    apply: (
        jobId: string,
        payload: { cover_letter?: string; expected_salary?: number },
    ): Promise<CareersApplication> =>
        request(`/careers/portal/jobs/${jobId}/apply`, {
            method: 'POST',
            body: JSON.stringify(payload),
        }),

    withdraw: (id: string): Promise<CareersApplication> =>
        request(`/careers/portal/applications/${id}/withdraw`, { method: 'PATCH' }),
};
