'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ChevronLeft,
    ChevronRight,
    ChevronDown,
    Gift,
    LayoutDashboard,
    Package,
    Search,
    X,
    type LucideIcon,
} from 'lucide-react';
import { useIsMdUp } from '@/hooks/useMediaQuery';
import { useNavLayouts } from '@/contexts/NavLayoutContext';
import { useBranding } from '@/lib/branding';
import { useI18n } from '@/lib/i18n';
import { isItemVisible } from '@/lib/nav-visibility';
import { buildNavModulesFromLayout, type ResolvedNavChild, type ResolvedNavModule } from '@/lib/nav-resolver';
import {
    accordionCloseState,
    accordionOpenState,
    buildOpenGroupsState,
    collectNavGroupKeys,
    filterNavModules,
    normalizeNavSearchQuery,
} from '@/lib/sidebar-nav-filter';
import { routes } from '@/lib/routes';

/* ------------------------------------------------------------------ */
/*  Navigation structure                                               */
/* ------------------------------------------------------------------ */

/**
 * Account-settings ("Admin") links that stay relevant to an accounting-only
 * subscription. Everything else in the module is retail/POS/marketing and is
 * hidden in `accountingOnlyMode`. Keep this in sync with the accounting-only
 * settings route allow-list in `@/lib/accounting-only-paths`.
 */
const ACCOUNTING_ONLY_ADMIN_LINK_HREFS: ReadonlySet<string> = new Set([
    routes.settings.root, // My Account
    routes.profile, // My Profile
    routes.team, // Team & Permissions
    routes.settings.auditLogs, // Audit Logs
    routes.settings.localization, // Localization
    routes.settings.tax, // Tax / VAT
    routes.settings.data, // Data Management
    routes.billing, // Billing
]);

type NavChild = ResolvedNavChild;
type NavModule = ResolvedNavModule;

function isNavSubgroup(child: NavChild): child is Extract<NavChild, { type: 'subgroup' }> {
    return 'type' in child && child.type === 'subgroup';
}

function canAccessModuleAdvancedReports(
    moduleKey: string,
    canAccessInventoryReports: boolean,
    canAccessAccountingAdvanced: boolean,
): boolean {
    if (moduleKey === 'accounting') {
        return canAccessAccountingAdvanced;
    }
    return canAccessInventoryReports;
}

function stripPosNavLink(children: NavChild[], posEnabled: boolean): NavChild[] {
    if (posEnabled) return children;
    return children
        .map((child) => {
            if (!isNavSubgroup(child)) {
                return child.href === routes.sales.pos ? null : child;
            }
            const filteredLinks = child.children.filter((link) => link.href !== routes.sales.pos);
            if (filteredLinks.length === 0) return null;
            return { ...child, children: filteredLinks };
        })
        .filter((child): child is NavChild => child !== null);
}

function filterModuleNavChildren(
    children: NavChild[],
    moduleKey: string,
    canAccessInventoryReports: boolean,
    canAccessAccountingAdvanced: boolean,
    canAccessPremiumCrm = false,
    planFeatures: Record<string, unknown> = {},
): NavChild[] {
    const canAccessAdvanced = canAccessModuleAdvancedReports(
        moduleKey,
        canAccessInventoryReports,
        canAccessAccountingAdvanced,
    );
    return children
        .map((child) => {
            if (!isNavSubgroup(child)) {
                if (child.premiumOnly && !canAccessPremiumCrm) return null;
                if (child.entitlement && !isItemVisible(child, planFeatures)) return null;
                return !child.advancedOnly || canAccessAdvanced ? child : null;
            }
            if (child.advancedOnly && !canAccessAdvanced) return null;
            if (child.entitlement && !isItemVisible(child, planFeatures)) return null;
            const filteredLinks = child.children.filter((link) => {
                if (link.premiumOnly && !canAccessPremiumCrm) return false;
                if (link.entitlement && !isItemVisible(link, planFeatures)) return false;
                return !link.advancedOnly || canAccessAdvanced;
            });
            if (filteredLinks.length === 0) return null;
            return { ...child, children: filteredLinks };
        })
        .filter((child): child is NavChild => child !== null);
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

const SIDEBAR_COLLAPSED_WIDTH = 64;
const SIDEBAR_MIN_WIDTH = 176;
const SIDEBAR_MAX_WIDTH = 400;
const SIDEBAR_DEFAULT_WIDTH = { compact: 208, normal: 256 } as const;

function clampSidebarWidth(value: number) {
    return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, value));
}

export default function Sidebar({
    canAccessAccounting = true,
    canAccessInventoryReports = false,
    canAccessAccountingAdvanced = false,
    canAccessPremiumCrm = false,
    canAccessManufacturing = false,
    canAccessAdmin = false,
    canManageBilling = false,
    canManageTeam = false,
    platformAdminMode = false,
    refereeMode = false,
    helpEnabled = false,
    supportEnabled = false,
    activePlanCode,
    accountingOnlyMode = false,
    posEnabled = true,
    compactNav = false,
    isOpen = false,
    onClose,
    planFeatures = {},
}: {
    canAccessAccounting?: boolean;
    canAccessInventoryReports?: boolean;
    canAccessAccountingAdvanced?: boolean;
    canAccessPremiumCrm?: boolean;
    canAccessManufacturing?: boolean;
    canAccessAdmin?: boolean;
    canManageBilling?: boolean;
    canManageTeam?: boolean;
    /** When true, hide all shop modules and show only the admin console. */
    platformAdminMode?: boolean;
    /** When true, hide shop/admin modules and show only the referee portal. */
    refereeMode?: boolean;
    helpEnabled?: boolean;
    supportEnabled?: boolean;
    activePlanCode?: string | null;
    /** When true, show only accounting-focused modules. */
    accountingOnlyMode?: boolean;
    /** When false, hide POS from sales navigation. */
    posEnabled?: boolean;
    /** Tighter nav when inside the accounting module trial */
    compactNav?: boolean;
    /** Mobile overlay open state */
    isOpen?: boolean;
    /** Called when mobile overlay should close */
    onClose?: () => void;
    /** Active tenant plan features, used for per-item entitlement gating */
    planFeatures?: Record<string, unknown>;
}) {
    const pathname = usePathname();
    const isMdUp = useIsMdUp();
    const { logoUrl, businessName, primaryColor } = useBranding();
    const { t } = useI18n();
    const { tenantLayout, platformAdminLayout } = useNavLayouts();
    const defaultWidth = compactNav ? SIDEBAR_DEFAULT_WIDTH.compact : SIDEBAR_DEFAULT_WIDTH.normal;
    const [collapsed, setCollapsed] = useState(false);
    const [width, setWidth] = useState<number>(defaultWidth);
    const [isResizing, setIsResizing] = useState(false);
    const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
    const [searchQuery, setSearchQuery] = useState('');
    const searchInputRef = useRef<HTMLInputElement>(null);
    const modules = useMemo(() => {
        if (refereeMode) {
            return [{
                key: 'referrals',
                label: (t as { referralPortal?: { breadcrumb?: string } }).referralPortal?.breadcrumb ?? 'Referrals',
                icon: Gift,
                children: [{
                    href: routes.referralsPortal,
                    label: (t as { referralPortal?: { dashboard?: string } }).referralPortal?.dashboard ?? 'Dashboard',
                    icon: LayoutDashboard,
                    exact: true,
                }],
            }] as NavModule[];
        }

        const sourceLayout = platformAdminMode ? platformAdminLayout : tenantLayout;
        return buildNavModulesFromLayout(sourceLayout, t as Record<string, unknown>)
            .filter((module) => {
                if (platformAdminMode) {
                    if (module.key === 'help') return helpEnabled;
                    return module.key === 'admin' || module.key === 'help';
                }
                if (accountingOnlyMode) {
                    if (module.key === 'help') return helpEnabled;
                    if (module.key === 'support') return supportEnabled;
                    if (module.key === 'accounting') return canAccessAccounting;
                    return ['dashboard', 'account-settings'].includes(module.key);
                }
                if (module.key === 'accounting') return canAccessAccounting;
                if (module.key === 'admin') return canAccessAdmin;
                if (module.key === 'help') return helpEnabled;
                if (module.key === 'support') return supportEnabled;
                if (module.key === 'manufacturing') return canAccessManufacturing;
                return true;
            })
            .map((module) => {
                if (!module.children) return module;

                if (module.key === 'account-settings') {
                    return {
                        ...module,
                        children: module.children.filter((child) => {
                            if (isNavSubgroup(child)) return true;
                            if (accountingOnlyMode && !ACCOUNTING_ONLY_ADMIN_LINK_HREFS.has(child.href)) {
                                return false;
                            }
                            if (child.href === routes.billing) return canManageBilling;
                            if (child.href === routes.team || child.href === routes.settings.auditLogs) {
                                return canManageTeam;
                            }
                            return true;
                        }),
                    };
                }

                if (['sales', 'purchase', 'inventory', 'accounting'].includes(module.key)) {
                    const filteredChildren = filterModuleNavChildren(
                        module.children,
                        module.key,
                        canAccessInventoryReports,
                        canAccessAccountingAdvanced,
                        canAccessPremiumCrm,
                        planFeatures,
                    );
                    return {
                        ...module,
                        children: module.key === 'sales'
                            ? stripPosNavLink(filteredChildren, posEnabled)
                            : filteredChildren,
                    };
                }

                if (module.key === 'crm') {
                    return {
                        ...module,
                        children: filterModuleNavChildren(
                            module.children,
                            module.key,
                            true,
                            true,
                            canAccessPremiumCrm,
                            planFeatures,
                        ),
                    };
                }

                return module;
            })
            .filter((module) => !module.children || module.children.length > 0);
    }, [
        refereeMode,
        platformAdminMode,
        platformAdminLayout,
        tenantLayout,
        t,
        accountingOnlyMode,
        canAccessAccounting,
        canAccessInventoryReports,
        canAccessAccountingAdvanced,
        canAccessPremiumCrm,
        canAccessManufacturing,
        canAccessAdmin,
        canManageBilling,
        canManageTeam,
        helpEnabled,
        supportEnabled,
        posEnabled,
        planFeatures,
    ]);

    const normalizedSearchQuery = normalizeNavSearchQuery(searchQuery);
    const isSearching = normalizedSearchQuery.length > 0;
    const displayModules = useMemo(
        () => filterNavModules(modules, searchQuery),
        [modules, searchQuery],
    );
    const expandableGroupKeys = useMemo(
        () => collectNavGroupKeys(displayModules),
        [displayModules],
    );
    const hasExpandableGroups = expandableGroupKeys.length > 0;

    const isActive = (href: string, exact = false) => {
        if (href === routes.home) return pathname === routes.home;
        if (exact) return pathname === href;
        return pathname === href || pathname.startsWith(`${href}/`);
    };

    useEffect(() => {
        const saved = localStorage.getItem('sidebar-collapsed');
        if (saved !== null) setCollapsed(saved === 'true');

        const savedWidth = localStorage.getItem('sidebar-width');
        if (savedWidth !== null) {
            const parsed = Number(savedWidth);
            if (!Number.isNaN(parsed)) {
                setWidth(clampSidebarWidth(parsed));
            }
        }

        // auto-open the group whose child is currently active
        const groups = localStorage.getItem('sidebar-open-groups');
        if (groups) {
            try { setOpenGroups(JSON.parse(groups)); } catch { /* ignore */ }
        }
    }, []);

    // Tracks the last pathname we auto-opened a section for, so re-renders that
    // change `modules` (locale switch, async nav-layout load, permission change)
    // don't clobber a section the user manually opened on the current page.
    const lastAutoOpenPathRef = useRef<string | null>(null);

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

        // Auto-open applies once per distinct route (real navigation), not on
        // every re-render that rebuilds `modules`.
        if (lastAutoOpenPathRef.current === pathname) return;
        lastAutoOpenPathRef.current = pathname;

        setOpenGroups((prev) => {
            const prevKeys = Object.keys(prev).filter((key) => prev[key]);
            const nextKeys = Object.keys(toOpen);
            // Already showing exactly this chain? Return prev to skip a redundant write/re-render.
            const unchanged =
                prevKeys.length === nextKeys.length &&
                nextKeys.every((key) => prev[key]);
            if (unchanged) return prev;
            localStorage.setItem('sidebar-open-groups', JSON.stringify(toOpen));
            return toOpen;
        });
    }, [canAccessAccounting, pathname, modules]);

    const asideRef = useRef<HTMLElement>(null);
    const touchStartXRef = useRef(0);

    // Close mobile drawer on navigation
    useEffect(() => {
        onClose?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pathname]);

    useEffect(() => {
        if (!isOpen || !onClose) return;

        const aside = asideRef.current;
        if (!aside) return;

        const focusableSelector = 'a[href], button:not([disabled]), select, textarea, input:not([disabled])';
        const getFocusable = () =>
            Array.from(aside.querySelectorAll<HTMLElement>(focusableSelector)).filter(
                (element) => !element.hasAttribute('disabled') && element.tabIndex !== -1,
            );

        const focusable = getFocusable();
        focusable[0]?.focus();

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
                return;
            }

            if (event.key !== 'Tab') return;

            const items = getFocusable();
            if (items.length === 0) return;

            const first = items[0];
            const last = items[items.length - 1];

            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [isOpen, onClose]);

    const toggleSidebar = () => {
        setCollapsed((prev) => {
            localStorage.setItem('sidebar-collapsed', String(!prev));
            return !prev;
        });
    };

    const startResize = useCallback((event: React.MouseEvent) => {
        event.preventDefault();

        const startX = event.clientX;
        const startWidth = width;

        setIsResizing(true);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const onMove = (moveEvent: MouseEvent) => {
            const delta = moveEvent.clientX - startX;
            setWidth(clampSidebarWidth(startWidth + delta));
        };

        const onUp = () => {
            setIsResizing(false);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            setWidth((current) => {
                localStorage.setItem('sidebar-width', String(current));
                return current;
            });
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }, [width]);

    const sidebarWidth = isMdUp
        ? (collapsed ? SIDEBAR_COLLAPSED_WIDTH : width)
        : defaultWidth;

    const toggleGroup = (key: string) => {
        setOpenGroups((prev) => {
            const next = prev[key]
                ? accordionCloseState(prev, key)
                : accordionOpenState(key);
            localStorage.setItem('sidebar-open-groups', JSON.stringify(next));
            return next;
        });
    };

    const expandAllGroups = () => {
        setOpenGroups((prev) => {
            const next = { ...prev, ...buildOpenGroupsState(expandableGroupKeys, true) };
            localStorage.setItem('sidebar-open-groups', JSON.stringify(next));
            return next;
        });
    };

    const collapseAllGroups = () => {
        setOpenGroups((prev) => {
            const next = { ...prev };
            for (const key of expandableGroupKeys) {
                next[key] = false;
            }
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
    const navPad = compactNav ? 'py-1.5' : 'py-2';
    const navText = compactNav ? 'text-[13px]' : 'text-sm';
    const navLabelCls = `${navText} font-normal tracking-tight whitespace-nowrap`;

    const linkCls = (active: boolean) =>
        `flex items-center rounded-xl transition-all duration-150 group ${
            collapsed
                ? `justify-center ${compactNav ? 'w-9 h-9' : 'w-10 h-10'} mx-auto`
                : `space-x-2.5 px-2.5 ${navPad}`
        } ${navText} ${
            active
                ? compactNav
                    ? 'bg-blue-600 text-white shadow-sm shadow-blue-200'
                    : 'bg-blue-600 text-white shadow-lg shadow-blue-200'
                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
        }`;

    const childLinkCls = (active: boolean, nested = false) =>
        `flex items-center rounded-lg transition-all duration-150 group space-x-2.5 px-2.5 ${compactNav ? 'py-1' : 'py-1.5'} ${navText} ${
            nested ? 'ml-8' : 'ml-4'
        } ${
            active
                ? 'bg-blue-50 text-blue-700'
                : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
        }`;

    const subgroupBtnCls = (active: boolean) =>
        `flex items-center w-full rounded-lg transition-all duration-150 space-x-2.5 px-2.5 ${compactNav ? 'py-1' : 'py-1.5'} ml-4 ${navText} ${
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
                ref={asideRef}
                role={onClose ? 'dialog' : undefined}
                aria-modal={onClose && isOpen ? true : undefined}
                aria-label={onClose ? t.sidebar.navigation : undefined}
                style={{ width: sidebarWidth }}
                className={`
                    fixed inset-y-0 left-0 z-40 flex flex-col bg-white border-r border-gray-200 flex-shrink-0 pt-safe
                    ${isResizing ? '' : 'transition-[width] duration-300'}
                    ${isOpen ? 'translate-x-0' : '-translate-x-full'}
                    md:relative md:inset-y-auto md:left-auto md:z-auto md:translate-x-0
                `}
                onTouchStart={(event) => {
                    touchStartXRef.current = event.touches[0]?.clientX ?? 0;
                }}
                onTouchEnd={(event) => {
                    if (!isOpen || !onClose) return;
                    const endX = event.changedTouches[0]?.clientX ?? 0;
                    if (touchStartXRef.current - endX > 72) {
                        onClose();
                    }
                }}
            >
                {/* Logo — height matches app header (layout.tsx) */}
                <div className={`flex items-center ${compactNav ? 'min-h-[3.25rem]' : 'h-14'} border-b border-gray-100 flex-shrink-0 ${collapsed ? 'justify-center px-0' : compactNav ? 'px-3 gap-2' : 'px-5 gap-3'}`}>
                    <div className={`flex items-center min-w-0 ${collapsed ? '' : 'flex-1 space-x-3'}`}>
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden" style={{ backgroundColor: primaryColor }}>
                            {logoUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={logoUrl} alt="Logo" className="w-full h-full object-contain" />
                            ) : (
                                <Package className="text-white w-5 h-5" />
                            )}
                        </div>
                        {!collapsed && (
                            <span className="min-w-0 truncate text-[15px] font-extrabold text-gray-950 tracking-tight leading-tight">
                                {businessName || 'ERP71'}
                            </span>
                        )}
                    </div>
                    {onClose && isOpen ? (
                        <button
                            type="button"
                            onClick={onClose}
                            className="md:hidden min-h-touch min-w-touch flex items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors flex-shrink-0"
                            aria-label={t.sidebar.closeNavigation}
                        >
                            <X className="w-5 h-5" />
                        </button>
                    ) : null}
                </div>

                {!collapsed ? (
                    <div className={`flex-shrink-0 space-y-1.5 border-b border-gray-100 ${compactNav ? 'px-2 py-2' : 'px-2 py-2.5'}`}>
                        <label className="flex items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 px-2.5 py-2">
                            <Search className="h-4 w-4 flex-shrink-0 text-gray-400" aria-hidden />
                            <input
                                ref={searchInputRef}
                                type="search"
                                value={searchQuery}
                                onChange={(event) => setSearchQuery(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Escape') {
                                        setSearchQuery('');
                                        searchInputRef.current?.blur();
                                    }
                                }}
                                placeholder={t.sidebar.searchPlaceholder}
                                aria-label={t.sidebar.searchPlaceholder}
                                className={`min-w-0 flex-1 bg-transparent outline-none ${compactNav ? 'text-[13px]' : 'text-sm'} text-gray-900 placeholder:text-gray-400`}
                            />
                            {isSearching ? (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSearchQuery('');
                                        searchInputRef.current?.focus();
                                    }}
                                    className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                                    aria-label={t.sidebar.clearSearch}
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            ) : null}
                        </label>
                        {hasExpandableGroups ? (
                            <div className="flex items-center justify-end gap-2 px-1">
                                <button
                                    type="button"
                                    onClick={expandAllGroups}
                                    className={`font-semibold text-gray-500 transition-colors hover:text-blue-600 ${compactNav ? 'text-[11px]' : 'text-xs'}`}
                                >
                                    {t.sidebar.expandAll}
                                </button>
                                <span className="text-gray-300" aria-hidden>·</span>
                                <button
                                    type="button"
                                    onClick={collapseAllGroups}
                                    className={`font-semibold text-gray-500 transition-colors hover:text-blue-600 ${compactNav ? 'text-[11px]' : 'text-xs'}`}
                                >
                                    {t.sidebar.collapseAll}
                                </button>
                            </div>
                        ) : null}
                    </div>
                ) : null}

                {/* Navigation */}
                <nav className={`flex-1 overflow-y-auto ${compactNav ? 'py-2' : 'py-4'} px-2 space-y-0.5`}>
                    {isSearching && displayModules.length === 0 ? (
                        <p className={`px-3 py-6 text-center ${compactNav ? 'text-[13px]' : 'text-sm'} text-gray-400`}>
                            {t.sidebar.noSearchResults}
                        </p>
                    ) : null}
                    {displayModules.map((mod) => {
                        const Icon = mod.icon;
                        const hasChildren = !!mod.children?.length;
                        const groupOpen = isSearching || (openGroups[mod.key] ?? false);
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
                                    {!collapsed && <span className={navLabelCls}>{mod.label}</span>}
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
                                            <span className={navLabelCls}>{mod.label}</span>
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
                                        type="button"
                                        onClick={() => toggleGroup(mod.key)}
                                        disabled={isSearching}
                                        aria-expanded={groupOpen}
                                        className={`flex items-center w-full rounded-xl transition-all duration-150 space-x-3 px-3 py-2 ${
                                            isSearching ? 'cursor-default' : ''
                                        } ${
                                            groupActive
                                                ? 'text-blue-700 bg-blue-50'
                                                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
                                        }`}
                                    >
                                        <Icon className={`flex-shrink-0 w-5 h-5 ${groupActive ? 'text-blue-600' : ''}`} />
                                        <span className={navLabelCls}>{mod.label}</span>
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
                                                const subgroupOpen = isSearching || (openGroups[subgroupKey] ?? false);
                                                const SubgroupIcon = child.icon;
                                                const subgroupActive = child.children.some((link) => isActive(link.href, link.exact));

                                                return (
                                                    <div key={subgroupKey}>
                                                        <button
                                                            type="button"
                                                            onClick={() => toggleGroup(subgroupKey)}
                                                            disabled={isSearching}
                                                            aria-expanded={subgroupOpen}
                                                            className={`${subgroupBtnCls(subgroupActive)}${isSearching ? ' cursor-default' : ''}`}
                                                        >
                                                            <SubgroupIcon className={`flex-shrink-0 w-4 h-4 ${subgroupActive ? 'text-blue-600' : ''}`} />
                                                            <span className={navLabelCls}>{child.label}</span>
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
                                                                            <span className={navLabelCls}>{label}</span>
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
                                                    <span className={navLabelCls}>{label}</span>
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

                {/* Width resize handle (desktop, expanded only) */}
                {isMdUp && !collapsed ? (
                    <div
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={t.sidebar.resizeNavigation}
                        aria-valuenow={width}
                        aria-valuemin={SIDEBAR_MIN_WIDTH}
                        aria-valuemax={SIDEBAR_MAX_WIDTH}
                        onMouseDown={startResize}
                        className={`absolute right-0 top-0 bottom-0 z-20 hidden w-1.5 cursor-col-resize select-none touch-none md:block hover:bg-blue-400/60 ${
                            isResizing ? 'bg-blue-500/70' : 'bg-transparent'
                        }`}
                    />
                ) : null}

                {/* Collapse toggle (desktop only) */}
                <button
                    type="button"
                    onClick={toggleSidebar}
                    className={`absolute -right-3 z-10 mt-4 hidden h-6 w-6 items-center justify-center rounded-full border border-gray-200 bg-white shadow-sm transition-all hover:border-blue-300 hover:text-blue-600 hover:shadow-md md:flex ${
                        collapsed ? 'top-[3.5rem]' : 'top-[6.75rem]'
                    }`}
                    title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                >
                    {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
                </button>
            </aside>
        </>
    );
}
