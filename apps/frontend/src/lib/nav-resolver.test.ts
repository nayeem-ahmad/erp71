import { DEFAULT_TENANT_NAV_LAYOUT } from '@erp71/shared-types';
import { buildNavModulesFromLayout } from './nav-resolver';
import { enMessages } from './localization/messages/en/index';

describe('nav-resolver', () => {
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
        expect(labels).toContain('Transactions & Funds');
        expect(labels).toContain('Reports');
        expect(labels).toContain('Settings');
    });
});