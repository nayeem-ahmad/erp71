'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Menu, Zap, X } from 'lucide-react';
import ChatBell from '@/components/ChatBell';
import NotificationBell from '@/components/NotificationBell';
import AvatarDropdown from '@/components/AvatarDropdown';
import Sidebar from '@/components/Sidebar';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import DemoSandboxBanner from '@/components/DemoSandboxBanner';
import FeedbackWidget from '@/components/FeedbackWidget';
import VoiceNavWidget from '@/components/VoiceNavWidget';
import AiChatWidget from '@/components/AiChatWidget';
import AppHeaderMobileMenu from '@/components/AppHeaderMobileMenu';
import Toaster from '@/components/Toaster';
import ServiceWorkerRegistrar from '@/components/ServiceWorkerRegistrar';
import { CompactUiProvider } from '@/contexts/CompactUiContext';
import { PlatformFeaturesProvider } from '@/contexts/PlatformFeaturesContext';
import { TenantLocaleProvider } from '@/contexts/TenantLocaleContext';
import {
    DEFAULT_PLATFORM_ADMIN_NAV_LAYOUT,
    DEFAULT_PLATFORM_FEATURES,
    DEFAULT_TENANT_NAV_LAYOUT,
    hasPlanEntitlement,
    normalizePlanFeatures,
    type NavLayoutNode,
    type PlatformFeatures,
} from '@erp71/shared-types';
import { isAccountingOnlyBlockedPath } from '@/lib/accounting-only-paths';
import { isAccountingAdvancedReportPath } from '@/lib/plan-gated-paths';
import { NavLayoutProvider } from '@/contexts/NavLayoutContext';
import TenantLocaleSync from '@/components/TenantLocaleSync';
import { BrandingProvider } from '@/lib/branding';
import { formatPlanDisplayName } from '@/lib/plan-display';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import {
    applyPlatformAdminContext,
    applyRefereeContext,
    applyEmployeeContext,
    applyTenantContext,
    getLoginContexts,
    isShopWorkspacePath,
} from '@/lib/auth-session';
import { syncLocalePreferenceFromSession } from '@/lib/localization/preference';
import { clampLocaleToTenant } from '@/lib/tenant-locales';
import { routes } from '@/lib/routes';
import { toast } from '@/lib/toast';
import { hasPermission, isOwner } from '@/lib/permissions';
import { isPosEnabled } from '@/lib/sales-settings';
import { getLastTenantId, getWorkspaceItem, removeWorkspaceItem, setWorkspaceItem } from '@/lib/session-store';

type DashboardLayoutProps = Readonly<{ children: React.ReactNode }>;

export default function DashboardLayout({ children }: DashboardLayoutProps) {
    const { t } = useI18n();
    const pathname = usePathname();
    const router = useRouter();
    const [user, setUser] = useState<any>(null);
    const [hasResolvedUser, setHasResolvedUser] = useState(false);
    const [activeStoreId, setActiveStoreId] = useState<string>('');
    const [showOnboardingBanner, setShowOnboardingBanner] = useState(false);
    const [showDemoBanner, setShowDemoBanner] = useState(false);
    const [showEmailVerificationBanner, setShowEmailVerificationBanner] = useState(false);
    const [resendingVerification, setResendingVerification] = useState(false);
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const [workspaceEpoch, setWorkspaceEpoch] = useState(0);
    const [accountPlatformFeatures, setAccountPlatformFeatures] = useState<PlatformFeatures>(DEFAULT_PLATFORM_FEATURES);
    const [tenantNavLayout, setTenantNavLayout] = useState<NavLayoutNode[]>(DEFAULT_TENANT_NAV_LAYOUT);
    const [platformAdminNavLayout, setPlatformAdminNavLayout] = useState<NavLayoutNode[]>(DEFAULT_PLATFORM_ADMIN_NAV_LAYOUT);
    const [posEnabled, setPosEnabled] = useState(true);

    const refreshNavLayouts = useCallback(() => {
        Promise.all([
            api.getNavLayout('tenant'),
            api.getNavLayout('platform_admin'),
        ]).then(([tenant, platformAdmin]) => {
            if (tenant?.layout?.length) setTenantNavLayout(tenant.layout);
            if (platformAdmin?.layout?.length) setPlatformAdminNavLayout(platformAdmin.layout);
        }).catch(() => null);
    }, []);

    useEffect(() => {
        refreshNavLayouts();
    }, [refreshNavLayouts]);

    useEffect(() => {
        const onNavLayoutUpdated = () => refreshNavLayouts();
        window.addEventListener('erp71:nav-layout-updated', onNavLayoutUpdated);
        return () => window.removeEventListener('erp71:nav-layout-updated', onNavLayoutUpdated);
    }, [refreshNavLayouts]);

    useEffect(() => {
        if (!hasResolvedUser || !user) return;
        if (getWorkspaceItem('active_context')) return;

        const { isReferee, isPlatformAdmin, isEmployee, tenants, count } = getLoginContexts(user);
        if (count !== 1) {
            // Several workspaces to choose from and this tab is in none of them
            // — a resumed shop that turned out to be stale, or a fresh tab with
            // nothing to resume. Anything but asking would be a guess.
            if (count > 1 && !getWorkspaceItem('tenant_id')) {
                router.replace(`${routes.selectAccount}?redirect=${encodeURIComponent(pathname)}`);
            }
            return;
        }

        // Checked before the referee branch and before the single-tenant one:
        // an employee is also a tenant member, so `tenants.length === 1` is true
        // for them too and would otherwise drop them into the staff app they
        // have no permissions for.
        if (isEmployee) {
            applyEmployeeContext(user.employee);
            setWorkspaceEpoch((epoch) => epoch + 1);
            if (!pathname.startsWith(routes.employeePortal.root)) {
                router.replace(routes.employeePortal.root);
            }
            return;
        }
        if (isReferee) {
            applyRefereeContext();
            setWorkspaceEpoch((epoch) => epoch + 1);
            if (!pathname.startsWith(routes.referralsPortal.root)) {
                router.replace(routes.referralsPortal.root);
            }
            return;
        }
        if (isPlatformAdmin) {
            applyPlatformAdminContext();
            setWorkspaceEpoch((epoch) => epoch + 1);
            if (pathname === routes.home) {
                router.replace(routes.admin.root);
            }
            return;
        }
        if (tenants.length === 1) {
            applyTenantContext(tenants[0]);
            setWorkspaceEpoch((epoch) => epoch + 1);
        }
    }, [hasResolvedUser, pathname, router, user]);

    useEffect(() => {
        api.getMe().then((me) => {
            // A tab that resumed from `last_tenant_id` may be pointing at a shop
            // this account no longer belongs to. Correct it against the real
            // membership list rather than letting the header carry a stale id.
            const tenantId = globalThis.window === undefined ? null : getWorkspaceItem('tenant_id');
            const tenants = me?.tenants ?? [];
            const matchedTenant = tenants.find((t: { id: string }) => t.id === tenantId);
            if (tenantId && !matchedTenant) {
                removeWorkspaceItem('tenant_id');
                removeWorkspaceItem('store_id');
                removeWorkspaceItem('subscription_plan_code');
                // One shop left is unambiguous; several is a choice only the
                // user can make, so `/select-account` takes it from here.
                if (tenants.length === 1) applyTenantContext(tenants[0]);
                setWorkspaceEpoch((epoch) => epoch + 1);
            }
            const sessionTenant = matchedTenant || (tenants.length === 1 ? tenants[0] : undefined);
            syncLocalePreferenceFromSession(me, { overwrite: false });
            if (sessionTenant) {
                const stored = localStorage.getItem('locale');
                const preferred = stored || me?.preferred_locale || 'en';
                const clamped = clampLocaleToTenant(preferred, sessionTenant);
                if (clamped !== preferred) {
                    localStorage.setItem('locale', clamped);
                }
            }
            setUser(me);
            setAccountPlatformFeatures(me?.platform_features ?? DEFAULT_PLATFORM_FEATURES);
            setShowEmailVerificationBanner(!me?.email_verified);
            const isDemo = Boolean(me?.is_demo) || localStorage.getItem('demo_session') === '1';
            setShowDemoBanner(isDemo && localStorage.getItem('demo_banner_dismissed') !== '1');
            if (me?.is_demo) {
                localStorage.setItem('demo_session', '1');
            }
        }).catch(() => null)
            .finally(() => setHasResolvedUser(true));
    }, []);

    const useCompactChrome = !pathname.startsWith(routes.sales.pos);
    // workspaceEpoch bumps after we restore this tab's shop context.
    void workspaceEpoch;
    const activeContext = globalThis.window === undefined ? null : getWorkspaceItem('active_context');
    const activeTenantId = globalThis.window === undefined ? null : getWorkspaceItem('tenant_id');
    // Platform admins choose between the admin console and any shop they belong
    // to. In admin-console mode we never resolve a shop/tenant so the dashboard
    // shows only platform-admin options.
    const inPlatformAdminMode = Boolean(user?.is_platform_admin) && activeContext === 'platform-admin';
    const inRefereeMode = Boolean(user?.referee?.is_active) && activeContext === 'referee';
    // `activeContext` alone is not enough: it is a stored value a user can
    // set by hand. Pairing it with `user.employee` — which only the server can
    // populate — means faking the context yields an employee shell with no data
    // rather than any access they did not already have.
    const inEmployeeMode = Boolean(user?.employee?.id) && activeContext === 'employee';
    const loginContexts = user
        ? getLoginContexts(user)
        : { isPlatformAdmin: false, isReferee: false, isEmployee: false, tenants: [], count: 0 };
    const canSwitchAccount = loginContexts.count > 1;
    const activeTenant = (inPlatformAdminMode || inRefereeMode)
        ? null
        : user?.tenants?.find((tenant: any) => tenant.id === activeTenantId) || user?.tenants?.[0];

    // Each tenant carries the platform switches with its own super-admin overrides
    // already applied; the account-level set is the fallback outside a workspace.
    const platformFeatures: PlatformFeatures = activeTenant?.platform_features ?? accountPlatformFeatures;

    // Setup is dismissed per workspace (server-side), so a new browser or a teammate's
    // first login never re-opens it. The localStorage flag is only a same-tab shortcut
    // for the moment between dismissing and /auth/me catching up.
    const onboardingDismissed = activeTenant?.onboarding_dismissed === true;

    useEffect(() => {
        if (inPlatformAdminMode || inRefereeMode) return;
        const done = onboardingDismissed || localStorage.getItem('onboarding_complete');
        if (!done && pathname === routes.home) setShowOnboardingBanner(true);
    }, [pathname, inPlatformAdminMode, inRefereeMode, onboardingDismissed]);

    const refreshSalesSettings = useCallback(() => {
        if (inPlatformAdminMode || inRefereeMode) {
            setPosEnabled(true);
            return;
        }
        api.getSalesSettings()
            .then((settings) => setPosEnabled(isPosEnabled(settings)))
            .catch(() => setPosEnabled(true));
    }, [inPlatformAdminMode, inRefereeMode]);

    useEffect(() => {
        refreshSalesSettings();
    }, [refreshSalesSettings, workspaceEpoch]);

    useEffect(() => {
        const onSalesSettingsUpdated = () => refreshSalesSettings();
        window.addEventListener('erp71:sales-settings-updated', onSalesSettingsUpdated);
        return () => window.removeEventListener('erp71:sales-settings-updated', onSalesSettingsUpdated);
    }, [refreshSalesSettings]);

    useEffect(() => {
        if (!mobileNavOpen) return;

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        return () => {
            document.body.style.overflow = previousOverflow;
        };
    }, [mobileNavOpen]);

    useEffect(() => {
        if (!hasResolvedUser) return;
        // In admin-console mode the generic shop dashboard doesn't apply — send
        // platform admins to their console instead of shop onboarding.
        if (inPlatformAdminMode) {
            if (pathname === routes.home) router.replace(routes.admin.root);
            return;
        }
        if (inRefereeMode) {
            if (pathname === routes.home) router.replace(routes.referralsPortal.root);
            return;
        }
        const done = onboardingDismissed || localStorage.getItem('onboarding_complete');
        if (done) return;
        if (pathname === routes.home) {
            router.replace(routes.onboarding);
        }
    }, [hasResolvedUser, pathname, router, inPlatformAdminMode, inRefereeMode, onboardingDismissed]);

    const tenantStores = activeTenant?.stores || [];
    const primaryRole = activeTenant?.role;
    const activePlan = activeTenant?.subscription?.plan ?? null;
    const activePlanCode = activePlan?.code || null;
    const activePlanLabel = formatPlanDisplayName(activePlan);
    const planFeatures = normalizePlanFeatures(
        activeTenant?.subscription?.plan?.features_json as Record<string, unknown> | undefined,
        activePlanCode,
    );
    const hasPaidPlan = activePlanCode && activePlanCode !== 'FREE';
    const hasAccountingEntitlement = Boolean(planFeatures.premiumAccounting);
    const hasInventoryReportEntitlement = Boolean(planFeatures.premiumInventoryReports);
    const hasAccountingAdvancedEntitlement = Boolean(planFeatures.premiumAccountingAdvanced);
    const hasPremiumCrm = Boolean(planFeatures.premiumCrm);
    const canAccessManufacturing =
        platformFeatures.manufacturing && hasPlanEntitlement(planFeatures, 'premiumManufacturing');
    const accountingOnlyMode = Boolean(planFeatures.accountingOnly);
    const isPlatformAdmin = inPlatformAdminMode;
    const perms = activeTenant?.permissions ?? [];
    const owner = isOwner(primaryRole);
    // Off by default platform-wide; a tenant override switches it on for one
    // workspace without exposing it to everyone else. Gated on the permission as
    // well as the flag: every /projects endpoint requires VIEW_PROJECTS, so
    // without this a cashier sees the module and gets a 403 behind every page.
    const canAccessProjects =
        Boolean(platformFeatures.projects) && (owner || hasPermission(perms, 'VIEW_PROJECTS'));
    const canManageBilling = owner || hasPermission(perms, 'MANAGE_USERS');
    const canManageTeam = owner || hasPermission(perms, 'MANAGE_USERS');
    const canViewAudit = canManageTeam;
    const canAccessAccounting =
        (owner || hasPermission(perms, 'VIEW_LEDGER'))
        && hasPaidPlan
        && hasAccountingEntitlement;
    const canAccessInventoryReports = Boolean(hasInventoryReportEntitlement);
    const canAccessAccountingAdvanced = Boolean(hasAccountingAdvancedEntitlement);
    const canAccessVoice = platformFeatures.voice && hasPlanEntitlement(planFeatures, 'premiumVoice');
    // Same two gates as every other AI feature: the platform kill switch and the
    // plan entitlement. Tool-level permissions are enforced server-side.
    const canAccessAiChat =
        platformFeatures.aiChat
        && hasPlanEntitlement(planFeatures, 'premiumAi')
        && !inPlatformAdminMode
        && !inRefereeMode;
    const effectivePlatformFeatures: PlatformFeatures = {
        ...platformFeatures,
        voice: canAccessVoice,
    };

    useEffect(() => {
        if (!hasResolvedUser || !user?.referee?.is_active) return;
        if (!pathname.startsWith(routes.referralsPortal.root)) return;
        if (getWorkspaceItem('active_context') === 'referee') return;
        applyRefereeContext();
        setWorkspaceEpoch((epoch) => epoch + 1);
    }, [hasResolvedUser, pathname, user]);

    // Platform admins can land on shop URLs after refresh while still in admin-console
    // context (active_context=platform-admin). Restore the last shop workspace automatically.
    useEffect(() => {
        if (!hasResolvedUser || !user) return;
        if (getWorkspaceItem('active_context') !== 'platform-admin') return;
        if (!isShopWorkspacePath(pathname)) return;

        const tenants = user.tenants ?? [];
        if (tenants.length === 0) return;

        const rememberedTenantId = getWorkspaceItem('tenant_id') || getLastTenantId();
        const tenant = tenants.find((entry: { id: string }) => entry.id === rememberedTenantId);
        // No remembered shop and more than one to choose from: dropping the user
        // into whichever happens to be first is exactly the surprise this is
        // meant to prevent. Let them pick.
        if (!tenant && tenants.length > 1) {
            router.replace(routes.selectAccount);
            return;
        }
        applyTenantContext(tenant ?? tenants[0]);
        setWorkspaceEpoch((epoch) => epoch + 1);
    }, [hasResolvedUser, pathname, user]);

    useEffect(() => {
        if (!activeTenant) return;

        const savedStoreId = getWorkspaceItem('store_id');
        const hasSavedStore = tenantStores.some((store: any) => store.id === savedStoreId);
        const resolvedStoreId = hasSavedStore ? savedStoreId : tenantStores[0]?.id;

        if (resolvedStoreId) {
            setActiveStoreId(resolvedStoreId);
            if (resolvedStoreId !== savedStoreId) {
                setWorkspaceItem('store_id', resolvedStoreId);
            }
        }
    }, [activeTenant, tenantStores]);

    useEffect(() => {
        if (!hasResolvedUser) {
            return;
        }

        if (!canAccessAccounting && pathname.startsWith(routes.accounting.root)) {
            router.replace(routes.home);
        }
        if (!canAccessInventoryReports && pathname.startsWith(`${routes.inventory.root}/reports`)) {
            router.replace(routes.inventory.products);
        }
        if (!canAccessAccountingAdvanced && isAccountingAdvancedReportPath(pathname)) {
            router.replace(routes.accounting.reports.pl);
        }
        if (!isPlatformAdmin && pathname.startsWith(routes.admin.root)) {
            router.replace(routes.home);
        }
        if (!user?.referee?.is_active && pathname.startsWith(routes.referralsPortal.root)) {
            router.replace(routes.home);
        }
        if (!user?.is_platform_admin && pathname === routes.status) {
            if (!user) {
                router.replace(`/login?redirect=${encodeURIComponent(routes.status)}`);
            } else {
                router.replace(routes.home);
            }
        }
        if (!canManageTeam && pathname.startsWith(routes.team)) {
            router.replace(routes.home);
        }
        if (!canManageTeam && pathname.startsWith(routes.settings.team)) {
            router.replace(routes.settings.root);
        }
        if (!canViewAudit && pathname.startsWith(routes.settings.auditLogs)) {
            router.replace(routes.settings.root);
        }
        if (!canAccessAccounting && pathname.startsWith(routes.accounting.expenses)) {
            router.replace(routes.home);
        }
        if (accountingOnlyMode && isAccountingOnlyBlockedPath(pathname)) {
            router.replace(canAccessAccounting ? routes.accounting.root : routes.home);
        }
        // /crm/conversations is a sibling of /crm/leads, not a child, so it needs listing
        // explicitly. The API 403s either way, but without this the page shell still
        // renders for a non-premium tenant.
        const premiumCrmPaths = [routes.crm.leads, routes.crm.contacts, routes.crm.conversations];
        if (!hasPremiumCrm && premiumCrmPaths.some((p) => pathname.startsWith(p))) {
            router.replace(routes.crm.root);
        }
        // Same reasoning as the premium-CRM paths above: every /projects endpoint
        // 403s without VIEW_PROJECTS, but the shell would still render and the
        // list would swallow the 403 into an empty table — a blank page with no
        // explanation, which is how the module's missing grants went unnoticed.
        if (!canAccessProjects && pathname.startsWith(routes.projects.root)) {
            router.replace(routes.home);
        }
        if (!platformFeatures.help && pathname.startsWith(routes.help)) {
            router.replace(routes.home);
        }
        if (!platformFeatures.support && !platformFeatures.feedback && pathname === routes.support) {
            router.replace(routes.home);
        }
        if (!posEnabled && pathname.startsWith(routes.sales.pos)) {
            router.replace(routes.sales.list);
        }
    }, [accountingOnlyMode, activeContext, canAccessAccounting, canAccessAccountingAdvanced, canAccessInventoryReports, canAccessProjects, canManageTeam, canViewAudit, hasPremiumCrm, hasResolvedUser, isPlatformAdmin, pathname, platformFeatures.help, platformFeatures.support, platformFeatures.feedback, posEnabled, router, user]);

    const activeStore =
        tenantStores.find((store: { id: string }) => store.id === activeStoreId) ?? tenantStores[0];
    const headerStoreLabel = inPlatformAdminMode
        ? 'Platform Admin'
        : inRefereeMode
            ? t.referralPortal.workspace.title
            : inEmployeeMode
                ? t.employeePortal.workspace.title
                : activeStore?.name ?? activeTenant?.name ?? t.dashboardLayout.defaultPageTitle;

    const handleStoreChange = (storeId: string) => {
        setActiveStoreId(storeId);
        setWorkspaceItem('store_id', storeId);
        router.refresh();
    };

    const tenantLocaleConfig = (inPlatformAdminMode || inRefereeMode) ? null : activeTenant;

    return (
        <BrandingProvider>
        <NavLayoutProvider
            tenantLayout={tenantNavLayout}
            platformAdminLayout={platformAdminNavLayout}
        >
        <PlatformFeaturesProvider features={effectivePlatformFeatures}>
        <TenantLocaleProvider tenant={tenantLocaleConfig}>
        <TenantLocaleSync tenant={tenantLocaleConfig} />
        <div className="flex h-dvh min-h-dvh bg-canvas font-sans text-gray-900">
            <Sidebar
                canAccessAccounting={canAccessAccounting}
                canAccessInventoryReports={canAccessInventoryReports}
                canAccessAccountingAdvanced={canAccessAccountingAdvanced}
                canAccessPremiumCrm={hasPremiumCrm}
                canAccessManufacturing={canAccessManufacturing}
                canAccessProjects={canAccessProjects}
                canAccessAdmin={isPlatformAdmin}
                canManageBilling={canManageBilling}
                canManageTeam={canManageTeam}
                platformAdminMode={inPlatformAdminMode}
                refereeMode={inRefereeMode}
                employeeMode={inEmployeeMode}
                helpEnabled={platformFeatures.help}
                supportEnabled={platformFeatures.support || platformFeatures.feedback}
                activePlanCode={activePlanCode}
                accountingOnlyMode={accountingOnlyMode}
                posEnabled={posEnabled}
                planFeatures={planFeatures}
                compactNav={useCompactChrome}
                isOpen={mobileNavOpen}
                onClose={() => setMobileNavOpen(false)}
            />

            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Top header */}
                <header className={`${useCompactChrome ? 'min-h-[3.25rem] py-1.5 md:px-4' : 'h-14 md:px-6'} bg-white border-b border-gray-100 flex items-center justify-between px-3 flex-shrink-0`}>
                    <div className="flex items-center gap-2 md:gap-3 min-w-0 flex-1">
                        <button
                            type="button"
                            className="md:hidden min-h-touch min-w-touch flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-xl transition-colors flex-shrink-0"
                            onClick={() => setMobileNavOpen(true)}
                            aria-label={t.sidebar.openNavigation}
                        >
                            <Menu className="w-5 h-5" />
                        </button>
                        <div className="flex min-w-0 flex-col justify-center gap-0.5">
                            {tenantStores.length > 1 && !inPlatformAdminMode && !inRefereeMode ? (
                                <select
                                    value={activeStoreId}
                                    onChange={(e) => handleStoreChange(e.target.value)}
                                    className="min-w-0 max-w-full truncate bg-transparent text-[15px] font-extrabold text-gray-950 tracking-tight outline-none leading-tight"
                                    aria-label={t.dashboardLayout.branchLabel}
                                >
                                    {tenantStores.map((store: { id: string; name: string }) => (
                                        <option key={store.id} value={store.id}>
                                            {store.name}
                                        </option>
                                    ))}
                                </select>
                            ) : (
                                <span className="min-w-0 truncate text-[15px] font-extrabold text-gray-950 tracking-tight leading-tight">
                                    {headerStoreLabel}
                                </span>
                            )}
                            {!inPlatformAdminMode && !inRefereeMode && activePlanLabel ? (
                                <span className="min-w-0 truncate text-[11px] font-medium text-gray-500 leading-tight">
                                    {activePlanLabel}
                                </span>
                            ) : null}
                        </div>
                    </div>

                    <div className="flex items-center gap-1.5 md:gap-4 flex-shrink-0">
                        <div className="hidden md:contents">
                            {canAccessVoice ? <VoiceNavWidget /> : null}
                            {canAccessVoice ? <div className="h-8 w-px bg-gray-200 hidden sm:block" /> : null}
                            <LanguageSwitcher />
                        </div>
                        <AppHeaderMobileMenu />
                        {platformFeatures.support || platformFeatures.feedback ? <FeedbackWidget /> : null}
                        {canAccessAiChat ? <AiChatWidget /> : null}
                        <ChatBell />
                        <NotificationBell />
                        <div className="h-8 w-px bg-gray-200 hidden sm:block" />
                        <AvatarDropdown
                            userName={user?.name || '—'}
                            roleLabel={
                                inPlatformAdminMode
                                    ? 'Platform Admin'
                                    : inRefereeMode
                                        ? t.referralPortal.workspace.title
                                        : (activeTenant?.role || t.dashboardLayout.userFallbackRole)
                            }
                            avatarUrl={user?.avatar_url}
                            canSwitchAccount={canSwitchAccount}
                        />
                    </div>
                </header>

                {showDemoBanner && (
                    <DemoSandboxBanner
                        onDismiss={() => {
                            localStorage.setItem('demo_banner_dismissed', '1');
                            setShowDemoBanner(false);
                        }}
                    />
                )}

                {showEmailVerificationBanner && (
                    <div className="bg-amber-500 text-white px-6 py-2.5 flex items-center justify-between gap-4 flex-shrink-0">
                        <div className="text-sm font-medium">
                            {t.dashboardLayout.emailVerifyMessage}
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                            <button
                                disabled={resendingVerification}
                                onClick={async () => {
                                    setResendingVerification(true);
                                    try {
                                        await api.resendVerificationEmail();
                                        toast.success(t.dashboardLayout.emailVerifySent);
                                    } catch (err: unknown) {
                                        const message = err instanceof Error ? err.message : t.dashboardLayout.emailVerifyFailed;
                                        toast.error(message);
                                    } finally {
                                        setResendingVerification(false);
                                    }
                                }}
                                className="text-xs font-bold bg-white text-amber-700 px-3 py-1 rounded-lg hover:bg-amber-50 transition-colors disabled:opacity-60"
                            >
                                {resendingVerification ? t.dashboardLayout.emailVerifySending : t.dashboardLayout.emailVerifyResend}
                            </button>
                            <button
                                onClick={() => setShowEmailVerificationBanner(false)}
                                className="text-amber-100 hover:text-white transition-colors"
                                aria-label={t.dashboardLayout.emailVerifyDismiss}
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                )}

                {/* Onboarding banner */}
                {showOnboardingBanner && (
                    <div className="bg-blue-600 text-white px-6 py-2.5 flex items-center justify-between gap-4 flex-shrink-0">
                        <div className="flex items-center gap-2 text-sm font-medium">
                            <Zap className="w-4 h-4 flex-shrink-0" />
                            <span>{t.dashboardLayout.onboardingMessage}</span>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                            <button
                                onClick={() => router.push(routes.onboarding)}
                                className="text-xs font-bold bg-white text-blue-600 px-3 py-1 rounded-lg hover:bg-blue-50 transition-colors"
                            >
                                {t.dashboardLayout.startSetup}
                            </button>
                            <button
                                onClick={() => {
                                    localStorage.setItem('onboarding_complete', '1');
                                    setShowOnboardingBanner(false);
                                    api.dismissOnboarding().catch(() => { /* retried on the next dismiss */ });
                                }}
                                className="text-blue-200 hover:text-white transition-colors"
                                aria-label="Dismiss"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                )}

                {/* Page content */}
                <main className="flex-1 overflow-hidden">
                    <CompactUiProvider density="compact">
                        {children}
                    </CompactUiProvider>
                </main>
            </div>

            <Toaster />
            <ServiceWorkerRegistrar />
        </div>
        </TenantLocaleProvider>
        </PlatformFeaturesProvider>
        </NavLayoutProvider>
        </BrandingProvider>
    );
}
