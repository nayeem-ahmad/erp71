'use client';

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Sidebar from './Sidebar';
import { useBranding } from '@/lib/branding';

jest.mock('next/link', () => {
    return ({ children, href, className, title }: { children: React.ReactNode; href: string; className?: string; title?: string }) => (
        <a href={href} className={className} title={title}>{children}</a>
    );
});

jest.mock('next/navigation', () => ({
    usePathname: () => '/accounting',
}));

jest.mock('lucide-react', () => {
    const icon = () => <span data-testid="icon" />;
    return {
        LayoutDashboard: icon,
        ShoppingCart: icon,
        Package: icon,
        Users: icon,
        FileText: icon,
        ClipboardList: icon,
        ArrowLeftRight: icon,
        Undo2: icon,
        FileSearch: icon,
        TrendingUp: icon,
        Clock: icon,
        Settings: icon,
        LogOut: icon,
        ChevronLeft: icon,
        ChevronRight: icon,
        ChevronDown: icon,
        ShoppingBag: icon,
        Truck: icon,
        Calculator: icon,
        FolderTree: icon,
        MapPin: icon,
        ClipboardCheck: icon,
        AlertTriangle: icon,
        BookOpen: icon,
        ShieldCheck: icon,
        CreditCard: icon,
        Crown: icon,
        BarChart3: icon,
        Globe: icon,
        Palette: icon,
        Factory: icon,
        Cog: icon,
        Receipt: icon,
        HelpCircle: icon,
        Boxes: icon,
        Gift: icon,
        Tag: icon,
        MessageSquare: icon,
        UserCog: icon,
        CalendarOff: icon,
        Landmark: icon,
        Megaphone: icon,
        CheckSquare: icon,
        Wallet: icon,
        HandCoins: icon,
        Sparkles: icon,
        Layers: icon,
        BadgeCheck: icon,
        Banknote: icon,
        Building2: icon,
        Cpu: icon,
        GitMerge: icon,
        Lock: icon,
        RefreshCw: icon,
        Scale: icon,
        Target: icon,
        Upload: icon,
        Waves: icon,
        Search: icon,
        X: icon,
    };
});

// No `virtual: true` here — that registers the mock under the literal specifier
// and leaves Sidebar importing the real hook, which silently made this a no-op.
jest.mock('@/lib/branding', () => ({
    useBranding: jest.fn(),
}));

const mockUseBranding = useBranding as jest.Mock;

/** Resets branding to an un-customised tenant; pass overrides for the branded cases. */
function setBranding(overrides: { logoUrl?: string | null; businessName?: string | null } = {}) {
    mockUseBranding.mockReturnValue({
        logoUrl: null,
        faviconUrl: null,
        businessName: null,
        primaryColor: '#2563eb',
        ...overrides,
    });
}

jest.mock('@/lib/i18n', () => {
    const { enMessages } = require('../lib/localization/messages/en');

    return {
        useI18n: () => ({
            t: enMessages,
        }),
    };
}, { virtual: true });

jest.mock('@/hooks/useMediaQuery', () => ({
    useIsMdUp: () => true,
}));

jest.mock('@/contexts/NavLayoutContext', () => {
    const {
        DEFAULT_PLATFORM_ADMIN_NAV_LAYOUT,
        DEFAULT_TENANT_NAV_LAYOUT,
    } = require('@erp71/shared-types');

    return {
        useNavLayouts: () => ({
            tenantLayout: DEFAULT_TENANT_NAV_LAYOUT,
            platformAdminLayout: DEFAULT_PLATFORM_ADMIN_NAV_LAYOUT,
        }),
    };
});

describe('Sidebar — brand mark', () => {
    beforeEach(() => {
        localStorage.clear();
        setBranding();
    });

    it('falls back to the ERP71 lockup when the tenant has uploaded no logo', () => {
        const { container } = render(<Sidebar canAccessAccounting />);

        const lockup = container.querySelector('img[src*="/logo/logo.svg"]');
        expect(lockup).toBeInTheDocument();
        expect(container.querySelector('img[src*="/logo/icon.svg"]')).not.toBeInTheDocument();
        expect(screen.queryByText('ERP71')).not.toBeInTheDocument();
    });

    it('uses the square mark when the sidebar is collapsed', () => {
        const { container } = render(<Sidebar canAccessAccounting />);

        fireEvent.click(screen.getByTitle('Collapse sidebar'));

        expect(container.querySelector('img[src*="/logo/icon.svg"]')).toBeInTheDocument();
        expect(container.querySelector('img[src*="/logo/logo.svg"]')).not.toBeInTheDocument();
    });

    it('shows the tenant logo instead of the ERP71 lockup once one is uploaded', () => {
        setBranding({ logoUrl: 'https://cdn.example.com/tenant-logo.png' });
        const { container } = render(<Sidebar canAccessAccounting />);

        expect(container.querySelector('img[src="https://cdn.example.com/tenant-logo.png"]')).toBeInTheDocument();
        expect(container.querySelector('img[src*="/logo/logo.svg"]')).not.toBeInTheDocument();
        expect(container.querySelector('img[src*="/logo/icon.svg"]')).not.toBeInTheDocument();
    });

    it('shows the tenant business name over the platform brand name', () => {
        setBranding({ businessName: 'Karim Traders' });
        render(<Sidebar canAccessAccounting />);

        expect(screen.getByText('Karim Traders')).toBeInTheDocument();
        expect(screen.queryByText('ERP71')).not.toBeInTheDocument();
    });
});

describe('Sidebar — Story 30.1', () => {
    beforeEach(() => {
        localStorage.clear();
        setBranding();
    });

    it('shows accounting navigation when access is allowed', () => {
        render(<Sidebar canAccessAccounting />);

        expect(screen.getByText('Accounting')).toBeInTheDocument();
    });

    it('hides accounting navigation when access is not allowed', () => {
        render(<Sidebar canAccessAccounting={false} />);

        expect(screen.queryByText('Accounting')).not.toBeInTheDocument();
    });

    it('shows Expenses as its own module alongside Accounting', () => {
        render(<Sidebar canAccessAccounting />);

        expect(screen.getByText('Expenses')).toBeInTheDocument();
    });

    it('hides Expenses when accounting access is not allowed', () => {
        // Expenses split out of Accounting but its pages still live under
        // /accounting/expenses, so it stays behind the same gate.
        render(<Sidebar canAccessAccounting={false} />);

        expect(screen.queryByText('Expenses')).not.toBeInTheDocument();
    });

    it('hides retail modules in accounting-only mode', () => {
        render(<Sidebar canAccessAccounting accountingOnlyMode />);

        expect(screen.getByText('Accounting')).toBeInTheDocument();
        expect(screen.getByText('Expenses')).toBeInTheDocument();
        expect(screen.getByText('Admin')).toBeInTheDocument();
        expect(screen.queryByText('Sales')).not.toBeInTheDocument();
        expect(screen.queryByText('Inventory')).not.toBeInTheDocument();
    });

    it('keeps the core Admin links in accounting-only mode', () => {
        render(<Sidebar canAccessAccounting accountingOnlyMode canManageBilling canManageTeam />);

        fireEvent.click(screen.getByText('Admin'));

        // After the menu reorg the tenant Admin sidebar is a slim set of direct links;
        // the long tail of settings pages lives on the /settings hub. In accounting-only
        // mode the core links (profile, team, billing) remain reachable.
        expect(screen.getByText('My Profile')).toBeInTheDocument();
        expect(screen.getByText('Team & Permissions')).toBeInTheDocument();
        expect(screen.getByText('Billing')).toBeInTheDocument();

        // The moved settings pages are not in the sidebar (they render on the hub,
        // which itself hides retail cards under accounting-only mode).
        expect(screen.queryByText('Audit Logs')).not.toBeInTheDocument();
        expect(screen.queryByText('Localization')).not.toBeInTheDocument();
        expect(screen.queryByText('Loyalty Program')).not.toBeInTheDocument();
        expect(screen.queryByText('Payment Methods')).not.toBeInTheDocument();
        expect(screen.queryByText('Branding')).not.toBeInTheDocument();
    });

    it('shows the slimmed Admin menu with direct links (settings tail lives on the hub)', () => {
        render(<Sidebar canAccessAccounting canManageBilling canManageTeam />);

        fireEvent.click(screen.getByText('Admin'));

        // Direct links that remain in the sidebar after the menu reorg.
        expect(screen.getByText('My Profile')).toBeInTheDocument();
        expect(screen.getByText('Team & Permissions')).toBeInTheDocument();
        expect(screen.getByText('Billing')).toBeInTheDocument();

        // The long tail of settings pages moved to the /settings hub — not the sidebar.
        expect(screen.queryByText('Loyalty Program')).not.toBeInTheDocument();
        expect(screen.queryByText('Payment Methods')).not.toBeInTheDocument();
        expect(screen.queryByText('Branding')).not.toBeInTheDocument();
    });

    it('shows grouped platform admin navigation in platform admin mode', () => {
        render(<Sidebar platformAdminMode helpEnabled />);

        fireEvent.click(screen.getByText('Platform Admin'));
        expect(screen.getByText('Tenant Management')).toBeInTheDocument();
        expect(screen.getByText('Inbox')).toBeInTheDocument();
        expect(screen.getByText('Growth')).toBeInTheDocument();
        expect(screen.getByText('Plans & billing')).toBeInTheDocument();
        expect(screen.getByText('Channels')).toBeInTheDocument();
        expect(screen.getByText('Platform')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Inbox'));
        expect(screen.getByText('Support')).toBeInTheDocument();
        expect(screen.getByText('Feedback')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Channels'));
        expect(screen.getByText('SMS Gateway')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Platform'));
        expect(screen.getByText('System Health')).toBeInTheDocument();
        expect(screen.getByText('Deploy')).toBeInTheDocument();
        expect(screen.getByText('Staff')).toBeInTheDocument();
        expect(screen.getByText('Public status')).toBeInTheDocument();

        // The settings hub stays a page; it is no longer the only sidebar entry
        // for fifteen buried screens.
        expect(screen.queryByText('Platform Settings')).not.toBeInTheDocument();
    });

    it('keeps Project Management out of the admin console until the platform switch is on', () => {
        render(<Sidebar platformAdminMode helpEnabled />);

        expect(screen.queryByText('Project Management')).not.toBeInTheDocument();
    });

    it('shows the platform team its own project module in platform admin mode', () => {
        render(<Sidebar platformAdminMode helpEnabled canAccessProjects />);

        fireEvent.click(screen.getByText('Project Management'));
        expect(screen.getByText('Boards')).toBeInTheDocument();
        expect(screen.getByText('Sprints')).toBeInTheDocument();
        expect(screen.getByText('Hour Logs')).toBeInTheDocument();

        // Still the admin console: no shop module rides in alongside it.
        expect(screen.queryByText('Sales')).not.toBeInTheDocument();
        expect(screen.queryByText('Inventory')).not.toBeInTheDocument();
    });

    it('shows platform admin and billing items when enabled', () => {
        render(<Sidebar canAccessAccounting canAccessAdmin canManageBilling canAccessInventoryReports activePlanCode="STANDARD" />);

        expect(screen.getByText('Platform Admin')).toBeInTheDocument();
        expect(screen.getByText('Admin')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Admin'));
        expect(screen.getByText('Billing')).toBeInTheDocument();

        // Open Sales group
        fireEvent.click(screen.getByText('Sales'));
        expect(screen.getByText('Sales Reports')).toBeInTheDocument();

        // Open Purchase group
        fireEvent.click(screen.getByText('Purchase'));
        expect(screen.getByText('Purchase Reports')).toBeInTheDocument();
        // Payables was dissolved — its links hang directly off the module.
        expect(screen.getByText('Supplier Payment')).toBeInTheDocument();

        // Open Inventory group
        fireEvent.click(screen.getByText('Inventory'));
        expect(screen.getByText('Inventory Reports')).toBeInTheDocument();
    });

    it('hides advanced inventory reports for tenants without report entitlement', () => {
        render(<Sidebar canAccessAccounting canAccessInventoryReports={false} />);

        // Open Sales group
        fireEvent.click(screen.getByText('Sales'));
        expect(screen.queryByText('Sales Reports')).not.toBeInTheDocument();

        // Open Purchase group
        fireEvent.click(screen.getByText('Purchase'));
        expect(screen.queryByText('Purchase Reports')).not.toBeInTheDocument();
        expect(screen.getByText('Supplier Payment')).toBeInTheDocument();

        // Open Inventory group
        fireEvent.click(screen.getByText('Inventory'));
        fireEvent.click(screen.getByText('Inventory Reports'));
        expect(screen.queryByText('Reorder Report')).not.toBeInTheDocument();
        expect(screen.queryByText('Shrinkage Report')).not.toBeInTheDocument();
        expect(screen.getByText('Stock Ledger')).toBeInTheDocument();
    });

    it('shows full accounting navigation with subgroups when access is allowed', async () => {
        render(<Sidebar canAccessAccounting canAccessInventoryReports canAccessAccountingAdvanced />);

        await waitFor(() => {
            // Reconciliation was dissolved — its links hang directly off the module.
            expect(screen.getByText('Bank Reconciliation')).toBeInTheDocument();
        });
        expect(screen.getByText('Loans')).toBeInTheDocument();
        expect(screen.getByText('Accounting Reports')).toBeInTheDocument();
        expect(screen.getByText('Accounting Setup')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Accounting Reports'));
        expect(screen.getByText('Trial Balance')).toBeInTheDocument();
        expect(screen.getByText('Comparative P&L')).toBeInTheDocument();
    });

    it('hides advanced accounting reports for tenants without report entitlement', async () => {
        render(<Sidebar canAccessAccounting canAccessAccountingAdvanced={false} />);

        await waitFor(() => {
            expect(screen.getByText('Accounting Reports')).toBeInTheDocument();
        });
        fireEvent.click(screen.getByText('Accounting Reports'));
        expect(screen.getByText('Profit & Loss')).toBeInTheDocument();
        expect(screen.queryByText('Comparative P&L')).not.toBeInTheDocument();
        expect(screen.queryByText('Budget vs. Actual')).not.toBeInTheDocument();
        expect(screen.queryByText('Cash Flow Statement')).not.toBeInTheDocument();
        expect(screen.queryByText('Financial Ratios')).not.toBeInTheDocument();
    });

    it('shows mobile close button when drawer is open', () => {
        const onClose = jest.fn();
        render(<Sidebar canAccessAccounting isOpen onClose={onClose} />);

        const closeButton = screen.getByRole('button', { name: /close navigation/i });
        fireEvent.click(closeButton);
        expect(onClose).toHaveBeenCalled();
    });

    it('restores and persists custom sidebar width on desktop', () => {
        localStorage.setItem('sidebar-width', '320');

        const { container } = render(<Sidebar canAccessAccounting />);
        const aside = container.querySelector('aside');

        expect(aside).toHaveStyle({ width: '320px' });
        expect(screen.getByRole('separator', { name: /resize navigation panel/i })).toBeInTheDocument();
    });

    it('filters navigation items from the search box', () => {
        render(<Sidebar canAccessAccounting canAccessInventoryReports canAccessAccountingAdvanced />);

        const search = screen.getByRole('searchbox', { name: /search menu/i });
        fireEvent.change(search, { target: { value: 'trial balance' } });

        expect(screen.getByText('Trial Balance')).toBeInTheDocument();
        expect(screen.queryByText('Purchase')).not.toBeInTheDocument();
    });

    it('shows an empty state when search has no matches', () => {
        render(<Sidebar canAccessAccounting />);

        const search = screen.getByRole('searchbox', { name: /search menu/i });
        fireEvent.change(search, { target: { value: 'zzzz-no-match' } });

        expect(screen.getByText(/no menu items match your search/i)).toBeInTheDocument();
    });

    it('expands and collapses all menu groups', () => {
        render(<Sidebar canAccessAccounting canAccessInventoryReports canAccessAccountingAdvanced />);

        expect(screen.queryByRole('link', { name: /^Sales$/ })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /expand all/i }));
        expect(screen.getByRole('link', { name: /^Sales$/ })).toHaveAttribute('href', '/sales/list');
        expect(screen.getByText('Trial Balance')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /collapse all/i }));
        expect(screen.queryByRole('link', { name: /^Sales$/ })).not.toBeInTheDocument();
        expect(screen.queryByText('Trial Balance')).not.toBeInTheDocument();
    });

    it('opening one subgroup closes a sibling subgroup (accordion)', async () => {
        render(<Sidebar canAccessAccounting canAccessInventoryReports canAccessAccountingAdvanced />);

        await waitFor(() => {
            expect(screen.getByText('Accounting Setup')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('Accounting Setup'));
        expect(screen.getByText('Chart of Accounts')).toBeInTheDocument();

        // Opening Accounting Reports must collapse Accounting Setup.
        fireEvent.click(screen.getByText('Accounting Reports'));
        expect(screen.getByText('Trial Balance')).toBeInTheDocument();
        expect(screen.queryByText('Chart of Accounts')).not.toBeInTheDocument();
    });

    it('opening one top-level module closes another top-level module (accordion)', () => {
        render(<Sidebar canAccessAccounting canAccessInventoryReports canAccessAccountingAdvanced />);

        fireEvent.click(screen.getByText('Inventory'));
        expect(screen.getByText('Inventory Reports')).toBeInTheDocument();

        // Opening Purchase must collapse Inventory.
        fireEvent.click(screen.getByText('Purchase'));
        expect(screen.getByText('Purchase Reports')).toBeInTheDocument();
        expect(screen.queryByText('Inventory Reports')).not.toBeInTheDocument();
    });

    it('shows the three referee portal destinations in referee mode', () => {
        render(<Sidebar refereeMode />);

        expect(screen.getByText('Dashboard')).toBeInTheDocument();
        expect(screen.getByText('Signups')).toBeInTheDocument();
        expect(screen.getByText('Payment history')).toBeInTheDocument();
    });

    it('hides the referee portal destinations outside referee mode', () => {
        render(<Sidebar canAccessAccounting />);

        expect(screen.queryByText('Payment history')).not.toBeInTheDocument();
    });

    it('persists the single open subgroup to localStorage', async () => {
        render(<Sidebar canAccessAccounting canAccessInventoryReports canAccessAccountingAdvanced />);

        await waitFor(() => {
            expect(screen.getByText('Accounting Reports')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('Accounting Reports'));

        const saved = JSON.parse(localStorage.getItem('sidebar-open-groups') ?? '{}');
        const openKeys = Object.entries(saved).filter(([, v]) => v).map(([k]) => k);
        // Only the Reports subgroup chain (parent + subgroup) should be open.
        expect(openKeys.some((k) => k.endsWith(':reports'))).toBe(true);
        expect(openKeys.filter((k) => k.includes(':')).length).toBe(1);
    });
});
