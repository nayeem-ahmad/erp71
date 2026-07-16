const prisma = require('@prisma/client');
const accounting = require('./prisma/bootstrap-accounting.js');
const tenantRoles = require('./prisma/tenant-role.seed.js');
const paymentMethods = require('./prisma/payment-method.seed.js');
const seedDemo = require('./prisma/seed-demo.js');
const seedTemplate = require('./prisma/templates/seed-template.js');

module.exports = {
    ...prisma,
    bootstrapDefaultAccountingForTenant: accounting.bootstrapDefaultAccountingForTenant,
    ensureLoanPostingSetup: accounting.ensureLoanPostingSetup,
    ensureCustomerPaymentPostingSetup: accounting.ensureCustomerPaymentPostingSetup,
    ensureInterBranchAccounts: accounting.ensureInterBranchAccounts,
    DEFAULT_ACCOUNTING_TEMPLATE: accounting.DEFAULT_ACCOUNTING_TEMPLATE,
    DEFAULT_POSTING_RULES: accounting.DEFAULT_POSTING_RULES,
    ...tenantRoles,
    ...paymentMethods,
    DEMO_ACCOUNT_EMAIL: seedDemo.DEMO_ACCOUNT_EMAIL,
    DEMO_ACCOUNT_PASSWORD: seedDemo.DEMO_ACCOUNT_PASSWORD,
    seedDemoAccount: seedDemo.seedDemoAccount,
    seedBusinessTypeTemplate: seedTemplate.seedBusinessTypeTemplate,
};