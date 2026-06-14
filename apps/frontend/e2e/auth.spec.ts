import { test, expect } from '@playwright/test';

/**
 * E2E: Signup → Login critical path
 *
 * These tests cover the authentication flows that gate all other features.
 * They require a running frontend (port 3000) and backend (port 4000).
 */

test.describe('Authentication', () => {
    test('signup page renders and validates required fields', { tag: '@readonly' }, async ({ page }) => {
        await page.goto('/signup');
        await expect(page.getByRole('heading', { name: /sign up|create account|register/i })).toBeVisible();

        // Submit without filling fields to trigger validation
        await page.getByRole('button', { name: /sign up|create account|register/i }).click();
        await expect(page.getByText(/required|please enter|invalid/i)).toBeVisible();
    });

    test('login page renders and shows error for wrong credentials', { tag: '@readonly' }, async ({ page }) => {
        await page.goto('/login');
        await expect(page.getByRole('heading', { name: /sign in|log in/i })).toBeVisible();

        await page.getByLabel(/email/i).fill('wrong@example.com');
        await page.getByLabel(/password/i).fill('wrongpassword');
        await page.getByRole('button', { name: /sign in|log in/i }).click();

        // Expect an error message (invalid credentials)
        await expect(page.getByText(/invalid|incorrect|unauthorized|error/i)).toBeVisible({ timeout: 10_000 });
    });

    test('successful signup redirects to dashboard or onboarding', async ({ page }) => {
        const timestamp = Date.now();
        const email = `e2e-test-${timestamp}@example.com`;

        await page.goto('/signup');

        await page.getByLabel(/name/i).fill('E2E Test User');
        await page.getByLabel(/email/i).fill(email);
        await page.getByLabel(/password/i).fill('SecurePassword123!');

        await page.getByRole('button', { name: /sign up|create account|register/i }).click();

        // After signup, expect redirect to dashboard or onboarding
        await expect(page).toHaveURL(/dashboard|onboarding/, { timeout: 15_000 });
    });

    test('successful login redirects to dashboard', { tag: '@readonly' }, async ({ page }) => {
        // This test depends on a seeded test account; adjust credentials per environment
        const email = process.env.E2E_TEST_EMAIL || 'test@example.com';
        const password = process.env.E2E_TEST_PASSWORD || 'TestPassword123!';

        await page.goto('/login');

        await page.getByLabel(/email/i).fill(email);
        await page.getByLabel(/password/i).fill(password);
        await page.getByRole('button', { name: /sign in|log in/i }).click();

        await expect(page).toHaveURL(/dashboard/, { timeout: 15_000 });
    });

    test('navigating to dashboard while logged out redirects to login', { tag: '@readonly' }, async ({ page }) => {
        // No auth token present — should redirect to login
        await page.goto('/dashboard');
        await expect(page).toHaveURL(/login/, { timeout: 10_000 });
    });
});
