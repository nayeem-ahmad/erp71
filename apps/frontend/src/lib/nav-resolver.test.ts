import { DEFAULT_PLATFORM_ADMIN_NAV_LAYOUT, DEFAULT_TENANT_NAV_LAYOUT } from '@erp71/shared-types';
import { buildNavModulesFromLayout } from './nav-resolver';
import { enMessages } from './localization/messages/en/index';

describe('nav-resolver', () => {
    it('does not include sales.new in the default sales children', () => {
        const sales = buildNavModulesFromLayout(DEFAULT_TENANT_NAV_LAYOUT, enMessages as Record<string, unknown>)
            .find((mod) => mod.key === 'sales');
        const hrefs = (sales?.children ?? []).flatMap((child) =>
            'type' in child ? child.children.map((link) => link.href) : [child.href]);
        expect(hrefs).not.toContain('/sales/new');
    });

    it('builds tenant sidebar modules from default layout', () => {
        const modules = buildNavModulesFromLayout(DEFAULT_TENANT_NAV_LAYOUT, enMessages as Record<string, unknown>);

        expect(modules.map((mod) => mod.key)).toContain('sales');
        expect(modules.map((mod) => mod.key)).toContain('accounting');

        const accounting = modules.find((mod) => mod.key === 'accounting');
        expect(accounting?.children?.length).toBeGreaterThan(0);

        const labels = (accounting?.children ?? []).flatMap((child) => {
            if ('type' in child && child.type === 'subgroup') {
                return [child.label, ...child.children.map((link) => link.label)];
            }
            return [child.label];
        });

        expect(labels).toContain('Overview');
        expect(labels).toContain('Loans');
        expect(labels).toContain('Accounting Reports');
        expect(labels).toContain('Accounting Setup');
        // Reconciliation was dissolved — its links hang directly off the module.
        expect(labels).toContain('Bank Reconciliation');
        // Expenses moved out to its own top-level module.
        expect(labels).not.toContain('Expense Categories');
    });

    it('exposes expenses as its own top-level module', () => {
        const modules = buildNavModulesFromLayout(DEFAULT_TENANT_NAV_LAYOUT, enMessages as Record<string, unknown>);

        const expenses = modules.find((mod) => mod.key === 'expenses');
        expect(expenses?.label).toBe('Expenses');
        expect((expenses?.children ?? []).map((child) => 'type' in child ? child.label : child.href)).toEqual([
            '/accounting/expenses',
            '/accounting/expenses/categories',
            '/accounting/expenses/reports',
        ]);
    });

    it('builds platform admin sidebar with platform settings link', () => {
        const modules = buildNavModulesFromLayout(
            DEFAULT_PLATFORM_ADMIN_NAV_LAYOUT,
            enMessages as Record<string, unknown>,
        );

        const admin = modules.find((mod) => mod.key === 'admin');
        expect(admin?.children?.length).toBeGreaterThan(0);

        const labels = (admin?.children ?? []).flatMap((child) => {
            if ('type' in child && child.type === 'subgroup') {
                return [child.label, ...child.children.map((link) => link.label)];
            }
            return [child.label];
        });

        expect(labels).toContain('System Health');
        expect(labels).toContain('Tenant Management');
        expect(labels).not.toContain('Tenant Payments');
        expect(labels).toContain('Platform Settings');
        expect(labels).not.toContain('SMS Gateway');
    });
});