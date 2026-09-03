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

    it('groups HR under five subgroups, with only Overview and Employees at the top', () => {
        const hr = buildNavModulesFromLayout(DEFAULT_TENANT_NAV_LAYOUT, enMessages as Record<string, unknown>)
            .find((mod) => mod.key === 'hr');

        // Labels resolving at all is half the assertion — a missing hr.hub.* or
        // sidebar.items.* key surfaces as the raw key rather than throwing.
        expect((hr?.children ?? []).map((child) => child.label)).toEqual([
            'Overview',
            'Employees',
            'Attendance & Leave',
            'Payroll',
            'Recruitment',
            'HR Reports',
            'HR Setup',
        ]);

        const subgroup = (label: string) => (hr?.children ?? [])
            .find((child) => 'type' in child && child.type === 'subgroup' && child.label === label);

        const hrefsUnder = (label: string) => {
            const group = subgroup(label);
            return group && 'children' in group ? group.children.map((link) => link.href) : [];
        };

        expect(hrefsUnder('Attendance & Leave')).toEqual([
            '/hr/attendance',
            '/hr/attendance/punches',
            '/hr/leaves',
        ]);
        expect(hrefsUnder('Payroll')).toEqual(['/hr/salary-payments']);
        expect(hrefsUnder('HR Setup')).toEqual([
            '/hr/employees/departments',
            '/hr/employees/designations',
            '/hr/schedules',
        ]);
    });

    it('puts HR Reports above HR Setup with every report reachable', () => {
        const hr = buildNavModulesFromLayout(DEFAULT_TENANT_NAV_LAYOUT, enMessages as Record<string, unknown>)
            .find((mod) => mod.key === 'hr');
        const group = (hr?.children ?? [])
            .find((child) => 'type' in child && child.type === 'subgroup' && child.label === 'HR Reports');

        expect(group && 'children' in group ? group.children.map((link) => link.href) : []).toEqual([
            '/hr/reports/attendance',
            '/hr/reports/leave-balance',
            '/hr/reports/payroll-cost',
            '/hr/reports/wages-register',
            '/hr/reports/employee-register',
            '/hr/reports/tax-deduction',
            '/hr/reports/provident-fund',
            '/hr/reports/service-book',
        ]);

        // Every label resolved rather than falling through to its raw key — a
        // missing sidebar.items.* would show as "sidebar.items.hrWagesRegister".
        const labels = group && 'children' in group ? group.children.map((link) => link.label) : [];
        expect(labels.some((label) => label.includes('.'))).toBe(false);
        expect(labels).toContain('Wages Register');
    });

    it('does not gate HR Reports behind the Advanced toggle', () => {
        const hr = buildNavModulesFromLayout(DEFAULT_TENANT_NAV_LAYOUT, enMessages as Record<string, unknown>)
            .find((mod) => mod.key === 'hr');
        const group = (hr?.children ?? [])
            .find((child) => 'type' in child && child.type === 'subgroup' && child.label === 'HR Reports');

        // Sales reports are advancedOnly; these are not. The wages and employee
        // registers are what a labour inspection asks for, so hiding them by
        // default would put compliance behind a power-user switch.
        expect(group && 'advancedOnly' in group ? group.advancedOnly : undefined).toBeFalsy();
    });

    it('marks the attendance records link exact so the punches page does not highlight both', () => {
        const hr = buildNavModulesFromLayout(DEFAULT_TENANT_NAV_LAYOUT, enMessages as Record<string, unknown>)
            .find((mod) => mod.key === 'hr');
        const group = (hr?.children ?? [])
            .find((child) => 'type' in child && child.type === 'subgroup' && child.label === 'Attendance & Leave');
        const records = group && 'children' in group
            ? group.children.find((link) => link.href === '/hr/attendance')
            : undefined;

        // Sidebar `isActive` prefix-matches, and /hr/attendance/punches sits under
        // /hr/attendance, so without `exact` both links light up at once.
        expect(records?.exact).toBe(true);
    });

    it('groups the platform admin console by job, with settings pages in the sidebar', () => {
        const modules = buildNavModulesFromLayout(
            DEFAULT_PLATFORM_ADMIN_NAV_LAYOUT,
            enMessages as Record<string, unknown>,
        );

        const admin = modules.find((mod) => mod.key === 'admin');
        expect((admin?.children ?? []).map((child) => child.label)).toEqual([
            'Overview',
            'Tenant Management',
            'Inbox',
            'Growth',
            'Plans & billing',
            'Channels',
            'Platform',
        ]);

        const subgroup = (label: string) => (admin?.children ?? [])
            .find((child) => 'type' in child && child.type === 'subgroup' && child.label === label);

        const hrefsUnder = (label: string) => {
            const group = subgroup(label);
            return group && 'children' in group ? group.children.map((link) => link.href) : [];
        };

        expect(hrefsUnder('Tenant Management')).toEqual([
            '/admin/tenants',
            '/admin/tenants/ledger',
            '/admin/tenants/reminders',
        ]);
        expect(hrefsUnder('Inbox')).toEqual([
            '/admin/support',
            '/admin/feedback',
        ]);
        expect(hrefsUnder('Growth')).toEqual([
            '/admin/referrals',
            '/admin/blog',
            '/admin/social-media',
            '/admin/url-shortener',
        ]);
        expect(hrefsUnder('Plans & billing')).toEqual([
            '/admin/platform-settings/plans',
            '/admin/platform-settings/addons',
            '/admin/platform-settings/payments',
        ]);
        expect(hrefsUnder('Channels')).toEqual([
            '/admin/platform-settings/sms',
            '/admin/platform-settings/email',
            '/admin/platform-settings/whatsapp',
            '/admin/platform-settings/buffer',
        ]);
        expect(hrefsUnder('Platform')).toEqual([
            '/admin/system-health',
            '/status',
            '/admin/platform-settings/deploy',
            '/admin/users',
            '/admin/platform-settings/general',
            '/admin/platform-settings/tenant-features',
            '/admin/platform-settings/navigation',
            '/admin/platform-settings/ai',
            '/admin/platform-settings/feedback-automation',
        ]);

        const platform = subgroup('Platform');
        const staff = platform && 'children' in platform
            ? platform.children.find((link) => link.href === '/admin/users')
            : undefined;
        const publicStatus = platform && 'children' in platform
            ? platform.children.find((link) => link.href === '/status')
            : undefined;
        expect(staff?.label).toBe('Staff');
        expect(publicStatus?.label).toBe('Public status');

        const growth = subgroup('Growth');
        const shortLinks = growth && 'children' in growth
            ? growth.children.find((link) => link.href === '/admin/url-shortener')
            : undefined;
        expect(shortLinks?.label).toBe('Short links');

        const topLevelHrefs = (admin?.children ?? [])
            .filter((child) => !('type' in child))
            .map((child) => ('href' in child ? child.href : undefined));
        expect(topLevelHrefs).not.toContain('/admin/platform-settings');
    });
});
describe('module-level entitlement', () => {
    // Regression: `NAV_REGISTRY` declared `chat: { entitlement: 'teamChat' }` from
    // the day team chat shipped, but resolution dropped the field, so the module
    // rendered on every plan and 403'd on entry.
    it('carries entitlement from the registry onto the resolved module', () => {
        const layout = [
            { id: 'chat', parentId: null, sortOrder: 0, visible: true },
        ] as never;

        const [chat] = buildNavModulesFromLayout(layout, {});

        expect(chat.key).toBe('chat');
        expect(chat.entitlement).toBe('teamChat');
    });

    it('leaves entitlement undefined for modules that declare none', () => {
        const layout = [
            { id: 'dashboard', parentId: null, sortOrder: 0, visible: true },
        ] as never;

        const [dashboard] = buildNavModulesFromLayout(layout, {});

        expect(dashboard.entitlement).toBeUndefined();
    });
});
