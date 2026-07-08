'use client';

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Sidebar from './Sidebar';

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

jest.mock('@/lib/branding', () => ({
    useBranding: () => ({
        logoUrl: null,
        faviconUrl: null,
        businessName: null,
        primaryColor: '#2563eb',
    }),
}), { virtual: true });

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

describe('Sidebar — Story 30.1', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('shows accounting navigation when access is allowed', () => {
        render(<Sidebar canAccessAccounting />);

        expect(screen.getByText('Accounting')).toBeInTheDocument();
    });

    it('hides accounting navigation when access is not allowed', () => {
        render(<Sidebar canAccessAccounting={false} />);

        expect(screen.queryByText('Accounting')).not.toBeInTheDocument();
    });

    it('hides retail modules in accounting-only mode', () => {
        render(<Sidebar canAccessAccounting accountingOnlyMode />);

        expect(screen.getByText('Accounting')).toBeInTheDocument();
        expect(screen.getByText('Admin')).toBeInTheDocument();
        expect(screen.queryByText('Sales')).not.toBeInTheDocument();
        expect(screen.queryByText('Inventory')).not.toBeInTheDocument();
    });

    it('trims the Admin menu to accounting-relevant links in accounting-only mode', () => {
        render(<Sidebar canAccessAccounting accountingOnlyMode canManageBilling canManageTeam />);

        fireEvent.click(screen.getByText('Admin'));

        // Accounting-relevant links stay
        expect(screen.getByText('My Account')).toBeInTheDocument();
        expect(screen.getByText('Team & Permissions')).toBeInTheDocument();
        expect(screen.getByText('Audit Logs')).toBeInTheDocument();
        expect(screen.getByText('Localization')).toBeInTheDocument();
        expect(screen.getByText('Tax / VAT')).toBeInTheDocument();
        expect(screen.getByText('Data Management')).toBeInTheDocument();
        expect(screen.getByText('Billing')).toBeInTheDocument();

        // Retail / marketing links are hidden
        expect(screen.queryByText('Loyalty Program')).not.toBeInTheDocument();
        expect(screen.queryByText('POS Counters')).not.toBeInTheDocument();
        expect(screen.queryByText('Discount Codes')).not.toBeInTheDocument();
        expect(screen.queryByText('Payment Methods')).not.toBeInTheDocument();
        expect(screen.queryByText('Sales Settings')).not.toBeInTheDocument();
        expect(screen.queryByText('SMS Notifications')).not.toBeInTheDocument();
        expect(screen.queryByText('Report Emails')).not.toBeInTheDocument();
        expect(screen.queryByText('Branding')).not.toBeInTheDocument();
        expect(screen.queryByText('SMS Credits')).not.toBeInTheDocument();
        expect(screen.queryByText('AI Credits')).not.toBeInTheDocument();
    });

    it('keeps the full Admin menu when not in accounting-only mode', () => {
        render(<Sidebar canAccessAccounting canManageBilling canManageTeam />);

        fireEvent.click(screen.getByText('Admin'));

        expect(screen.getByText('Loyalty Program')).toBeInTheDocument();
        expect(screen.getByText('Payment Methods')).toBeInTheDocument();
        expect(screen.getByText('Branding')).toBeInTheDocument();
    });

    it('shows full platform admin navigation in platform admin mode', () => {
        render(<Sidebar platformAdminMode helpEnabled />);

        fireEvent.click(screen.getByText('Platform Admin'));
        expect(screen.getByText('Tenant Management')).toBeInTheDocument();
        expect(screen.getByText('System Health')).toBeInTheDocument();
        expect(screen.getByText('Platform Settings')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Tenant Management'));
        expect(screen.getByText('Tenant Ledger')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Platform Settings'));
        expect(screen.getByText('SMS Gateway')).toBeInTheDocument();
        expect(screen.getByText('Subscription Plans')).toBeInTheDocument();
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
        expect(screen.getByText('Payables')).toBeInTheDocument();

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
        expect(screen.getByText('Payables')).toBeInTheDocument();

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
            expect(screen.getByText('Transactions & Funds')).toBeInTheDocument();
        });
        expect(screen.getByText('Reconciliation')).toBeInTheDocument();
        expect(screen.getByText('Reports')).toBeInTheDocument();
        expect(screen.getByText('Settings')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Transactions & Funds'));
        expect(screen.getByText('Expense Categories')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Reports'));
        expect(screen.getByText('Trial Balance')).toBeInTheDocument();
        expect(screen.getByText('Comparative P&L')).toBeInTheDocument();
    });

    it('hides advanced accounting reports for tenants without report entitlement', async () => {
        render(<Sidebar canAccessAccounting canAccessAccountingAdvanced={false} />);

        await waitFor(() => {
            expect(screen.getByText('Reports')).toBeInTheDocument();
        });
        fireEvent.click(screen.getByText('Reports'));
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
            expect(screen.getByText('Transactions & Funds')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('Transactions & Funds'));
        expect(screen.getByText('Expense Categories')).toBeInTheDocument();

        // Opening Reports must collapse Transactions & Funds.
        fireEvent.click(screen.getByText('Reports'));
        expect(screen.getByText('Trial Balance')).toBeInTheDocument();
        expect(screen.queryByText('Expense Categories')).not.toBeInTheDocument();
    });

    it('persists the single open subgroup to localStorage', async () => {
        render(<Sidebar canAccessAccounting canAccessInventoryReports canAccessAccountingAdvanced />);

        await waitFor(() => {
            expect(screen.getByText('Reports')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('Reports'));

        const saved = JSON.parse(localStorage.getItem('sidebar-open-groups') ?? '{}');
        const openKeys = Object.entries(saved).filter(([, v]) => v).map(([k]) => k);
        // Only the Reports subgroup chain (parent + subgroup) should be open.
        expect(openKeys.some((k) => k.endsWith(':reports'))).toBe(true);
        expect(openKeys.filter((k) => k.includes(':')).length).toBe(1);
    });
});