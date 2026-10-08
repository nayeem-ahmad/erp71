import {
    APP_REGISTRY,
    BUSINESS_APP_IDS,
    DEFAULT_PLATFORM_FEATURES,
    NAV_REGISTRY,
    PLATFORM_FEATURE_KEYS,
    resolveAppStates,
    sanitizeHiddenApps,
    type AppStateInput,
    type PlatformFeatures,
} from './index';

const ALL_SWITCHES_ON: PlatformFeatures = Object.fromEntries(
    PLATFORM_FEATURE_KEYS.map((key) => [key, true]),
) as unknown as PlatformFeatures;

const PRO_FEATURES = {
    premiumAccounting: true,
    premiumCrm: true,
    premiumManufacturing: true,
    teamChat: true,
};

function input(overrides: Partial<AppStateInput> = {}): AppStateInput {
    return {
        planFeatures: PRO_FEATURES,
        planCode: 'PRO',
        platformFeatures: ALL_SWITCHES_ON,
        hiddenApps: [],
        isOwner: true,
        permissions: [],
        ...overrides,
    };
}

describe('APP_REGISTRY', () => {
    it('has an app for every top-level module except the dashboard, and nothing else', () => {
        const modules = Object.values(NAV_REGISTRY)
            .filter((entry) => entry.kind === 'module' && entry.id !== 'dashboard')
            .map((entry) => entry.id)
            .sort();
        expect(Object.keys(APP_REGISTRY).sort()).toEqual(modules);
    });

    it('lists the business apps, which are the only ones an owner may hide', () => {
        expect([...BUSINESS_APP_IDS].sort()).toEqual([
            'accounting', 'crm', 'expenses', 'hr', 'imports', 'inventory',
            'manufacturing', 'projects', 'purchase', 'sales', 'storefront',
        ]);
    });
});

describe('the appShell platform switch', () => {
    it('is off by default', () => {
        expect(DEFAULT_PLATFORM_FEATURES.appShell).toBe(false);
        expect(PLATFORM_FEATURE_KEYS).toContain('appShell');
    });
});

describe('resolveAppStates', () => {
    it('makes every app available to the owner of a fully entitled workspace', () => {
        const states = resolveAppStates(input());
        for (const id of BUSINESS_APP_IDS) expect(states[id]).toBe('available');
        expect(states.chat).toBe('available');
        expect(states['account-settings']).toBe('available');
    });

    it('locks the paid modules on a free plan', () => {
        const states = resolveAppStates(input({ planCode: 'FREE', planFeatures: {} }));
        expect(states.accounting).toBe('locked');
        expect(states.expenses).toBe('locked');
        expect(states.manufacturing).toBe('locked');
        expect(states.chat).toBe('locked');
        expect(states.sales).toBe('available');
    });

    it('locks accounting on a paid plan that lacks the entitlement, and on a free plan that has it', () => {
        expect(resolveAppStates(input({ planFeatures: {} })).accounting).toBe('locked');
        expect(resolveAppStates(input({ planCode: 'FREE' })).accounting).toBe('locked');
    });

    it('treats a module whose platform switch is off as unavailable, not locked', () => {
        const switches = { ...ALL_SWITCHES_ON, manufacturing: false, projects: false };
        const states = resolveAppStates(input({ platformFeatures: switches, planFeatures: {} }));
        expect(states.manufacturing).toBe('unavailable');
        expect(states.projects).toBe('unavailable');
    });

    it('applies the shell-level permission gates to members and not to the owner', () => {
        const member = resolveAppStates(input({ isOwner: false, permissions: ['VIEW_SALES'] }));
        expect(member.accounting).toBe('unavailable');
        expect(member.expenses).toBe('unavailable');
        expect(member.projects).toBe('unavailable');

        const bookkeeper = resolveAppStates(input({ isOwner: false, permissions: ['VIEW_LEDGER', 'VIEW_PROJECTS'] }));
        expect(bookkeeper.accounting).toBe('available');
        expect(bookkeeper.projects).toBe('available');
    });

    it('hides only business apps the owner switched off, and ignores ids it does not know', () => {
        const states = resolveAppStates(input({ hiddenApps: ['crm', 'bogus', 'chat'] }));
        expect(states.crm).toBe('hidden');
        expect(states.chat).toBe('available');
        expect(states).not.toHaveProperty('bogus');
    });

    it('keeps a hidden app locked when the plan does not grant it', () => {
        const states = resolveAppStates(input({ planFeatures: {}, hiddenApps: ['accounting'] }));
        expect(states.accounting).toBe('locked');
    });

    it('shows an accounting-only workspace its books, settings and help, and nothing else', () => {
        const states = resolveAppStates(input({ planFeatures: { ...PRO_FEATURES, accountingOnly: true } }));
        const shown = Object.entries(states)
            .filter(([, state]) => state !== 'unavailable')
            .map(([id]) => id)
            .sort();
        expect(shown).toEqual(['account-settings', 'accounting', 'expenses', 'help', 'support']);
    });

    it('keeps the platform console out of the shop shell', () => {
        expect(resolveAppStates(input()).admin).toBe('unavailable');
        expect(resolveAppStates(input({ isPlatformAdmin: true })).admin).toBe('available');
    });

    it('opens Support when either the support or the feedback switch is on', () => {
        const off = { ...ALL_SWITCHES_ON, support: false, feedback: false };
        expect(resolveAppStates(input({ platformFeatures: off })).support).toBe('unavailable');
        expect(resolveAppStates(input({ platformFeatures: { ...off, feedback: true } })).support).toBe('available');
        expect(resolveAppStates(input({ platformFeatures: { ...off, support: true } })).support).toBe('available');
    });
});

describe('sanitizeHiddenApps', () => {
    it('keeps business app ids once each, in order, and drops everything else', () => {
        expect(sanitizeHiddenApps(['crm', 'crm', 'chat', 3, 'x', 'hr'])).toEqual(['crm', 'hr']);
    });

    it('treats anything but an array as nothing hidden', () => {
        expect(sanitizeHiddenApps(null)).toEqual([]);
        expect(sanitizeHiddenApps('crm')).toEqual([]);
    });
});
