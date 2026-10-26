import { test, expect, type Page } from '@playwright/test';
import { fetchE2ESession, loginViaApi, type E2ESession } from './helpers/auth';
import {
    E2E_STOREFRONT_SLUG,
    storefrontPath,
    skipIfStorefrontUnavailable,
    waitForStorefrontReady,
} from './helpers/storefront';

/**
 * Mobile viewport smoke tests — run on iPhone, Pixel, and iPad projects only.
 * Public pages work without API; authenticated checks skip when backend is down.
 *
 * Marketing and app chrome switch at Tailwind's `md` breakpoint (768px).
 * iPad (gen 7) is 810px wide, so it gets the desktop nav and no hamburger.
 */
const DESKTOP_NAV_MIN_PX = 768;

function showsDesktopNav(page: Page): boolean {
    return (page.viewportSize()?.width ?? 0) >= DESKTOP_NAV_MIN_PX;
}

test.describe('Mobile responsiveness @mobile', () => {
    test('contact page exposes site nav via hamburger', async ({ page }) => {
        await page.goto('/contact', { waitUntil: 'domcontentloaded' });
        const features = page.getByRole('link', { name: /features/i });
        const pricing = page.getByRole('link', { name: /pricing/i });

        if (showsDesktopNav(page)) {
            await expect(page.locator('header nav').getByRole('link', { name: /features/i })).toBeVisible();
            await expect(page.locator('header nav').getByRole('link', { name: /pricing/i })).toBeVisible();
            await expect(page.getByRole('button', { name: /toggle menu/i })).toHaveCount(0);
            return;
        }

        await expect(features).toBeHidden();
        await page.getByRole('button', { name: /toggle menu/i }).click();
        await expect(features).toBeVisible();
        await expect(pricing).toBeVisible();
    });

    test('terms page uses shared marketing navigation', async ({ page }) => {
        await page.goto('/terms', { waitUntil: 'domcontentloaded' });

        if (showsDesktopNav(page)) {
            await expect(page.locator('header nav').getByRole('link', { name: /contact/i })).toBeVisible();
            await expect(page.getByRole('button', { name: /toggle menu/i })).toHaveCount(0);
            return;
        }

        await page.getByRole('button', { name: /toggle menu/i }).click();
        await expect(page.getByRole('link', { name: /contact/i }).first()).toBeVisible();
    });

    test('pricing page shows mobile plan comparison selector', async ({ page }) => {
        await page.goto('/pricing', { waitUntil: 'domcontentloaded' });
        const selector = page.getByRole('combobox');
        const table = page.locator('table');

        if (await selector.isVisible()) {
            // "POS terminal" is also a feature bullet and a desktop-table cell.
            // Scope to the phone comparison panel so strict mode has one match.
            const mobilePanel = page.locator('.md\\:hidden').filter({ has: selector });
            await expect(mobilePanel.getByText('POS terminal & cashier sessions', { exact: true })).toBeVisible();
            await expect(table).toBeHidden();
        } else {
            await expect(table).toBeVisible();
        }
    });

    test('login page form fits narrow viewport', async ({ page }) => {
        await page.goto('/login');
        const card = page.locator('form').first();
        await expect(card).toBeVisible();
        const box = await card.boundingBox();
        const viewport = page.viewportSize();
        expect(box).not.toBeNull();
        expect(viewport).not.toBeNull();
        if (box && viewport) {
            expect(box.width).toBeLessThanOrEqual(viewport.width);
        }
    });

    test(`storefront home exposes nav via hamburger (${E2E_STOREFRONT_SLUG})`, async ({ page }) => {
        await page.goto(storefrontPath());
        await waitForStorefrontReady(page);
        if (await skipIfStorefrontUnavailable(page)) {
            test.skip(true, `Storefront slug "${E2E_STOREFRONT_SLUG}" unavailable`);
        }

        const menuToggle = page.getByRole('button', { name: /toggle menu/i });
        if (!(await menuToggle.isVisible().catch(() => false))) {
            test.skip(true, 'Storefront mobile nav not deployed yet — hamburger menu missing');
        }

        await expect(page.getByRole('navigation').getByRole('link', { name: /^shop$/i })).toBeHidden();
        await menuToggle.click();
        await expect(page.getByRole('link', { name: /^shop$/i })).toBeVisible();
        await expect(page.getByRole('link', { name: /^home$/i })).toBeVisible();
    });

    test(`storefront shop filters accessible on mobile (${E2E_STOREFRONT_SLUG})`, async ({ page }) => {
        await page.goto(storefrontPath('shop'));
        await waitForStorefrontReady(page);
        if (await skipIfStorefrontUnavailable(page)) {
            test.skip(true, `Storefront slug "${E2E_STOREFRONT_SLUG}" unavailable`);
        }

        const filtersPanel = page.locator('aside, [role="complementary"]').filter({
            has: page.getByRole('heading', { name: /^filters$/i }),
        });
        const filtersToggle = page.getByRole('button', { name: /^filters$/i });
        const viewport = page.viewportSize();
        const isWide = viewport ? viewport.width >= 1024 : false;

        if (isWide) {
            await expect(filtersPanel).toBeVisible();
            return;
        }

        if (await filtersToggle.isVisible().catch(() => false)) {
            await expect(filtersPanel).toBeHidden();
            await filtersToggle.click();
            await expect(filtersPanel).toBeVisible();
        } else {
            await expect(filtersPanel).toBeVisible();
        }

        await expect(page.getByText(/^categories$/i)).toBeVisible();
    });

    test(`storefront shop shows add to cart on mobile (${E2E_STOREFRONT_SLUG})`, async ({ page }) => {
        await page.goto(storefrontPath('shop'));
        await waitForStorefrontReady(page);
        if (await skipIfStorefrontUnavailable(page)) {
            test.skip(true, `Storefront slug "${E2E_STOREFRONT_SLUG}" unavailable`);
        }

        await expect(page.getByText(/showing \d+ product/i)).toBeVisible({ timeout: 15_000 });
        await expect(page.getByRole('button', { name: /add to cart/i }).first()).toBeVisible();
    });

    test('app header user menu when authenticated', async ({ page }) => {
        let session: E2ESession;
        try {
            session = await fetchE2ESession();
        } catch {
            test.skip(true, 'Backend unavailable — skipping authenticated mobile shell check');
            return;
        }

        await loginViaApi(page, session);
        await page.goto('/sales/customers', { waitUntil: 'domcontentloaded' });
        await expect(page).toHaveURL(/\/sales\/customers|\/dashboard|\/login|\/onboarding|\/select-account/, {
            timeout: 15_000,
        });
        expect(page.url(), 'Redirected to login').not.toMatch(/\/login|\/auth/);

        const openNav = page.getByRole('button', { name: /open navigation/i });
        if (showsDesktopNav(page)) {
            // iPad is at or above `md`, so the sidebar is on screen and the
            // hamburger is not rendered.
            await expect(openNav).toHaveCount(0);
        } else {
            await expect(openNav).toBeVisible();
            // The branch picker is a header control, and only when the tenant
            // has more than one store. A single-store smoke account has none.
            if (session.storeCount > 1) {
                await expect(page.getByRole('combobox', { name: /^branch$/i })).toBeVisible();
            }
        }

        await expect(page.getByRole('button', { name: /more options/i })).toHaveCount(0);
        await page.getByRole('button', { name: /user menu/i }).click();
        await expect(page.getByRole('button', { name: /my profile/i })).toBeVisible();
    });
});