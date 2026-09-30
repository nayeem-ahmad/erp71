import { DEFAULT_TENANT_NAV_LAYOUT, NAV_PERMISSIONS, NAV_REGISTRY } from '@erp71/shared-types';

describe('sales.daily-report nav', () => {
    it('is a BASIC Sales link gated on VIEW_FINANCIAL_REPORTS', () => {
        const entry = NAV_REGISTRY['sales.daily-report'];
        expect(entry.href).toBe('/sales/daily-report');
        expect(entry.advancedOnly).toBeFalsy();
        const layout = DEFAULT_TENANT_NAV_LAYOUT.find((node) => node.id === 'sales.daily-report');
        expect(layout?.parentId).toBe('sales');
        expect(NAV_PERMISSIONS['sales.daily-report']).toEqual(['VIEW_FINANCIAL_REPORTS']);
    });
});
