import { isAccountingOnlyBlockedPath } from './accounting-only-paths';

describe('isAccountingOnlyBlockedPath', () => {
    it('blocks retail module paths', () => {
        expect(isAccountingOnlyBlockedPath('/sales')).toBe(true);
        expect(isAccountingOnlyBlockedPath('/sales/new')).toBe(true);
        expect(isAccountingOnlyBlockedPath('/purchases')).toBe(true);
        expect(isAccountingOnlyBlockedPath('/inventory/products')).toBe(true);
        expect(isAccountingOnlyBlockedPath('/crm')).toBe(true);
        expect(isAccountingOnlyBlockedPath('/hr')).toBe(true);
        expect(isAccountingOnlyBlockedPath('/storefront')).toBe(true);
    });

    it('blocks retail-only account settings pages', () => {
        expect(isAccountingOnlyBlockedPath('/settings/loyalty')).toBe(true);
        expect(isAccountingOnlyBlockedPath('/settings/counters')).toBe(true);
        expect(isAccountingOnlyBlockedPath('/settings/sms')).toBe(true);
        expect(isAccountingOnlyBlockedPath('/settings/sales')).toBe(true);
        expect(isAccountingOnlyBlockedPath('/settings/payment-methods')).toBe(true);
        expect(isAccountingOnlyBlockedPath('/settings/discount-codes')).toBe(true);
        expect(isAccountingOnlyBlockedPath('/settings/branding')).toBe(true);
        expect(isAccountingOnlyBlockedPath('/settings/reports')).toBe(true);
    });

    it('allows accounting-relevant account settings pages', () => {
        expect(isAccountingOnlyBlockedPath('/settings')).toBe(false);
        expect(isAccountingOnlyBlockedPath('/settings/audit-logs')).toBe(false);
        expect(isAccountingOnlyBlockedPath('/settings/localization')).toBe(false);
        expect(isAccountingOnlyBlockedPath('/settings/tax')).toBe(false);
        expect(isAccountingOnlyBlockedPath('/settings/data')).toBe(false);
    });

    it('allows the accounting workspace and non-settings admin pages', () => {
        expect(isAccountingOnlyBlockedPath('/accounting')).toBe(false);
        expect(isAccountingOnlyBlockedPath('/team')).toBe(false);
        expect(isAccountingOnlyBlockedPath('/billing')).toBe(false);
    });
});
