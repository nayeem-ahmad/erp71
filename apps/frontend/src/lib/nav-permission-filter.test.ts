import { DEFAULT_TENANT_NAV_LAYOUT, TENANT_ROLE_TEMPLATE_BY_KEY } from '@erp71/shared-types';
import { enMessages } from '@/lib/localization/messages/en';
import { filterNavByPermissions } from './nav-permission-filter';
import { buildNavModulesFromLayout } from './nav-resolver';
import type { ResolvedNavChild, ResolvedNavModule } from './nav-resolver';

const modules = buildNavModulesFromLayout(
    DEFAULT_TENANT_NAV_LAYOUT,
    enMessages as Record<string, unknown>,
);

const permissionsOf = (templateKey: string) => [...TENANT_ROLE_TEMPLATE_BY_KEY[templateKey].permissions];
const asMember = (templateKey: string) => ({ isOwner: false, permissions: permissionsOf(templateKey) });

const linkHrefs = (mods: ResolvedNavModule[]) =>
    mods.flatMap((mod) =>
        (mod.children ?? []).flatMap((child: ResolvedNavChild) =>
            'type' in child ? child.children.map((link) => link.href) : [child.href],
        ),
    );
const keys = (mods: ResolvedNavModule[]) => mods.map((mod) => mod.key);

describe('filterNavByPermissions', () => {
    it('leaves the menu untouched for the workspace owner', () => {
        expect(filterNavByPermissions(modules, { isOwner: true, permissions: [] })).toBe(modules);
    });

    describe('a Project User', () => {
        const visible = filterNavByPermissions(modules, asMember('project_user'));

        it('is not offered the retail, back-office or CRM modules', () => {
            for (const hidden of ['sales', 'storefront', 'purchase', 'imports', 'inventory', 'manufacturing', 'crm', 'hr']) {
                expect(keys(visible)).not.toContain(hidden);
            }
        });

        it('keeps Projects, team chat and the open entries', () => {
            expect(keys(visible)).toEqual(expect.arrayContaining(['dashboard', 'projects', 'chat', 'whats-new']));
        });

        it('sees every Projects screen except Setup, which needs its own permission', () => {
            const projectLinks = linkHrefs(visible.filter((mod) => mod.key === 'projects'));
            expect(projectLinks).toEqual(expect.arrayContaining(['/projects', '/projects/boards', '/projects/tasks']));
            expect(projectLinks).not.toContain('/projects/settings');
        });

        it('is not offered tenant configuration, but keeps their own profile', () => {
            const settings = linkHrefs(visible.filter((mod) => mod.key === 'account-settings'));
            expect(settings).toContain('/profile');
            for (const href of ['/settings/branding', '/settings/tax', '/settings/sms', '/settings/counters', '/settings/data']) {
                expect(settings).not.toContain(href);
            }
        });
    });

    describe('a Sales User', () => {
        const visible = filterNavByPermissions(modules, asMember('sales_user'));

        // Storefront stays: its orders page is sales work, so CREATE_SALE opens it.
        it('keeps Sales and drops the modules they hold nothing for', () => {
            expect(keys(visible)).toContain('sales');
            for (const hidden of ['imports', 'hr', 'crm']) {
                expect(keys(visible)).not.toContain(hidden);
            }
        });

        it('sees the sales screens their permissions open, and not the rest', () => {
            const sales = linkHrefs(visible.filter((mod) => mod.key === 'sales'));
            expect(sales).toEqual(expect.arrayContaining(['/sales/pos', '/sales/quotes', '/sales/orders', '/sales/returns']));
        });
    });

    it('shows an accounting-only member the modules their permissions reach', () => {
        const visible = filterNavByPermissions(modules, asMember('hr_user'));
        expect(keys(visible)).toContain('hr');
        const hr = linkHrefs(visible.filter((mod) => mod.key === 'hr'));
        // Payroll is behind VIEW_PAYROLL / MANAGE_HR, which an HR User does not hold.
        expect(hr).not.toContain('/hr/salary-payments');
        expect(hr).toContain('/hr/employees');
    });

    it('drops a subgroup whose every link is hidden, rather than leaving an empty heading', () => {
        const visible = filterNavByPermissions(modules, asMember('hr_user'));
        const hr = visible.find((mod) => mod.key === 'hr');
        const subgroupKeys = (hr?.children ?? []).filter((c) => 'type' in c).map((c) => ('type' in c ? c.key : ''));
        expect(subgroupKeys).not.toContain('payroll');
    });

    it('treats an empty tag as open, never as "nobody"', () => {
        const fake: ResolvedNavModule[] = [
            {
                key: 'x',
                icon: modules[0].icon,
                label: 'X',
                permissions: [],
                children: [{ href: '/x', icon: modules[0].icon, label: 'X', permissions: [] }],
            },
        ];
        expect(filterNavByPermissions(fake, { isOwner: false, permissions: [] })).toHaveLength(1);
    });

    it('keeps a module that has no children when its own tag clears, and drops it when it does not', () => {
        const chat = modules.find((mod) => mod.key === 'chat');
        expect(chat).toBeDefined();
        expect(keys(filterNavByPermissions([chat!], { isOwner: false, permissions: ['USE_TEAM_CHAT'] }))).toEqual(['chat']);
        expect(filterNavByPermissions([chat!], { isOwner: false, permissions: ['VIEW_PROJECTS'] })).toEqual([]);
    });
});
