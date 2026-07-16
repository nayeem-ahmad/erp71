/**
 * Guards the runtime export surface of @erp71/database.
 *
 * packages/database has no build step: index.js is hand-maintained alongside
 * index.ts. TypeScript resolves imports against index.ts ("types"), Node against
 * index.js ("main"), so an export present only in the .ts typechecks fine and is
 * undefined at runtime. That has shipped three times (9374ffc, 6372327, and the
 * seedBusinessTypeTemplate bug this test was added for). Service specs mock the
 * package wholesale, so they cannot catch it.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const database = require('../../../packages/database/index.js');

describe('@erp71/database runtime exports', () => {
    it.each([
        'seedBusinessTypeTemplate',
        'seedDefaultTenantRoles',
        'seedDefaultPaymentMethods',
        'bootstrapDefaultAccountingForTenant',
        'seedDemoAccount',
        'seedTenantDemoData',
        'ensureInterBranchAccounts',
    ])('exports %s as a function from index.js', (name) => {
        expect(typeof database[name]).toBe('function');
    });

    it.each([
        'DEMO_ACCOUNT_EMAIL',
        'DEMO_ACCOUNT_PASSWORD',
    ])('exports %s as a defined (non-function) value from index.js', (name) => {
        expect(database[name]).not.toBeUndefined();
    });
});
