import { expect, Page } from '@playwright/test';

/** Canonical public storefront for mobile/responsive E2E smoke tests. */
export const E2E_STOREFRONT_SLUG = process.env.E2E_STOREFRONT_SLUG || 'nayeem-store';

export function storefrontPath(segment = '') {
    const base = `/store/${E2E_STOREFRONT_SLUG}`;
    return segment ? `${base}/${segment.replace(/^\//, '')}` : base;
}

/** Wait until the storefront shell has finished loading (or 404). */
export async function waitForStorefrontReady(page: Page) {
    await page.waitForLoadState('domcontentloaded');
    await expect(
        page.getByRole('heading', { name: /store not found/i }).or(page.locator('main h1').first()),
    ).toBeVisible({ timeout: 20_000 });
}

export async function skipIfStorefrontUnavailable(page: Page) {
    if (await page.getByRole('heading', { name: /store not found/i }).isVisible().catch(() => false)) {
        return true;
    }
    return false;
}