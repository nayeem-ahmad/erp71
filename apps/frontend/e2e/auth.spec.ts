import { test, expect } from '@playwright/test';
import { loginViaApi, loginViaUi } from './helpers/auth';

/**
 * E2E: Signup → Login critical path
 *
 * These tests cover the authentication flows that gate all other features.
 * They require a running frontend (port 3000) and backend (port 4000).
 */

test.describe('Authentication', () => {
    // Read-only prod smoke: credentials are verified via API (global-setup + billing/POS
    // specs). UI form wiring is covered by the wrong-credentials case below; a second
    // UI submit hits prod login rate limits after global-setup already authenticated.
    test('successful login grants dashboard access', { tag: '@readonly' }, async ({ page }) => {
        await loginViaApi(page);
        await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
        await expect(page).toHaveURL(/dashboard/, { timeout: 15_000 });

        // Business Monitor v2 redesign: the redesigned section headings render
        // (read-only — assertions only, no data mutation).
        await expect(page.getByText('Business health')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText('Sales by category')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText('Top customers')).toBeVisible({ timeout: 15_000 });
    });

    test('successful UI login redirects to dashboard', async ({ page }) => {
        await loginViaUi(page);
        await expect(page).toHaveURL(/dashboard|onboarding/, { timeout: 15_000 });
    });

    test('signup page renders and validates required fields', { tag: '@readonly' }, async ({ page }) => {
        await page.goto('/signup', { waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('heading', { name: /create your erp71 workspace|create your workspace|sign up|create account|register/i })).toBeVisible();

        // Current form: email, optional mobile, password, organization, terms.
        // There is no "your name" or "store name" field. Submit is not sent —
        // native `required` blocks an empty email, so this stays read-only.
        await expect(page.locator('#signup-email')).toBeVisible();
        await expect(page.locator('#signup-password')).toBeVisible();
        await expect(page.locator('#signup-organization')).toBeVisible();
        await expect(page.locator('#signup-terms')).toBeVisible();

        await page.getByRole('button', { name: /create workspace|sign up|create account|register/i }).click();
        await expect(page).toHaveURL(/\/signup/);
        const emailInvalid = await page
            .locator('#signup-email')
            .evaluate((el) => (el as HTMLInputElement).validity.valueMissing);
        expect(emailInvalid).toBe(true);
    });

    test('login page renders and shows error for wrong credentials', { tag: '@readonly' }, async ({ page }) => {
        await page.goto('/login');
        await expect(page.getByRole('heading', { name: /welcome back|sign in|log in/i })).toBeVisible();

        await page.getByLabel(/email/i).fill('wrong@example.com');
        await page.getByLabel(/password/i).fill('wrongpassword');
        await page.getByRole('button', { name: /sign in|log in/i }).click();

        // Expect an error message (invalid credentials)
        await expect(page.getByText(/invalid|incorrect|unauthorized|error/i)).toBeVisible({ timeout: 10_000 });
    });

    test('successful signup redirects after creating a workspace', async ({ page }) => {
        const timestamp = Date.now();
        const email = `e2e-test-${timestamp}@example.com`;

        await page.goto('/signup', { waitUntil: 'domcontentloaded' });

        await page.locator('#signup-email').fill(email);
        const mobile = page.locator('#signup-mobile');
        if ((await mobile.count()) > 0 && (await mobile.getAttribute('required')) !== null) {
            await mobile.fill('01712345678');
        }
        await page.locator('#signup-password').fill('SecurePassword123!');
        await page.locator('#signup-organization').fill(`E2E Org ${timestamp}`);
        await page.locator('#signup-terms').check();

        await page.getByRole('button', { name: /create workspace|sign up|create account|register/i }).click();

        // New accounts are unverified, so the app routes to email verification;
        // a configured-verified environment lands on the dashboard/onboarding.
        await expect(page).toHaveURL(/verify-email|dashboard|onboarding/, { timeout: 15_000 });
    });

    test('navigating to dashboard while logged out does not show the dashboard', { tag: '@readonly' }, async ({ page }) => {
        // No auth token present. Data is protected server-side (APIs return 401);
        // the shell bounces an unauthenticated visitor off the functional
        // dashboard to either login or the onboarding gate.
        await page.goto('/dashboard');
        await expect(page).toHaveURL(/login|onboarding/, { timeout: 10_000 });
    });
});
