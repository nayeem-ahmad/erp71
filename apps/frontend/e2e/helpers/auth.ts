import { expect, Page } from '@playwright/test';

export const E2E_EMAIL = process.env.E2E_TEST_EMAIL || 'test@example.com';
export const E2E_PASSWORD = process.env.E2E_TEST_PASSWORD || 'TestPassword123!';
export const E2E_API_URL = process.env.E2E_API_URL || 'http://localhost:4000';
export const E2E_BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';

export type E2ESession = {
    accessToken: string;
    tenantId: string;
    storeId: string;
    planCode?: string;
};

let cachedSession: E2ESession | null = null;

/** Authenticate via the public login API (fast, no UI flake). Cached per worker. */
export async function fetchE2ESession(force = false): Promise<E2ESession> {
    if (!force && cachedSession) return cachedSession;
    const res = await fetch(`${E2E_API_URL}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: E2E_EMAIL, password: E2E_PASSWORD }),
    });

    if (!res.ok) {
        throw new Error(`E2E login failed: ${res.status} ${await res.text()}`);
    }

    const body = await res.json();
    const tenant = body.data.tenants[0];
    if (!tenant?.stores?.[0]?.id) {
        throw new Error('E2E login response missing tenant/store context');
    }

    cachedSession = {
        accessToken: body.data.access_token,
        tenantId: tenant.id,
        storeId: tenant.stores[0].id,
        planCode: tenant.subscription?.plan?.code,
    };
    return cachedSession;
}

/** Inject an authenticated shop session into the browser. */
export async function applyE2ESession(page: Page, session: E2ESession) {
    await page.goto(E2E_BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.evaluate(
        ({ accessToken, tenantId, storeId, planCode }) => {
            localStorage.setItem('access_token', accessToken);
            localStorage.setItem('tenant_id', tenantId);
            localStorage.setItem('store_id', storeId);
            localStorage.removeItem('active_context');
            localStorage.removeItem('demo_session');
            if (planCode) {
                localStorage.setItem('subscription_plan_code', planCode);
            }
        },
        session,
    );
}

/** Preferred login for specs that only need an authenticated dashboard session. */
export async function loginViaApi(page: Page, session?: E2ESession) {
    await applyE2ESession(page, session ?? (await fetchE2ESession()));
}

/** Pick the first shop workspace when the account chooser is shown. */
async function pickWorkspaceIfNeeded(page: Page) {
    if (!page.url().includes('/select-account')) return;

    await expect(page.getByRole('heading', { name: /choose a workspace/i })).toBeVisible({
        timeout: 15_000,
    });

    await page
        .getByRole('button', { name: /owner ·|member ·/i })
        .first()
        .click();

    await page.waitForURL(/dashboard/, { timeout: 15_000, waitUntil: 'commit' });
}

/**
 * Log in through the UI and land on the dashboard.
 * Use only in specs that explicitly exercise the login form.
 */
export async function loginViaUi(page: Page) {
    await page.context().clearCookies();
    await page.goto('/login', { waitUntil: 'domcontentloaded' });

    if (page.url().includes('/dashboard')) return;

    if (page.url().includes('/select-account')) {
        await pickWorkspaceIfNeeded(page);
        return;
    }

    await page.getByLabel(/email/i).fill(E2E_EMAIL);
    await page.getByLabel(/password/i).fill(E2E_PASSWORD);
    await page.getByRole('button', { name: /sign in|log in/i }).click();
    await page.waitForURL(/select-account|dashboard/, { timeout: 30_000 });
    await pickWorkspaceIfNeeded(page);
}