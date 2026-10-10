import { test, expect, Page, ConsoleMessage } from '@playwright/test';
import { E2E_BASE_URL, applyE2ESession, fetchE2ESession, type E2ESession } from './helpers/auth';
import { NAV_ROUTES } from './helpers/nav-routes';
import { gotoSettled } from './helpers/navigation';

const BASE = E2E_BASE_URL;
const ROUTES = NAV_ROUTES;

// Errors that indicate a real problem (not just warnings)
const FATAL_PATTERNS = [
    /error\s+boundary/i,
    /application error/i,
    /something went wrong/i,
    /unhandled.*exception/i,
    /chunk load error/i,
    /hydration.*failed/i,
    /hydration mismatch/i,
    /cannot read propert/i,
    /is not a function/i,
    /is not defined/i,
    /failed to fetch/i,
    /network error/i,
    // Use a narrow pattern to catch Next.js 500 pages without matching monetary values like "৳500"
    /500\s*\|\s*internal server error/i,
];

// Console error patterns to flag (less strict for warnings)
const CONSOLE_ERROR_IGNORE = [
    /sentry/i,
    /metaDescription/i,
    /favicon/i,
    /webpack/i,
    /hot.*update/i,
    /DevTools/i,
    /supabase.*realtime/i,
    /ExperimentalWarning/i,
    /DeprecationWarning/i,
    /Download the React DevTools/i,
    /upstash/i,
    /sms.*log/i,
    /resend/i,
    /BILLING_PROVIDER/i,
];

test.describe('Sidebar navigation — all routes load without errors', { tag: '@readonly' }, () => {
    let session: E2ESession;

    test.beforeAll(async () => {
        session = await fetchE2ESession();
    });

    for (const route of ROUTES) {
        test(`${route.label} (${route.path})`, async ({ page }) => {
            const consoleErrors: string[] = [];
            const networkErrors: string[] = [];

            // Capture console errors
            page.on('console', (msg: ConsoleMessage) => {
                if (msg.type() === 'error') {
                    const text = msg.text();
                    const ignored = CONSOLE_ERROR_IGNORE.some((p) => p.test(text));
                    if (!ignored) consoleErrors.push(text);
                }
            });

            // Capture failed network requests (4xx/5xx from our API)
            page.on('response', (response) => {
                const url = response.url();
                const status = response.status();
                if (url.includes('localhost:4000') && status >= 400 && status !== 401 && status !== 403) {
                    networkErrors.push(`${status} ${url}`);
                }
            });

            await applyE2ESession(page, session);

            // Navigate to the route
            await gotoSettled(page, `${BASE}${route.path}`);

            // Check we weren't redirected to login (unauthenticated)
            const finalUrl = page.url();
            const redirectedToLogin = finalUrl.includes('/login') || finalUrl.includes('/auth');
            if (redirectedToLogin) {
                console.log(`  ⚠ Redirected to login: ${finalUrl}`);
            }

            // Check page body for fatal error text
            const bodyText = await page.locator('body').innerText().catch(() => '');
            const fatalInBody = FATAL_PATTERNS.filter((p) => p.test(bodyText));

            // Check for Next.js error overlay
            const errorOverlay = await page.locator('nextjs-portal, #__next-error, [data-nextjs-dialog]').count();

            // Build result
            const issues: string[] = [
                ...(redirectedToLogin ? [`Redirected to login (${finalUrl})`] : []),
                ...fatalInBody.map((p) => `Fatal text in body: ${p}`),
                ...(errorOverlay > 0 ? ['Next.js error overlay visible'] : []),
                ...consoleErrors.slice(0, 3).map((e) => `Console error: ${e.substring(0, 120)}`),
                ...networkErrors.slice(0, 3).map((e) => `Network error: ${e}`),
            ];

            if (issues.length > 0) {
                console.log(`\n  ISSUES on ${route.path}:\n${issues.map((i) => `    - ${i}`).join('\n')}`);
            }

            // Fail the test only for genuine fatal errors (not console warnings)
            const fatalIssues = [
                ...fatalInBody,
                ...(errorOverlay > 0 ? ['error overlay'] : []),
                ...networkErrors,
            ];
            expect(fatalIssues, `Fatal issues on ${route.path}`).toHaveLength(0);
        });
    }
});
