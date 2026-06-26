'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
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
    Palette,
    Factory,
    Cog,
    Receipt,
    HandCoins,
    Wallet,
    HelpCircle,
    Gift,
    Tag,
    MessageSquare,
    UserCog,
    CalendarOff,
    Banknote,
    Landmark,
    FileSearch,
    CheckSquare,
    Megaphone,
    Sparkles,
    Layers,
    BadgeCheck,
    type LucideIcon,
} from 'lucide-react';
import { useBranding } from '@/lib/branding';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';

/* ------------------------------------------------------------------ */
/*  Navigation structure                                               */
/* ------------------------------------------------------------------ */

interface NavLink {
    href: string;
    icon: LucideIcon;
    label: string;
    /** If true, renders as a non-clickable section header */
    section?: boolean;
    advancedOnly?: boolean;
    /** If true, only exact path match counts as active (for module hub routes) */
    exact?: boolean;
}

interface NavSubgroup {
    type: 'subgroup';
    key: string;
    icon: LucideIcon;
    label: string;
    advancedOnly?: boolean;
    children: NavLink[];
}

type NavChild = NavLink | NavSubgroup;

function isNavSubgroup(child: NavChild): child is NavSubgroup {
    return 'type' in child && child.type === 'subgroup';
}

function filterModuleNavChildren(children: NavChild[], canAccessAdvanced: boolean): NavChild[] {
    return children
        .map((child) => {
            if (!isNavSubgroup(child)) {
                return !child.advancedOnly || canAccessAdvanced ? child : null;
            }
            if (child.advancedOnly && !canAccessAdvanced) return null;
            const filteredLinks = child.children.filter((link) => !link.advancedOnly || canAccessAdvanced);
            if (filteredLinks.length === 0) return null;
            return { ...child, children: filteredLinks };
        })
        .filter((child): child is NavChild => child !== null);
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

function buildModules(t: ReturnType<typeof useI18n>['t']): NavModule[] {
    return [
    {
        key: 'dashboard',
        icon: LayoutDashboard,
        label: t.sidebar.modules.dashboard,
        href: routes.home,
    },
    {
        key: 'sales',
        icon: ShoppingBag,
        label: t.sidebar.modules.sales,
        children: [
            { href: routes.sales.root, icon: LayoutDashboard, label: t.sidebar.items.overview, exact: true },
            { href: routes.sales.pos, icon: ShoppingCart, label: t.sidebar.items.pos },
            { href: routes.sales.list, icon: TrendingUp, label: t.sidebar.items.allSales },
            { href: routes.sales.new, icon: FileText, label: t.sidebar.items.newSalesEntry },
            { href: routes.sales.cashierSessions, icon: Clock, label: t.sidebar.items.cashierSessions },
            {
                type: 'subgroup',
                key: 'receivables',
                icon: Wallet,
                label: t.sales.hub.receivables,
                children: [
                    { href: routes.sales.customerPayments, icon: Wallet, label: t.sidebar.items.customerPayment },
                    { href: routes.sales.customerLedger, icon: BookOpen, label: t.sidebar.items.customerLedger },
                    { href: routes.sales.customerDueAging, icon: Clock, label: t.sidebar.items.dueAging },
                ],
            },
            {
                type: 'subgroup',
                key: 'order-flow',
                icon: ClipboardList,
                label: t.sales.hub.orderFlow,
                children: [
                    { href: routes.sales.quotes, icon: FileText, label: t.sidebar.items.salesQuotations },
                    { href: routes.sales.orders, icon: ClipboardList, label: t.sidebar.items.salesOrders },
                    { href: routes.sales.delivery, icon: MapPin, label: t.sidebar.items.delivery },
                    { href: routes.sales.returns, icon: ArrowLeftRight, label: t.sidebar.items.salesReturns },
                    { href: routes.sales.warrantyClaims, icon: ShieldCheck, label: t.sidebar.items.warrantyClaims },
                ],
            },
            {
                type: 'subgroup',
                key: 'storefront',
                icon: Globe,
                label: t.sidebar.modules.storefront,
                children: [
                    { href: routes.storefront.root, icon: ShoppingBag, label: t.sidebar.items.storefrontOrders, exact: true },
                    { href: routes.storefront.settings, icon: Settings, label: t.sidebar.items.storefrontSettings },
                ],
            },
            {
                type: 'subgroup',
                key: 'customers-crm',
                icon: Users,
                label: t.sales.hub.customersCrm,
                children: [
                    { href: routes.sales.customers, icon: Users, label: t.sidebar.items.customers },
                    { href: routes.sales.crm.tasks, icon: CheckSquare, label: t.sidebar.items.crmTasks },
                    { href: routes.sales.crm.campaigns, icon: Megaphone, label: t.sidebar.items.crmCampaigns },
                    { href: routes.sales.loyalty, icon: Gift, label: t.sidebar.items.loyaltyPoints },
                ],
            },
            {
                type: 'subgroup',
                key: 'reports',
                icon: BarChart3,
                label: t.sales.hub.reports,
                advancedOnly: true,
                children: [
                    { href: routes.sales.reports.summary, icon: TrendingUp, label: t.sidebar.items.salesSummary, advancedOnly: true },
                    { href: routes.sales.reports.products, icon: Package, label: t.sidebar.items.salesByProduct, advancedOnly: true },
                    { href: routes.sales.reports.consolidated, icon: BarChart3, label: t.sidebar.items.consolidated, advancedOnly: true },
                    { href: routes.sales.reports.branchReport, icon: BarChart3, label: t.sidebar.items.branchReport, advancedOnly: true },
                ],
            },
            {
                type: 'subgroup',
                key: 'setup',
                icon: Settings,
                label: t.sales.hub.setup,
                children: [
                    { href: routes.sales.customerGroups, icon: FolderTree, label: t.sidebar.items.customerGroups },
                    { href: routes.sales.priceLists, icon: Tag, label: t.sidebar.items.priceLists },
                    { href: routes.sales.territories, icon: MapPin, label: t.sidebar.items.territories },
                    { href: routes.settings.sales, icon: Cog, label: t.sidebar.items.salesSettings },
                ],
            },
        ],
    },
    {
        key: 'purchase',
        icon: Truck,
        label: t.sidebar.modules.purchase,
        children: [
            { href: routes.purchases.root, icon: LayoutDashboard, label: t.sidebar.items.overview, exact: true },
            { href: routes.purchases.list, icon: ClipboardList, label: t.sidebar.items.purchases },
            {
                type: 'subgroup',
                key: 'payables',
                icon: Wallet,
                label: t.purchases.hub.payables,
                children: [
                    { href: routes.purchases.supplierPayments, icon: Wallet, label: t.sidebar.items.supplierPayment },
                    { href: routes.purchases.supplierLedger, icon: BookOpen, label: t.sidebar.items.supplierLedger },
                ],
            },
            {
                type: 'subgroup',
                key: 'order-flow',
                icon: ClipboardList,
                label: t.purchases.hub.orderFlow,
                children: [
                    { href: routes.purchases.orders, icon: FileText, label: t.sidebar.items.purchaseOrders },
                    { href: routes.purchases.quotations, icon: FileSearch, label: t.sidebar.items.purchaseQuotations },
                    { href: routes.purchases.returns, icon: Undo2, label: t.sidebar.items.purchaseReturns },
                ],
            },
            {
                type: 'subgroup',
                key: 'reports',
                icon: BarChart3,
                label: t.purchases.hub.reports,
                advancedOnly: true,
                children: [
                    { href: routes.purchases.reports.summary, icon: TrendingUp, label: t.sidebar.items.purchaseSummary, advancedOnly: true },
                    { href: routes.purchases.reports.byProduct, icon: Package, label: t.sidebar.items.purchasesByProduct, advancedOnly: true },
                    { href: routes.purchases.reports.bySupplier, icon: Truck, label: t.sidebar.items.purchasesBySupplier, advancedOnly: true },
                ],
            },
            {
                type: 'subgroup',
                key: 'setup',
                icon: Settings,
                label: t.purchases.hub.setup,
                children: [
                    { href: routes.purchases.suppliers, icon: Truck, label: t.sidebar.items.suppliers },
                ],
            },
        ],
    },
    {
        key: 'accounting',
        icon: Calculator,
        label: t.sidebar.modules.accounting,
        children: [
            { href: routes.accounting.root, icon: LayoutDashboard, label: t.sidebar.items.overview, exact: true },
            { href: routes.accounting.vouchers, icon: FileText, label: t.sidebar.items.voucherEntry },
            { href: routes.accounting.journal, icon: ClipboardList, label: t.sidebar.items.journal },
            { href: routes.accounting.ledger, icon: ClipboardList, label: t.sidebar.items.ledger },
            { href: routes.accounting.reconciliation, icon: AlertTriangle, label: t.sidebar.items.postingExceptions },
            { href: routes.accounting.expenses, icon: Receipt, label: t.sidebar.items.expenses },
            { href: routes.accounting.loans, icon: HandCoins, label: t.sidebar.items.loans },
            {
                type: 'subgroup',
                key: 'reports',
                icon: BarChart3,
                label: t.sidebar.sections.accountingReports,
                children: [
                    { href: routes.accounting.reports.pl, icon: TrendingUp, label: t.sidebar.items.profitAndLoss },
                    { href: routes.accounting.reports.balanceSheet, icon: LayoutDashboard, label: t.sidebar.items.balanceSheet },
                    { href: routes.accounting.reports.cashbook, icon: BookOpen, label: t.sidebar.items.cashbook },
                    { href: routes.accounting.reports.bankbook, icon: Landmark, label: t.sidebar.items.bankbook },
                ],
            },
            {
                type: 'subgroup',
                key: 'setup',
                icon: Settings,
                label: t.sidebar.sections.accountingSetup,
                children: [
                    { href: routes.accounting.coa, icon: FolderTree, label: t.sidebar.items.chartOfAccounts },
                    { href: routes.accounting.postingRules, icon: Settings, label: t.sidebar.items.postingRules },
                ],
            },
        ],
    },
    {
        key: 'inventory',
        icon: Package,
        label: t.sidebar.modules.inventory,
        children: [
            { href: routes.inventory.root, icon: LayoutDashboard, label: t.sidebar.items.overview, exact: true },
            { href: routes.inventory.products, icon: Package, label: t.sidebar.items.products },
            { href: routes.inventory.transfers, icon: Boxes, label: t.sidebar.items.transfers },
            { href: routes.inventory.stockTakes, icon: ClipboardCheck, label: t.sidebar.items.stockTakes },
            { href: routes.inventory.shrinkage, icon: AlertTriangle, label: t.sidebar.items.shrinkage },
            { href: routes.inventory.labels, icon: Tag, label: t.sidebar.items.printLabels },
            {
                type: 'subgroup',
                key: 'reports',
                icon: BarChart3,
                label: t.inventory.hub.reports,
                children: [
                    { href: routes.inventory.ledger, icon: BookOpen, label: t.sidebar.items.stockLedger },
                    { href: routes.inventory.reports.reorder, icon: TrendingUp, label: t.sidebar.items.reorderReport, advancedOnly: true },
                    { href: routes.inventory.reports.shrinkage, icon: AlertTriangle, label: t.sidebar.items.shrinkageReport, advancedOnly: true },
                    { href: routes.inventory.reports.valuation, icon: Calculator, label: t.sidebar.items.valuation, advancedOnly: true },
                ],
            },
            {
                type: 'subgroup',
                key: 'setup',
                icon: Settings,
                label: t.inventory.hub.setup,
                children: [
                    { href: routes.inventory.brands, icon: Tag, label: t.sidebar.items.brands },
                    { href: routes.inventory.categories, icon: FolderTree, label: t.sidebar.items.categories },
                    { href: routes.inventory.settings, icon: Settings, label: t.sidebar.items.inventorySettings },
                ],
            },
        ],
    },
    {
        key: 'hr',
        icon: UserCog,
        label: t.sidebar.modules.hr,
        children: [
            { href: routes.hr.root, icon: LayoutDashboard, label: t.sidebar.items.overview, exact: true },
            { href: routes.hr.employees, icon: Users, label: t.sidebar.items.employees },
            {
                type: 'subgroup',
                key: 'organization',
                icon: Layers,
                label: t.hr.hub.organization,
                children: [
                    { href: routes.hr.departments, icon: Layers, label: t.sidebar.items.departments },
                    { href: routes.hr.designations, icon: BadgeCheck, label: t.sidebar.items.designations },
                ],
            },
            {
                type: 'subgroup',
                key: 'operations',
                icon: Clock,
                label: t.hr.hub.operations,
                children: [
                    { href: routes.hr.attendance, icon: Clock, label: t.sidebar.items.attendance },
                    { href: routes.hr.leaves, icon: CalendarOff, label: t.sidebar.items.leaves },
                    { href: routes.hr.salaryPayments, icon: Banknote, label: t.sidebar.items.salaryPayments },
                ],
            },
        ],
    },
    {
        key: 'account-settings',
        icon: Settings,
        label: t.sidebar.modules.accountSettings,
        children: [
            { href: routes.settings.root, icon: LayoutDashboard, label: t.sidebar.items.overview, exact: true },
            { href: routes.billing, icon: CreditCard, label: t.sidebar.modules.billing },
            { href: routes.team, icon: UserCog, label: t.sidebar.items.teamPermissions },
            { href: routes.smsCredits, icon: MessageSquare, label: t.sidebar.items.smsCredits },
            { href: routes.aiCredits, icon: Sparkles, label: t.sidebar.items.aiCredits },
        ],
    },
    {
        key: 'support',
        icon: MessageSquare,
        label: t.sidebar.items.support,
        href: routes.support,
    },
    {
        key: 'admin',
        icon: ShieldCheck,
        label: t.sidebar.modules.admin,
        children: [
            { href: routes.admin.root, icon: LayoutDashboard, label: t.sidebar.items.overview },
            { href: routes.admin.tenants, icon: Crown, label: t.sidebar.items.tenants },
            { href: routes.admin.users, icon: Users, label: t.sidebar.items.users },
            { href: routes.admin.feedback, icon: MessageSquare, label: t.sidebar.items.feedback },
            { href: routes.admin.support, icon: MessageSquare, label: t.sidebar.items.adminSupport },
        ],
    },
    {
        key: 'help',
        icon: HelpCircle,
        label: t.sidebar.modules.help,
        href: routes.help,
    },
];
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/** Modules visible when acting as the Platform Admin (no shop/tenant scope). */
const PLATFORM_ADMIN_MODULES = new Set(['admin', 'help']);

export default function Sidebar({
    canAccessAccounting = true,
    canAccessInventoryReports = false,
    canAccessAdmin = false,
    canManageBilling = false,
    canManageTeam = false,
    platformAdminMode = false,
    activePlanCode,
    isOpen = false,
    onClose,
}: {
    canAccessAccounting?: boolean;
    canAccessInventoryReports?: boolean;
    canAccessAdmin?: boolean;
    canManageBilling?: boolean;
    canManageTeam?: boolean;
    /** When true, hide all shop modules and show only the admin console. */
    platformAdminMode?: boolean;
    activePlanCode?: string | null;
    /** Mobile overlay open state */
    isOpen?: boolean;
    /** Called when mobile overlay should close */
    onClose?: () => void;
}) {
    const pathname = usePathname();
    const { logoUrl, businessName, primaryColor } = useBranding();
    const { t } = useI18n();
    const [collapsed, setCollapsed] = useState(false);
    const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
    const modules = useMemo(() => buildModules(t)
        .filter((module) => {
            // Platform-admin console: shop owner/user options are hidden entirely.
            if (platformAdminMode) return PLATFORM_ADMIN_MODULES.has(module.key);
            if (module.key === 'accounting') return canAccessAccounting;
            if (module.key === 'admin') return canAccessAdmin;
            return true;
        })
        .map((module) => {
            if (!module.children) return module;

            if (module.key === 'account-settings') {
                return {
                    ...module,
                    children: module.children.filter((child) => {
                        if (isNavSubgroup(child)) return true;
                        if (child.href === routes.billing) return canManageBilling;
                        if (child.href === routes.team) return canManageTeam;
                        return true;
                    }),
                };
            }

            if (['sales', 'purchase', 'inventory'].includes(module.key)) {
                return {
                    ...module,
                    children: filterModuleNavChildren(module.children, canAccessInventoryReports),
                };
            }

            return module;
        })
        .filter((module) => !module.children || module.children.length > 0), [
        t,
        platformAdminMode,
        canAccessAccounting,
        canAccessInventoryReports,
        canAccessAdmin,
        canManageBilling,
        canManageTeam,
    ]);

    const isActive = (href: string, exact = false) => {
        if (href === routes.home) return pathname === routes.home;
        if (exact) return pathname === href;
        return pathname === href || pathname.startsWith(`${href}/`);
    };

    useEffect(() => {
        const saved = localStorage.getItem('sidebar-collapsed');
        if (saved !== null) setCollapsed(saved === 'true');

        // auto-open the group whose child is currently active
        const groups = localStorage.getItem('sidebar-open-groups');
        if (groups) {
            try { setOpenGroups(JSON.parse(groups)); } catch { /* ignore */ }
        }
    }, []);

    // auto-expand the module and any nested subgroup that contains the current page
    useEffect(() => {
        const toOpen: Record<string, boolean> = {};

        for (const mod of modules) {
            if (!mod.children) continue;

            for (const child of mod.children) {
                if (isNavSubgroup(child)) {
                    if (child.children.some((link) => isActive(link.href, link.exact))) {
                        toOpen[mod.key] = true;
                        toOpen[`${mod.key}:${child.key}`] = true;
                    }
                    continue;
                }

                if (!child.section && isActive(child.href, child.exact)) {
                    toOpen[mod.key] = true;
                }
            }
        }

        if (Object.keys(toOpen).length === 0) return;

        setOpenGroups((prev) => {
            let changed = false;
            const next = { ...prev };
            for (const [key, value] of Object.entries(toOpen)) {
                if (value && !next[key]) {
                    next[key] = true;
                    changed = true;
                }
            }
            if (!changed) return prev;
            localStorage.setItem('sidebar-open-groups', JSON.stringify(next));
            return next;
        });
    }, [canAccessAccounting, pathname, modules]);

    // Close mobile drawer on navigation
    useEffect(() => {
        onClose?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pathname]);

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

    const isGroupActive = (mod: NavModule) =>
        mod.children?.some((child) => {
            if (isNavSubgroup(child)) {
                return child.children.some((link) => isActive(link.href, link.exact));
            }
            if (child.section) return false;
            return isActive(child.href, child.exact);
        }) ?? false;

    /* ---- Shared link styles ---- */
    const linkCls = (active: boolean) =>
        `flex items-center rounded-xl transition-all duration-150 group ${
            collapsed ? 'justify-center w-10 h-10 mx-auto' : 'space-x-3 px-3 py-2'
        } ${
            active
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-200'
                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
        }`;

    const childLinkCls = (active: boolean, nested = false) =>
        `flex items-center rounded-lg transition-all duration-150 group space-x-3 px-3 py-1.5 ${
            nested ? 'ml-8' : 'ml-4'
        } ${
            active
                ? 'bg-blue-50 text-blue-700 font-bold'
                : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
        }`;

    const subgroupBtnCls = (active: boolean) =>
        `flex items-center w-full rounded-lg transition-all duration-150 space-x-3 px-3 py-1.5 ml-4 ${
            active
                ? 'text-blue-700 bg-blue-50/70'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
        }`;

    return (
        <>
            {/* Mobile backdrop */}
            {isOpen && (
                <div
                    className="md:hidden fixed inset-0 z-30 bg-black/50"
                    onClick={onClose}
                />
            )}

            <aside
                className={`
                    fixed inset-y-0 left-0 z-40 w-64 flex flex-col bg-white border-r border-gray-200 transition-all duration-300 flex-shrink-0
                    ${isOpen ? 'translate-x-0' : '-translate-x-full'}
                    md:relative md:inset-y-auto md:left-auto md:z-auto md:translate-x-0
                    ${collapsed ? 'md:w-16' : 'md:w-64'}
                `}
            >
                {/* Logo */}
                <div className={`flex items-center h-14 border-b border-gray-100 flex-shrink-0 ${collapsed ? 'justify-center px-0' : 'px-5 space-x-3'}`}>
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden" style={{ backgroundColor: primaryColor }}>
                        {logoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={logoUrl} alt="Logo" className="w-full h-full object-contain" />
                        ) : (
                            <Package className="text-white w-5 h-5" />
                        )}
                    </div>
                    {!collapsed && (
                        <div className="min-w-0">
                            <span className="text-lg font-bold tracking-tight whitespace-nowrap block">
                                {businessName || 'RetailSaaS'}
                            </span>
                            <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">{t.sidebar.workspace}</span>
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
                                    /* In collapsed mode, navigate to first link child */
                                    <Link
                                        href={
                                            isNavSubgroup(mod.children![0])
                                                ? mod.children![0].children[0].href
                                                : mod.children![0].href
                                        }
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
                                        {mod.children!.map((child) => {
                                            if (isNavSubgroup(child)) {
                                                const subgroupKey = `${mod.key}:${child.key}`;
                                                const subgroupOpen = openGroups[subgroupKey] ?? false;
                                                const SubgroupIcon = child.icon;
                                                const subgroupActive = child.children.some((link) => isActive(link.href, link.exact));

                                                return (
                                                    <div key={subgroupKey}>
                                                        <button
                                                            type="button"
                                                            onClick={() => toggleGroup(subgroupKey)}
                                                            className={subgroupBtnCls(subgroupActive)}
                                                        >
                                                            <SubgroupIcon className={`flex-shrink-0 w-4 h-4 ${subgroupActive ? 'text-blue-600' : ''}`} />
                                                            <span className="text-sm font-semibold tracking-tight whitespace-nowrap">{child.label}</span>
                                                            <ChevronDown
                                                                className={`ml-auto w-3.5 h-3.5 transition-transform duration-200 ${
                                                                    subgroupOpen ? 'rotate-180' : ''
                                                                } ${subgroupActive ? 'text-blue-400' : 'text-gray-300'}`}
                                                            />
                                                        </button>
                                                        {subgroupOpen && (
                                                            <div className="mt-0.5 space-y-0.5">
                                                                {child.children.map(({ href, icon: LinkIcon, label, exact, advancedOnly }) => {
                                                                    const active = isActive(href, exact);
                                                                    return (
                                                                        <Link key={href} href={href} className={childLinkCls(active, true)}>
                                                                            <LinkIcon className={`flex-shrink-0 w-3.5 h-3.5 ${active ? 'text-blue-600' : ''}`} />
                                                                            <span className="text-sm tracking-tight whitespace-nowrap">{label}</span>
                                                                            {advancedOnly && (
                                                                                <span className="ml-auto text-[9px] font-black uppercase tracking-widest text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-md">Advanced</span>
                                                                            )}
                                                                        </Link>
                                                                    );
                                                                })}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            }

                                            const { href, icon: ChildIcon, label, section, exact } = child;
                                            if (section) {
                                                return (
                                                    <div key={href} className="flex items-center ml-4 px-3 pt-3 pb-1">
                                                        <ChildIcon className="flex-shrink-0 w-3.5 h-3.5 text-gray-300" />
                                                        <span className="ml-2 text-[10px] font-black uppercase tracking-widest text-gray-300">{label}</span>
                                                    </div>
                                                );
                                            }
                                            const active = isActive(href, exact);
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

                {/* Collapse toggle (desktop only) */}
                <button
                    onClick={toggleSidebar}
                    className="absolute -right-3 top-[3.5rem] mt-4 z-10 w-6 h-6 bg-white border border-gray-200 rounded-full hidden md:flex items-center justify-center shadow-sm hover:shadow-md hover:border-blue-300 hover:text-blue-600 transition-all"
                    title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                >
                    {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
                </button>
            </aside>
        </>
    );
}
