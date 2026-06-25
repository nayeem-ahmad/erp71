'use client';

import { render, screen, fireEvent } from '@testing-library/react';
import Sidebar from './Sidebar';

jest.mock('next/link', () => {
    return ({ children, href, className, title }: { children: React.ReactNode; href: string; className?: string; title?: string }) => (
        <a href={href} className={className} title={title}>{children}</a>
    );
});

jest.mock('next/navigation', () => ({
    usePathname: () => '/dashboard/accounting',
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

        expect(screen.getByText('Billing')).toBeInTheDocument();
        expect(screen.getByText('Platform Admin')).toBeInTheDocument();
        expect(screen.getByText('Settings')).toBeInTheDocument();
        expect(screen.getByText('STANDARD')).toBeInTheDocument();

        // Open Sales group
        fireEvent.click(screen.getByText('Sales'));
        expect(screen.getByText('Sales Reports')).toBeInTheDocument();

        // Open Purchase group
        fireEvent.click(screen.getByText('Purchase'));
        expect(screen.getByText('Purchase Reports')).toBeInTheDocument();
        expect(screen.getByText('Purchase Setup')).toBeInTheDocument();

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
        expect(screen.getByText('Purchase Setup')).toBeInTheDocument();

        // Open Inventory group
        fireEvent.click(screen.getByText('Inventory'));
        expect(screen.queryByText('Reorder Report')).not.toBeInTheDocument();
        expect(screen.queryByText('Shrinkage Report')).not.toBeInTheDocument();
        expect(screen.getByText('Inventory Reports')).toBeInTheDocument();
        expect(screen.getByText('Stock Ledger')).toBeInTheDocument();
    });
});