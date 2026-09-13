export * from '@prisma/client';
export { applyAccountingTemplate, bootstrapDefaultAccountingForTenant, ensureInterBranchAccounts, DEFAULT_ACCOUNTING_TEMPLATE, DEFAULT_POSTING_RULES } from './prisma/bootstrap-accounting.js';
export type { AccountingBootstrapClient, DefaultAccountingGroupDefinition } from './prisma/bootstrap-accounting.js';
export {
    bootstrapPlatformAccounting,
    seedPlatformExpenseCategories,
    DEFAULT_PLATFORM_EXPENSE_CATEGORIES,
    PLATFORM_ACCOUNT,
    PLATFORM_ACCOUNTING_TEMPLATE,
    PLATFORM_PAYMENT_ACCOUNTS,
    PLATFORM_PAYMENT_METHODS,
} from './prisma/platform-accounting.js';
export type { PlatformAccountName, PlatformExpenseCategoryDefinition } from './prisma/platform-accounting.js';
export * from './prisma/account-code.js';
export { seedDemoAccount, DEMO_ACCOUNT_EMAIL, DEMO_ACCOUNT_PASSWORD } from './prisma/seed-demo.js';
export { seedBusinessTypeTemplate } from './prisma/templates/seed-template.js';
export { seedDefaultTenantRoles } from './prisma/tenant-role.seed.js';
export { seedDefaultPaymentMethods, DEFAULT_PAYMENT_METHODS } from './prisma/payment-method.seed.js';
export {
    seedDefaultLeadTaxonomy,
    DEFAULT_LEAD_SOURCES,
    DEFAULT_LEAD_CATEGORIES,
    DEFAULT_CONVERSATION_CHANNELS,
    DEFAULT_ACTIVITY_PURPOSES,
    LEGACY_LEAD_SOURCE_CODES,
    LEGACY_LEAD_CATEGORY_CODES,
    FALLBACK_SOURCE_CODE,
} from './prisma/lead-taxonomy.seed.js';
