import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { E2E_API_URL, E2E_BASE_URL } from './auth';

export type DemoSession = {
    accessToken: string;
    tenantId: string;
    storeId: string;
    planCode?: string;
    email?: string;
};

let cachedDemoSession: DemoSession | null = null;

const DEMO_SESSION_CACHE_TTL_MS = 30 * 60 * 1000;

type CachedDemoSessionFile = DemoSession & { fetchedAt?: number };

function demoSessionCachePath() {
    return (
        process.env.E2E_DEMO_SESSION_FILE
        ?? path.join(process.cwd(), 'e2e', '.cache', 'demo-session.json')
    );
}

async function readDemoSessionCache(allowStale = false): Promise<DemoSession | null> {
    try {
        const raw = await readFile(demoSessionCachePath(), 'utf8');
        const parsed = JSON.parse(raw) as CachedDemoSessionFile;
        if (!parsed.accessToken || !parsed.tenantId || !parsed.storeId) return null;
        if (
            !allowStale
            && parsed.fetchedAt
            && Date.now() - parsed.fetchedAt > DEMO_SESSION_CACHE_TTL_MS
        ) {
            return null;
        }
        return {
            accessToken: parsed.accessToken,
            tenantId: parsed.tenantId,
            storeId: parsed.storeId,
            planCode: parsed.planCode,
            email: parsed.email,
        };
    } catch {
        return null;
    }
}

async function sleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithThrottleRetry(url: string, init?: RequestInit, attempts = 10): Promise<Response> {
    let lastRes: Response | null = null;
    for (let i = 0; i < attempts; i++) {
        const res = await fetch(url, init);
        if (res.status !== 429) return res;
        lastRes = res;
        await sleep(Math.min((i + 1) * 2000, 15_000));
    }
    return lastRes!;
}

/**
 * Authenticate via POST /auth/demo (Demo Store tenant with STANDARD plan +
 * seeded products, customers, suppliers, and accounting).
 */
export async function fetchDemoSession(force = false): Promise<DemoSession> {
    if (!force && cachedDemoSession) return cachedDemoSession;

    if (!force) {
        const fromFile = await readDemoSessionCache();
        if (fromFile) {
            cachedDemoSession = fromFile;
            return fromFile;
        }
    }

    const res = await fetchWithThrottleRetry(`${E2E_API_URL}/api/v1/auth/demo`, { method: 'POST' });
    if (!res.ok) {
        const stale = await readDemoSessionCache(true);
        if (stale) {
            cachedDemoSession = stale;
            return stale;
        }
        const body = await res.text();
        throw new Error(
            `Demo login failed (${res.status}). Seed the demo account first ` +
                `(npm run db:seed in packages/database). For local E2E, run backend with ` +
                `THROTTLE_LIMIT=100000. Response: ${body}`,
        );
    }

    const body = await res.json();
    const tenant = body.data?.tenants?.[0];
    const store = tenant?.stores?.[0];
    if (!body.data?.access_token || !tenant?.id || !store?.id) {
        throw new Error('Demo login response missing access_token, tenant, or store');
    }

    cachedDemoSession = {
        accessToken: body.data.access_token,
        tenantId: tenant.id,
        storeId: store.id,
        planCode: tenant.subscription?.plan?.code,
        email: body.data.user?.email,
    };
    return cachedDemoSession;
}

/** Inject a demo session, split across the backends the production client uses. */
export async function applyDemoSession(page: Page, session: DemoSession) {
    await page.goto(E2E_BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.evaluate(
        ({ accessToken, tenantId, storeId, planCode }) => {
            localStorage.setItem('access_token', accessToken);
            sessionStorage.setItem('tenant_id', tenantId);
            sessionStorage.setItem('store_id', storeId);
            localStorage.setItem('last_tenant_id', tenantId);
            sessionStorage.removeItem('active_context');
            localStorage.setItem('demo_session', '1');
            localStorage.setItem('onboarding_complete', '1');
            if (planCode) {
                sessionStorage.setItem('subscription_plan_code', planCode);
            }
        },
        session,
    );
}

export async function dismissDemoBannerIfPresent(page: Page) {
    const dismiss = page.getByRole('button', { name: /dismiss demo banner/i });
    if (await dismiss.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await dismiss.click();
    }
}

export function authHeaders(session: DemoSession): Record<string, string> {
    return {
        Authorization: `Bearer ${session.accessToken}`,
        'x-tenant-id': session.tenantId,
        'x-store-id': session.storeId,
        'Content-Type': 'application/json',
    };
}

/** Quick sanity check that the demo tenant has catalog data. */
export async function assertDemoCatalogReady(session: DemoSession) {
    const res = await fetchWithThrottleRetry(`${E2E_API_URL}/api/v1/products?limit=5`, {
        headers: authHeaders(session),
    });
    expect(res.ok).toBeTruthy();
    const body = await res.json();
    const items = body.data?.items ?? body.data ?? [];
    expect(Array.isArray(items) ? items.length : 0).toBeGreaterThan(0);
}