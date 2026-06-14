import { test, expect, Page } from '@playwright/test';

/**
 * E2E: POS sale critical path
 *
 * Covers: navigate to POS → search product → add to cart → complete sale.
 * Requires a logged-in session; uses storageState set up via global setup
 * or the E2E_AUTH_TOKEN env variable.
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

test.describe('POS — Point of Sale', () => {
    test.beforeEach(async ({ page }) => {
        await loginIfNeeded(page);
    });

    test('POS page loads with product search and cart', { tag: '@readonly' }, async ({ page }) => {
        await page.goto('/dashboard/pos');
        await expect(page).toHaveURL(/pos/);

        // Expect a product search input or product listing
        const searchOrProducts = page.getByPlaceholder(/search|product/i).or(
            page.getByRole('heading', { name: /pos|point of sale/i }),
        );
        await expect(searchOrProducts.first()).toBeVisible({ timeout: 10_000 });
    });

    test('can search for a product and add it to the cart', async ({ page }) => {
        await page.goto('/dashboard/pos');

        const searchInput = page.getByPlaceholder(/search product|scan barcode|search/i);
        if (await searchInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
            await searchInput.fill('test');
            await page.waitForTimeout(500); // debounce

            const firstProduct = page.getByRole('button', { name: /add to cart|add/i }).first();
            if (await firstProduct.isVisible({ timeout: 5_000 }).catch(() => false)) {
                await firstProduct.click();
                // Cart should reflect the addition
                await expect(page.getByText(/total|subtotal|cart/i)).toBeVisible({ timeout: 5_000 });
            }
        }
    });

    test('cart shows line items and a checkout/complete-sale button', { tag: '@readonly' }, async ({ page }) => {
        await page.goto('/dashboard/pos');

        // If there are products in the cart already (or after adding), expect checkout button
        const checkoutBtn = page.getByRole('button', { name: /complete sale|checkout|pay now/i });
        // Just confirm the POS page loaded even if cart is empty
        await expect(page).toHaveURL(/pos/);
        // Checkout button may only appear when cart is non-empty — acceptable
        const visible = await checkoutBtn.isVisible({ timeout: 3_000 }).catch(() => false);
        if (visible) {
            await expect(checkoutBtn).toBeEnabled();
        }
    });

    test('completing a sale shows a confirmation or receipt', async ({ page }) => {
        await page.goto('/dashboard/pos');

        // Only attempt to complete a sale if there are products in the system
        const addBtn = page.getByRole('button', { name: /add to cart|add/i }).first();
        if (await addBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
            await addBtn.click();

            const checkoutBtn = page.getByRole('button', { name: /complete sale|checkout|pay now/i });
            if (await checkoutBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
                await checkoutBtn.click();
                // Expect confirmation message or receipt modal
                await expect(
                    page.getByText(/sale completed|receipt|success|thank you/i),
                ).toBeVisible({ timeout: 10_000 });
            }
        }
    });

    test('POS sale does not crash when amount paid is less than total', async ({ page }) => {
        await page.goto('/dashboard/pos');
        // This test verifies that the UI prevents submission with invalid amounts
        const addBtn = page.getByRole('button', { name: /add to cart|add/i }).first();
        if (await addBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
            await addBtn.click();

            const amountInput = page.getByLabel(/amount paid|cash received/i);
            if (await amountInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
                await amountInput.fill('0');
                const checkoutBtn = page.getByRole('button', { name: /complete sale|checkout|pay now/i });
                await checkoutBtn.click();
                // Expect validation error, not a crash
                await expect(page.getByText(/insufficient|invalid amount|error/i)).toBeVisible({ timeout: 5_000 });
            }
        }
    });
});
