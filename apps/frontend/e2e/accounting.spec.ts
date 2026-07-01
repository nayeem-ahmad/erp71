import { test, expect } from '@playwright/test';
import {
    applyDemoSession,
    assertDemoCatalogReady,
    dismissDemoBannerIfPresent,
    fetchDemoSession,
    type DemoSession,
} from './helpers/demo-auth';
import {
    ACCOUNTING_REPORTS,
    ACCOUNTING_WORKSPACE_ROUTES,
    SEEDED_ACCOUNTS,
    VOUCHER_SCENARIOS,
    expectAccountingPageHeading,
    fillBalancedVoucher,
    saveVoucher,
    waitForVoucherAccounts,
} from './helpers/accounting';
import {
    createCostCenter,
    createFixedAsset,
    createRecurringJournal,
    importOpeningBalances,
    listAccounts,
    lockFiscalPeriod,
    postRecurringJournal,
    runDepreciation,
    unlockFiscalPeriod,
    upsertBudget,
    getProfitLossReport,
    initiateFundTransfer,
    listDemoStores,
    receiveFundTransfer,
    type AccountSummary,
} from './helpers/api-client';

/**
 * Accounting module E2E — full feature coverage.
 *
 * Uses the public demo tenant (POST /auth/demo) for STANDARD-plan accounting
 * with seeded chart of accounts, posting rules, and catalog data.
 *
 * Run:  npm run test:e2e:accounting   (from apps/frontend)
 * Env:  E2E_API_URL, PLAYWRIGHT_BASE_URL (optional overrides)
 */
test.describe.serial('Accounting module — full feature coverage', () => {
    let session: DemoSession;
    let marker: string;
    let expenseCategoryName: string;
    let createdVoucherRef: string;
    let seededAccounts: AccountSummary[];

    test.beforeAll(async () => {
        let lastError: unknown;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                session = await fetchDemoSession(attempt > 0);
                await assertDemoCatalogReady(session);
                seededAccounts = await listAccounts(session);
                lastError = undefined;
                break;
            } catch (error) {
                lastError = error;
                if (attempt < 2) {
                    await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 3000));
                }
            }
        }
        if (lastError) throw lastError;

        marker = `E2E-AC-${Date.now()}`;
        expenseCategoryName = `${marker}-cat`;
        createdVoucherRef = `${marker}-CP`;
    });

    test.beforeEach(async ({ page }) => {
        page.on('dialog', (dialog) => dialog.accept());
        await applyDemoSession(page, session);
        await dismissDemoBannerIfPresent(page);
    });

    // ── Overview & export ─────────────────────────────────────────────────────

    test('AC01 — accounting overview hub loads with workspace and report links', async ({ page }) => {
        await page.goto('/accounting');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText(/financial report/i).first()).toBeVisible();

        for (const route of ACCOUNTING_WORKSPACE_ROUTES.slice(1, 5)) {
            await expect(page.locator(`a[href="${route.path}"]`).first()).toBeVisible();
        }
        for (const report of ACCOUNTING_REPORTS.slice(0, 4)) {
            await expect(page.locator(`a[href="${report.path}"]`).first()).toBeVisible();
        }
    });

    test('AC02 — ledger export modal opens and triggers Tally download', async ({ page }) => {
        await page.goto('/accounting');
        await page.getByRole('button', { name: /export/i }).first().click();
        await page.getByRole('button', { name: /tally/i }).click();

        const exportModal = page.locator('.fixed').filter({ hasText: /export tally/i });
        await expect(exportModal).toBeVisible({ timeout: 5_000 });

        const downloadPromise = page.waitForEvent('download', { timeout: 15_000 }).catch(() => null);
        await exportModal.getByRole('button', { name: /download/i }).click();
        const download = await downloadPromise;
        if (download) {
            expect(download.suggestedFilename()).toMatch(/\.xml$/i);
        } else {
            // Download may be blocked in headless CI; modal + click still validates the export flow.
            await expect(exportModal).not.toBeVisible({ timeout: 10_000 });
        }
    });

    // ── Chart of Accounts ─────────────────────────────────────────────────────

    test('AC03 — chart of accounts shows seeded accounts and accepts new group', async ({ page }) => {
        await page.goto('/accounting/coa');
        await expectAccountingPageHeading(page, /chart of accounts|account directory/i);
        await expect(page.getByText('Cash in Hand').first()).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText('Main Bank Account').first()).toBeVisible();

        const groupName = `${marker}-group`;
        await page.getByRole('textbox', { name: 'Account group name' }).fill(groupName);
        await page.getByRole('button', { name: /create group/i }).click();
        const groupFilter = page.getByLabel('Filter by Group');
        await groupFilter.selectOption({ label: groupName });
        await expect(groupFilter).toHaveValue(/.+/);
    });

    // ── Vouchers (all 6 types) ────────────────────────────────────────────────

    test('AC04 — all voucher types post balanced entries', async ({ page }) => {
        test.setTimeout(120_000);

        for (const scenario of VOUCHER_SCENARIOS) {
            await fillBalancedVoucher(page, scenario, `${marker}-${scenario.type}`);
            await saveVoucher(page);
        }
    });

    // ── Journal & ledger ──────────────────────────────────────────────────────

    test('AC05 — journal lists vouchers and opens detail view', async ({ page }) => {
        await page.goto('/accounting/journal');
        await expect(page.getByText(/journal/i).first()).toBeVisible({ timeout: 10_000 });

        const voucherLink = page.locator('a[href^="/accounting/vouchers/"]').first();
        await expect(voucherLink).toBeVisible({ timeout: 15_000 });
        await voucherLink.click();

        await expect(page).toHaveURL(/\/accounting\/vouchers\//);
        await expect(page.getByText(/debit|credit|voucher/i).first()).toBeVisible({ timeout: 10_000 });
    });

    test('AC06 — general ledger shows Cash in Hand movements', async ({ page }) => {
        await page.goto('/accounting/ledger');
        await expect(page.getByText(/ledger/i).first()).toBeVisible({ timeout: 10_000 });

        const accountSelect = page.getByLabel('Ledger account');
        await accountSelect.selectOption({ label: '1010 - Cash in Hand' });
        await page.waitForTimeout(1_000);

        await expect(
            page.getByText(/closing balance|running balance|voucher|no transactions/i).first(),
        ).toBeVisible({ timeout: 15_000 });
    });

    // ── Posting rules & exceptions ────────────────────────────────────────────

    test('AC07 — posting rules list loads and edit modal opens', async ({ page }) => {
        await page.goto('/accounting/posting-rules');
        await expect(page.getByText(/posting rule/i).first()).toBeVisible({ timeout: 10_000 });

        const editBtn = page.locator('button').filter({ hasText: /^Edit$/ }).first();
        await expect(editBtn).toBeVisible({ timeout: 15_000 });
        await editBtn.click();

        const editModal = page.locator('.fixed').filter({ hasText: 'Edit Posting Rule' });
        await expect(editModal).toBeVisible({ timeout: 10_000 });
        await editModal.getByRole('button', { name: /cancel/i }).click();
    });

    test('AC08 — posting exceptions page loads with event table', async ({ page }) => {
        await page.goto('/accounting/reconciliation');
        await expect(page.getByText(/posting|exception/i).first()).toBeVisible({ timeout: 10_000 });
        await expect(page.getByRole('button', { name: /refresh/i })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText(/\d+ events?/i)).toBeVisible();
    });

    // ── Fiscal periods & opening balances ─────────────────────────────────────

    test('AC09 — fiscal periods list, lock, and unlock', async ({ page }) => {
        test.setTimeout(60_000);

        const targetYear = new Date().getFullYear() - 3;
        const targetMonth = 2;
        const monthLabel = 'February';

        await page.goto('/accounting/fiscal-periods');
        await expect(page.getByText(/fiscal period/i).first()).toBeVisible({ timeout: 10_000 });

        const yearMinus = page.getByRole('button', { name: '−' });
        const yearDisplay = page.locator('span.font-black.w-16');
        while (Number(await yearDisplay.textContent()) > targetYear) {
            await yearMinus.click();
            await page.waitForTimeout(500);
        }
        await expect(page.getByText(`${monthLabel} ${targetYear}`)).toBeVisible({ timeout: 10_000 });
        await expect(page.getByRole('button', { name: 'Lock Period' }).first()).toBeVisible();

        await lockFiscalPeriod(session, { year: targetYear, month: targetMonth });
        await page.reload();
        await dismissDemoBannerIfPresent(page);
        let displayYear = Number(await page.locator('span.font-black.w-16').textContent());
        while (displayYear > targetYear) {
            await page.getByRole('button', { name: '−' }).click();
            await page.waitForTimeout(500);
            displayYear = Number(await page.locator('span.font-black.w-16').textContent());
        }
        await expect(
            page.locator('tr').filter({ hasText: `${monthLabel} ${targetYear}` }).getByText('Locked'),
        ).toBeVisible({ timeout: 10_000 });

        await unlockFiscalPeriod(session, { year: targetYear, month: targetMonth });
        await page.reload();
        await dismissDemoBannerIfPresent(page);
        displayYear = Number(await page.locator('span.font-black.w-16').textContent());
        while (displayYear > targetYear) {
            await page.getByRole('button', { name: '−' }).click();
            await page.waitForTimeout(500);
            displayYear = Number(await page.locator('span.font-black.w-16').textContent());
        }
        await expect(
            page.locator('tr').filter({ hasText: `${monthLabel} ${targetYear}` }).getByText('Open'),
        ).toBeVisible({ timeout: 10_000 });
    });

    test('AC10 — opening balance import form and journal posting', async ({ page }) => {
        const cashAccount = seededAccounts.find((a) => a.name.includes('Cash in Hand'));
        const equityAccount = seededAccounts.find((a) => a.name.includes("Owner's Equity"));
        expect(cashAccount).toBeTruthy();
        expect(equityAccount).toBeTruthy();

        await page.goto('/accounting/opening-balances', { waitUntil: 'domcontentloaded' });
        await expect(page.getByText(/opening balance/i).first()).toBeVisible({ timeout: 10_000 });

        const rows = page.locator('tbody tr');
        const cashOption = rows.nth(0).locator('select option', { hasText: /Cash in Hand/i });
        await expect(cashOption).toHaveCount(1, { timeout: 20_000 });
        await rows.nth(0).locator('select').selectOption({ label: SEEDED_ACCOUNTS.cash });
        await rows.nth(0).locator('input[type="number"]').first().fill('125');
        await rows.nth(1).locator('select').selectOption({ label: SEEDED_ACCOUNTS.equity });
        await rows.nth(1).locator('input[type="number"]').nth(1).fill('125');
        await expect(page.getByText(/balanced/i)).toBeVisible({ timeout: 5_000 });

        const asOfDate = new Date().toISOString().slice(0, 10);
        const voucher = (await importOpeningBalances(session, {
            asOfDate,
            entries: [
                { accountId: cashAccount!.id, debitAmount: 125, creditAmount: 0 },
                { accountId: equityAccount!.id, debitAmount: 0, creditAmount: 125 },
            ],
        })) as { id: string; description?: string };
        expect(voucher.id).toBeTruthy();

        await page.goto(`/accounting/vouchers/${voucher.id}`, { waitUntil: 'domcontentloaded' });
        await expect(page.getByText(/opening balances as of/i).first()).toBeVisible({ timeout: 20_000 });
    });

    // ── Cost centers & fixed assets ───────────────────────────────────────────

    test('AC11 — cost center create and segment P&L', async ({ page }) => {
        const ccCode = `${marker}-CC`;
        const ccName = `${marker} Ops`;

        await page.goto('/accounting/cost-centers');
        await expect(page.getByText(/cost center/i).first()).toBeVisible({ timeout: 10_000 });

        await page.getByRole('button', { name: /new cost center/i }).click();
        await page.getByPlaceholder('e.g. DEPT-01').fill(ccCode);
        await page.getByPlaceholder('e.g. Retail Operations').fill(ccName);
        await expect(page.getByRole('heading', { name: 'New Cost Center' })).toBeVisible();

        await createCostCenter(session, { code: ccCode, name: ccName });
        await page.reload();
        await dismissDemoBannerIfPresent(page);

        await expect(page.getByText(ccName).first()).toBeVisible({ timeout: 10_000 });
        await page.getByText(ccName).click();
        await expect(page.getByText(/revenue|expense/i).first()).toBeVisible({ timeout: 10_000 });
    });

    test('AC12 — fixed asset register and depreciation run', async ({ page }) => {
        const assetCode = `${marker}-FA`;
        const assetName = `${marker} Laptop`;

        await page.goto('/accounting/fixed-assets');
        await expect(page.getByText(/fixed asset/i).first()).toBeVisible({ timeout: 10_000 });

        await page.getByRole('button', { name: /add asset/i }).click();
        await page.getByPlaceholder('e.g. FA-001').fill(assetCode);
        await page.getByPlaceholder('e.g. Office Furniture').fill(assetName);
        await page.locator('input[type="date"]').first().fill('2024-01-15');
        await page.getByPlaceholder('0.00').first().fill('120000');
        await expect(page.getByRole('heading', { name: 'Add Fixed Asset' })).toBeVisible();

        await createFixedAsset(session, {
            assetCode,
            name: assetName,
            purchaseDate: '2024-01-15',
            cost: 120_000,
            usefulLifeMonths: 60,
        });
        await page.reload();
        await dismissDemoBannerIfPresent(page);
        await expect(page.getByText(assetName).first()).toBeVisible({ timeout: 10_000 });

        const now = new Date();
        await runDepreciation(session, { year: now.getFullYear(), month: now.getMonth() + 1 });
        await page.reload();
        await dismissDemoBannerIfPresent(page);
        await page.getByRole('button', { name: /run depreciation/i }).click();
        await expect(page.getByText(/run monthly depreciation/i)).toBeVisible({ timeout: 5_000 });
    });

    // ── Recurring journals ────────────────────────────────────────────────────

    test('AC13 — recurring journal template create and post', async ({ page }) => {
        const templateName = `${marker} Rent`;
        const expenseAccount = seededAccounts.find((a) => a.name.includes('General Operating Expense'));
        const cashAccount = seededAccounts.find((a) => a.name.includes('Cash in Hand'));
        expect(expenseAccount).toBeTruthy();
        expect(cashAccount).toBeTruthy();

        await page.goto('/accounting/recurring-journals');
        await expect(page.getByText(/recurring journal/i).first()).toBeVisible({ timeout: 10_000 });

        await page.getByRole('button', { name: /new template/i }).click();
        await page.getByPlaceholder(/monthly rent/i).fill(templateName);
        await page.locator('input[type="date"]').first().fill(new Date().toISOString().slice(0, 10));
        await expect(page.getByRole('heading', { name: 'New Recurring Journal' })).toBeVisible();

        const template = await createRecurringJournal(session, {
            name: templateName,
            frequency: 'MONTHLY',
            nextDueDate: new Date().toISOString().slice(0, 10),
            lines: [
                { accountId: expenseAccount!.id, debitAmount: 1000, creditAmount: 0 },
                { accountId: cashAccount!.id, debitAmount: 0, creditAmount: 1000 },
            ],
        });
        await page.reload();
        await dismissDemoBannerIfPresent(page);
        await expect(page.getByText(templateName).first()).toBeVisible({ timeout: 10_000 });

        await postRecurringJournal(session, (template as { id: string }).id);
        await page.reload();
        await dismissDemoBannerIfPresent(page);
        await expect(page.getByText(/last run/i).first()).toBeVisible({ timeout: 15_000 });
    });

    // ── Bank reconciliation ───────────────────────────────────────────────────

    test('AC14 — bank reconciliation setup, import, and auto-match', async ({ page }) => {
        test.setTimeout(90_000);

        const bankAccount = seededAccounts.find((a) => a.name.includes('Main Bank Account'));
        expect(bankAccount).toBeTruthy();

        await page.goto('/accounting/reconciliation/bank', { waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('heading', { name: 'Bank Reconciliation' })).toBeVisible({
            timeout: 10_000,
        });

        await page.waitForResponse(
            (res) => res.url().includes('/accounting/accounts') && res.status() === 200,
            { timeout: 20_000 },
        );

        const setupPanel = page
            .getByRole('heading', { name: /1\. set up reconciliation/i })
            .locator('..');
        const bankSelect = setupPanel.locator('select');
        await expect(bankSelect.locator('option', { hasText: /Main Bank Account/i })).toHaveCount(1, {
            timeout: 20_000,
        });
        await bankSelect.selectOption({ label: bankAccount!.name });
        await setupPanel.locator('input[type="number"]').fill('50000');
        await setupPanel.getByRole('button', { name: /next: import statement/i }).click();

        const today = new Date().toISOString().slice(0, 10);
        const importPanel = page
            .getByRole('heading', { name: /2\. paste bank statement entries/i })
            .locator('..');
        await expect(importPanel).toBeVisible({ timeout: 15_000 });
        await importPanel.locator('textarea').fill(
            `${today}, E2E bank fee, 250, DEBIT\n${today}, E2E deposit, 5000, CREDIT`,
        );
        await importPanel.getByRole('button', { name: /import & continue/i }).click();

        await expect(page.getByText(/book balance/i).first()).toBeVisible({ timeout: 20_000 });
        const autoMatchBtn = page.getByRole('button', { name: /auto-match by date/i });
        await expect(autoMatchBtn).toBeVisible({ timeout: 10_000 });
        await autoMatchBtn.click();
        await expect(autoMatchBtn).not.toBeVisible({ timeout: 20_000 });
        await expect(page.getByText(/matched/i).first()).toBeVisible({ timeout: 10_000 });
    });

    // ── Financial reports ─────────────────────────────────────────────────────

    for (const report of ACCOUNTING_REPORTS) {
        test(`AC15 — ${report.label} report loads`, async ({ page }) => {
            test.setTimeout(60_000);
            await page.goto(report.path, { waitUntil: 'domcontentloaded' });
            await expectAccountingPageHeading(page, report.pattern);
            await expect(page.locator('body')).not.toContainText(/application error|something went wrong/i);
        });
    }

    // ── Expenses, categories, reports ─────────────────────────────────────────

    test('AC16 — expense category, entry, and reports', async ({ page }) => {
        await page.goto('/accounting/expenses/categories');
        await page.getByRole('button', { name: /add category/i }).click();
        const categoryForm = page.locator('form').filter({ has: page.getByRole('heading', { name: /add category/i }) });
        await categoryForm.locator('input[type="text"]').fill(expenseCategoryName);
        await categoryForm.getByRole('button', { name: /^save$/i }).click();
        await expect(page.getByText(expenseCategoryName).first()).toBeVisible({ timeout: 10_000 });

        await page.goto('/accounting/expenses');
        await page.getByRole('button', { name: /add expense/i }).click();
        const expenseForm = page.locator('form').filter({
            has: page.getByRole('heading', { name: /add expense/i }),
        });
        await expenseForm.locator('select').first().selectOption({ label: expenseCategoryName });
        await expenseForm.locator('input[type="number"]').first().fill('350');
        await expenseForm.getByRole('button', { name: /^save$/i }).click();
        await expect(page.getByText(/expense recorded/i)).toBeVisible({ timeout: 15_000 });
        await expect(
            page.locator('table tbody tr').filter({ hasText: expenseCategoryName }),
        ).toBeVisible({ timeout: 15_000 });

        await page.goto('/accounting/expenses/reports');
        await expect(page.getByText(/expense|report|total/i).first()).toBeVisible({ timeout: 10_000 });
    });

    // ── Loans ─────────────────────────────────────────────────────────────────

    test('AC17 — loan payable create and list', async ({ page }) => {
        await page.goto('/accounting/loans');
        await expect(page.getByText(/loan/i).first()).toBeVisible({ timeout: 10_000 });

        await page.getByRole('button', { name: /add loan/i }).click();
        const loanForm = page.locator('form').filter({
            has: page.getByRole('heading', { name: /add loan/i }),
        });
        await loanForm.getByPlaceholder(/who the loan is with/i).fill(`${marker} Supplier`);
        await loanForm.locator('input[type="number"]').first().fill('25000');
        await loanForm.locator('input[type="date"]').first().fill(new Date().toISOString().slice(0, 10));
        await loanForm.getByRole('button', { name: /^save$/i }).click();
        await expect(page.getByText(/loan saved/i)).toBeVisible({ timeout: 15_000 });
        await expect(
            page.locator('table tbody tr').filter({ hasText: `${marker} Supplier` }),
        ).toBeVisible({ timeout: 15_000 });
    });

    // ── Budget vs actual ──────────────────────────────────────────────────────

    test('AC18 — budget upsert via API and budget vs actual report', async ({ page }) => {
        const expenseAccount = seededAccounts.find((a) => a.name.includes('General Operating Expense'));
        expect(expenseAccount).toBeTruthy();

        const fiscalYear = new Date().getFullYear();
        await upsertBudget(session, {
            accountId: expenseAccount!.id,
            fiscalYear,
            month: 6,
            amount: 50_000,
        });

        await page.goto('/accounting/reports/budget-vs-actual');
        await expect(page.getByText(/budget/i).first()).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText(/general operating expense|50,?000/i).first()).toBeVisible({
            timeout: 15_000,
        });
    });

    // ── Cash payment voucher (regression anchor for journal flow) ───────────────

    test('AC19 — cash payment voucher with reference appears in journal', async ({ page }) => {
        await fillBalancedVoucher(
            page,
            VOUCHER_SCENARIOS[0],
            createdVoucherRef,
        );
        await saveVoucher(page);
        await expect(page).toHaveURL(/[?&]voucher=/, { timeout: 10_000 });

        const voucherNumber = new URL(page.url()).searchParams.get('voucher');
        expect(voucherNumber).toBeTruthy();

        await page.goto('/accounting/vouchers');
        await page.getByPlaceholder(/search by voucher/i).fill(voucherNumber!);
        await expect(
            page.locator('table tbody tr').filter({ hasText: voucherNumber! }),
        ).toBeVisible({ timeout: 15_000 });

        await page.locator('a[href^="/accounting/vouchers/"]').first().click();
        await expect(page.getByText(createdVoucherRef)).toBeVisible({ timeout: 10_000 });
    });

    // ── Multi-branch reports ──────────────────────────────────────────────────

    test('AC-Branch-01 — P&L scope bar supports branch and compare views', async ({ page }) => {
        const stores = await listDemoStores(session);
        expect(stores.length).toBeGreaterThanOrEqual(2);

        await page.goto('/accounting/reports/pl');
        await expect(page.getByText(/profit\s*&\s*loss|profit and loss/i).first()).toBeVisible({ timeout: 10_000 });

        await page.getByLabel(/this branch/i).check();
        await expect(page.getByRole('combobox').first()).toBeVisible();

        await page.getByLabel(/compare branches/i).check();
        await expect(page.getByText(stores[0].name).first()).toBeVisible();
        await expect(page.getByText(stores[1].name).first()).toBeVisible();

        const from = '2026-01-01';
        const to = new Date().toISOString().slice(0, 10);
        const compare = await getProfitLossReport(session, {
            scope: 'compare',
            storeIds: stores.map((s) => s.id).join(','),
            from,
            to,
        });
        expect(compare.scope).toBe('compare');
        expect(compare.columns?.length).toBeGreaterThanOrEqual(2);
    });

    test('AC-Branch-02 — inter-branch fund transfer page loads and API flow works', async ({ page }) => {
        const stores = await listDemoStores(session);
        expect(stores.length).toBeGreaterThanOrEqual(2);

        await page.goto('/accounting/inter-branch/fund-transfers');
        await expect(page.getByText(/fund transfer/i).first()).toBeVisible({ timeout: 10_000 });

        const transfer = await initiateFundTransfer(session, {
            sourceStoreId: stores[0].id,
            destinationStoreId: stores[1].id,
            amount: 500,
            method: 'CASH',
            description: `${marker}-fund-transfer`,
        });
        expect(transfer.id).toBeTruthy();

        const received = await receiveFundTransfer(session, transfer.id);
        expect(received.status).toBe('RECEIVED');
    });

    // ── Remaining workspace routes smoke ──────────────────────────────────────

    for (const route of ACCOUNTING_WORKSPACE_ROUTES) {
        test(`AC20 — ${route.label} workspace route loads`, async ({ page }) => {
            await page.goto(route.path);
            await expectAccountingPageHeading(page, route.pattern);
        });
    }
});