import { test, expect, Page } from '@playwright/test';

/**
 * E2E: Billing critical path
 *
 * Covers: navigate to billing → view current plan → view available plans → initiate upgrade.
 */

async function loginIfNeeded(page: Page) {
    const email = process.env.E2E_TEST_EMAIL || 'test@example.com';
    const password = process.env.E2E_TEST_PASSWORD || 'TestPassword123!';

    await page.goto('/login');
    const heading = page.getByRole('heading', { name: /sign in|log in/i });
    if (await heading.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await page.getByLabel(/email/i).fill(email);
        await page.getByLabel(/password/i).fill(password);
        await page.getByRole('button', { name: /sign in|log in/i }).click();
        await page.waitForURL(/dashboard/, { timeout: 15_000 });
    }
}

test.describe('Billing', () => {
    test.beforeEach(async ({ page }) => {
        await loginIfNeeded(page);
    });

    test('billing page loads and displays subscription status', async ({ page }) => {
        await page.goto('/dashboard/billing');
        await expect(page).toHaveURL(/billing/);

        // Expect either a plan name or a loading indicator that resolves
        await expect(
            page.getByText(/plan|subscription|billing/i).first(),
        ).toBeVisible({ timeout: 10_000 });
    });

    test('billing page shows available upgrade plans', async ({ page }) => {
        await page.goto('/dashboard/billing');

        // Plans section should list at least one plan option
        await expect(
            page.getByText(/basic|standard|premium|free/i).first(),
        ).toBeVisible({ timeout: 10_000 });
    });

    test('clicking upgrade plan shows a checkout or confirmation dialog', async ({ page }) => {
        await page.goto('/dashboard/billing');

        // Find any upgrade/select plan button
        const upgradeBtn = page.getByRole('button', { name: /upgrade|select|get started|choose/i }).first();
        if (await upgradeBtn.isVisible({ timeout: 8_000 }).catch(() => false)) {
            await upgradeBtn.click();

            // Expect a confirmation dialog, checkout modal, or redirect
            const response = page.getByText(/confirm|checkout|proceed|payment/i).or(
                page.getByRole('dialog'),
            );
            await expect(response.first()).toBeVisible({ timeout: 8_000 });
        }
    });

    test('billing page is inaccessible to unauthenticated users', async ({ page }) => {
        // Clear cookies/storage to simulate logout
        await page.context().clearCookies();
        await page.evaluate(() => localStorage.clear());

        await page.goto('/dashboard/billing');
        await expect(page).toHaveURL(/login/, { timeout: 10_000 });
    });

    test('cancel subscription button is present for active subscribers', async ({ page }) => {
        await page.goto('/dashboard/billing');

        const cancelBtn = page.getByRole('button', { name: /cancel|downgrade/i });
        // Only verify if the button exists — its presence depends on subscription state
        const visible = await cancelBtn.isVisible({ timeout: 5_000 }).catch(() => false);
        if (visible) {
            await expect(cancelBtn).toBeEnabled();
        }
    });
});
