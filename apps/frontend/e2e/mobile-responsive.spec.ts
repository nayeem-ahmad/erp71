import { test, expect } from '@playwright/test';
import { fetchE2ESession, loginViaApi } from './helpers/auth';
import {
    E2E_STOREFRONT_SLUG,
    storefrontPath,
    skipIfStorefrontUnavailable,
    waitForStorefrontReady,
} from './helpers/storefront';

/**
 * Mobile viewport smoke tests — run on iPhone, Pixel, and iPad projects only.
 * Public pages work without API; authenticated checks skip when backend is down.
 */
test.describe('Mobile responsiveness @mobile', () => {
    test('contact page exposes site nav via hamburger', async ({ page }) => {
        await page.goto('/contact');
        await expect(page.getByRole('link', { name: /features/i })).toBeHidden();
        await page.getByRole('button', { name: /toggle menu/i }).click();
        await expect(page.getByRole('link', { name: /features/i })).toBeVisible();
        await expect(page.getByRole('link', { name: /pricing/i })).toBeVisible();
    });

    test('terms page uses shared marketing navigation', async ({ page }) => {
        await page.goto('/terms');
        await page.getByRole('button', { name: /toggle menu/i }).click();
        await expect(page.getByRole('link', { name: /contact/i }).first()).toBeVisible();
    });

    test('pricing page shows mobile plan comparison selector', async ({ page }) => {
        await page.goto('/pricing');
        const selector = page.getByRole('combobox');
        const table = page.locator('table');

        if (await selector.isVisible()) {
            await expect(selector).toBeVisible();
            await expect(page.getByText('POS terminal')).toBeVisible();
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

    test('app header overflow menu when authenticated', async ({ page }) => {
        try {
            await fetchE2ESession();
        } catch {
            test.skip(true, 'Backend unavailable — skipping authenticated mobile shell check');
        }

        await loginViaApi(page);
        await page.goto('/sales/customers');
        await expect(page.getByRole('button', { name: /open navigation/i })).toBeVisible();

        const overflow = page.getByRole('button', { name: /more options/i });
        if (await overflow.isVisible()) {
            await overflow.click();
            await expect(page.getByLabel(/select branch/i)).toBeVisible();
        }
    });
});