import { StorePermission as P } from '@erp71/shared-types';

/**
 * The "any one of these" sets that gate routes several roles legitimately use.
 * Applied with `@RequireAnyStorePermission(...SET)`; OWNER always passes.
 *
 * Two rules keep these honest:
 *
 * 1. **A read set names everyone who works with the document**, not just its
 *    author: a sale is read by whoever sells, orders, quotes or returns, and by
 *    the accountants who reconcile it. A write set names the specific action.
 * 2. **`VIEW_LEDGER` is deliberately absent from most sets.** The legacy Cashier
 *    holds it by default, so listing it would hand every cashier the purchase
 *    book. Accountants are recognised by `VIEW_FINANCIAL_REPORTS` instead.
 *
 * `route-authorization.roles.spec.ts` pins that every built-in role template
 * still reaches the routes its module exists for.
 */

// Sales ------------------------------------------------------------------
/** Anyone who sells, quotes, orders or returns. */
export const SALES_STAFF: P[] = [P.CREATE_SALE, P.CREATE_SALES_ORDER, P.CREATE_QUOTATION, P.CREATE_RETURN];
/** Sales documents, reports and dashboards. */
export const SALES_READ: P[] = [
    ...SALES_STAFF,
    P.VIEW_CUSTOMER_CREDIT,
    P.MANAGE_CUSTOMER_CREDIT,
    P.WRITE_OFF_CUSTOMER_DEBT,
    P.VIEW_FINANCIAL_REPORTS,
    P.VIEW_CONSOLIDATED_REPORTS,
    P.EDIT_PRODUCT_PRICES,
];
export const SALE_WRITE: P[] = [P.CREATE_SALE];
export const SALE_DELETE: P[] = [P.CANCEL_ENTRY];
export const SALES_ORDER_WRITE: P[] = [P.CREATE_SALES_ORDER];
export const QUOTATION_WRITE: P[] = [P.CREATE_QUOTATION];
export const SALES_RETURN_WRITE: P[] = [P.CREATE_RETURN];
export const DELIVERY_WRITE: P[] = [P.CREATE_SALE, P.CREATE_SALES_ORDER];
export const WARRANTY_WRITE: P[] = [P.CREATE_SALE, P.CREATE_RETURN];
/** Setting up price lists, customer groups, territories. */
export const SALES_SETUP_WRITE: P[] = [
    P.EDIT_PRODUCT_PRICES,
    P.MANAGE_CUSTOMER_CREDIT,
    P.MANAGE_CRM_SETTINGS,
    P.MANAGE_USERS,
    P.MANAGE_COUNTERS,
];
/** Price lists are read at the till to price a sale. */
export const PRICE_LIST_READ: P[] = [...SALES_STAFF, P.EDIT_PRODUCT_PRICES, P.VIEW_PRODUCT_CATALOG];
/** The till: opening, closing and reading a cashier session. */
export const POS_STAFF: P[] = [P.CREATE_SALE, P.MANAGE_COUNTERS];
export const LOYALTY_ADJUST: P[] = [P.MANAGE_CUSTOMER_CREDIT, P.MANAGE_USERS];
export const PROMO_MANAGE: P[] = [P.EDIT_PRODUCT_PRICES, P.MANAGE_USERS];
export const STOREFRONT_STAFF: P[] = [P.MANAGE_STOREFRONT_PAGES, P.CREATE_SALE, P.MANAGE_USERS];

// Customers ---------------------------------------------------------------
/** CRM staff read the customer list too. */
export const CRM_STAFF: P[] = [
    P.VIEW_CRM_INTERACTIONS,
    P.CREATE_CRM_INTERACTIONS,
    P.MANAGE_CRM_TASKS,
    P.APPROVE_CRM_ACTIVITY,
    P.VIEW_LEADS,
    P.MANAGE_LEADS,
    P.VIEW_LEAD_CONVERSATIONS,
    P.CREATE_LEAD_CONVERSATIONS,
    P.MANAGE_CRM_SETTINGS,
];
export const CUSTOMER_READ: P[] = [...SALES_READ, ...CRM_STAFF];
export const CUSTOMER_WRITE: P[] = [
    P.CREATE_SALE,
    P.CREATE_SALES_ORDER,
    P.CREATE_QUOTATION,
    P.MANAGE_LEADS,
    P.MANAGE_CUSTOMER_CREDIT,
];
/** A customer's receivables ledger — what they owe, and what they have paid. */
export const CUSTOMER_CREDIT_READ: P[] = [
    P.VIEW_CUSTOMER_CREDIT,
    P.MANAGE_CUSTOMER_CREDIT,
    P.WRITE_OFF_CUSTOMER_DEBT,
    P.VIEW_FINANCIAL_REPORTS,
    P.CREATE_SALE,
];
export const CUSTOMER_CREDIT_WRITE: P[] = [P.MANAGE_CUSTOMER_CREDIT, P.CREATE_VOUCHER, P.CREATE_SALE];

// CRM ---------------------------------------------------------------------
export const CRM_WRITE: P[] = [
    P.CREATE_CRM_INTERACTIONS,
    P.MANAGE_CRM_TASKS,
    P.MANAGE_LEADS,
    P.CREATE_LEAD_CONVERSATIONS,
    P.MANAGE_CRM_SETTINGS,
];
/** Bulk messaging spends SMS/WhatsApp credits: campaign managers only. */
export const CRM_CAMPAIGN_WRITE: P[] = [P.MANAGE_CRM_SETTINGS, P.MANAGE_LEADS];

// Purchasing --------------------------------------------------------------
export const PURCHASE_READ: P[] = [
    P.CREATE_PURCHASE,
    P.EDIT_SUPPLIERS,
    P.APPROVE_PRODUCT_DEMAND,
    P.VIEW_FINANCIAL_REPORTS,
    P.VIEW_CONSOLIDATED_REPORTS,
];
export const PURCHASE_WRITE: P[] = [P.CREATE_PURCHASE];
export const PURCHASE_RETURN_WRITE: P[] = [P.CREATE_PURCHASE, P.CREATE_RETURN];
/** A supplier's name and phone are looked up wherever a product is edited. */
export const SUPPLIER_READ: P[] = [...PURCHASE_READ, P.VIEW_PRODUCT_CATALOG, P.EDIT_PRODUCTS];
export const SUPPLIER_WRITE: P[] = [P.EDIT_SUPPLIERS, P.CREATE_PURCHASE];
/** A supplier's payables ledger and payments. */
export const SUPPLIER_CREDIT_READ: P[] = [P.CREATE_PURCHASE, P.EDIT_SUPPLIERS, P.VIEW_FINANCIAL_REPORTS];
export const SUPPLIER_CREDIT_WRITE: P[] = [P.CREATE_PURCHASE, P.CREATE_VOUCHER];

// Inventory & catalogue -----------------------------------------------------
export const CATALOG_READ: P[] = [P.VIEW_PRODUCT_CATALOG];
export const PRODUCT_WRITE: P[] = [P.EDIT_PRODUCTS, P.EDIT_PRODUCT_PRICES];
export const BRAND_WRITE: P[] = [P.EDIT_BRANDS, P.EDIT_PRODUCTS];
export const INVENTORY_STAFF: P[] = [
    P.CREATE_INVENTORY_MOVEMENTS,
    P.CREATE_GOODS_TRANSFER,
    P.APPROVE_GOODS_TRANSFER,
    P.STOCK_TAKE,
];
/** Stock values and dashboards: cost is in them, so no bare catalogue read. */
export const INVENTORY_REPORT_READ: P[] = [
    ...INVENTORY_STAFF,
    P.EDIT_PRODUCTS,
    P.EDIT_PRODUCT_PRICES,
    P.CREATE_PURCHASE,
    P.APPROVE_PRODUCT_DEMAND,
    P.VIEW_FINANCIAL_REPORTS,
    P.VIEW_CONSOLIDATED_REPORTS,
];
export const INVENTORY_WRITE: P[] = [P.CREATE_INVENTORY_MOVEMENTS, P.MANAGE_STORES];
export const STOCK_TAKE_STAFF: P[] = [P.STOCK_TAKE, P.CREATE_INVENTORY_MOVEMENTS];
export const SHRINKAGE_STAFF: P[] = [P.CREATE_INVENTORY_MOVEMENTS, P.STOCK_TAKE];
export const MANUFACTURING_READ: P[] = [
    P.CREATE_INVENTORY_MOVEMENTS,
    P.STOCK_TAKE,
    P.EDIT_PRODUCTS,
    P.CREATE_GOODS_TRANSFER,
    P.VIEW_FINANCIAL_REPORTS,
];
export const MANUFACTURING_WRITE: P[] = [P.CREATE_INVENTORY_MOVEMENTS, P.EDIT_PRODUCTS];
export const MANUFACTURING_PRICE: P[] = [P.EDIT_PRODUCT_PRICES];

// Money -----------------------------------------------------------------------
export const ACCOUNTING_READ: P[] = [P.VIEW_LEDGER, P.VIEW_FINANCIAL_REPORTS, P.CREATE_VOUCHER];
export const ACCOUNTING_WRITE: P[] = [P.CREATE_VOUCHER];
export const FUND_READ: P[] = [P.CREATE_FUND_TRANSFER, P.APPROVE_FUND_TRANSFER, P.VIEW_FINANCIAL_REPORTS];
export const FUND_CREATE: P[] = [P.CREATE_FUND_TRANSFER];
/** Receiving is approving on the other end; managers hold only CREATE. */
export const FUND_RECEIVE: P[] = [P.APPROVE_FUND_TRANSFER, P.CREATE_FUND_TRANSFER];
export const LOANS_READ: P[] = [P.VIEW_LOANS, P.MANAGE_LOANS];
export const LOANS_WRITE: P[] = [P.MANAGE_LOANS];
/** Payment methods are read wherever money is taken or paid. */
export const TENDER_READ: P[] = [
    ...SALES_STAFF,
    P.CREATE_PURCHASE,
    P.CREATE_VOUCHER,
    P.MANAGE_CUSTOMER_CREDIT,
    P.CREATE_FUND_TRANSFER,
    P.VIEW_FINANCIAL_REPORTS,
];
export const EXPENSE_READ: P[] = [P.VIEW_LEDGER, P.VIEW_FINANCIAL_REPORTS, P.CREATE_VOUCHER];
export const EXPENSE_WRITE: P[] = [P.CREATE_VOUCHER];

// People ------------------------------------------------------------------------
export const HR_READ: P[] = [P.VIEW_HR, P.MANAGE_HR];
export const HR_WRITE: P[] = [P.MANAGE_HR];
export const PAYROLL_READ: P[] = [P.VIEW_PAYROLL, P.MANAGE_HR];
export const PAYROLL_WRITE: P[] = [P.MANAGE_HR];
/** Accruing salaries posts vouchers, so the accountant who runs it may too. */
export const PAYROLL_POST: P[] = [P.MANAGE_HR, P.CREATE_VOUCHER];

// Workspace settings ------------------------------------------------------------
/** Whoever administers users, branches or counters. */
export const SETTINGS_ADMIN: P[] = [P.MANAGE_USERS, P.MANAGE_STORES, P.MANAGE_COUNTERS];
export const COUNTER_READ: P[] = [P.CREATE_SALE, P.MANAGE_COUNTERS, P.MANAGE_STORES];
export const COUNTER_WRITE: P[] = [P.MANAGE_COUNTERS, P.MANAGE_STORES];
/** Receipts and invoices are printed by whoever produces the document. */
export const PRINT_READ: P[] = [
    ...SALES_STAFF,
    P.CREATE_PURCHASE,
    P.CREATE_VOUCHER,
    P.VIEW_FINANCIAL_REPORTS,
    P.MANAGE_COUNTERS,
    P.MANAGE_USERS,
];
export const BILLING_ADMIN: P[] = [P.MANAGE_USERS];
export const API_KEY_ADMIN: P[] = [P.MANAGE_USERS];
/** The chart-of-accounts names a payment method can point at. */
export const PAYMENT_ACCOUNTS_READ: P[] = [...ACCOUNTING_READ, ...SETTINGS_ADMIN];
