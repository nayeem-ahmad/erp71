import { chromium } from '@playwright/test';

const BASE = 'http://localhost:3000';
const API = 'http://localhost:4000';

const SIDEBAR_LINKS = [
    '/dashboard',
    '/dashboard/pos',
    '/dashboard/sales',
    '/dashboard/delivery',
    '/dashboard/returns',
    '/dashboard/orders',
    '/dashboard/quotes',
    '/dashboard/warranty-claims',
    '/dashboard/cashier-sessions',
    '/dashboard/loyalty',
    '/dashboard/sales/reports/summary',
    '/dashboard/sales/reports/products',
    '/dashboard/reports/consolidated',
    '/dashboard/reports/branch-report',
    '/dashboard/crm/tasks',
    '/dashboard/crm/campaigns',
    '/dashboard/customers/reports/due-aging',
    '/dashboard/customers',
    '/dashboard/customer-groups',
    '/dashboard/territories',
    '/dashboard/purchases',
    '/dashboard/purchase-orders',
    '/dashboard/purchase-quotations',
    '/dashboard/purchase-returns',
    '/dashboard/purchases/reports/summary',
    '/dashboard/purchases/reports/by-product',
    '/dashboard/purchases/reports/by-supplier',
    '/dashboard/suppliers',
    '/dashboard/accounting',
    '/dashboard/accounting/vouchers',
    '/dashboard/accounting/journal',
    '/dashboard/accounting/ledger',
    '/dashboard/accounting/reconciliation',
    '/dashboard/expenses',
    '/dashboard/accounting/reports/pl',
    '/dashboard/accounting/reports/balance-sheet',
    '/dashboard/accounting/reports/cashbook',
    '/dashboard/accounting/reports/bankbook',
    '/dashboard/accounting/coa',
    '/dashboard/accounting/posting-rules',
    '/dashboard/inventory',
    '/dashboard/inventory/transfers',
    '/dashboard/inventory/shrinkage',
    '/dashboard/inventory/stock-takes',
    '/dashboard/inventory/labels',
    '/dashboard/inventory/ledger',
    '/dashboard/inventory/reports/reorder',
    '/dashboard/inventory/reports/shrinkage',
    '/dashboard/inventory/reports/valuation',
    '/dashboard/brands',
    '/dashboard/inventory/categories',
    '/dashboard/inventory/settings',
    '/dashboard/storefront',
    '/dashboard/storefront/settings',
    '/dashboard/employees',
    '/dashboard/attendance',
    '/dashboard/leaves',
    '/dashboard/billing',
    '/dashboard/sms-credits',
    '/dashboard/ai-credits',
    '/dashboard/team',
    '/dashboard/settings',
    '/dashboard/support',
    '/dashboard/admin',
    '/dashboard/admin/tenants',
    '/dashboard/admin/users',
    '/dashboard/admin/support',
    '/dashboard/help',
];

type Result = { path: string; status: 'PASS' | 'FAIL' | 'REDIRECT'; detail?: string };

async function checkLinks() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Step 1: Login
    console.log('Logging in via demo endpoint...');
    const demoRes = await page.request.post(`${API}/api/v1/auth/demo`);
    const body = await demoRes.json();
    const token: string = body.data.access_token;
    const tenantId: string = body.data.tenants?.[0]?.id ?? '';
    const storeId: string = body.data.tenants?.[0]?.stores?.[0]?.id ?? '';
    console.log(`Logged in as demo@retailsaas.app, tenant=${tenantId}, store=${storeId}\n`);

    // Inject auth into browser localStorage
    await page.goto(`${BASE}/login`);
    await page.evaluate(({ token, tenantId, storeId }) => {
        localStorage.setItem('access_token', token);
        localStorage.setItem('tenant_id', tenantId);
        localStorage.setItem('store_id', storeId);
    }, { token, tenantId, storeId });

    const results: Result[] = [];

    for (const path of SIDEBAR_LINKS) {
        const url = `${BASE}${path}`;
        const consoleErrors: string[] = [];
        const pageErrors: string[] = [];

        const consoleHandler = (msg: any) => {
            if (msg.type() === 'error') consoleErrors.push(msg.text());
        };
        const errorHandler = (err: Error) => pageErrors.push(err.message);

        page.on('console', consoleHandler);
        page.on('pageerror', errorHandler);

        try {
            await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
            const finalUrl = page.url();
            const finalPath = new URL(finalUrl).pathname;

            const bodyText = await page.textContent('body') ?? '';
            const has404 = /\b404\b|page not found|not found/i.test(bodyText);
            const hasError = /application error|something went wrong|an unexpected error/i.test(bodyText);
            const redirectedToLogin = finalUrl.includes('/login');
            const redirectedElsewhere = finalPath !== path && !redirectedToLogin;

            let status: Result['status'] = 'PASS';
            let detail = '';

            if (redirectedToLogin) {
                status = 'FAIL';
                detail = 'Redirected to login (auth not persisted)';
            } else if (has404) {
                status = 'FAIL';
                detail = '404 page rendered';
            } else if (hasError) {
                status = 'FAIL';
                detail = 'Error boundary triggered';
            } else if (redirectedElsewhere) {
                status = 'REDIRECT';
                detail = `→ ${finalPath}`;
            } else {
                const criticalErrors = consoleErrors.filter(e =>
                    e.includes('ChunkLoadError') ||
                    e.includes('Cannot read properties of undefined') ||
                    e.includes('is not a function')
                );
                if (criticalErrors.length > 0) {
                    status = 'FAIL';
                    detail = criticalErrors[0].slice(0, 120);
                }
                if (pageErrors.length > 0) {
                    status = 'FAIL';
                    detail = pageErrors[0].slice(0, 120);
                }
            }

            results.push({ path, status, detail });
        } catch (err: any) {
            results.push({ path, status: 'FAIL', detail: (err.message ?? 'timeout/crash').slice(0, 120) });
        } finally {
            page.off('console', consoleHandler);
            page.off('pageerror', errorHandler);
        }

        const r = results[results.length - 1];
        const icon = r.status === 'PASS' ? '✅' : r.status === 'REDIRECT' ? '↪️ ' : '❌';
        console.log(`${icon} ${path}${r.detail ? '  — ' + r.detail : ''}`);
    }

    await browser.close();

    const passes = results.filter(r => r.status === 'PASS').length;
    const fails = results.filter(r => r.status === 'FAIL');
    const redirects = results.filter(r => r.status === 'REDIRECT');

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`✅ PASS:     ${passes}/${results.length}`);
    if (redirects.length) {
        console.log(`↪️  REDIRECT: ${redirects.length}`);
        redirects.forEach(r => console.log(`   ${r.path}  ${r.detail}`));
    }
    if (fails.length) {
        console.log(`❌ FAIL:     ${fails.length}`);
        fails.forEach(f => console.log(`   ${f.path}  — ${f.detail}`));
    }
}

checkLinks().catch(err => { console.error(err); process.exit(1); });
