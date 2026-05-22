'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
    LayoutDashboard,
    ShoppingCart,
    Package,
    Boxes,
    Users,
    FileText,
    ClipboardList,
    ArrowLeftRight,
    Undo2,
    TrendingUp,
    Clock,
    Settings,
    LogOut,
    ChevronLeft,
    ChevronRight,
    ChevronDown,
    ShoppingBag,
    Truck,
    Calculator,
    FolderTree,
    MapPin,
    ClipboardCheck,
    AlertTriangle,
    BookOpen,
    ShieldCheck,
    CreditCard,
    Crown,
    BarChart3,
    Globe,
    type LucideIcon,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Navigation structure                                               */
/* ------------------------------------------------------------------ */

interface NavChild {
    href: string;
    icon: LucideIcon;
    label: string;
    /** If true, renders as a non-clickable section header */
    section?: boolean;
    advancedOnly?: boolean;
}

interface NavModule {
    key: string;
    icon: LucideIcon;
    label: string;
    /** Single page (no children) — acts as a direct link */
    href?: string;
    children?: NavChild[];
    /** Show a "coming soon" badge instead of children */
    soon?: boolean;
}

const MODULES: NavModule[] = [
    {
        key: 'dashboard',
        icon: LayoutDashboard,
        label: 'Dashboard',
        href: '/dashboard',
    },
    {
        key: 'sales',
        icon: ShoppingBag,
        label: 'Sales',
        children: [
            { href: '/dashboard/pos',               icon: ShoppingCart,    label: 'POS' },
            { href: '/dashboard/sales',             icon: TrendingUp,      label: 'Sales' },
            { href: '/dashboard/returns',           icon: ArrowLeftRight,  label: 'Sales Returns' },
            { href: '/dashboard/orders',            icon: ClipboardList,   label: 'Sales Orders' },
            { href: '/dashboard/quotes',            icon: FileText,        label: 'Sales Quotations' },
            { href: '/dashboard/warranty-claims',   icon: ShieldCheck,     label: 'Warranty Claims' },
            { href: '/dashboard/cashier-sessions',  icon: Clock,           label: 'Cashier Sessions' },
        ],
    },
    {
        key: 'purchase',
        icon: Truck,
        label: 'Purchase',
        children: [
            { href: '/dashboard/purchases', icon: ClipboardList, label: 'Purchases' },
            { href: '/dashboard/purchase-returns', icon: Undo2, label: 'Purchase Returns' },
        ],
    },
    {
        key: 'accounting',
        icon: Calculator,
        label: 'Accounting',
        children: [
            { href: '/dashboard/accounting', icon: Calculator, label: 'Overview' },
            { href: '/dashboard/accounting/vouchers', icon: FileText, label: 'Voucher Entry' },
            { href: '/dashboard/accounting/journal', icon: ClipboardList, label: 'Journal' },
            { href: '/dashboard/accounting/ledger', icon: ClipboardList, label: 'Ledger' },
            { href: '/dashboard/accounting/reconciliation', icon: AlertTriangle, label: 'Posting Exceptions' },
        ],
    },
    {
        key: 'inventory',
        icon: Package,
        label: 'Inventory',
        children: [
            { href: '/dashboard/inventory', icon: Package, label: 'Products' },
            { href: '/dashboard/inventory/transfers', icon: Boxes, label: 'Transfers' },
            { href: '/dashboard/inventory/shrinkage', icon: AlertTriangle, label: 'Shrinkage' },
            { href: '/dashboard/inventory/stock-takes', icon: ClipboardCheck, label: 'Stock Takes' },
            { href: '/dashboard/inventory/ledger', icon: BookOpen, label: 'Stock Ledger' },
        ],
    },
    {
        key: 'reports',
        icon: BarChart3,
        label: 'Reports',
        children: [
            { href: '#sales-reports', icon: ShoppingBag, label: 'Sales', section: true, advancedOnly: true },
            { href: '/dashboard/sales/reports/summary', icon: TrendingUp, label: 'Sales Summary', advancedOnly: true },
            { href: '/dashboard/sales/reports/products', icon: Package, label: 'Sales by Product', advancedOnly: true },
            { href: '/dashboard/reports/consolidated', icon: BarChart3, label: 'Consolidated', advancedOnly: true },
            { href: '#inventory-reports', icon: Package, label: 'Inventory', section: true, advancedOnly: true },
            { href: '/dashboard/inventory/reports/reorder', icon: TrendingUp, label: 'Reorder Report', advancedOnly: true },
            { href: '/dashboard/inventory/reports/shrinkage', icon: AlertTriangle, label: 'Shrinkage Report', advancedOnly: true },
            { href: '/dashboard/inventory/reports/valuation', icon: Calculator, label: 'Valuation', advancedOnly: true },
        ],
    },
    {
        key: 'storefront',
        icon: Globe,
        label: 'Storefront',
        children: [
            { href: '/dashboard/storefront', icon: ShoppingBag, label: 'Orders' },
            { href: '/dashboard/storefront/settings', icon: Settings, label: 'Settings' },
        ],
    },
    {
        key: 'billing',
        icon: CreditCard,
        label: 'Billing',
        href: '/dashboard/billing',
    },
    {
        key: 'account-settings',
        icon: Settings,
        label: 'Account Settings',
        href: '/dashboard/settings',
    },
    {
        key: 'admin',
        icon: ShieldCheck,
        label: 'Platform Admin',
        children: [
            { href: '/dashboard/admin/tenants', icon: Crown, label: 'Tenants' },
        ],
    },
    {
        key: 'settings',
        icon: Settings,
        label: 'Settings',
        children: [
            { href: '#sales-setup', icon: ShoppingBag, label: 'Sales Setup', section: true },
            { href: '/dashboard/customers', icon: Users, label: 'Customers' },
            { href: '/dashboard/customer-groups', icon: FolderTree, label: 'Customer Groups' },
            { href: '/dashboard/territories', icon: MapPin, label: 'Territories' },
            { href: '#inventory-setup', icon: Package, label: 'Inventory Setup', section: true },
            { href: '/dashboard/inventory/categories', icon: FolderTree, label: 'Categories' },
            { href: '/dashboard/inventory/settings', icon: Settings, label: 'Inventory Settings' },
            { href: '#accounting-setup', icon: Calculator, label: 'Accounting Setup', section: true },
            { href: '/dashboard/accounting/coa', icon: FolderTree, label: 'Chart of Accounts' },
            { href: '/dashboard/accounting/posting-rules', icon: Settings, label: 'Posting Rules' },
        ],
    },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function Sidebar({
    canAccessAccounting = true,
    canAccessInventoryReports = false,
    canAccessAdmin = false,
    canManageBilling = false,
    activePlanCode,
}: {
    canAccessAccounting?: boolean;
    canAccessInventoryReports?: boolean;
    canAccessAdmin?: boolean;
    canManageBilling?: boolean;
    activePlanCode?: string | null;
}) {
    const pathname = usePathname();
    const [collapsed, setCollapsed] = useState(false);
    const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
    const modules = MODULES
        .filter((module) => {
            if (module.key === 'accounting') return canAccessAccounting;
            if (module.key === 'admin') return canAccessAdmin;
            if (module.key === 'billing') return canManageBilling;
            return true;
        })
        .map((module) => {
            if (!['inventory', 'reports'].includes(module.key) || !module.children) {
                return module;
            }

            return {
                ...module,
                children: module.children.filter((child) => !child.advancedOnly || canAccessInventoryReports),
            };
        })
        .filter((module) => !module.children || module.children.length > 0);

    useEffect(() => {
        const saved = localStorage.getItem('sidebar-collapsed');
        if (saved !== null) setCollapsed(saved === 'true');

        // auto-open the group whose child is currently active
        const groups = localStorage.getItem('sidebar-open-groups');
        if (groups) {
            try { setOpenGroups(JSON.parse(groups)); } catch { /* ignore */ }
        }
    }, []);

    // auto-expand the group that contains the current page
    useEffect(() => {
        for (const mod of modules) {
            if (mod.children?.some((c) => pathname.startsWith(c.href))) {
                setOpenGroups((prev) => {
                    if (prev[mod.key]) return prev;
                    const next = { ...prev, [mod.key]: true };
                    localStorage.setItem('sidebar-open-groups', JSON.stringify(next));
                    return next;
                });
            }
        }
    }, [canAccessAccounting, pathname]);

    const toggleSidebar = () => {
        setCollapsed((prev) => {
            localStorage.setItem('sidebar-collapsed', String(!prev));
            return !prev;
        });
    };

    const toggleGroup = (key: string) => {
        setOpenGroups((prev) => {
            const next = { ...prev, [key]: !prev[key] };
            localStorage.setItem('sidebar-open-groups', JSON.stringify(next));
            return next;
        });
    };

    const isActive = (href: string) =>
        href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href);

    const isGroupActive = (mod: NavModule) =>
        mod.children?.some((c) => pathname.startsWith(c.href)) ?? false;

    /* ---- Shared link styles ---- */
    const linkCls = (active: boolean) =>
        `flex items-center rounded-xl transition-all duration-150 group ${
            collapsed ? 'justify-center w-10 h-10 mx-auto' : 'space-x-3 px-3 py-2'
        } ${
            active
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-200'
                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
        }`;

    const childLinkCls = (active: boolean) =>
        `flex items-center rounded-lg transition-all duration-150 group space-x-3 px-3 py-1.5 ml-4 ${
            active
                ? 'bg-blue-50 text-blue-700 font-bold'
                : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
        }`;

    return (
        <aside
            className={`relative flex flex-col bg-white border-r border-gray-200 transition-all duration-300 flex-shrink-0 ${
                collapsed ? 'w-16' : 'w-64'
            }`}
        >
            {/* Logo */}
            <div className={`flex items-center h-14 border-b border-gray-100 flex-shrink-0 ${collapsed ? 'justify-center px-0' : 'px-5 space-x-3'}`}>
                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Package className="text-white w-5 h-5" />
                </div>
                {!collapsed && (
                    <div className="min-w-0">
                        <span className="text-lg font-bold tracking-tight whitespace-nowrap block">RetailSaaS</span>
                        <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Workspace</span>
                            {activePlanCode && (
                                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${activePlanCode === 'PREMIUM' ? 'bg-amber-100 text-amber-700' : activePlanCode === 'STANDARD' ? 'bg-indigo-100 text-indigo-700' : activePlanCode === 'BASIC' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                                    {activePlanCode}
                                </span>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Navigation */}
            <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-1">
                {modules.map((mod) => {
                    const Icon = mod.icon;
                    const hasChildren = !!mod.children?.length;
                    const groupOpen = openGroups[mod.key] ?? false;
                    const groupActive = isGroupActive(mod);

                    /* --- Direct link (Dashboard, Inventory, Settings) --- */
                    if (mod.href) {
                        const active = isActive(mod.href);
                        return (
                            <Link
                                key={mod.key}
                                href={mod.href}
                                title={collapsed ? mod.label : undefined}
                                className={linkCls(active)}
                            >
                                <Icon className={`flex-shrink-0 w-5 h-5 ${active ? 'text-white' : 'group-hover:scale-110 transition-transform'}`} />
                                {!collapsed && <span className="font-semibold text-sm tracking-tight whitespace-nowrap">{mod.label}</span>}
                            </Link>
                        );
                    }

                    /* --- "Coming soon" placeholder --- */
                    if (mod.soon) {
                        return (
                            <div
                                key={mod.key}
                                title={collapsed ? `${mod.label} (coming soon)` : undefined}
                                className={`flex items-center rounded-xl cursor-default ${
                                    collapsed ? 'justify-center w-10 h-10 mx-auto' : 'space-x-3 px-3 py-2'
                                } text-gray-300`}
                            >
                                <Icon className="flex-shrink-0 w-5 h-5" />
                                {!collapsed && (
                                    <>
                                        <span className="font-semibold text-sm tracking-tight whitespace-nowrap">{mod.label}</span>
                                        <span className="ml-auto text-[9px] font-bold uppercase tracking-widest bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-md">Soon</span>
                                    </>
                                )}
                            </div>
                        );
                    }

                    /* --- Group with children (Sales) --- */
                    return (
                        <div key={mod.key}>
                            {/* Group header */}
                            {collapsed ? (
                                /* In collapsed mode, navigate to first child */
                                <Link
                                    href={mod.children![0].href}
                                    title={mod.label}
                                    className={linkCls(groupActive)}
                                >
                                    <Icon className={`flex-shrink-0 w-5 h-5 ${groupActive ? 'text-white' : 'group-hover:scale-110 transition-transform'}`} />
                                </Link>
                            ) : (
                                <button
                                    onClick={() => toggleGroup(mod.key)}
                                    className={`flex items-center w-full rounded-xl transition-all duration-150 space-x-3 px-3 py-2 ${
                                        groupActive
                                            ? 'text-blue-700 bg-blue-50'
                                            : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
                                    }`}
                                >
                                    <Icon className={`flex-shrink-0 w-5 h-5 ${groupActive ? 'text-blue-600' : ''}`} />
                                    <span className="font-semibold text-sm tracking-tight whitespace-nowrap">{mod.label}</span>
                                    <ChevronDown
                                        className={`ml-auto w-4 h-4 transition-transform duration-200 ${
                                            groupOpen ? 'rotate-180' : ''
                                        } ${groupActive ? 'text-blue-400' : 'text-gray-300'}`}
                                    />
                                </button>
                            )}

                            {/* Children */}
                            {!collapsed && groupOpen && hasChildren && (
                                <div className="mt-0.5 space-y-0.5">
                                    {mod.children!.map(({ href, icon: ChildIcon, label, section }) => {
                                        if (section) {
                                            return (
                                                <div key={href} className="flex items-center ml-4 px-3 pt-3 pb-1">
                                                    <ChildIcon className="flex-shrink-0 w-3.5 h-3.5 text-gray-300" />
                                                    <span className="ml-2 text-[10px] font-black uppercase tracking-widest text-gray-300">{label}</span>
                                                </div>
                                            );
                                        }
                                        const active = isActive(href);
                                        return (
                                            <Link key={href} href={href} className={childLinkCls(active)}>
                                                <ChildIcon className={`flex-shrink-0 w-4 h-4 ${active ? 'text-blue-600' : ''}`} />
                                                <span className="text-sm tracking-tight whitespace-nowrap">{label}</span>
                                                {mod.key === 'reports' && href.includes('/reports/') && (
                                                    <span className="ml-auto text-[9px] font-black uppercase tracking-widest text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-md">Advanced</span>
                                                )}
                                            </Link>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}
            </nav>

            {/* Sign out */}
            <div className={`border-t border-gray-100 p-2 flex-shrink-0 ${collapsed ? 'flex justify-center' : ''}`}>
                <button
                    onClick={() => { localStorage.clear(); window.location.href = '/login'; }}
                    title={collapsed ? 'Sign out' : undefined}
                    className={`flex items-center rounded-xl text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors group ${
                        collapsed ? 'w-10 h-10 justify-center' : 'space-x-3 w-full px-3 py-2'
                    }`}
                >
                    <LogOut className="w-5 h-5 group-hover:rotate-12 transition-transform flex-shrink-0" />
                    {!collapsed && <span className="font-medium text-sm">Sign out</span>}
                </button>
            </div>

            {/* Collapse toggle */}
            <button
                onClick={toggleSidebar}
                className="absolute -right-3 top-[3.5rem] mt-4 z-10 w-6 h-6 bg-white border border-gray-200 rounded-full flex items-center justify-center shadow-sm hover:shadow-md hover:border-blue-300 hover:text-blue-600 transition-all"
                title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
                {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
            </button>
        </aside>
    );
}
