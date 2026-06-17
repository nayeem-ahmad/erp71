import { test, expect } from '@playwright/test';

/**
 * Chained critical path: signup → dashboard → billing workspace.
 * POS sale is covered by pos.spec.ts; this spec links auth + billing navigation.
 */
test.describe('Critical launch path', () => {
    test('signup → verify-email pending → dashboard → billing page', async ({ page }) => {
        const timestamp = Date.now();
        const email = `critical-path-${timestamp}@example.com`;

        await page.goto('/signup');
        await page.getByLabel(/your name/i).fill('Critical Path User');
        await page.getByLabel(/email address/i).fill(email);
        await page.getByLabel(/password/i).fill('SecurePassword123!');
        await page.getByLabel(/organization name/i).fill('Critical Workspace');
        await page.getByLabel(/store name/i).fill('Critical Store');
        await page.getByRole('button', { name: /create workspace|sign up|create account|register/i }).click();

        await expect(page).toHaveURL(/verify-email/, { timeout: 15_000 });
        await expect(page.getByText(/check your inbox/i)).toBeVisible();

        await page.getByRole('link', { name: /continue to setup/i }).click();
        await expect(page).toHaveURL(/dashboard\/onboarding/, { timeout: 15_000 });
        await expect(page.getByText(/welcome to retailsaas|get your store/i).first()).toBeVisible();

        await page.goto('/dashboard/billing');
        await expect(page.getByText(/billing|subscription|plan/i).first()).toBeVisible({ timeout: 10_000 });
    });
});