import {
    DEFAULT_PLATFORM_ADMIN_NAV_LAYOUT,
    DEFAULT_PLATFORM_FEATURES,
    DEFAULT_TENANT_NAV_LAYOUT,
    resolveAppStates,
    type AppStateInput,
} from '@erp71/shared-types';
import { enMessages } from './localization/messages/en/index';
import { resolveSidebarModules, type SidebarModulesInput } from './sidebar-modules';

const EVERY_SWITCH = {
    ...DEFAULT_PLATFORM_FEATURES,
    help: true,
    support: true,
    manufacturing: true,
    projects: true,
};

function appStates(overrides: Partial<AppStateInput> = {}) {
    return resolveAppStates({
        planFeatures: { premiumAccounting: true, premiumManufacturing: true, teamChat: true },
        planCode: 'PRO',
        platformFeatures: EVERY_SWITCH,
        hiddenApps: [],
        isOwner: true,
        permissions: [],
        ...overrides,
    });
}

function input(overrides: Partial<SidebarModulesInput> = {}): SidebarModulesInput {
    return {
        tenantLayout: DEFAULT_TENANT_NAV_LAYOUT,
        platformAdminLayout: DEFAULT_PLATFORM_ADMIN_NAV_LAYOUT,
        messages: enMessages as Record<string, unknown>,
        planFeatures: { premiumAccounting: true, premiumManufacturing: true, teamChat: true },
        memberIsOwner: true,
        appStates: appStates(),
        ...overrides,
    };
}

const keys = (modules: { key: string }[]) => modules.map((module) => module.key);

describe('resolveSidebarModules — tenant shell gated on app states', () => {
    it('shows every available app of a fully entitled owner', () => {
        const shown = keys(resolveSidebarModules(input()));
        for (const key of ['dashboard', 'sales', 'accounting', 'expenses', 'manufacturing', 'projects', 'crm', 'chat', 'help']) {
            expect(shown).toContain(key);
        }
        expect(shown).not.toContain('admin');
    });

    it('leaves out apps the owner hid and apps the plan does not grant', () => {
        const states = appStates({
            hiddenApps: ['crm'],
            planFeatures: { premiumAccounting: true, teamChat: true },
        });
        const shown = keys(resolveSidebarModules(input({ appStates: states })));

        expect(states.manufacturing).toBe('locked');
        expect(shown).not.toContain('crm');
        expect(shown).not.toContain('manufacturing');
        expect(shown).toContain('sales');
    });

    it('still drops what the member holds no permission for, after the app gate', () => {
        const states = appStates({ isOwner: false, permissions: ['VIEW_PROJECTS'] });
        const shown = keys(resolveSidebarModules(input({
            appStates: states,
            memberIsOwner: false,
            memberPermissions: ['VIEW_PROJECTS'],
        })));

        expect(shown).toContain('projects');
        expect(shown).not.toContain('sales');
        expect(shown).not.toContain('accounting');
    });

    it('shows an accounting-only workspace its books, settings and help', () => {
        const states = appStates({
            planFeatures: { premiumAccounting: true, accountingOnly: true },
        });
        const shown = keys(resolveSidebarModules(input({ appStates: states, accountingOnlyMode: true })));

        expect(shown.sort()).toEqual(['account-settings', 'accounting', 'dashboard', 'expenses', 'help', 'support'].sort());
    });
});

/**
 * `appShell` off must leave the classic sidebar exactly as it was. Production
 * now gates it on app states, while the old Sidebar tests drive the legacy
 * booleans — so this pins the two to each other: for every plan, switch set
 * and viewer below, the registry and the booleans the layout derives agree.
 */
describe('resolveSidebarModules — app states match the legacy gates', () => {
    const PLANS: Record<string, { code: string; features: Record<string, boolean> }> = {
        free: { code: 'FREE', features: {} },
        standard: { code: 'STANDARD', features: { premiumAccounting: true } },
        pro: { code: 'PRO', features: { premiumAccounting: true, premiumManufacturing: true, premiumCrm: true, teamChat: true } },
        accountingOnly: { code: 'ACCOUNTING', features: { premiumAccounting: true, accountingOnly: true } },
        freeWithChat: { code: 'FREE', features: { teamChat: true, premiumAccounting: true } },
    };
    const SWITCH_SETS = {
        allOn: { ...DEFAULT_PLATFORM_FEATURES, help: true, support: true, feedback: true, manufacturing: true, projects: true },
        allOff: { ...DEFAULT_PLATFORM_FEATURES },
        mixed: { ...DEFAULT_PLATFORM_FEATURES, help: true, feedback: true, manufacturing: true },
    };
    const VIEWERS = {
        owner: { isOwner: true, permissions: [] as string[] },
        bookkeeper: { isOwner: false, permissions: ['VIEW_LEDGER', 'VIEW_PROJECTS', 'CREATE_SALE', 'VIEW_SALES'] },
        cashier: { isOwner: false, permissions: ['CREATE_SALE'] },
    };

    for (const [planName, plan] of Object.entries(PLANS)) {
        for (const [switchName, switches] of Object.entries(SWITCH_SETS)) {
            for (const [viewerName, viewer] of Object.entries(VIEWERS)) {
                it(`${planName} × ${switchName} × ${viewerName}`, () => {
                    const paid = plan.code !== 'FREE';
                    // The booleans exactly as (app)/layout.tsx derives them.
                    const legacy: SidebarModulesInput = input({
                        appStates: undefined,
                        planFeatures: plan.features,
                        accountingOnlyMode: Boolean(plan.features.accountingOnly),
                        canAccessAccounting: (viewer.isOwner || viewer.permissions.includes('VIEW_LEDGER'))
                            && paid && Boolean(plan.features.premiumAccounting),
                        canAccessManufacturing: switches.manufacturing && Boolean(plan.features.premiumManufacturing),
                        canAccessProjects: switches.projects && (viewer.isOwner || viewer.permissions.includes('VIEW_PROJECTS')),
                        helpEnabled: switches.help,
                        supportEnabled: switches.support || switches.feedback,
                        canAccessAdmin: false,
                        memberIsOwner: viewer.isOwner,
                        memberPermissions: viewer.permissions,
                    });
                    const states = resolveAppStates({
                        planFeatures: plan.features,
                        planCode: plan.code,
                        platformFeatures: switches,
                        hiddenApps: [],
                        isOwner: viewer.isOwner,
                        permissions: viewer.permissions,
                    });

                    expect(keys(resolveSidebarModules({ ...legacy, appStates: states })))
                        .toEqual(keys(resolveSidebarModules(legacy)));
                });
            }
        }
    }
});
