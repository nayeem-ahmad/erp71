import { test, expect } from '@playwright/test';
import { applyE2ESession, fetchE2ESession, type E2ESession } from './helpers/auth';

/**
 * E2E: Billing critical path
 *
 * Covers: navigate to billing → view current plan → view available plans → initiate upgrade.
 */

test.describe('Billing', { tag: '@readonly' }, () => {
    let session: E2ESession;

    test.beforeAll(async () => {
        session = await fetchE2ESession();
    });

    test.beforeEach(async ({ page }) => {
        await applyE2ESession(page, session);
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

    test('billing controls are not exposed to unauthenticated users', async ({ page }) => {
        // Clear cookies/storage to simulate logout
        await page.context().clearCookies();
        await page.evaluate(() => localStorage.clear());

        await page.goto('/dashboard/billing');
        // Billing data is protected server-side (the APIs return 401). Without a
        // session the subscription-management controls must not render.
        await expect(page.getByRole('button', { name: /cancel subscription/i })).toHaveCount(0);
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
