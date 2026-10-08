'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronsLeft, ChevronsRight, LayoutGrid, Search, X } from 'lucide-react';
import BrandLogo from '@/components/BrandLogo';
import NavModuleChildren from '@/components/sidebar/NavModuleChildren';
import { useNavLayouts } from '@/contexts/NavLayoutContext';
import { useDrawerFocusTrap } from '@/hooks/useDrawerFocusTrap';
import { useIsMdUp } from '@/hooks/useMediaQuery';
import { usePendingVoucherCount } from '@/hooks/usePendingVoucherCount';
import { appHomeHref, buildRail, findActiveAppKey, railKeyFor, type RailEntry } from '@/lib/app-shell';
import { BRAND_NAME } from '@/lib/brand';
import { useBranding } from '@/lib/branding';
import { useI18n } from '@/lib/i18n';
import type { ResolvedNavModule } from '@/lib/nav-resolver';
import { isNavSubgroup, resolveSidebarModules, type SidebarModulesInput } from '@/lib/sidebar-modules';
import { filterNavModules, normalizeNavSearchQuery } from '@/lib/sidebar-nav-filter';
import { routes } from '@/lib/routes';

const RAIL_WIDTH = 56;
const PANEL_MIN_WIDTH = 176;
const PANEL_MAX_WIDTH = 400;
const PANEL_DEFAULT_WIDTH = 232;
const PANEL_MOBILE_WIDTH = 264;
/** The panel's "every app" view, picked on a phone with the back arrow. */
const ALL_APPS = '__all__';

const STORAGE = {
    collapsed: 'app-shell-collapsed',
    width: 'app-shell-panel-width',
    openGroups: 'app-shell-open-groups',
} as const;

function clampPanelWidth(value: number) {
    return Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, value));
}

function readStorage(key: string): string | null {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function writeStorage(key: string, value: string) {
    try {
        localStorage.setItem(key, value);
    } catch {
        /* private mode — the preference just does not stick */
    }
}

export type AppShellSidebarProps = Omit<SidebarModulesInput, 'tenantLayout' | 'platformAdminLayout' | 'messages'> & {
    /** Unread team-chat messages, dotted on the Chat rail icon. */
    chatUnreadCount?: number;
    compactNav?: boolean;
    /** Mobile drawer open state. */
    isOpen?: boolean;
    onClose?: () => void;
};

/**
 * The tenant shell as a rail of apps: one icon per app, and beside it the
 * menu of the app you are in. Gating is `resolveSidebarModules` — the same
 * call the classic sidebar and the Home tiles make — so the three always
 * agree. See `docs/superpowers/specs/2026-10-08-app-shell-rail-design.md`.
 */
export default function AppShellSidebar({
    chatUnreadCount = 0,
    compactNav = false,
    isOpen = false,
    onClose,
    ...gates
}: AppShellSidebarProps) {
    const pathname = usePathname();
    const isMdUp = useIsMdUp();
    const { logoUrl, businessName, primaryColor } = useBranding();
    const { t, fmt } = useI18n();
    const copy = t.components.appShell;
    const { tenantLayout, platformAdminLayout } = useNavLayouts();

    // Recomputed each render, as the classic sidebar's is: `planFeatures`
    // arrives as a fresh object every time, so a memo would never hit.
    const modules = resolveSidebarModules({
        ...gates,
        tenantLayout,
        platformAdminLayout,
        messages: t as Record<string, unknown>,
    });
    const rail = buildRail(modules, copy.helpGroup);
    const entries = [...rail.business, ...rail.utility];

    const [collapsed, setCollapsed] = useState(false);
    const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT_WIDTH);
    const [isResizing, setIsResizing] = useState(false);
    const [query, setQuery] = useState('');
    const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
    const [focusSearch, setFocusSearch] = useState(false);
    const searchRef = useRef<HTMLInputElement>(null);
    const asideRef = useRef<HTMLElement>(null);
    const touchStartXRef = useRef(0);

    useEffect(() => {
        if (readStorage(STORAGE.collapsed) === 'true') setCollapsed(true);
        const savedWidth = Number(readStorage(STORAGE.width));
        if (savedWidth) setPanelWidth(clampPanelWidth(savedWidth));
        const savedGroups = readStorage(STORAGE.openGroups);
        if (savedGroups) {
            try { setOpenGroups(JSON.parse(savedGroups)); } catch { /* ignore */ }
        }
    }, []);

    /* ---- Which app's menu is showing ---- */

    const onHome = pathname === routes.home;
    const activeModuleKey = findActiveAppKey(modules, pathname);
    const routeKey = activeModuleKey ? railKeyFor(activeModuleKey) : null;
    // A page no app owns (profile, notifications) keeps the last app's menu.
    const [lastRouteKey, setLastRouteKey] = useState<string | null>(null);
    useEffect(() => {
        if (routeKey) setLastRouteKey(routeKey);
    }, [routeKey]);
    // On a phone an app icon only switches the menu; navigating resets that.
    const [pickedKey, setPickedKey] = useState<string | null>(null);
    useEffect(() => {
        setPickedKey(null);
    }, [pathname]);

    const currentKey = onHome ? null : (routeKey ?? lastRouteKey);
    const shownKey = pickedKey ?? currentKey;
    const shownEntry = shownKey && shownKey !== ALL_APPS
        ? entries.find((entry) => entry.key === shownKey) ?? null
        : null;

    /* ---- Links, badges ---- */

    const isActive = useCallback((href: string, exact = false) => {
        if (href === routes.home) return pathname === routes.home;
        if (exact) return pathname === href;
        return pathname === href || pathname.startsWith(`${href}/`);
    }, [pathname]);

    // The approval queue is the voucher list filtered to PENDING, so its count
    // hangs off the Vouchers link, and Accounting's rail icon carries a dot.
    const { count: pendingVoucherCount } = usePendingVoucherCount();
    const badgeFor = useCallback(
        (href: string) => (href === routes.accounting.vouchers ? pendingVoucherCount : 0),
        [pendingVoucherCount],
    );
    const entryHasWork = (entry: RailEntry) => entry.modules.some((module) =>
        (module.children ?? []).some((child) => (isNavSubgroup(child)
            ? child.children.some((link) => badgeFor(link.href) > 0)
            : badgeFor(child.href) > 0)));

    // Auto-open the subgroup holding the current page.
    useEffect(() => {
        const toOpen: Record<string, boolean> = {};
        for (const navModule of modules) {
            for (const child of navModule.children ?? []) {
                if (isNavSubgroup(child) && child.children.some((link) => isActive(link.href, link.exact))) {
                    toOpen[`${navModule.key}:${child.key}`] = true;
                }
            }
        }
        if (Object.keys(toOpen).length === 0) return;
        setOpenGroups((prev) => (Object.keys(toOpen).every((key) => prev[key]) ? prev : { ...prev, ...toOpen }));
        // Once per navigation; `modules` is rebuilt every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pathname]);

    const toggleGroup = (key: string) => {
        setOpenGroups((prev) => {
            const next = { ...prev, [key]: !prev[key] };
            writeStorage(STORAGE.openGroups, JSON.stringify(next));
            return next;
        });
    };

    /* ---- Search, and Ctrl/⌘+K ---- */

    const isSearching = normalizeNavSearchQuery(query).length > 0;
    const results = isSearching
        ? filterNavModules(modules.filter((module) => module.key !== 'dashboard'), query)
        : [];

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return;
            event.preventDefault();
            setCollapsed(false);
            setFocusSearch(true);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);

    useEffect(() => {
        if (!focusSearch) return;
        searchRef.current?.focus();
        setFocusSearch(false);
    }, [focusSearch, collapsed]);

    /* ---- Drawer, collapse, resize ---- */

    useDrawerFocusTrap(asideRef, isOpen, onClose);

    useEffect(() => {
        onClose?.();
        // Close the phone drawer on navigation, as the classic sidebar does.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pathname]);

    const toggleCollapsed = () => {
        setCollapsed((prev) => {
            writeStorage(STORAGE.collapsed, String(!prev));
            return !prev;
        });
    };

    const startResize = useCallback((event: React.MouseEvent) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = panelWidth;
        // Dragging toward the inline end widens the panel — rightward in LTR,
        // leftward in RTL.
        const direction = document.documentElement.dir === 'rtl' ? -1 : 1;
        setIsResizing(true);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const onMove = (moveEvent: MouseEvent) => {
            setPanelWidth(clampPanelWidth(startWidth + (moveEvent.clientX - startX) * direction));
        };
        const onUp = () => {
            setIsResizing(false);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            setPanelWidth((current) => {
                writeStorage(STORAGE.width, String(current));
                return current;
            });
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }, [panelWidth]);

    const panelShown = !isMdUp || !collapsed;
    const width = isMdUp
        ? RAIL_WIDTH + (collapsed ? 0 : panelWidth)
        : RAIL_WIDTH + PANEL_MOBILE_WIDTH;

    /* ---- Pieces ---- */

    const navText = compactNav ? 'text-[13px]' : 'text-sm';
    const rowCls = (active: boolean) =>
        `flex min-h-touch items-center gap-2.5 rounded-lg px-2.5 ${navText} transition-colors ${
            active ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
        }`;

    const railItemCls = (highlighted: boolean) =>
        `relative flex min-h-touch min-w-touch items-center justify-center rounded-lg transition-colors ${
            highlighted ? 'bg-blue-50 text-blue-600' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
        }`;

    const renderRailEntry = (entry: RailEntry) => {
        const Icon = entry.icon;
        const unread = entry.key === 'chat' ? chatUnreadCount : 0;
        const unreadLabel = unread > 0 ? fmt(t.chat.badge.unread, { count: unread }) : '';
        const label = [entry.label, unreadLabel].filter(Boolean).join(' · ');
        const highlighted = entry.key === shownKey;
        const body = (
            <>
                {highlighted ? <span aria-hidden className="absolute inset-y-2 -start-2 w-0.5 rounded-e bg-blue-600" /> : null}
                <Icon className="h-5 w-5" aria-hidden />
                {unread > 0 ? (
                    <span aria-hidden className="absolute end-1.5 top-1.5 h-2 w-2 rounded-full bg-blue-600 ring-2 ring-white" />
                ) : entryHasWork(entry) ? (
                    <span aria-hidden className="absolute end-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-white" />
                ) : null}
            </>
        );

        if (!isMdUp) {
            return (
                <button
                    key={entry.key}
                    type="button"
                    aria-label={label}
                    aria-pressed={highlighted}
                    title={entry.label}
                    onClick={() => setPickedKey(entry.key)}
                    className={railItemCls(highlighted)}
                >
                    {body}
                </button>
            );
        }

        const href = appHomeHref(entry.modules[0]) ?? routes.home;
        return (
            <Link
                key={entry.key}
                href={href}
                aria-label={label}
                aria-current={entry.key === currentKey ? 'true' : undefined}
                title={entry.label}
                className={railItemCls(highlighted)}
            >
                {body}
            </Link>
        );
    };

    const renderSingleLink = (module: ResolvedNavModule) => {
        const Icon = module.icon;
        const href = module.href ?? appHomeHref(module) ?? routes.home;
        const active = isActive(href);
        return (
            <Link key={module.key} href={href} className={rowCls(active)}>
                <Icon className={`h-4 w-4 flex-shrink-0 ${active ? 'text-blue-600' : ''}`} aria-hidden />
                <span className="truncate">{module.label}</span>
            </Link>
        );
    };

    const renderModuleMenu = (module: ResolvedNavModule, searching: boolean) => (
        module.children?.length ? (
            <NavModuleChildren
                key={module.key}
                moduleKey={module.key}
                items={module.children}
                openGroups={openGroups}
                onToggleGroup={toggleGroup}
                isActive={isActive}
                isSearching={searching}
                compactNav={compactNav}
                badgeFor={badgeFor}
                badgeTitle={t.vouchers.approval.queueBadge}
                flat
            />
        ) : renderSingleLink(module)
    );

    const headingCls = 'px-2.5 pb-1 pt-1 text-xs font-semibold text-gray-500';

    const renderAppList = () => (
        <div className="space-y-0.5">
            <h2 className={headingCls}>{copy.apps}</h2>
            {entries.map((entry) => {
                const Icon = entry.icon;
                if (!isMdUp) {
                    return (
                        <button key={entry.key} type="button" onClick={() => setPickedKey(entry.key)} className={`${rowCls(false)} w-full text-start`}>
                            <Icon className="h-4 w-4 flex-shrink-0" aria-hidden />
                            <span className="truncate">{entry.label}</span>
                        </button>
                    );
                }
                return (
                    <Link key={entry.key} href={appHomeHref(entry.modules[0]) ?? routes.home} className={rowCls(false)}>
                        <Icon className="h-4 w-4 flex-shrink-0" aria-hidden />
                        <span className="truncate">{entry.label}</span>
                    </Link>
                );
            })}
        </div>
    );

    const renderPanelBody = () => {
        if (isSearching) {
            if (results.length === 0) {
                return <p className={`px-3 py-6 text-center ${navText} text-gray-400`}>{t.sidebar.noSearchResults}</p>;
            }
            return (
                <div className="space-y-3">
                    {results.map((module) => (
                        <section key={module.key}>
                            <h2 className={headingCls}>{module.label}</h2>
                            {renderModuleMenu(module, true)}
                        </section>
                    ))}
                </div>
            );
        }
        if (!shownEntry) return renderAppList();
        return (
            <div>
                <div className="flex items-center gap-1">
                    {!isMdUp ? (
                        <button
                            type="button"
                            onClick={() => setPickedKey(ALL_APPS)}
                            aria-label={copy.apps}
                            className="flex min-h-touch min-w-touch items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
                        >
                            <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />
                        </button>
                    ) : null}
                    <h2 className={headingCls}>{shownEntry.label}</h2>
                </div>
                <div className="space-y-0.5">
                    {shownEntry.modules.map((module) => renderModuleMenu(module, false))}
                </div>
            </div>
        );
    };

    return (
        <>
            {isOpen ? (
                <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={onClose} aria-hidden />
            ) : null}

            <aside
                ref={asideRef}
                role={onClose ? 'dialog' : undefined}
                aria-modal={onClose && isOpen ? true : undefined}
                aria-label={onClose ? t.sidebar.navigation : undefined}
                style={{ width }}
                className={`
                    fixed inset-y-0 start-0 z-40 flex flex-shrink-0 bg-white pt-safe
                    ${isResizing ? '' : 'transition-[width] duration-300'}
                    ${isOpen ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full'}
                    md:relative md:inset-y-auto md:start-auto md:z-auto md:translate-x-0 md:rtl:translate-x-0
                `}
                onTouchStart={(event) => {
                    touchStartXRef.current = event.touches[0]?.clientX ?? 0;
                }}
                onTouchEnd={(event) => {
                    if (!isOpen || !onClose) return;
                    const endX = event.changedTouches[0]?.clientX ?? 0;
                    if (touchStartXRef.current - endX > 72) onClose();
                }}
            >
                {/* Rail */}
                <nav
                    aria-label={copy.apps}
                    className="flex h-full flex-shrink-0 flex-col items-center gap-1 border-e border-gray-200 pb-2"
                    style={{ width: RAIL_WIDTH }}
                >
                    <Link
                        href={routes.home}
                        aria-label={t.sidebar.goToDashboard}
                        className={`flex ${compactNav ? 'min-h-[3.25rem]' : 'h-14'} w-full flex-shrink-0 items-center justify-center border-b border-gray-100`}
                    >
                        {logoUrl ? (
                            <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg" style={{ backgroundColor: primaryColor }}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={logoUrl} alt="" className="h-full w-full object-contain" />
                            </span>
                        ) : (
                            <BrandLogo variant="mark" height={28} decorative />
                        )}
                    </Link>

                    <Link
                        href={routes.home}
                        aria-label={copy.home}
                        aria-current={onHome ? 'true' : undefined}
                        title={copy.home}
                        className={`mt-1 ${railItemCls(onHome && !pickedKey)}`}
                    >
                        <LayoutGrid className="h-5 w-5" aria-hidden />
                    </Link>

                    <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto">
                        {rail.business.map(renderRailEntry)}
                    </div>

                    <div className="flex w-full flex-col items-center gap-1 border-t border-gray-100 pt-1">
                        {rail.utility.map(renderRailEntry)}
                        {isMdUp ? (
                            <button
                                type="button"
                                onClick={toggleCollapsed}
                                aria-label={collapsed ? copy.expandMenu : copy.collapseMenu}
                                title={collapsed ? copy.expandMenu : copy.collapseMenu}
                                className={railItemCls(false)}
                            >
                                {collapsed
                                    ? <ChevronsRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
                                    : <ChevronsLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />}
                            </button>
                        ) : null}
                    </div>
                </nav>

                {/* App panel */}
                {panelShown ? (
                    <div data-testid="app-panel" className="relative flex min-w-0 flex-1 flex-col border-e border-gray-200">
                        <div className={`flex ${compactNav ? 'min-h-[3.25rem]' : 'h-14'} flex-shrink-0 items-center gap-2 border-b border-gray-100 px-3`}>
                            <span className="min-w-0 flex-1 truncate text-[15px] font-extrabold leading-tight tracking-tight text-gray-950">
                                {businessName || BRAND_NAME}
                            </span>
                            {onClose && isOpen ? (
                                <button
                                    type="button"
                                    onClick={onClose}
                                    aria-label={t.sidebar.closeNavigation}
                                    className="flex min-h-touch min-w-touch flex-shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900 md:hidden"
                                >
                                    <X className="h-5 w-5" aria-hidden />
                                </button>
                            ) : null}
                        </div>

                        <div className="flex-shrink-0 border-b border-gray-100 px-2 py-2">
                            <label className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-2.5 py-2">
                                <Search className="h-4 w-4 flex-shrink-0 text-gray-400" aria-hidden />
                                <input
                                    ref={searchRef}
                                    type="search"
                                    value={query}
                                    onChange={(event) => setQuery(event.target.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Escape') {
                                            setQuery('');
                                            searchRef.current?.blur();
                                        }
                                    }}
                                    placeholder={copy.searchAllApps}
                                    aria-label={copy.searchAllApps}
                                    className={`min-w-0 flex-1 bg-transparent outline-none ${navText} text-gray-900 placeholder:text-gray-400`}
                                />
                                {isSearching ? (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setQuery('');
                                            searchRef.current?.focus();
                                        }}
                                        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                                        aria-label={t.sidebar.clearSearch}
                                    >
                                        <X className="h-3.5 w-3.5" aria-hidden />
                                    </button>
                                ) : null}
                            </label>
                        </div>

                        <nav aria-label={t.sidebar.navigation} className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
                            {renderPanelBody()}
                        </nav>

                        {isMdUp ? (
                            <div
                                role="separator"
                                aria-orientation="vertical"
                                aria-label={t.sidebar.resizeNavigation}
                                aria-valuenow={panelWidth}
                                aria-valuemin={PANEL_MIN_WIDTH}
                                aria-valuemax={PANEL_MAX_WIDTH}
                                onMouseDown={startResize}
                                className={`absolute bottom-0 end-0 top-0 z-20 w-1.5 cursor-col-resize select-none touch-none hover:bg-blue-400/60 ${
                                    isResizing ? 'bg-blue-500/70' : 'bg-transparent'
                                }`}
                            />
                        ) : null}
                    </div>
                ) : null}
            </aside>
        </>
    );
}
