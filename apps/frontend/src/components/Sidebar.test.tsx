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

    it('shows platform admin and billing items when enabled', () => {
        render(<Sidebar canAccessAccounting canAccessAdmin canManageBilling canAccessInventoryReports activePlanCode="STANDARD" />);

        expect(screen.getByText('Platform Admin')).toBeInTheDocument();
        expect(screen.getByText('Settings')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Settings'));
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
        render(<Sidebar canAccessAccounting canAccessInventoryReports />);

        await waitFor(() => {
            expect(screen.getByText('Transactions & Funds')).toBeInTheDocument();
        });
        expect(screen.getByText('Reconciliation')).toBeInTheDocument();
        expect(screen.getByText('Accounting Reports')).toBeInTheDocument();
        expect(screen.getByText('Accounting Setup')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Transactions & Funds'));
        expect(screen.getByText('Expense Categories')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Accounting Reports'));
        expect(screen.getByText('Trial Balance')).toBeInTheDocument();
        expect(screen.getByText('Comparative P&L')).toBeInTheDocument();
    });

    it('hides advanced accounting reports for tenants without report entitlement', async () => {
        render(<Sidebar canAccessAccounting canAccessInventoryReports={false} />);

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
});