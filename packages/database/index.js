const prisma = require('@prisma/client');
const accounting = require('./prisma/bootstrap-accounting.js');

const DEMO_ACCOUNT_EMAIL = 'demo@erp71.com';

module.exports = {
    ...prisma,
    ...accounting,
    DEMO_ACCOUNT_EMAIL,
};