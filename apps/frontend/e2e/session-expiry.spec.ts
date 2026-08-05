import { test, expect } from '@playwright/test';
import { E2E_BASE_URL } from './helpers/auth';

/**
 * E2E: an expired session must land the user on /login, not on a dead shell.
 *
 * Regression: the app used to swallow the 401 from /auth/me and render the full
 * chrome anyway — sidebar, menus and header all visible, user name showing "—",
 * every link 401ing behind the scenes. The user had no way to tell they were
 * signed out and no way back to the login page short of clearing storage.
 *
 * These cases drive real navigation, which is the half that unit tests cannot
 * reach: jsdom 26 makes `window.location` non-configurable, so the routing
 * policy is unit-tested in src/lib/session-expiry.test.ts and the navigation
 * itself is verified here.
 *
 * Requires a running frontend (port 3000) and backend (port 4000).
 */

/** Plant a syntactically valid but rejected token, as an expired one would be. */
async function applyExpiredSession(page: import('@playwright/test').Page) {
    await page.goto(E2E_BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem(
            'access_token',
            'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJleHBpcmVkIiwiZXhwIjoxfQ.invalid',
        );
        localStorage.setItem('tenant_id', '00000000-0000-0000-0000-000000000000');
    });
}

test.describe('Expired session', () => {
    test('redirects to login instead of stalling on the app shell', { tag: '@readonly' }, async ({ page }) => {
        await applyExpiredSession(page);

        await page.goto('/sales/orders', { waitUntil: 'domcontentloaded' });

        await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    });

    test('explains why the user was signed out', { tag: '@readonly' }, async ({ page }) => {
        await applyExpiredSession(page);

        await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
        await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

        await expect(page.getByText(/session has expired/i)).toBeVisible({ timeout: 10_000 });
    });

    test('carries the attempted page through as a return path', { tag: '@readonly' }, async ({ page }) => {
        await applyExpiredSession(page);

        await page.goto('/inventory/products', { waitUntil: 'domcontentloaded' });

        await expect(page).toHaveURL(/redirect=%2Finventory%2Fproducts/, { timeout: 15_000 });
    });

    test('clears the dead token so a reload cannot resurrect the stalled shell', { tag: '@readonly' }, async ({ page }) => {
        await applyExpiredSession(page);

        await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
        await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

        const token = await page.evaluate(
            () => localStorage.getItem('access_token') ?? sessionStorage.getItem('access_token'),
        );
        expect(token).toBeNull();
    });

    test('does not leave the dead page in history for the Back button', { tag: '@readonly' }, async ({ page }) => {
        await applyExpiredSession(page);

        await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
        await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

        await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => null);
        await expect(page).not.toHaveURL(/\/dashboard/, { timeout: 10_000 });
    });
});
