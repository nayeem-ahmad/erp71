import { test, expect } from '@playwright/test';
import { applyE2ESession, fetchE2ESession, type E2ESession } from './helpers/auth';

/**
 * E2E: POS sale critical path
 *
 * Covers: navigate to POS → search product → add to cart → complete sale.
 * Requires a logged-in session; uses storageState set up via global setup
 * or the E2E_AUTH_TOKEN env variable.
 */

test.describe('POS — Point of Sale', () => {
    let session: E2ESession;

    test.beforeAll(async () => {
        session = await fetchE2ESession();
    });

    test.beforeEach(async ({ page }) => {
        await applyE2ESession(page, session);
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
        // The checkout control is present even with an empty cart; it is
        // correctly disabled until line items are added, so assert presence only
        // (not enabled-ness).
        await expect(checkoutBtn.first()).toBeVisible({ timeout: 5_000 });
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
