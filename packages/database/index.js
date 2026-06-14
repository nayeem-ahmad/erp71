const prisma = require('@prisma/client');
const accounting = require('./prisma/bootstrap-accounting.js');

const DEMO_ACCOUNT_EMAIL = 'demo@retailsaas.app';

module.exports = {
    ...prisma,
    ...accounting,
    DEMO_ACCOUNT_EMAIL,
};