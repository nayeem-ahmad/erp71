import { test, expect, type Page } from '@playwright/test';
import { E2E_BASE_URL, applyE2ESession, fetchE2ESession, sessionHasAccountingAccess } from './helpers/auth';

const HUB_PAGES = [
    { path: '/sales', label: 'Sales Hub' },
    { path: '/purchases', label: 'Purchases Hub' },
    { path: '/inventory', label: 'Inventory Hub' },
    { path: '/hr', label: 'HR Hub' },
    { path: '/accounting', label: 'Accounting Hub' },
    { path: '/settings', label: 'Settings Quick Links' },
];

/** Requires platform-admin context — skipped when the shop E2E user is redirected away. */
const ADMIN_HUB_PAGES = [
    { path: '/admin', label: 'Admin Hub' },
    { path: '/admin/platform-settings', label: 'Platform Settings Hub' },
];

const FATAL_PATTERNS = [
    /error\s+boundary/i,
    /application error/i,
    /something went wrong/i,
    /500\s*\|\s*internal server error/i,
];

async function assertHubLinks(page: Page, hubPath: string) {
    const networkErrors: string[] = [];

    page.on('response', (response) => {
        const url = response.url();
        const status = response.status();
        if (url.includes('localhost:4000') && status >= 400 && status !== 401 && status !== 403) {
            networkErrors.push(`${status} ${url}`);
        }
    });

    // Compact hubs (ModuleHub → CompactLinkGrid) render card titles as
    // `text-sm font-semibold`; older hubs use headings / `text-sm font-bold`.
    const cardLinks = page.locator('a[href^="/"]').filter({
        has: page.locator('h2, h3, .text-sm.font-bold, .text-sm.font-semibold'),
    });

    const hrefs = await cardLinks.evaluateAll((anchors) =>
        [...new Set(
            anchors
                .map((a) => a.getAttribute('href'))
                .filter((href): href is string => !!href && href.startsWith('/') && !href.startsWith('//')),
        )],
    );

    expect(hrefs.length, `Expected hub cards on ${hubPath}`).toBeGreaterThan(0);

    for (const href of hrefs) {
        await page.goto(`${E2E_BASE_URL}${href}`, { waitUntil: 'networkidle', timeout: 15000 });

        const finalUrl = page.url();
        expect(finalUrl, `Redirected to login from ${href}`).not.toMatch(/\/login|\/auth/);

        const bodyText = await page.locator('body').innerText().catch(() => '');
        const fatalInBody = FATAL_PATTERNS.some((p) => p.test(bodyText));
        expect(fatalInBody, `Fatal error on ${href}`).toBe(false);

        const errorOverlay = await page.locator('nextjs-portal, #__next-error, [data-nextjs-dialog]').count();
        expect(errorOverlay, `Error overlay on ${href}`).toBe(0);
    }

    expect(networkErrors, `API errors from ${hubPath} links`).toHaveLength(0);
}

test.describe('Hub & quick-link navigation', { tag: '@readonly' }, () => {
    test.beforeAll(async () => {
        await fetchE2ESession();
    });

    for (const hub of HUB_PAGES) {
        test(`${hub.label} cards navigate without errors`, async ({ page }) => {
            const session = await fetchE2ESession();
            await applyE2ESession(page, session);
            await page.goto(`${E2E_BASE_URL}${hub.path}`, { waitUntil: 'networkidle', timeout: 15000 });

            if (hub.path === '/accounting' && !sessionHasAccountingAccess(session)) {
                test.skip(true, 'E2E smoke account lacks accounting plan — hub gated');
            }
            if (!page.url().includes(hub.path)) {
                test.skip(true, `E2E user redirected away from ${hub.path}`);
            }

            await assertHubLinks(page, hub.path);
        });
    }

    for (const hub of ADMIN_HUB_PAGES) {
        test(`${hub.label} cards navigate without errors`, async ({ page }) => {
            const session = await fetchE2ESession();
            await applyE2ESession(page, session);
            await page.goto(`${E2E_BASE_URL}${hub.path}`, { waitUntil: 'networkidle', timeout: 15000 });

            if (!page.url().includes(hub.path)) {
                test.skip(true, 'Shop E2E user is not a platform admin — admin hub cards not visible');
            }

            await assertHubLinks(page, hub.path);
        });
    }
});