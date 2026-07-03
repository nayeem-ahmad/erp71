import { buildNavModulesFromLayout } from '@/lib/nav-resolver';
import { DEFAULT_TENANT_NAV_LAYOUT } from '@erp71/shared-types';
import { enMessages } from '@/lib/localization/messages/en';
import { buildOpenGroupsState, collectNavGroupKeys, filterNavModules } from './sidebar-nav-filter';

const tenantModules = buildNavModulesFromLayout(
    DEFAULT_TENANT_NAV_LAYOUT,
    enMessages as Record<string, unknown>,
);

describe('sidebar-nav-filter', () => {
    it('returns all modules when query is empty', () => {
        expect(filterNavModules(tenantModules, '')).toHaveLength(tenantModules.length);
        expect(filterNavModules(tenantModules, '   ')).toHaveLength(tenantModules.length);
    });

    it('filters to modules whose label matches', () => {
        const filtered = filterNavModules(tenantModules, 'sales');
        expect(filtered.some((mod) => mod.key === 'sales')).toBe(true);
        expect(filtered.some((mod) => mod.key === 'purchase')).toBe(false);
    });

    it('keeps parent module when a nested link label matches', () => {
        const filtered = filterNavModules(tenantModules, 'trial balance');
        const accounting = filtered.find((mod) => mod.key === 'accounting');
        expect(accounting).toBeDefined();
        expect(
            accounting?.children?.some(
                (child) =>
                    'type' in child &&
                    child.type === 'subgroup' &&
                    child.children.some((link) => link.label === 'Trial Balance'),
            ),
        ).toBe(true);
    });

    it('matches subgroup labels and includes their children', () => {
        const filtered = filterNavModules(tenantModules, 'receivables');
        const sales = filtered.find((mod) => mod.key === 'sales');
        expect(sales).toBeDefined();
        expect(
            sales?.children?.some(
                (child) => 'type' in child && child.type === 'subgroup' && child.label === 'Receivables',
            ),
        ).toBe(true);
    });

    it('collects module and subgroup keys for expand/collapse all', () => {
        const keys = collectNavGroupKeys(tenantModules);
        expect(keys).toContain('sales');
        expect(keys).toContain('sales:receivables');
        expect(keys).not.toContain('dashboard');
    });

    it('builds open-group state maps from keys', () => {
        expect(buildOpenGroupsState(['sales', 'purchase'], true)).toEqual({
            sales: true,
            purchase: true,
        });
        expect(buildOpenGroupsState(['sales'], false)).toEqual({ sales: false });
    });
});