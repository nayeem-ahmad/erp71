const prisma = require('@prisma/client');
const accounting = require('./prisma/bootstrap-accounting.js');
const accountCode = require('./prisma/account-code.js');
const tenantRoles = require('./prisma/tenant-role.seed.js');
const paymentMethods = require('./prisma/payment-method.seed.js');
const leadTaxonomy = require('./prisma/lead-taxonomy.seed.js');
const seedDemo = require('./prisma/seed-demo.js');
const seedTemplate = require('./prisma/templates/seed-template.js');

module.exports = {
    ...prisma,
    ...accountCode,
    bootstrapDefaultAccountingForTenant: accounting.bootstrapDefaultAccountingForTenant,
    ensureInterBranchAccounts: accounting.ensureInterBranchAccounts,
    DEFAULT_ACCOUNTING_TEMPLATE: accounting.DEFAULT_ACCOUNTING_TEMPLATE,
    DEFAULT_POSTING_RULES: accounting.DEFAULT_POSTING_RULES,
    ...tenantRoles,
    ...paymentMethods,
    ...leadTaxonomy,
    DEMO_ACCOUNT_EMAIL: seedDemo.DEMO_ACCOUNT_EMAIL,
    DEMO_ACCOUNT_PASSWORD: seedDemo.DEMO_ACCOUNT_PASSWORD,
    seedDemoAccount: seedDemo.seedDemoAccount,
    seedBusinessTypeTemplate: seedTemplate.seedBusinessTypeTemplate,
};