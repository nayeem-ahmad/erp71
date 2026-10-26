import { request } from '@playwright/test';
import { CURRENT_TERMS_VERSION } from '@erp71/shared-types';

/** Login is 10/60s per IP. A 429 must be retried, not treated as "no account". */
async function loginWithThrottleRetry(
    ctx: Awaited<ReturnType<typeof request.newContext>>,
    apiUrl: string,
    email: string,
    password: string,
) {
    let last = await ctx.post(`${apiUrl}/api/v1/auth/login`, {
        data: { email, password },
        failOnStatusCode: false,
    });
    for (let attempt = 1; attempt <= 4 && last.status() === 429; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
        last = await ctx.post(`${apiUrl}/api/v1/auth/login`, {
            data: { email, password },
            failOnStatusCode: false,
        });
    }
    return last;
}

/**
 * Ensures the canonical E2E account exists before the suite runs.
 *
 * Login-gated specs (billing, pos, sidebar-routes, auth "successful login")
 * authenticate as this account. The CI E2E database is created fresh per run,
 * so this signs the account up via the public API; a 409 (already exists) is
 * treated as success so local re-runs against a persistent DB also work.
 *
 * Production smoke uses a pre-provisioned account. A failed login there must
 * not fall through to signup — that used to post `planCode: 'FREE'`, which the
 * API rejects, and abort the nightly before any test body ran.
 */
async function globalSetup() {
    const apiUrl = process.env.E2E_API_URL || 'http://localhost:4000';
    const email = process.env.E2E_TEST_EMAIL || 'test@example.com';
    const password = process.env.E2E_TEST_PASSWORD || 'TestPassword123!';
    const isProductionApi = /erp71\.com/i.test(apiUrl);

    const ctx = await request.newContext();
    try {
        // Nightly prod smoke tests use a pre-provisioned account — verify login first
        // so we don't depend on signup against a live deployment.
        const existingLogin = await loginWithThrottleRetry(ctx, apiUrl, email, password);
        if (existingLogin.ok()) return;

        if (isProductionApi) {
            const body = await existingLogin.text();
            throw new Error(
                `E2E login failed (${existingLogin.status()}) against ${apiUrl}. ` +
                    'Nightly uses a pre-provisioned account and will not sign up there. ' +
                    body.slice(0, 300),
            );
        }

        let lastStatus = 0;
        let lastBody = '';
        // Tenant provisioning runs a multi-step transaction that can occasionally
        // exceed the interactive-transaction timeout under load, returning a 5xx.
        // Retry a few times so a transient signup hiccup doesn't fail the suite.
        for (let attempt = 1; attempt <= 4; attempt++) {
            const res = await ctx.post(`${apiUrl}/api/v1/auth/signup`, {
                data: {
                    name: 'E2E Test User',
                    email,
                    password,
                    tenantName: 'E2E Test Org',
                    storeName: 'E2E Test Store',
                    // FREE is not a self-serve plan; the API rejects it with 400
                    // and the suite never starts. STANDARD is the signup form's default.
                    planCode: 'STANDARD',
                    // Signup refuses an account without it, and a hardcoded
                    // string here would rot silently on the next version bump.
                    acceptedTermsVersion: CURRENT_TERMS_VERSION,
                },
                failOnStatusCode: false,
            });
            lastStatus = res.status();
            // 201/200 = created. 409 = account exists — verify credentials still work.
            if ([200, 201].includes(lastStatus)) return;
            if (lastStatus === 409) {
                const loginRes = await ctx.post(`${apiUrl}/api/v1/auth/login`, {
                    data: { email, password },
                    failOnStatusCode: false,
                });
                if (loginRes.ok()) return;
                lastBody = await loginRes.text();
                throw new Error(
                    `E2E account exists but login failed (${loginRes.status()}). ` +
                        'Reset test@example.com password or delete the user and re-run. ' +
                        lastBody,
                );
            }
            lastBody = await res.text();
            await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
        }
        throw new Error(
            `E2E account provisioning failed after retries: ${lastStatus} ${lastBody}`,
        );
    } finally {
        await ctx.dispose();
    }
}

export default globalSetup;
