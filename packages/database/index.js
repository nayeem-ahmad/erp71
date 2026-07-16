const prisma = require('@prisma/client');
const accounting = require('./prisma/bootstrap-accounting.js');
const tenantRoles = require('./prisma/tenant-role.seed.js');
const paymentMethods = require('./prisma/payment-method.seed.js');
const seedDemo = require('./prisma/seed-demo.js');
const seedTemplate = require('./prisma/templates/seed-template.js');

module.exports = {
    ...prisma,
    ...accounting,
    ...tenantRoles,
    ...paymentMethods,
    DEMO_ACCOUNT_EMAIL: seedDemo.DEMO_ACCOUNT_EMAIL,
    DEMO_ACCOUNT_PASSWORD: seedDemo.DEMO_ACCOUNT_PASSWORD,
    seedDemoAccount: seedDemo.seedDemoAccount,
    seedTenantDemoData: seedDemo.seedTenantDemoData,
    seedBusinessTypeTemplate: seedTemplate.seedBusinessTypeTemplate,
};