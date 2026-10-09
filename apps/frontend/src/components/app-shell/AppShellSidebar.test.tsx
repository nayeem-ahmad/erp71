import { act, fireEvent, render, screen, within } from '@testing-library/react';
import {
    DEFAULT_PLATFORM_FEATURES,
    resolveAppStates,
    type AppStateInput,
} from '@erp71/shared-types';
import AppShellSidebar from './AppShellSidebar';

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
