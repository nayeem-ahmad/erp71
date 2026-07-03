const prisma = require('@prisma/client');
const accounting = require('./prisma/bootstrap-accounting.js');
const tenantRoles = require('./prisma/tenant-role.seed.js');
const seedDemo = require('./prisma/seed-demo.js');

module.exports = {
    ...prisma,
    ...accounting,
    ...tenantRoles,
    DEMO_ACCOUNT_EMAIL: seedDemo.DEMO_ACCOUNT_EMAIL,
    DEMO_ACCOUNT_PASSWORD: seedDemo.DEMO_ACCOUNT_PASSWORD,
    seedDemoAccount: seedDemo.seedDemoAccount,
    seedTenantDemoData: seedDemo.seedTenantDemoData,
};