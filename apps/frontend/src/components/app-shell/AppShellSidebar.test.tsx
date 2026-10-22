import { act, fireEvent, render, screen, within } from '@testing-library/react';
import {
    DEFAULT_PLATFORM_FEATURES,
    DEFAULT_SECTION_VALUES,
    resolveAppStates,
    type AppStateInput,
    type MyPreferencesResponse,
} from '@erp71/shared-types';
import { api } from '@/lib/api';
import { SAVE_DEBOUNCE_MS, usePreferencesStore } from '@/lib/preferences/store';
import AppShellSidebar from './AppShellSidebar';

jest.mock('@/lib/api', () => ({
    api: {
        saveMyPreferenceSection: jest.fn(),
        resetMyPreferenceSection: jest.fn(),
    },
}));
const saveApi = api.saveMyPreferenceSection as jest.Mock;

function preferences(
    sidebar: { appShellOpenGroups?: string[] } = {},
    device: { sidebarCollapsed?: boolean } = {},
    sidebarSource: 'default' | 'profile' | 'member' = 'profile',
): MyPreferencesResponse {
    return {
        profile: { id: 'p1', name: 'Cashier' },
        legacy_browser_sections: [],
        sections: {
            invoicePrint: { value: DEFAULT_SECTION_VALUES.invoicePrint, source: 'default' },
            tableView: { value: DEFAULT_SECTION_VALUES.tableView, source: 'default' },
            tableColumns: { value: DEFAULT_SECTION_VALUES.tableColumns, source: 'default' },
            sidebar: { value: sidebar, source: sidebarSource },
            alerts: { value: DEFAULT_SECTION_VALUES.alerts, source: 'default' },
            device: { value: device, source: 'profile' },
        },
    };
}
const hydrate = (data: MyPreferencesResponse) =>
    act(() => usePreferencesStore.getState().hydrate('t1:u1', data));

let mockPathname = '/sales/list';
let mockIsMdUp = true;
let mockPendingVouchers = 0;

jest.mock('next/link', () => {
    return ({ children, href, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children: React.ReactNode; href: string }) => (
        <a href={href} {...rest}>{children}</a>
    );
});

jest.mock('next/navigation', () => ({
    usePathname: () => mockPathname,
}));

jest.mock('@/hooks/useMediaQuery', () => ({
    useIsMdUp: () => mockIsMdUp,
}));

jest.mock('@/hooks/usePendingVoucherCount', () => ({
    usePendingVoucherCount: () => ({ count: mockPendingVouchers }),
}));

jest.mock('@/lib/branding', () => ({
    useBranding: () => ({ logoUrl: null, faviconUrl: null, businessName: 'Karim Traders', primaryColor: '#2563eb' }),
}));

jest.mock('@/lib/i18n', () => {
    const { enMessages } = require('../../lib/localization/messages/en');
    const { formatMessage } = jest.requireActual('@/lib/i18n');
    return {
        useI18n: () => ({
            t: enMessages,
            fmt: (template: string, values: Record<string, string | number>) => formatMessage(template, values, 'en'),
        }),
    };
});

jest.mock('@/contexts/NavLayoutContext', () => {
    const { DEFAULT_PLATFORM_ADMIN_NAV_LAYOUT, DEFAULT_TENANT_NAV_LAYOUT } = require('@erp71/shared-types');
    return {
        useNavLayouts: () => ({
            tenantLayout: DEFAULT_TENANT_NAV_LAYOUT,
            platformAdminLayout: DEFAULT_PLATFORM_ADMIN_NAV_LAYOUT,
        }),
    };
});

const PLAN = { premiumAccounting: true, premiumManufacturing: true, premiumCrm: true, teamChat: true };

function states(overrides: Partial<AppStateInput> = {}) {
    return resolveAppStates({
        planFeatures: PLAN,
        planCode: 'PRO',
        platformFeatures: { ...DEFAULT_PLATFORM_FEATURES, help: true, support: true, manufacturing: true, projects: true },
        hiddenApps: [],
        isOwner: true,
        permissions: [],
        ...overrides,
    });
}

function renderShell(props: Partial<React.ComponentProps<typeof AppShellSidebar>> = {}) {
    return render(
        <AppShellSidebar
            appStates={states()}
            planFeatures={PLAN}
            canAccessInventoryReports
            canAccessPremiumCrm
            memberIsOwner
            memberPermissions={[]}
            {...props}
        />,
    );
}

const rail = () => screen.getByRole('navigation', { name: 'Apps' });
const panel = () => screen.getByTestId('app-panel');

describe('AppShellSidebar', () => {
    beforeEach(() => {
        localStorage.clear();
        mockPathname = '/sales/list';
        mockIsMdUp = true;
        mockPendingVouchers = 0;
    });

    it('puts one icon per available app on the rail, and none for an app the owner hid', () => {
        renderShell({ appStates: states({ hiddenApps: ['crm'] }) });

        expect(within(rail()).getByRole('link', { name: 'Sales' })).toHaveAttribute('href', '/sales');
        expect(within(rail()).getByRole('link', { name: 'Inventory' })).toBeInTheDocument();
        expect(within(rail()).queryByRole('link', { name: 'CRM' })).not.toBeInTheDocument();
    });

    it('shows the menu of the app the page belongs to', () => {
        renderShell();

        expect(within(panel()).getByRole('heading', { name: 'Sales' })).toBeInTheDocument();
        expect(panel().querySelector('a[href="/sales/customer-payments"]')).toBeInTheDocument();
        expect(panel().querySelector('a[href="/inventory/reports/reorder"]')).not.toBeInTheDocument();
    });

    it('marks the active app on the rail', () => {
        renderShell();

        expect(within(rail()).getByRole('link', { name: 'Sales' })).toHaveAttribute('aria-current', 'true');
        expect(within(rail()).getByRole('link', { name: 'Inventory' })).not.toHaveAttribute('aria-current');
    });

    it('searches every app, not only the open one', () => {
        renderShell();

        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'reorder' } });

        expect(panel().querySelector('a[href="/inventory/reports/reorder"]')).toBeInTheDocument();
    });

    it('lists the apps on Home, where no app is open', () => {
        mockPathname = '/dashboard';
        renderShell();

        expect(panel().querySelector('a[href="/sales"]')).toBeInTheDocument();
        expect(panel().querySelector('a[href="/inventory"]')).toBeInTheDocument();
        expect(within(rail()).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'true');
    });

    it('keeps the last app open on a page no app owns', () => {
        const { rerender } = renderShell();
        mockPathname = '/notifications';
        rerender(
            <AppShellSidebar appStates={states()} planFeatures={PLAN} memberIsOwner memberPermissions={[]} />,
        );

        expect(within(panel()).getByRole('heading', { name: 'Sales' })).toBeInTheDocument();
    });

    it('on a phone, switches the menu to another app without leaving the page', () => {
        mockIsMdUp = false;
        renderShell({ isOpen: true, onClose: jest.fn() });

        fireEvent.click(within(rail()).getByRole('button', { name: 'CRM' }));

        expect(within(panel()).getByRole('heading', { name: 'CRM' })).toBeInTheDocument();
        expect(panel().querySelector('a[href="/crm/leads"]')).toBeInTheDocument();
    });

    it('on a phone, takes the menu back to the app list when Home is tapped on Home', () => {
        mockIsMdUp = false;
        mockPathname = '/dashboard';
        renderShell({ isOpen: true, onClose: jest.fn() });

        fireEvent.click(within(rail()).getByRole('button', { name: 'CRM' }));
        expect(within(panel()).getByRole('heading', { name: 'CRM' })).toBeInTheDocument();

        // Already on Home, so the tap does not navigate — it must still reset.
        fireEvent.click(within(rail()).getByRole('link', { name: 'Home' }));

        expect(within(panel()).getByRole('heading', { name: 'Apps' })).toBeInTheDocument();
    });

    it('folds Help, Support and What’s New into one Help entry', () => {
        mockPathname = '/support';
        renderShell();

        expect(within(rail()).getByRole('link', { name: 'Help' })).toHaveAttribute('aria-current', 'true');
        expect(panel().querySelector('a[href="/support"]')).toBeInTheDocument();
        expect(panel().querySelector('a[href="/whats-new"]')).toBeInTheDocument();
        expect(panel().querySelector('a[href="/help"]')).toBeInTheDocument();
    });

    it('marks Chat when there are unread messages', () => {
        renderShell({ chatUnreadCount: 3 });

        expect(within(rail()).getByRole('link', { name: /Chat.*3 unread messages/ })).toBeInTheDocument();
    });

    it('focuses the search on Ctrl+K, opening the menu first if it was collapsed', () => {
        renderShell();

        fireEvent.click(screen.getByRole('button', { name: 'Collapse menu' }));
        expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();

        act(() => {
            fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
        });

        expect(screen.getByRole('searchbox')).toHaveFocus();
    });
});

describe('AppShellSidebar — preferences', () => {
    const subgroup = (name: string) => within(panel()).getByRole('button', { name });
    const reportsOpen = () => subgroup('Accounting Reports').getAttribute('aria-expanded') === 'true';
    const setupOpen = () => subgroup('Accounting Setup').getAttribute('aria-expanded') === 'true';
    const settle = () =>
        act(async () => {
            jest.advanceTimersByTime(SAVE_DEBOUNCE_MS * 2);
        });

    beforeEach(() => {
        jest.useFakeTimers();
        localStorage.clear();
        usePreferencesStore.getState().clear();
        saveApi.mockReset();
        saveApi.mockImplementation(async (_key: string, body: unknown) => ({ value: body, source: 'member' }));
        mockPathname = '/accounting';
        mockIsMdUp = true;
        mockPendingVouchers = 0;
    });
    afterEach(() => {
        jest.useRealTimers();
    });

    it("opens the profile's groups for a member with none saved", () => {
        hydrate(preferences({ appShellOpenGroups: ['accounting:reports'] }));
        renderShell();

        expect(reportsOpen()).toBe(true);
        expect(setupOpen()).toBe(false);
    });

    it('seeds the groups from the profile when preferences finish loading after mount', () => {
        renderShell();
        expect(reportsOpen()).toBe(false);

        hydrate(preferences({ appShellOpenGroups: ['accounting:reports'] }));

        expect(reportsOpen()).toBe(true);
    });

    it('does not reseed once the person has toggled a group', () => {
        renderShell();
        fireEvent.click(subgroup('Accounting Setup'));

        hydrate(preferences({ appShellOpenGroups: ['accounting:reports'] }));

        expect(setupOpen()).toBe(true);
        expect(reportsOpen()).toBe(false);
    });

    it('without loaded preferences, reads the groups from this browser as before', () => {
        localStorage.setItem('app-shell-open-groups', JSON.stringify({ 'accounting:reports': true }));
        renderShell();

        expect(reportsOpen()).toBe(true);
    });

    it("ignores this browser's groups once preferences have loaded", () => {
        localStorage.setItem('app-shell-open-groups', JSON.stringify({ 'accounting:reports': true }));
        hydrate(preferences({ appShellOpenGroups: ['accounting:setup'] }));
        renderShell();

        expect(setupOpen()).toBe(true);
        expect(reportsOpen()).toBe(false);
    });

    it('toggleGroup saves appShellOpenGroups, and writes nothing to the browser', async () => {
        hydrate(preferences({ appShellOpenGroups: ['accounting:reports'] }));
        renderShell();

        fireEvent.click(subgroup('Accounting Setup'));
        expect(setupOpen()).toBe(true);
        await settle();

        expect(saveApi).toHaveBeenCalledTimes(1);
        const [key, body] = saveApi.mock.calls[0];
        expect(key).toBe('sidebar');
        expect((body as { appShellOpenGroups: string[] }).appShellOpenGroups.slice().sort()).toEqual([
            'accounting:reports',
            'accounting:setup',
        ]);
        expect(localStorage.getItem('app-shell-open-groups')).toBeNull();
    });

    it('saves the groups left open after closing one', async () => {
        hydrate(preferences({ appShellOpenGroups: ['accounting:reports', 'accounting:setup'] }));
        renderShell();

        fireEvent.click(subgroup('Accounting Reports'));
        await settle();

        expect(saveApi).toHaveBeenCalledWith('sidebar', { appShellOpenGroups: ['accounting:setup'] });
    });

    it("opening the current page's group on navigation saves nothing", async () => {
        mockPathname = '/accounting/reports/pl';
        hydrate(preferences({ appShellOpenGroups: [] }));
        const { rerender } = renderShell();
        expect(reportsOpen()).toBe(true);

        mockPathname = '/accounting/setup/chart-of-accounts';
        rerender(<AppShellSidebar appStates={states()} planFeatures={PLAN} memberIsOwner memberPermissions={[]} />);
        await settle();

        expect(saveApi).not.toHaveBeenCalled();
        expect(localStorage.getItem('app-shell-open-groups')).toBeNull();
    });

    it('keeps the current page group open when the profile seeds after mount', () => {
        mockPathname = '/accounting/reports/pl';
        renderShell();

        hydrate(preferences({ appShellOpenGroups: ['accounting:setup'] }));

        expect(reportsOpen()).toBe(true);
        expect(setupOpen()).toBe(true);
    });

    it('without loaded preferences, toggleGroup writes the browser key and not the server', async () => {
        renderShell();

        fireEvent.click(subgroup('Accounting Setup'));
        await settle();

        expect(JSON.parse(localStorage.getItem('app-shell-open-groups') as string)).toEqual({ 'accounting:setup': true });
        expect(saveApi).not.toHaveBeenCalled();
    });

    it('never writes to the server on mount', async () => {
        hydrate(preferences({ appShellOpenGroups: ['accounting:reports'] }, { sidebarCollapsed: true }));
        renderShell();
        await settle();

        expect(saveApi).not.toHaveBeenCalled();
    });

    describe('collapsed: browser value wins, else device.sidebarCollapsed, else expanded', () => {
        const collapsedNow = () => screen.queryByTestId('app-panel') === null;

        it('is expanded by default', () => {
            hydrate(preferences());
            renderShell();
            expect(collapsedNow()).toBe(false);
        });

        it("starts collapsed from the profile's device setting when this browser has no value", () => {
            hydrate(preferences({}, { sidebarCollapsed: true }));
            renderShell();
            expect(collapsedNow()).toBe(true);
        });

        it("this browser's stored expanded wins over the profile", () => {
            localStorage.setItem('app-shell-collapsed', 'false');
            hydrate(preferences({}, { sidebarCollapsed: true }));
            renderShell();
            expect(collapsedNow()).toBe(false);
        });

        it("this browser's stored collapsed wins over a profile that expands", () => {
            localStorage.setItem('app-shell-collapsed', 'true');
            hydrate(preferences({}, { sidebarCollapsed: false }));
            renderShell();
            expect(collapsedNow()).toBe(true);
        });

        it('applies the profile when preferences finish loading after mount', () => {
            renderShell();
            expect(collapsedNow()).toBe(false);

            hydrate(preferences({}, { sidebarCollapsed: true }));

            expect(collapsedNow()).toBe(true);
        });

        it('does not apply the profile after loading when this browser has a value', () => {
            localStorage.setItem('app-shell-collapsed', 'false');
            renderShell();

            hydrate(preferences({}, { sidebarCollapsed: true }));

            expect(collapsedNow()).toBe(false);
        });

        it('toggling writes only the browser key, never the server', async () => {
            hydrate(preferences({}, { sidebarCollapsed: true }));
            renderShell();

            fireEvent.click(screen.getByRole('button', { name: 'Expand menu' }));
            await settle();

            expect(collapsedNow()).toBe(false);
            expect(localStorage.getItem('app-shell-collapsed')).toBe('false');
            expect(saveApi).not.toHaveBeenCalled();
        });
    });
});
