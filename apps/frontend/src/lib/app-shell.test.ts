import { APP_REGISTRY, DEFAULT_TENANT_NAV_LAYOUT } from '@erp71/shared-types';
import { enMessages } from './localization/messages/en/index';
import { buildNavModulesFromLayout } from './nav-resolver';
import { appHomeHref, buildRail, findActiveAppKey } from './app-shell';

/** The whole default tenant nav, ungated, less the platform console's module. */
const modules = buildNavModulesFromLayout(DEFAULT_TENANT_NAV_LAYOUT, enMessages as Record<string, unknown>)
    .filter((module) => module.key !== 'admin');

const byKey = (key: string) => modules.find((module) => module.key === key)!;

describe('findActiveAppKey', () => {
    it('gives the app owning the page', () => {
        expect(findActiveAppKey(modules, '/sales/list')).toBe('sales');
        expect(findActiveAppKey(modules, '/inventory/reports/reorder')).toBe('inventory');
    });

    it('prefers the app with the longer matching link', () => {
        // Expenses lives under /accounting/expenses; Accounting owns /accounting.
        expect(findActiveAppKey(modules, '/accounting/expenses/123')).toBe('expenses');
        expect(findActiveAppKey(modules, '/accounting/vouchers/9')).toBe('accounting');
    });

    it('claims a detail page under an app root even when no link names it', () => {
        expect(findActiveAppKey(modules, '/sales/some-record-id')).toBe('sales');
    });

    it('treats Home and pages no app owns as no app', () => {
        expect(findActiveAppKey(modules, '/dashboard')).toBeNull();
        expect(findActiveAppKey(modules, '/notifications')).toBeNull();
    });

    it('matches the single-page modules too', () => {
        expect(findActiveAppKey(modules, '/chat')).toBe('chat');
        expect(findActiveAppKey(modules, '/help/getting-started')).toBe('help');
    });
});

describe('appHomeHref', () => {
    it('is the first link of the app, looking inside a leading subgroup', () => {
        expect(appHomeHref(byKey('sales'))).toBe('/sales');
        expect(appHomeHref(byKey('chat'))).toBe('/chat');
        expect(appHomeHref({
            key: 'x',
            label: 'X',
            icon: byKey('sales').icon,
            children: [{
                type: 'subgroup',
                key: 'reports',
                label: 'Reports',
                icon: byKey('sales').icon,
                children: [{ href: '/x/reports/one', label: 'One', icon: byKey('sales').icon }],
            }],
        } as never)).toBe('/x/reports/one');
    });
});

describe('buildRail', () => {
    it('puts business apps first in layout order and folds the help modules into one entry', () => {
        const rail = buildRail(modules, 'Help');

        expect(rail.business.map((entry) => entry.key)).toEqual([
            'sales', 'storefront', 'purchase', 'imports', 'accounting', 'expenses',
            'inventory', 'crm', 'projects', 'manufacturing', 'hr',
        ]);
        // Settings last, the way a rail ends with its gear.
        expect(rail.utility.map((entry) => entry.key)).toEqual(['chat', 'help', 'account-settings']);

        const help = rail.utility.find((entry) => entry.key === 'help')!;
        expect(help.label).toBe('Help');
        expect(help.modules.map((module) => module.key)).toEqual(['help', 'support', 'whats-new']);
    });

    it('leaves Home out of the rail, and drops the help entry when none of its modules is present', () => {
        const rail = buildRail(modules.filter((module) => !['help', 'support', 'whats-new'].includes(module.key)), 'Help');

        expect([...rail.business, ...rail.utility].map((entry) => entry.key)).not.toContain('dashboard');
        expect(rail.utility.map((entry) => entry.key)).not.toContain('help');
    });

    it('still shows a utility app the fixed order does not name, ahead of Settings', () => {
        // A utility added to the registry later, with no place in the rail's
        // fixed order and no group, must not silently vanish from the rail.
        APP_REGISTRY.inbox = { id: 'inbox', kind: 'utility' };
        try {
            const inbox = { ...byKey('chat'), key: 'inbox', label: 'Inbox', href: '/inbox' };
            const rail = buildRail([...modules, inbox], 'Help');
            expect(rail.utility.map((entry) => entry.key)).toEqual(['chat', 'help', 'inbox', 'account-settings']);
        } finally {
            delete APP_REGISTRY.inbox;
        }
    });

    it('gives a lone help module its own name rather than the group label', () => {
        const rail = buildRail(modules.filter((module) => !['support', 'whats-new'].includes(module.key)), 'Help & support');
        const help = rail.utility.find((entry) => entry.key === 'help')!;
        expect(help.label).toBe(byKey('help').label);
    });
});
