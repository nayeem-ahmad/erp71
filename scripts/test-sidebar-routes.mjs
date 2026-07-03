// Sidebar route tester — paths from Sidebar.tsx + routes.ts
// Usage: node scripts/test-sidebar-routes.mjs

import { chromium } from 'playwright';

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const API = process.env.E2E_API_URL || 'http://localhost:4000';
const EMAIL = process.env.E2E_TEST_EMAIL || 'nayeem.ahmad@gmail.com';
const PASSWORD = process.env.E2E_TEST_PASSWORD || 'password123';

/** All hrefs rendered in Sidebar.tsx (buildModules). */
const ROUTES = [
    { path: '/dashboard', label: 'Dashboard' },

    // Sales
    { path: '/sales', label: 'Sales Overview' },
    { path: '/sales/pos', label: 'POS' },
    { path: '/sales/list', label: 'Sales' },
    { path: '/sales/new', label: 'New Sales Entry' },
    { path: '/sales/customer-payments', label: 'Customer Payments' },
    { path: '/sales/returns', label: 'Sales Returns' },
    { path: '/sales/quotes', label: 'Sales Quotations' },
    { path: '/sales/orders', label: 'Sales Orders' },
    { path: '/sales/delivery', label: 'Delivery' },
    { path: '/sales/warranty-claims', label: 'Warranty Claims' },
    { path: '/storefront/settings', label: 'Storefront Settings' },
    { path: '/sales/customers', label: 'Customers' },
    { path: '/sales/cashier-sessions', label: 'Cashier Sessions' },
    { path: '/sales/customer-ledger', label: 'Customer Ledger' },
    { path: '/sales/customers/reports/due-aging', label: 'Due Aging' },
    { path: '/sales/loyalty', label: 'Loyalty Points' },
    { path: '/sales/reports/summary', label: 'Sales Summary' },
    { path: '/sales/reports/products', label: 'Sales by Product' },
    { path: '/sales/reports/consolidated', label: 'Consolidated Report' },
    { path: '/sales/reports/branch-report', label: 'Branch Report' },
    { path: '/sales/customer-groups', label: 'Customer Groups' },
    { path: '/sales/price-lists', label: 'Price Lists' },
    { path: '/sales/territories', label: 'Territories' },
    { path: '/settings/sales', label: 'Sales Settings' },

    // Purchases
    { path: '/purchases', label: 'Purchase Overview' },
    { path: '/purchases/list', label: 'All Purchases' },
    { path: '/purchases/supplier-payments', label: 'Supplier Payments' },
    { path: '/purchases/supplier-ledger', label: 'Supplier Ledger' },
    { path: '/purchases/orders', label: 'Purchase Orders' },
    { path: '/purchases/quotations', label: 'Purchase Quotations' },
    { path: '/purchases/returns', label: 'Purchase Returns' },
    { path: '/purchases/reports/summary', label: 'Purchase Summary' },
    { path: '/purchases/reports/by-product', label: 'Purchases by Product' },
    { path: '/purchases/reports/by-supplier', label: 'Purchases by Supplier' },
    { path: '/purchases/suppliers', label: 'Suppliers' },

    // Accounting
    { path: '/accounting', label: 'Accounting Overview' },
    { path: '/accounting/vouchers/new', label: 'Voucher Entry' },
    { path: '/accounting/vouchers', label: 'Vouchers' },
    { path: '/accounting/journal', label: 'Journal' },
    { path: '/accounting/ledger', label: 'Accounting Ledger' },
    { path: '/accounting/expenses', label: 'Expenses' },
    { path: '/accounting/expenses/categories', label: 'Expense Categories' },
    { path: '/accounting/expenses/reports', label: 'Expense Reports' },
    { path: '/accounting/loans', label: 'Loans' },
    { path: '/accounting/reconciliation', label: 'Posting Exceptions' },
    { path: '/accounting/reconciliation/bank', label: 'Bank Reconciliation' },
    { path: '/accounting/reports/pl', label: 'Profit & Loss' },
    { path: '/accounting/reports/balance-sheet', label: 'Balance Sheet' },
    { path: '/accounting/reports/cashbook', label: 'Cashbook' },
    { path: '/accounting/reports/bankbook', label: 'Bankbook' },
    { path: '/accounting/reports/trial-balance', label: 'Trial Balance' },
    { path: '/accounting/reports/comparative-pl', label: 'Comparative P&L' },
    { path: '/accounting/reports/ar-aging', label: 'AR Aging' },
    { path: '/accounting/reports/ap-aging', label: 'AP Aging' },
    { path: '/accounting/reports/vat-tax', label: 'VAT / Tax Report' },
    { path: '/accounting/reports/budget-vs-actual', label: 'Budget vs. Actual' },
    { path: '/accounting/reports/cash-flow', label: 'Cash Flow Statement' },
    { path: '/accounting/reports/financial-ratios', label: 'Financial Ratios' },
    { path: '/accounting/coa', label: 'Chart of Accounts' },
    { path: '/accounting/posting-rules', label: 'Posting Rules' },
    { path: '/accounting/fiscal-periods', label: 'Fiscal Periods' },
    { path: '/accounting/opening-balances', label: 'Opening Balances' },
    { path: '/accounting/cost-centers', label: 'Cost Centers' },
    { path: '/accounting/fixed-assets', label: 'Fixed Assets' },
    { path: '/accounting/recurring-journals', label: 'Recurring Journals' },

    // Inventory
    { path: '/inventory', label: 'Inventory Overview' },
    { path: '/inventory/products', label: 'Inventory Products' },
    { path: '/inventory/transfers', label: 'Transfers' },
    { path: '/inventory/stock-takes', label: 'Stock Takes' },
    { path: '/inventory/shrinkage', label: 'Shrinkage' },
    { path: '/inventory/labels', label: 'Print Labels' },
    { path: '/inventory/ledger', label: 'Stock Ledger' },
    { path: '/inventory/reports/reorder', label: 'Reorder Report' },
    { path: '/inventory/reports/shrinkage', label: 'Shrinkage Report' },
    { path: '/inventory/reports/valuation', label: 'Valuation Report' },
    { path: '/inventory/brands', label: 'Brands' },
    { path: '/inventory/categories', label: 'Categories' },
    { path: '/inventory/settings', label: 'Inventory Settings' },

    // CRM
    { path: '/crm', label: 'CRM Overview' },
    { path: '/crm/leads', label: 'CRM Leads' },
    { path: '/crm/customers', label: 'CRM Customers' },

    // HR
    { path: '/hr', label: 'HR Overview' },
    { path: '/hr/employees', label: 'Employees' },
    { path: '/hr/employees/departments', label: 'Departments' },
    { path: '/hr/employees/designations', label: 'Designations' },
    { path: '/hr/attendance', label: 'Attendance' },
    { path: '/hr/leaves', label: 'Leaves' },
    { path: '/hr/salary-payments', label: 'Salary Payments' },

    // Account settings
    { path: '/settings', label: 'Settings' },
    { path: '/billing', label: 'Billing' },
    { path: '/team', label: 'Team & Permissions' },
    { path: '/sms-credits', label: 'SMS Credits' },
    { path: '/ai-credits', label: 'AI Credits' },

    // Support & admin
    { path: '/support', label: 'Support' },
    { path: '/admin', label: 'Admin Overview' },
    { path: '/admin/tenants', label: 'Platform Admin Tenants' },
    { path: '/admin/users', label: 'Platform Admin Users' },
    { path: '/admin/feedback', label: 'Feedback' },
    { path: '/admin/support', label: 'Admin Support' },
    { path: '/help', label: 'Help' },
];

const CRASH_PATTERNS = [
    /application error/i,
    /something went wrong/i,
    /unhandled runtime error/i,
    /chunk load error/i,
    /hydration failed/i,
];

const CONSOLE_IGNORE = [
    /sentry/i, /favicon/i, /webpack/i, /hot.*update/i, /DevTools/i,
    /supabase.*realtime/i, /ExperimentalWarning/i, /DeprecationWarning/i,
    /Download the React DevTools/i, /ResizeObserver loop/i, /instrumentation/i,
    /themeColor/i, /401/, /403/, /429/, /icon-192/, /Failed to load resource/,
];

async function login() {
    const res = await fetch(`${API}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    if (!res.ok) throw new Error(`Login failed: ${res.status} ${await res.text()}`);
    const body = await res.json();
    const d = body.data;
    return {
        token: d.access_token,
        tenantId: d.tenants[0].id,
        storeId: d.tenants[0].stores[0].id,
        planCode: d.tenants[0].subscription?.plan?.code ?? 'PREMIUM',
    };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function urlMatchesPath(finalUrl, expectedPath) {
    const u = new URL(finalUrl);
    const actual = u.pathname.replace(/\/$/, '') || '/';
    const expected = expectedPath.replace(/\/$/, '') || '/';
    return actual === expected || actual.startsWith(`${expected}/`);
}

async function run() {
    console.log(`Logging in as ${EMAIL}...`);
    const { token, tenantId, storeId, planCode } = await login();
    console.log(`✓ Logged in — tenant: ${tenantId}  plan: ${planCode}\n`);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.evaluate(({ token, tenantId, storeId, planCode }) => {
        localStorage.setItem('access_token', token);
        localStorage.setItem('tenant_id', tenantId);
        localStorage.setItem('store_id', storeId);
        localStorage.setItem('subscription_plan_code', planCode);
        localStorage.removeItem('active_context');
        localStorage.removeItem('demo_session');
    }, { token, tenantId, storeId, planCode });

    const results = [];

    for (const route of ROUTES) {
        const consoleErrors = [];
        const serverErrors = [];

        const onConsole = (msg) => {
            if (msg.type() === 'error') {
                const text = msg.text();
                if (!CONSOLE_IGNORE.some((p) => p.test(text))) {
                    consoleErrors.push(text.substring(0, 200));
                }
            }
        };
        const onResponse = (response) => {
            const url = response.url();
            const status = response.status();
            if (url.includes('localhost:4000') && status >= 500) {
                serverErrors.push(`${status} ${response.request().method()} ${url.replace(/.*api\/v1/, '/api/v1')}`);
            }
        };

        page.on('console', onConsole);
        page.on('response', onResponse);

        let timedOut = false;
        let navError = null;
        try {
            await page.goto(`${BASE}${route.path}`, { waitUntil: 'load', timeout: 60000 });
            await sleep(800);
        } catch (e) {
            if (/timeout/i.test(e.message)) timedOut = true;
            else navError = e.message.substring(0, 100);
        }

        page.off('console', onConsole);
        page.off('response', onResponse);

        const finalUrl = page.url();
        const redirected =
            finalUrl.includes('/login') ||
            (finalUrl.includes('/auth') && !finalUrl.includes('/dashboard'));
        const wrongPage = !redirected && !urlMatchesPath(finalUrl, route.path);

        let crashes = [];
        try {
            const bodyText = await page.locator('body').innerText({ timeout: 3000 });
            crashes = CRASH_PATTERNS.filter((p) => p.test(bodyText));
        } catch {}

        let errorDialog = false;
        try {
            errorDialog = await page.locator('[data-nextjs-dialog-header]').isVisible({ timeout: 800 });
        } catch {}

        const issues = [
            ...(redirected ? [`auth broken — redirected to ${finalUrl}`] : []),
            ...(wrongPage ? [`wrong page — expected ${route.path}, got ${new URL(finalUrl).pathname}`] : []),
            ...(timedOut ? ['page load timed out (>60s)'] : []),
            ...(navError ? [`navigation error: ${navError}`] : []),
            ...crashes.map((p) => `crash: ${p}`),
            ...(errorDialog ? ['Next.js error dialog'] : []),
            ...serverErrors.map((e) => `server 5xx: ${e}`),
            ...consoleErrors.slice(0, 2).map((e) => `JS error: ${e}`),
        ];

        const ok = issues.length === 0;
        const sym = ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
        console.log(`${sym} ${route.label.padEnd(34)} ${route.path}`);
        for (const issue of issues) console.log(`    └─ ${issue}`);

        results.push({ ...route, issues });
        await sleep(300);
    }

    await browser.close();

    const passed = results.filter((r) => r.issues.length === 0);
    const failed = results.filter((r) => r.issues.length > 0);

    console.log(`\n${'─'.repeat(65)}`);
    console.log(`Total: ${results.length}   \x1b[32m✓ ${passed.length} passed\x1b[0m   \x1b[31m✗ ${failed.length} failed\x1b[0m`);

    if (failed.length > 0) {
        console.log('\nFailed routes:');
        for (const r of failed) {
            console.log(`  • ${r.label.padEnd(34)} ${r.path}`);
            for (const i of r.issues) console.log(`      └─ ${i}`);
        }
        process.exit(1);
    }
}

run();