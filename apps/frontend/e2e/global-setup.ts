import { request } from '@playwright/test';

/**
 * Ensures the canonical E2E account exists before the suite runs.
 *
 * Login-gated specs (billing, pos, sidebar-routes, auth "successful login")
 * authenticate as this account. The CI E2E database is created fresh per run,
 * so this signs the account up via the public API; a 409 (already exists) is
 * treated as success so local re-runs against a persistent DB also work.
 */
async function globalSetup() {
    const apiUrl = process.env.E2E_API_URL || 'http://localhost:4000';
    const email = process.env.E2E_TEST_EMAIL || 'test@example.com';
    const password = process.env.E2E_TEST_PASSWORD || 'TestPassword123!';

    const ctx = await request.newContext();
    try {
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
                    planCode: 'FREE',
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
