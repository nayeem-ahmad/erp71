import { canChooseAccountingDashboard, tenantDashboardVariant } from './plan-entitlements';

const LEDGER = ['VIEW_LEDGER'];

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
});

describe('canChooseAccountingDashboard', () => {
    it('is true only when the accounting module is entitled', () => {
        expect(canChooseAccountingDashboard('STANDARD', { premiumAccounting: true })).toBe(true);
        expect(canChooseAccountingDashboard('BASIC', {})).toBe(false);
        expect(canChooseAccountingDashboard(null, null)).toBe(false);
    });
});
