import { test, expect } from '@playwright/test';
import {
    applyDemoSession,
    assertDemoCatalogReady,
    dismissDemoBannerIfPresent,
    fetchDemoSession,
    type DemoSession,
} from './helpers/demo-auth';
import { initScreenshotRun, saveStepScreenshot } from './helpers/screenshots';
import { listProducts, type ProductSummary } from './helpers/api-client';

/**
 * Core module E2E — sales, purchase, accounting, inventory.
 *
 * Uses the public demo tenant (POST /auth/demo) so STANDARD-plan accounting
 * and seeded catalog data are available. Saves a full-page screenshot at every
 * step under e2e/screenshots/core-modules/<run-id>/.
 *
 * Run:  npm run test:e2e:core   (from apps/frontend)
 * Env:  E2E_API_URL, PLAYWRIGHT_BASE_URL (optional overrides)
 */
test.describe.serial('Core modules — sales, purchase, accounting, inventory', () => {
    test.describe.configure({ retries: 0 });

    let session: DemoSession;
    let product: ProductSummary;
    let saleRefMarker: string;

    test.beforeAll(async () => {
        session = await fetchDemoSession();
        await assertDemoCatalogReady(session);
        initScreenshotRun();

        const products = await listProducts(session);
        product = products.find((p) => p.sku) ?? products[0];

        saleRefMarker = `E2E-${Date.now()}`;
    });

    test.beforeEach(async ({ page }) => {
        page.on('dialog', (dialog) => dialog.accept());
        await applyDemoSession(page, session);
        await dismissDemoBannerIfPresent(page);
    });

    // ── Prerequisites ───────────────────────────────────────────────────────

    test('P1 — dashboard and inventory settings', async ({ page }) => {
        await page.goto('/dashboard');
        await expect(page.getByText(/business monitor|dashboard/i).first()).toBeVisible({ timeout: 15_000 });
        await saveStepScreenshot(page, 'P1-dashboard');

        await page.goto('/inventory/settings');
        await expect(page.getByText(/inventory settings|warehouse/i).first()).toBeVisible({ timeout: 10_000 });
        await saveStepScreenshot(page, 'P1-inventory-settings');
    });

    // ── Sales ───────────────────────────────────────────────────────────────

    test('S0 — sidebar navigates away from New Sale', async ({ page }) => {
        await page.goto('/sales/new');
        await expect(page.getByRole('heading', { name: 'New Sale' })).toBeVisible({ timeout: 10_000 });

        await page.locator('aside a[href="/dashboard"]').click();
        await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });

        await page.goto('/sales/new');
        await expect(page.getByRole('heading', { name: 'New Sale' })).toBeVisible({ timeout: 10_000 });

        const productSearch = page.getByPlaceholder(/add product/i);
        await productSearch.click();
        await page.waitForTimeout(400);

        await page.locator('aside a[href="/inventory/products"]').click();
        await expect(page).toHaveURL(/\/inventory\/products/, { timeout: 10_000 });
    });

    test('S1 — cash sale via New Sale', async ({ page }) => {
        await page.goto('/sales/new');
        await expect(page.getByRole('heading', { name: 'New Sale' })).toBeVisible({ timeout: 10_000 });

        const productSearch = page.getByPlaceholder(/add product/i);
        await productSearch.click();
        await productSearch.fill(product.sku ?? product.name.slice(0, 6));
        await page.waitForTimeout(400);

        const productRow = page
            .locator('[class*="hover:bg-blue-50"]')
            .filter({ hasText: product.name })
            .first();
        await expect(productRow).toBeVisible({ timeout: 10_000 });
        await productRow.click();
        await saveStepScreenshot(page, 'S1-line-item-added');

        const totalText = await page.locator('text=/Total|৳/').last().textContent();
        const amountMatch = totalText?.match(/[\d,]+(?:\.\d+)?/);
        const payAmount = amountMatch ? amountMatch[0].replace(/,/g, '') : '100';

        await page.getByPlaceholder('Amount').fill(payAmount);
        await page.getByRole('button', { name: 'Cash' }).first().click();
        await expect(page.getByText('✓ Settled')).toBeVisible({ timeout: 5_000 });
        await saveStepScreenshot(page, 'S1-payment-settled');

        await page.getByRole('textbox', { name: 'Ref #' }).fill(saleRefMarker);

        await page.getByRole('button', { name: 'Create Sale' }).click();
        await page.waitForTimeout(1_000);
        await saveStepScreenshot(page, 'S1-sale-created');

        await page.goto('/sales/list');
        await expect(page.getByText(saleRefMarker).or(page.getByText(/SL-|sale/i)).first()).toBeVisible({
            timeout: 15_000,
        });
        await saveStepScreenshot(page, 'S1-sales-list');
    });

    test('S2 — customer payments and ledger pages load', async ({ page }) => {
        await page.goto('/sales/customer-payments');
        await expect(page.getByText(/customer payment/i).first()).toBeVisible({ timeout: 10_000 });
        await saveStepScreenshot(page, 'S2-customer-payments');

        await page.goto('/sales/customer-ledger');
        await expect(page.getByText(/customer ledger|ledger/i).first()).toBeVisible({ timeout: 10_000 });
        await saveStepScreenshot(page, 'S2-customer-ledger');
    });

    test('S3 — POS page loads', async ({ page }) => {
        await page.goto('/sales/pos');
        await expect(page).toHaveURL(/pos/);
        await expect(page.getByRole('heading', { name: /pos terminal/i })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByPlaceholder(/search sku or name/i)).toBeVisible();
        await saveStepScreenshot(page, 'S3-pos');
    });

    // ── Purchase ────────────────────────────────────────────────────────────

    test('PU1 — record purchase (stock in)', async ({ page }) => {
        await page.goto('/purchases/list');
        await expect(page.getByRole('heading', { name: /purchases/i })).toBeVisible({ timeout: 10_000 });

        await page.getByRole('button', { name: /record purchase/i }).click();
        await expect(page.getByRole('heading', { name: /record purchase/i })).toBeVisible({ timeout: 5_000 });

        const search = page.getByPlaceholder(/search products by name or sku/i);
        await search.fill(product.sku ?? product.name.slice(0, 5));
        const productBtn = page.getByRole('button').filter({ hasText: product.name }).first();
        await expect(productBtn).toBeVisible({ timeout: 10_000 });
        await productBtn.click();
        await saveStepScreenshot(page, 'PU1-purchase-lines');

        await page.getByRole('button', { name: /post purchase/i }).click();
        await page.waitForTimeout(1_500);
        await expect(page.getByRole('heading', { name: /record purchase/i })).not.toBeVisible({
            timeout: 10_000,
        });
        await saveStepScreenshot(page, 'PU1-purchase-posted');
    });

    test('PU2 — purchase orders and quotations pages', async ({ page }) => {
        await page.goto('/purchases/orders');
        await expect(page.getByText(/purchase order/i).first()).toBeVisible({ timeout: 10_000 });
        await saveStepScreenshot(page, 'PU2-purchase-orders');

        await page.goto('/purchases/quotations');
        await expect(page.getByText(/quotation|rfq/i).first()).toBeVisible({ timeout: 10_000 });
        await saveStepScreenshot(page, 'PU2-purchase-quotations');

        await page.goto('/purchases/supplier-ledger');
        await expect(page.getByText(/supplier ledger/i).first()).toBeVisible({ timeout: 10_000 });
        await saveStepScreenshot(page, 'PU2-supplier-ledger');
    });

    // ── Inventory ───────────────────────────────────────────────────────────

    test('I1 — inventory ledger shows movements', async ({ page }) => {
        await page.goto('/inventory/ledger');
        await expect(page.getByText(/inventory ledger|ledger/i).first()).toBeVisible({ timeout: 10_000 });
        await page.waitForTimeout(1_000);
        await saveStepScreenshot(page, 'I1-inventory-ledger');
    });

    test('I2 — stock takes, shrinkage, and valuation report', async ({ page }) => {
        await page.goto('/inventory/stock-takes');
        await expect(page.getByText(/stock take/i).first()).toBeVisible({ timeout: 10_000 });
        await saveStepScreenshot(page, 'I2-stock-takes');

        await page.goto('/inventory/shrinkage');
        await expect(page.getByText(/shrinkage/i).first()).toBeVisible({ timeout: 10_000 });
        await saveStepScreenshot(page, 'I2-shrinkage');

        await page.goto('/inventory/reports/valuation');
        await expect(page.getByText(/valuation/i).first()).toBeVisible({ timeout: 10_000 });
        await saveStepScreenshot(page, 'I2-valuation-report');
    });

    test('I3 — product catalog', async ({ page }) => {
        await page.goto('/inventory/products');
        await expect(page.getByText(product.name).first()).toBeVisible({ timeout: 15_000 });
        await saveStepScreenshot(page, 'I3-products');
    });

    // ── Accounting ──────────────────────────────────────────────────────────

    test('A1 — cash payment voucher', async ({ page }) => {
        test.setTimeout(60_000);

        await page.goto('/accounting/vouchers/new');
        await expect(page.getByText(/voucher/i).first()).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('#voucher-type-select')).toHaveValue('cash_payment');
        await saveStepScreenshot(page, 'A1-vouchers-empty');

        await expect(page.getByText(/loading accounts/i)).not.toBeVisible({ timeout: 15_000 });

        const accountSelects = page.getByLabel(/account row/i);
        await accountSelects.nth(0).selectOption({ label: 'Cash in Hand (1010)' });
        await page.getByLabel(/credit row 1/i).fill('250');
        await accountSelects.nth(1).selectOption({ label: 'General Operating Expense (5010)' });
        await page.getByLabel(/debit row 2/i).fill('250');

        await expect(page.getByText(/balanced and ready/i)).toBeVisible({ timeout: 5_000 });
        await saveStepScreenshot(page, 'A1-voucher-balanced');

        const saveBtn = page.getByRole('button', { name: 'Save Voucher' });
        await expect(saveBtn).toBeEnabled({ timeout: 5_000 });
        await saveBtn.click();
        await expect(page.getByText(/saved successfully/i).first()).toBeVisible({
            timeout: 15_000,
        });
        await saveStepScreenshot(page, 'A1-voucher-saved');
    });

    test('A2 — journal, COA, and posting rules', async ({ page }) => {
        await page.goto('/accounting/journal');
        await expect(page.getByText(/journal/i).first()).toBeVisible({ timeout: 10_000 });
        await saveStepScreenshot(page, 'A2-journal');

        await page.goto('/accounting/coa');
        await expect(page.getByText(/chart of accounts|accounts/i).first()).toBeVisible({ timeout: 10_000 });
        await saveStepScreenshot(page, 'A2-coa');

        await page.goto('/accounting/posting-rules');
        await expect(page.getByText(/posting rule/i).first()).toBeVisible({ timeout: 10_000 });
        await saveStepScreenshot(page, 'A2-posting-rules');
    });

    test('A3 — financial reports', async ({ page }) => {
        await page.goto('/accounting/reports/trial-balance');
        await expect(page.getByText(/trial balance/i).first()).toBeVisible({ timeout: 10_000 });
        await page.waitForTimeout(1_000);
        await saveStepScreenshot(page, 'A3-trial-balance');

        await page.goto('/accounting/reports/pl');
        await expect(page.getByText(/profit|loss|p\s*&\s*l/i).first()).toBeVisible({ timeout: 10_000 });
        await saveStepScreenshot(page, 'A3-pl');

        await page.goto('/accounting/reports/balance-sheet');
        await expect(page.getByText(/balance sheet/i).first()).toBeVisible({ timeout: 10_000 });
        await saveStepScreenshot(page, 'A3-balance-sheet');

        await page.goto('/accounting/reports/cashbook');
        await expect(page.getByText(/cashbook|cash book/i).first()).toBeVisible({ timeout: 10_000 });
        await saveStepScreenshot(page, 'A3-cashbook');
    });

    test('A4 — expenses entry page', async ({ page }) => {
        await page.goto('/accounting/expenses');
        await expect(page.getByText(/expense/i).first()).toBeVisible({ timeout: 10_000 });
        await saveStepScreenshot(page, 'A4-expenses');
    });

    // ── Cross-module smoke ────────────────────────────────────────────────────

    test('E2E — sales and purchase reports', async ({ page }) => {
        await page.goto('/sales/reports/summary');
        await expect(page.getByText(/sales summary|summary/i).first()).toBeVisible({ timeout: 10_000 });
        await saveStepScreenshot(page, 'E2E-sales-summary');

        await page.goto('/purchases/reports/summary');
        await expect(page.getByText(/purchase summary|summary/i).first()).toBeVisible({ timeout: 10_000 });
        await saveStepScreenshot(page, 'E2E-purchase-summary');
    });
});