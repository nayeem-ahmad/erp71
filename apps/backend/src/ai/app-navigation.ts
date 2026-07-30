import type { ChatToolModule } from './chat-tools';

/**
 * The pages the assistant is allowed to deep-link to.
 *
 * The data tools tell the model what the numbers are; this tells it where those
 * numbers live and where the user goes to act on them. The assistant is
 * read-only, so "record a sale" or "add an expense" is always a link out to the
 * page, never something it does itself — and a report answer reads better when
 * "the top 20 of 143" comes with a link to the full report.
 *
 * Paths must match a real route under `apps/frontend/src/app/(app)`. The
 * frontend renders an in-app link (client-side navigation) for any answer link
 * whose href starts with "/", so a wrong path here becomes a dead in-app link,
 * not an external one. Keep this list to routes that exist.
 *
 * Gating mirrors the tools: an entry with `modules` is offered only to a tenant
 * whose plan covers one of them, so an accounting-only business is never told to
 * open an inventory page it does not have.
 */
export interface AppPage {
    path: string;
    /** Short human label the model uses as the link text. */
    label: string;
    /** One line, written for the model: what the page is for. */
    description: string;
    /** Plans this page belongs to. Omit for pages every plan has. */
    modules?: ChatToolModule[];
}

const APP_PAGES: AppPage[] = [
    // Everywhere
    { path: '/dashboard', label: 'Dashboard', description: 'business overview and key figures at a glance' },

    // Sales — retail
    { path: '/sales/new', label: 'New Sale', description: 'record a new sale / invoice', modules: ['retail'] },
    { path: '/sales/pos', label: 'POS', description: 'point-of-sale counter for quick cash sales', modules: ['retail'] },
    { path: '/sales/list', label: 'All Sales', description: 'browse and search past sales', modules: ['retail'] },
    { path: '/sales/orders', label: 'Sales Orders', description: 'open sales orders and the order pipeline', modules: ['retail'] },
    { path: '/sales/quotes', label: 'Quotations', description: 'sales quotes and quotations', modules: ['retail'] },
    { path: '/sales/returns', label: 'Sales Returns', description: 'record and review customer returns', modules: ['retail'] },
    { path: '/sales/customer-payments', label: 'Customer Payments', description: 'receive a payment from a customer', modules: ['retail'] },
    { path: '/sales/loyalty', label: 'Loyalty', description: 'customer loyalty points and rewards', modules: ['retail'] },
    { path: '/sales/reports/summary', label: 'Sales Summary', description: 'sales totals and trend over a period', modules: ['retail'] },
    { path: '/sales/reports/products', label: 'Product Sales', description: 'sales broken down by product, top movers', modules: ['retail'] },

    // Customers — CRM
    { path: '/sales/customers', label: 'Customers', description: 'the customer list and customer profiles', modules: ['crm'] },
    { path: '/sales/customer-ledger', label: 'Customer Ledger', description: 'a customer\'s running account of sales and payments', modules: ['crm'] },
    { path: '/sales/customers/reports/due-aging', label: 'Receivables Aging', description: 'who owes money and how overdue it is', modules: ['crm'] },

    // Inventory
    { path: '/inventory', label: 'Inventory', description: 'stock overview', modules: ['inventory'] },
    { path: '/inventory/products', label: 'Products', description: 'the product list, prices and stock levels', modules: ['inventory'] },
    { path: '/inventory/reports/reorder', label: 'Reorder / Low Stock', description: 'items at or below their reorder level', modules: ['inventory'] },
    { path: '/inventory/reports/valuation', label: 'Stock Valuation', description: 'stock on hand and what it is worth, including aging', modules: ['inventory'] },
    { path: '/inventory/ledger', label: 'Stock Ledger', description: 'stock movements in and out over time', modules: ['inventory'] },
    { path: '/inventory/shrinkage', label: 'Shrinkage', description: 'stock loss, wastage and adjustments', modules: ['inventory'] },

    // Purchasing — retail
    { path: '/purchases', label: 'Purchases', description: 'purchasing overview', modules: ['retail'] },
    { path: '/purchases/list', label: 'All Purchases', description: 'record a purchase and browse past ones', modules: ['retail'] },
    { path: '/purchases/orders', label: 'Purchase Orders', description: 'purchase orders to suppliers', modules: ['retail'] },
    { path: '/purchases/quotations', label: 'Purchase Quotations', description: 'supplier quotations and RFQs', modules: ['retail'] },
    { path: '/purchases/returns', label: 'Purchase Returns', description: 'returns to suppliers', modules: ['retail'] },
    { path: '/purchases/suppliers', label: 'Suppliers', description: 'the supplier list and supplier profiles', modules: ['retail'] },
    { path: '/purchases/supplier-payments', label: 'Supplier Payments', description: 'pay a supplier', modules: ['retail'] },
    { path: '/purchases/supplier-ledger', label: 'Supplier Ledger', description: 'a supplier\'s running account of purchases and payments', modules: ['retail'] },
    { path: '/purchases/reports/summary', label: 'Purchase Summary', description: 'purchase totals and trend over a period', modules: ['retail'] },

    // Accounting — always available
    { path: '/accounting/expenses', label: 'Expenses', description: 'record an expense and review expenses' },
    { path: '/accounting/vouchers/new', label: 'New Voucher', description: 'post a journal / accounting voucher' },
    { path: '/accounting/reports/pl', label: 'Profit & Loss', description: 'the P&L statement (and a click from the other statements)' },
    { path: '/accounting/reports/budget-vs-actual', label: 'Budget vs Actual', description: 'budgeted figures against actuals' },
    { path: '/accounting/reports/vat-tax', label: 'VAT & Tax', description: 'VAT and tax summary' },
    { path: '/accounting/reports/cashbook', label: 'Cash Book', description: 'cash and bank position and movements' },
    { path: '/accounting/reports/ap-aging', label: 'Payables Aging', description: 'what the business owes suppliers and how overdue' },

    // HR
    { path: '/hr/attendance', label: 'Attendance', description: 'staff attendance and workforce figures', modules: ['hr'] },
];

/** The pages this tenant's plan actually has, given its resolved modules. */
export function pagesForModules(modules: Set<ChatToolModule>): AppPage[] {
    return APP_PAGES.filter((page) => !page.modules || page.modules.some((m) => modules.has(m)));
}

/** The "Pages you can link to" block for the system prompt. */
export function buildNavigationSection(modules: Set<ChatToolModule>): string[] {
    const pages = pagesForModules(modules);
    if (!pages.length) return [];
    return [
        'LINKING TO PAGES IN THE APP:',
        '- When you point the user somewhere in the app — a report to open, or a page to do something you cannot do yourself (you are read-only) — link to it with a markdown link using one of the exact paths below: "[open the Sales Summary](/sales/reports/summary)".',
        '- Only ever link to a path from this list. Never invent a path, and never link to one that is not here. If the right page is not on the list, name it in words instead of guessing a link.',
        '- These are in-app links, so use the path on its own with no domain. Give one link per suggestion, not a list of pages, unless the user asked about several.',
        '',
        'Pages you can link to:',
        ...pages.map((page) => `- ${page.path} — ${page.description}`),
    ];
}
