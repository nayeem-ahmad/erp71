import {
    canChooseAccountingDashboard,
    canChooseCrmDashboard,
    tenantDashboardVariant,
} from './plan-entitlements';

const LEDGER = ['VIEW_LEDGER'];
const PIPELINE = ['VIEW_LEADS'];

describe('tenantDashboardVariant', () => {
    it('reads the plan default out of a raw features_json bag', () => {
        expect(tenantDashboardVariant('STANDARD', { premiumAccounting: true }, 'AUTO', LEDGER)).toBe('RETAIL');
        expect(
            tenantDashboardVariant(
                'STANDARD',
                { premiumAccounting: true, accountingDashboard: true },
                'AUTO',
                LEDGER,
            ),
        ).toBe('ACCOUNTING');
    });

    it('honours a tenant that opted in on a retail plan', () => {
        expect(
            tenantDashboardVariant('STANDARD', { premiumAccounting: true }, 'ACCOUNTING', LEDGER),
        ).toBe('ACCOUNTING');
    });

    it('honours a tenant that opted out of an accounting-default plan', () => {
        expect(
            tenantDashboardVariant(
                'STANDARD',
                { premiumAccounting: true, accountingDashboard: true },
                'RETAIL',
                LEDGER,
            ),
        ).toBe('RETAIL');
    });

    it('falls back to retail without the accounting module or the ledger permission', () => {
        expect(tenantDashboardVariant('BASIC', {}, 'ACCOUNTING', LEDGER)).toBe('RETAIL');
        expect(
            tenantDashboardVariant('STANDARD', { premiumAccounting: true }, 'ACCOUNTING', ['CREATE_SALE']),
        ).toBe('RETAIL');
    });

    it('pins accounting-only tenants regardless of preference or permission', () => {
        const features = { premiumAccounting: true, accountingOnly: true, accountingDashboard: true };
        expect(tenantDashboardVariant('ACCOUNTING', features, 'RETAIL', LEDGER)).toBe('ACCOUNTING');
        expect(tenantDashboardVariant('ACCOUNTING', features, 'AUTO', [])).toBe('ACCOUNTING');
    });

    it('treats missing plan data as retail rather than throwing', () => {
        expect(tenantDashboardVariant(null, null, null)).toBe('RETAIL');
        expect(tenantDashboardVariant(undefined, undefined, undefined)).toBe('RETAIL');
    });

    it('reads the CRM plan default and honours an opt-in on a retail plan', () => {
        expect(
            tenantDashboardVariant('STANDARD', { premiumCrm: true, crmDashboard: true }, 'AUTO', PIPELINE),
        ).toBe('CRM');
        expect(tenantDashboardVariant('STANDARD', { premiumCrm: true }, 'CRM', PIPELINE)).toBe('CRM');
        expect(tenantDashboardVariant('STANDARD', { premiumCrm: true }, 'AUTO', PIPELINE)).toBe('RETAIL');
    });

    it('falls back to retail without the CRM module or the leads permission', () => {
        expect(tenantDashboardVariant('BASIC', {}, 'CRM', PIPELINE)).toBe('RETAIL');
        expect(
            tenantDashboardVariant('STANDARD', { premiumCrm: true }, 'CRM', ['CREATE_SALE']),
        ).toBe('RETAIL');
    });

    it('honours a tenant that opted out of a CRM-default plan', () => {
        expect(
            tenantDashboardVariant('STANDARD', { premiumCrm: true, crmDashboard: true }, 'RETAIL', PIPELINE),
        ).toBe('RETAIL');
    });

    it('prefers accounting when a plan somehow carries both dashboard defaults', () => {
        const features = {
            premiumAccounting: true,
            accountingDashboard: true,
            premiumCrm: true,
            crmDashboard: true,
        };
        expect(tenantDashboardVariant('PREMIUM', features, 'AUTO', [...LEDGER, ...PIPELINE])).toBe('ACCOUNTING');
        // The preference is still the tenant's to override.
        expect(tenantDashboardVariant('PREMIUM', features, 'CRM', [...LEDGER, ...PIPELINE])).toBe('CRM');
    });

    it('pins accounting-only tenants even when they ask for CRM', () => {
        const features = { premiumAccounting: true, accountingOnly: true };
        expect(tenantDashboardVariant('ACCOUNTING', features, 'CRM', PIPELINE)).toBe('ACCOUNTING');
    });
});

describe('canChooseAccountingDashboard', () => {
    it('is true only when the accounting module is entitled', () => {
        expect(canChooseAccountingDashboard('STANDARD', { premiumAccounting: true })).toBe(true);
        expect(canChooseAccountingDashboard('BASIC', {})).toBe(false);
        expect(canChooseAccountingDashboard(null, null)).toBe(false);
    });
});

describe('canChooseCrmDashboard', () => {
    it('is true only when the premium CRM module is entitled', () => {
        expect(canChooseCrmDashboard('STANDARD', { premiumCrm: true })).toBe(true);
        expect(canChooseCrmDashboard('BASIC', {})).toBe(false);
        expect(canChooseCrmDashboard(null, null)).toBe(false);
    });
});
