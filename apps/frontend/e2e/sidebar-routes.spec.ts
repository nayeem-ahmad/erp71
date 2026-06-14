import { test, expect, Page, ConsoleMessage } from '@playwright/test';

// Base URLs and credentials are env-overridable so this read-only suite can run
// against a local stack (default) or the live deployment (nightly smoke test).
const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const API  = process.env.E2E_API_URL || 'http://localhost:4000';

const E2E_EMAIL    = process.env.E2E_TEST_EMAIL || 'nayeem.ahmad@gmail.com';
const E2E_PASSWORD = process.env.E2E_TEST_PASSWORD || 'password123';

// All sidebar routes extracted from Sidebar.tsx
const ROUTES = [
    { path: '/dashboard',                              label: 'Dashboard' },
    { path: '/dashboard/pos',                          label: 'POS' },
    { path: '/dashboard/sales',                        label: 'Sales' },
    { path: '/dashboard/returns',                      label: 'Sales Returns' },
    { path: '/dashboard/orders',                       label: 'Sales Orders' },
    { path: '/dashboard/quotes',                       label: 'Sales Quotations' },
    { path: '/dashboard/warranty-claims',              label: 'Warranty Claims' },
    { path: '/dashboard/cashier-sessions',             label: 'Cashier Sessions' },
    { path: '/dashboard/loyalty',                      label: 'Loyalty Points' },
    { path: '/dashboard/delivery',                     label: 'Delivery' },
    { path: '/dashboard/purchases',                    label: 'Purchases' },
    { path: '/dashboard/purchase-orders',              label: 'Purchase Orders' },
    { path: '/dashboard/purchase-quotations',          label: 'Purchase Quotations' },
    { path: '/dashboard/purchase-returns',             label: 'Purchase Returns' },
    { path: '/dashboard/suppliers',                    label: 'Suppliers' },
    { path: '/dashboard/purchases/reports/summary',    label: 'Purchase Summary' },
    { path: '/dashboard/purchases/reports/by-product',  label: 'Purchases by Product' },
    { path: '/dashboard/purchases/reports/by-supplier', label: 'Purchases by Supplier' },
    { path: '/dashboard/accounting',                   label: 'Accounting Overview' },
    { path: '/dashboard/accounting/vouchers',          label: 'Voucher Entry' },
    { path: '/dashboard/accounting/journal',           label: 'Journal' },
    { path: '/dashboard/accounting/ledger',            label: 'Accounting Ledger' },
    { path: '/dashboard/accounting/reconciliation',    label: 'Posting Exceptions' },
    { path: '/dashboard/expenses',                     label: 'Expenses' },
    { path: '/dashboard/expenses/categories',          label: 'Expense Categories' },
    { path: '/dashboard/expenses/reports',             label: 'Expense Reports' },
    { path: '/dashboard/inventory',                    label: 'Inventory Products' },
    { path: '/dashboard/inventory/transfers',          label: 'Transfers' },
    { path: '/dashboard/inventory/shrinkage',          label: 'Shrinkage' },
    { path: '/dashboard/inventory/stock-takes',        label: 'Stock Takes' },
    { path: '/dashboard/inventory/ledger',             label: 'Stock Ledger' },
    { path: '/dashboard/inventory/labels',             label: 'Print Labels' },
    { path: '/dashboard/sales/reports/summary',        label: 'Sales Summary' },
    { path: '/dashboard/sales/reports/products',       label: 'Sales by Product' },
    { path: '/dashboard/reports/consolidated',         label: 'Consolidated Report' },
    { path: '/dashboard/inventory/reports/reorder',    label: 'Reorder Report' },
    { path: '/dashboard/inventory/reports/shrinkage',  label: 'Shrinkage Report' },
    { path: '/dashboard/inventory/reports/valuation',  label: 'Valuation Report' },
    { path: '/dashboard/storefront',                   label: 'Storefront Orders' },
    { path: '/dashboard/storefront/settings',          label: 'Storefront Settings' },
    { path: '/dashboard/billing',                      label: 'Billing' },
    { path: '/dashboard/settings',                     label: 'Settings' },
    { path: '/dashboard/admin/tenants',                label: 'Platform Admin Tenants' },
    { path: '/dashboard/customers',                    label: 'Customers' },
    { path: '/dashboard/customer-groups',              label: 'Customer Groups' },
    { path: '/dashboard/territories',                  label: 'Territories' },
    { path: '/dashboard/inventory/categories',         label: 'Categories' },
    { path: '/dashboard/inventory/settings',           label: 'Inventory Settings' },
    { path: '/dashboard/accounting/coa',               label: 'Chart of Accounts' },
    { path: '/dashboard/accounting/posting-rules',     label: 'Posting Rules' },
    { path: '/dashboard/settings/branding',            label: 'Branding' },
    { path: '/dashboard/settings/tax',                 label: 'Tax / VAT' },
    { path: '/dashboard/settings/audit-logs',          label: 'Audit Logs' },
    { path: '/dashboard/settings/loyalty',             label: 'Loyalty Program Settings' },
    { path: '/dashboard/settings/sms',                 label: 'SMS Notifications' },
    { path: '/dashboard/settings/reports',             label: 'Report Emails' },
    { path: '/dashboard/settings/discount-codes',      label: 'Discount Codes' },
    { path: '/dashboard/help',                         label: 'Help' },
];

// Errors that indicate a real problem (not just warnings)
const FATAL_PATTERNS = [
    /error\s+boundary/i,
    /application error/i,
    /something went wrong/i,
    /unhandled.*exception/i,
    /chunk load error/i,
    /hydration.*failed/i,
    /hydration mismatch/i,
    /cannot read propert/i,
    /is not a function/i,
    /is not defined/i,
    /failed to fetch/i,
    /network error/i,
    /500/,
];

// Console error patterns to flag (less strict for warnings)
const CONSOLE_ERROR_IGNORE = [
    /sentry/i,
    /metaDescription/i,
    /favicon/i,
    /webpack/i,
    /hot.*update/i,
    /DevTools/i,
    /supabase.*realtime/i,
    /ExperimentalWarning/i,
    /DeprecationWarning/i,
    /Download the React DevTools/i,
    /upstash/i,
    /sms.*log/i,
    /resend/i,
    /BILLING_PROVIDER/i,
];

async function loginAndGetToken(): Promise<string> {
    const res = await fetch(`${API}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: E2E_EMAIL, password: E2E_PASSWORD }),
    });
    const data = await res.json();
    return data.data.access_token;
}

async function setupAuth(page: Page, token: string, tenantId: string, storeId: string) {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    // Inject auth into localStorage the way the app expects it
    await page.evaluate(
        ({ token, tenantId, storeId }) => {
            localStorage.setItem('access_token', token);
            localStorage.setItem('selected_tenant_id', tenantId);
            localStorage.setItem('selected_store_id', storeId);
        },
        { token, tenantId, storeId }
    );
}

test.describe('Sidebar navigation — all routes load without errors', { tag: '@readonly' }, () => {
    let token: string;
    let tenantId: string;
    let storeId: string;

    test.beforeAll(async () => {
        const res = await fetch(`${API}/api/v1/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: E2E_EMAIL, password: E2E_PASSWORD }),
        });
        const data = await res.json();
        token    = data.data.access_token;
        tenantId = data.data.tenants[0].id;
        storeId  = data.data.tenants[0].stores[0].id;
    });

    for (const route of ROUTES) {
        test(`${route.label} (${route.path})`, async ({ page }) => {
            const consoleErrors: string[] = [];
            const networkErrors: string[] = [];

            // Capture console errors
            page.on('console', (msg: ConsoleMessage) => {
                if (msg.type() === 'error') {
                    const text = msg.text();
                    const ignored = CONSOLE_ERROR_IGNORE.some((p) => p.test(text));
                    if (!ignored) consoleErrors.push(text);
                }
            });

            // Capture failed network requests (4xx/5xx from our API)
            page.on('response', (response) => {
                const url = response.url();
                const status = response.status();
                if (url.includes('localhost:4000') && status >= 400 && status !== 401 && status !== 403) {
                    networkErrors.push(`${status} ${url}`);
                }
            });

            // Set auth state
            await page.goto(BASE, { waitUntil: 'domcontentloaded' });
            await page.evaluate(
                ({ token, tenantId, storeId }) => {
                    localStorage.setItem('access_token', token);
                    localStorage.setItem('selected_tenant_id', tenantId);
                    localStorage.setItem('selected_store_id', storeId);
                },
                { token, tenantId, storeId }
            );

            // Navigate to the route
            await page.goto(`${BASE}${route.path}`, { waitUntil: 'networkidle', timeout: 15000 });

            // Check we weren't redirected to login (unauthenticated)
            const finalUrl = page.url();
            const redirectedToLogin = finalUrl.includes('/login') || finalUrl.includes('/auth');
            if (redirectedToLogin) {
                console.log(`  ⚠ Redirected to login: ${finalUrl}`);
            }

            // Check page body for fatal error text
            const bodyText = await page.locator('body').innerText().catch(() => '');
            const fatalInBody = FATAL_PATTERNS.filter((p) => p.test(bodyText));

            // Check for Next.js error overlay
            const errorOverlay = await page.locator('nextjs-portal, #__next-error, [data-nextjs-dialog]').count();

            // Build result
            const issues: string[] = [
                ...(redirectedToLogin ? [`Redirected to login (${finalUrl})`] : []),
                ...fatalInBody.map((p) => `Fatal text in body: ${p}`),
                ...(errorOverlay > 0 ? ['Next.js error overlay visible'] : []),
                ...consoleErrors.slice(0, 3).map((e) => `Console error: ${e.substring(0, 120)}`),
                ...networkErrors.slice(0, 3).map((e) => `Network error: ${e}`),
            ];

            if (issues.length > 0) {
                console.log(`\n  ISSUES on ${route.path}:\n${issues.map((i) => `    - ${i}`).join('\n')}`);
            }

            // Fail the test only for genuine fatal errors (not console warnings)
            const fatalIssues = [
                ...fatalInBody,
                ...(errorOverlay > 0 ? ['error overlay'] : []),
                ...networkErrors,
            ];
            expect(fatalIssues, `Fatal issues on ${route.path}`).toHaveLength(0);
        });
    }
});
