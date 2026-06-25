import { test, expect } from '@playwright/test';
import { loginViaUi } from './helpers/auth';

/**
 * E2E: Signup → Login critical path
 *
 * These tests cover the authentication flows that gate all other features.
 * They require a running frontend (port 3000) and backend (port 4000).
 */

test.describe('Authentication', () => {
    // UI login is sensitive to auth rate limits — run before signup creates extra traffic.
    test('successful login redirects to dashboard', { tag: '@readonly' }, async ({ page }) => {
        await loginViaUi(page);
        await expect(page).toHaveURL(/dashboard/, { timeout: 15_000 });
    });

    test('signup page renders and validates required fields', { tag: '@readonly' }, async ({ page }) => {
        await page.goto('/signup');
        await expect(page.getByRole('heading', { name: /create your retail saas workspace|sign up|create account|register/i })).toBeVisible();

        // Submit without filling fields: the form uses native HTML5 `required`
        // validation, so the browser blocks submission (no navigation away) and
        // the first required field is reported invalid.
        await page.getByRole('button', { name: /create workspace|sign up|create account|register/i }).click();
        await expect(page).toHaveURL(/\/signup/);
        const nameInvalid = await page
            .getByLabel(/your name/i)
            .evaluate((el) => (el as HTMLInputElement).validity.valueMissing);
        expect(nameInvalid).toBe(true);
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

        await page.goto('/signup');

        // All of name/email/password/organization/store are required by the form.
        await page.getByLabel(/your name/i).fill('E2E Test User');
        await page.getByLabel(/email address/i).fill(email);
        await page.getByLabel(/password/i).fill('SecurePassword123!');
        await page.getByLabel(/organization name/i).fill(`E2E Org ${timestamp}`);
        await page.getByLabel(/store name/i).fill('Main Branch');

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
