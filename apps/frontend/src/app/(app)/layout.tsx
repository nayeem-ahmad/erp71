'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Menu, Zap, X } from 'lucide-react';
import NotificationBell from '@/components/NotificationBell';
import AvatarDropdown from '@/components/AvatarDropdown';
import SetPasswordGate from '@/components/SetPasswordGate';
import Sidebar from '@/components/Sidebar';
import AppShellSidebar from '@/components/app-shell/AppShellSidebar';
import DemoSandboxBanner from '@/components/DemoSandboxBanner';
import ActivationPendingBanner from '@/components/ActivationPendingBanner';
// Fetched on their own after the page is up, and only when rendered; see the file.
import { AiChatWidget, SupportDialog, TimeTracker, VoiceNavWidget } from '@/components/app-shell-widgets';
import TimerChip from '@/components/projects/TimerChip';
import Toaster from '@/components/Toaster';
import ServiceWorkerRegistrar from '@/components/ServiceWorkerRegistrar';
import { CompactUiProvider } from '@/contexts/CompactUiContext';
import { PlatformFeaturesProvider } from '@/contexts/PlatformFeaturesContext';
import { AppShellProvider } from '@/contexts/AppShellContext';
import { TenantLocaleProvider } from '@/contexts/TenantLocaleContext';
import {
    DEFAULT_PLATFORM_ADMIN_NAV_LAYOUT,
    DEFAULT_PLATFORM_FEATURES,
    DEFAULT_TENANT_NAV_LAYOUT,
    hasPlanEntitlement,
    normalizePlanFeatures,
    resolveAppStates,
    type NavLayoutNode,
    type PlatformFeatures,
} from '@erp71/shared-types';
import { isAccountingOnlyBlockedPath } from '@/lib/accounting-only-paths';
import { isAccountingAdvancedReportPath } from '@/lib/plan-gated-paths';
import { isPlatformAdminOnlyPath } from '@/lib/platform-admin-paths';
import { NavLayoutProvider } from '@/contexts/NavLayoutContext';
import { useChatUnreadCount } from '@/hooks/useChatUnreadCount';
import TenantLocaleSync from '@/components/TenantLocaleSync';
import { BrandingProvider } from '@/lib/branding';
import { formatPlanDisplayName } from '@/lib/plan-display';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useMe } from '@/hooks/use-me';
import { ME_QUERY_KEY, QueryProvider, resetWorkspaceQueries, workspaceScope } from '@/lib/query-client';
import {
    applyPlatformAdminContext,
    applyRefereeContext,
    applyEmployeeContext,
    applyTenantContext,
    getLoginContexts,
    isShopWorkspacePath,
} from '@/lib/auth-session';
import {
    SESSION_CONFIRM_MAX_RETRIES,
    handleUnconfirmedSession,
    isUnconfirmedSessionError,
    sessionConfirmRetryDelayMs,
} from '@/lib/session-expiry';
import { syncLocalePreferenceFromSession } from '@/lib/localization/preference';
import { clampLocaleToTenant } from '@/lib/tenant-locales';
import { routes } from '@/lib/routes';
import { toast } from '@/lib/toast';
import { hasPermission, isOwner } from '@/lib/permissions';
import { isPosEnabled } from '@/lib/sales-settings';
import { useProjectTimerStore } from '@/lib/project-timer-store';
import { getLastTenantId, getWorkspaceItem, removeWorkspaceItem, setWorkspaceItem } from '@/lib/session-store';
import { stripBranchParam } from '@/lib/branch-scope';

type DashboardLayoutProps = Readonly<{ children: React.ReactNode }>;

/**
 * The query cache is provided here, around the shell, so the shell itself can
 * read `/auth/me` through it — see `QueryProvider` for why here and not in the
 * root layout.
 */
export default function DashboardLayout({ children }: DashboardLayoutProps) {
    return (
        <QueryProvider>
            <AppShell>{children}</AppShell>
        </QueryProvider>
    );
}

function AppShell({ children }: DashboardLayoutProps) {
    const { t, fmt } = useI18n();
    const pathname = usePathname();
    const router = useRouter();
    const queryClient = useQueryClient();
    // The signed-in user, from the cache every page shares. A page that reads
    // it while the shell is loading it joins the same request, and a page that
    // reads it afterwards gets it from memory.
    const meQuery = useMe();
    const user: any = meQuery.data ?? null;
    // Resolved once there is an answer, or a failure that is a verdict. A
    // failure that said nothing about the session (429, 5xx, network) is still
    // being re-asked below, so the shell keeps waiting rather than drawing a
    // signed-out-looking app.
    const hasResolvedUser = meQuery.data !== undefined
        || (meQuery.isError && !isUnconfirmedSessionError(meQuery.error));
    const [activeStoreId, setActiveStoreId] = useState<string>('');
    const [showOnboardingBanner, setShowOnboardingBanner] = useState(false);
    const [showDemoBanner, setShowDemoBanner] = useState(false);
    const [emailVerificationDismissed, setEmailVerificationDismissed] = useState(false);
    const [resendingVerification, setResendingVerification] = useState(false);
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    // Stable, so the drawer's focus trap does not re-run (and re-focus its first
    // control) every time the shell re-renders behind it.
    const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);
    const [supportOpen, setSupportOpen] = useState(false);
    const [workspaceEpoch, setWorkspaceEpoch] = useState(0);
    const accountPlatformFeatures: PlatformFeatures = user?.platform_features ?? DEFAULT_PLATFORM_FEATURES;
    // Derived rather than set once on load: `me` now refreshes in the background,
    // and a dismissed banner must stay dismissed through those refreshes.
    const showEmailVerificationBanner = Boolean(user) && !user.email_verified && !emailVerificationDismissed;
    const [tenantNavLayout, setTenantNavLayout] = useState<NavLayoutNode[]>(DEFAULT_TENANT_NAV_LAYOUT);
    const [platformAdminNavLayout, setPlatformAdminNavLayout] = useState<NavLayoutNode[]>(DEFAULT_PLATFORM_ADMIN_NAV_LAYOUT);
    // The platform team's own workspace. Resolved lazily, and only in the admin
    // console — it is what scopes the project pages there, in place of a shop.
    // Starts false even when the id is already parked in this tab's store: the
    // effect below flips it on the first commit, and reading storage during
    // render would make the server and client disagree about what to draw.
    const [platformWorkspaceReady, setPlatformWorkspaceReady] = useState(false);

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

    // What used to run once when the shell fetched `/auth/me` now runs whenever
    // the cached answer changes — a background refresh included, so a shop the
    // user was removed from is corrected without a reload. Structural sharing
    // keeps `user` the same object when nothing in it changed, so a refresh that
    // found nothing new does not re-run this.
    //
    // Declared ahead of the context effect below on purpose: effects run in
    // order, and a stale shop has to be cleared before that one decides
    // whether the tab still needs the account chooser.
    useEffect(() => {
        if (!user) return;
        // A tab that resumed from `last_tenant_id` may be pointing at a shop
        // this account no longer belongs to. Correct it against the real
        // membership list rather than letting the header carry a stale id.
        const tenantId = globalThis.window === undefined ? null : getWorkspaceItem('tenant_id');
        const tenants = user.tenants ?? [];
        const matchedTenant = tenants.find((t: { id: string }) => t.id === tenantId);
        if (tenantId && !matchedTenant) {
            removeWorkspaceItem('tenant_id');
            removeWorkspaceItem('store_id');
            removeWorkspaceItem('subscription_plan_code');
            // Whatever was fetched under the shop this tab no longer belongs to
            // must not be painted into the next one.
            resetWorkspaceQueries(queryClient);
            // One shop left is unambiguous; several is a choice only the
            // user can make, so `/select-account` takes it from here.
            if (tenants.length === 1) applyTenantContext(tenants[0]);
            setWorkspaceEpoch((epoch) => epoch + 1);
        }
        const sessionTenant = matchedTenant || (tenants.length === 1 ? tenants[0] : undefined);
        syncLocalePreferenceFromSession(user, { overwrite: false });
        if (sessionTenant) {
            const stored = localStorage.getItem('locale');
            const preferred = stored || user.preferred_locale || 'en';
            const clamped = clampLocaleToTenant(preferred, sessionTenant);
            if (clamped !== preferred) {
                localStorage.setItem('locale', clamped);
            }
        }
        const isDemo = Boolean(user.is_demo) || localStorage.getItem('demo_session') === '1';
        setShowDemoBanner(isDemo && localStorage.getItem('demo_banner_dismissed') !== '1');
        if (user.is_demo) {
            localStorage.setItem('demo_session', '1');
        }
    }, [queryClient, user]);

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

    // No verdict on the session (rate limit, 5xx, network) and nothing cached to
    // show. Rendering on regardless draws a signed-out-looking shell with no way
    // forward, so re-ask a few times, then hand over to the login page with this
    // page as the return path. A background refresh that fails while there is
    // data on screen is not this case: the screen keeps what it has.
    const sessionConfirmAttempts = useRef(0);
    const { isError: meFailed, error: meError, errorUpdatedAt: meErrorAt, refetch: refetchMe } = meQuery;
    const hasMe = meQuery.data !== undefined;
    useEffect(() => {
        if (hasMe) {
            sessionConfirmAttempts.current = 0;
            return;
        }
        if (!meFailed || !isUnconfirmedSessionError(meError)) return;
        if (sessionConfirmAttempts.current >= SESSION_CONFIRM_MAX_RETRIES) {
            handleUnconfirmedSession();
            return;
        }
        const retryTimer = setTimeout(() => {
            sessionConfirmAttempts.current += 1;
            void refetchMe();
        }, sessionConfirmRetryDelayMs(meError));
        return () => clearTimeout(retryTimer);
    }, [hasMe, meFailed, meError, meErrorAt, refetchMe]);

    const useCompactChrome = !pathname.startsWith(routes.sales.pos);

    // Platform-admin-only surfaces (`/admin/*`, `/status`) must not render their
    // shell before we know who is looking. The redirect effect below only runs
    // after hydration and `/auth/me`, so without this gate a tenant user — or a
    // signed-out visitor — sees the whole platform console, and its panels fire
    // their (403ing) admin API calls, for as long as that round trip takes.
    const canRenderChildrenForRole = !isPlatformAdminOnlyPath(pathname)
        || (hasResolvedUser && Boolean(user?.is_platform_admin));
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

    // `/projects` in the admin console must not render until the platform
    // workspace id is in hand. Without it the request carries no `x-tenant-id`,
    // and `TenantInterceptor` falls back to auto-resolving the caller's own
    // membership — so an admin who also owns a shop would be shown *that shop's*
    // projects inside the platform console for as long as the round trip takes.
    const awaitingPlatformWorkspace = inPlatformAdminMode
        && pathname.startsWith(routes.projects.root)
        && !platformWorkspaceReady;
    const canRenderChildren = canRenderChildrenForRole && !awaitingPlatformWorkspace;

    // Each tenant carries the platform switches with its own super-admin overrides
    // already applied; the account-level set is the fallback outside a workspace.
    const platformFeatures: PlatformFeatures = activeTenant?.platform_features ?? accountPlatformFeatures;

    const primaryRole = activeTenant?.role;
    const owner = isOwner(primaryRole);

    // Setup is dismissed per workspace (server-side), so a new browser or a teammate's
    // first login never re-opens it. The localStorage flag is only a same-tab shortcut
    // for the moment between dismissing and /auth/me catching up.
    const onboardingDismissed = activeTenant?.onboarding_dismissed === true;

    // This workspace has never been paid for and switched on. Read off the
    // session rather than fetched, so it costs nothing for the vast majority of
    // workspaces that are already active. Suppressed on /billing itself, where
    // the activation panel says all of this at length.
    const showActivationBanner =
        activeTenant?.pending_activation === true && !pathname.startsWith(routes.billing);

    // Only the owner is prompted to run store setup — staff can't create the shop
    // and shouldn't be nagged about it. Recomputed (rather than only ever switched
    // on) so the banner disappears again once /auth/me reports the workspace as
    // dismissed: before the user resolves, `onboardingDismissed` is still false.
    useEffect(() => {
        if (!hasResolvedUser || inPlatformAdminMode || inRefereeMode || !owner) {
            setShowOnboardingBanner(false);
            return;
        }
        const done = onboardingDismissed || localStorage.getItem('onboarding_complete');
        setShowOnboardingBanner(!done && pathname === routes.home);
    }, [hasResolvedUser, pathname, inPlatformAdminMode, inRefereeMode, onboardingDismissed, owner]);

    // Whether the POS is switched on decides a nav entry and a redirect. Cached
    // per workspace, so the navigation that re-applies this tab's workspace (and
    // bumps `workspaceEpoch`) no longer re-fetches it on every click; a key that
    // moves with the tenant or branch is what re-asks after a real switch.
    const salesSettingsEnabled = !inPlatformAdminMode && !inRefereeMode;
    const salesSettingsQuery = useQuery({
        queryKey: ['sales-settings', ...workspaceScope()],
        queryFn: () => api.getSalesSettings(),
        enabled: salesSettingsEnabled,
    });
    // On until told otherwise — the old default, and the safe one: a failed read
    // must not hide the till.
    const posEnabled = !salesSettingsEnabled || salesSettingsQuery.data === undefined
        ? true
        : isPosEnabled(salesSettingsQuery.data);

    useEffect(() => {
        const onSalesSettingsUpdated = () => {
            void queryClient.invalidateQueries({ queryKey: ['sales-settings'] });
        };
        window.addEventListener('erp71:sales-settings-updated', onSalesSettingsUpdated);
        return () => window.removeEventListener('erp71:sales-settings-updated', onSalesSettingsUpdated);
    }, [queryClient]);

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
        // Same rule as the banner: setup is the owner's job, so staff land on the
        // dashboard instead of a wizard they can't finish.
        if (!owner) return;
        const done = onboardingDismissed || localStorage.getItem('onboarding_complete');
        if (done) return;
        if (pathname === routes.home) {
            router.replace(routes.onboarding);
        }
    }, [hasResolvedUser, pathname, router, inPlatformAdminMode, inRefereeMode, onboardingDismissed, owner]);

    const tenantStores = activeTenant?.stores || [];
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
    // The admin console's own copy of the project module, backed by the platform
    // workspace instead of a shop. Gated on its own platform switch rather than
    // `projects`: that one decides what shops are sold, this one whether the
    // operator's staff have somewhere to run their own work.
    const canAccessPlatformProjects =
        inPlatformAdminMode && Boolean(accountPlatformFeatures.platformProjects);
    // The platform's own books. Same shape as the line above and for the same
    // reason: a platform-scoped switch, not a shop entitlement, so it is read
    // off the account's platform features rather than the active tenant's plan.
    const canAccessPlatformAccounting =
        inPlatformAdminMode && Boolean(accountPlatformFeatures.platformAccounting);
    const perms = activeTenant?.permissions ?? [];
    // Off by default platform-wide; a tenant override switches it on for one
    // workspace without exposing it to everyone else. Gated on the permission as
    // well as the flag: every /projects endpoint requires VIEW_PROJECTS, so
    // without this a cashier sees the module and gets a 403 behind every page.
    const canAccessProjects = inPlatformAdminMode
        ? canAccessPlatformProjects
        : Boolean(platformFeatures.projects) && (owner || hasPermission(perms, 'VIEW_PROJECTS'));
    // The rail-of-apps shell: a shop's own workspace only — the admin console,
    // the referral partner portal and the employee portal keep their sidebars.
    const appShellOn = Boolean(platformFeatures.appShell)
        && !inPlatformAdminMode
        && !inRefereeMode
        && !inEmployeeMode;
    // Hidden apps belong to the new shell. With it off the workspace sees the
    // old sidebar exactly as before, whatever an owner hid while it was on.
    const hiddenApps: readonly string[] = appShellOn ? (activeTenant?.hidden_apps ?? []) : [];
    // The module gate for the tenant sidebar, the app rail and the Home tiles.
    const appStates = resolveAppStates({
        planFeatures,
        planCode: activePlanCode,
        platformFeatures,
        hiddenApps,
        isOwner: owner,
        permissions: perms,
        isPlatformAdmin: inPlatformAdminMode,
    });
    const canManageBilling = owner || hasPermission(perms, 'MANAGE_USERS');
    // Who may hide apps: the backend's rule for workspace-wide display settings.
    // Not on an accounting-only plan, where there is nothing worth hiding and
    // the settings page sits outside the workspace's allowed paths.
    const canManageApps = (owner || activeTenant?.role === 'MANAGER') && !accountingOnlyMode;
    const canManageTeam = owner || hasPermission(perms, 'MANAGE_USERS');
    const canViewAudit = canManageTeam;
    // The permission half of the /short-links guards; the Sidebar applies the
    // `urlShortener` plan entitlement itself. Owners bypass StorePermissionGuard.
    const canManageShortLinks = owner || hasPermission(perms, 'MANAGE_SHORT_LINKS');
    const canAccessAccounting =
        (owner || hasPermission(perms, 'VIEW_LEDGER'))
        && hasPaidPlan
        && hasAccountingEntitlement;
    const canAccessInventoryReports = Boolean(hasInventoryReportEntitlement);
    const canAccessAccountingAdvanced = Boolean(hasAccountingAdvancedEntitlement);
    // The floating time tracker follows the user across every page, so it is
    // mounted by the shell rather than by the hour log. Same two gates every
    // /project-time route carries — without the permission, every call behind
    // the panel is a 403.
    const canTrackTime =
        canAccessProjects
        && !inPlatformAdminMode
        && !inRefereeMode
        && (owner || hasPermission(perms, 'LOG_PROJECT_TIME'));
    // While the tracker is open it hangs just below its header chip, and the
    // rest of the header's actions step aside so the chip and the panel read as
    // one thing. Hidden rather than unmounted: the bells keep their polling and
    // their counts, and come back exactly as they were when the panel closes.
    const trackerOpen = useProjectTimerStore((state) => state.open) && canTrackTime && canRenderChildren;
    const headerActionsClass = trackerOpen ? 'hidden' : 'contents';
    const canAccessVoice = platformFeatures.voice && hasPlanEntitlement(planFeatures, 'premiumVoice');
    // Same two gates as every other AI feature: the platform kill switch and the
    // plan entitlement. Tool-level permissions are enforced server-side.
    const canAccessAiChat =
        platformFeatures.aiChat
        && hasPlanEntitlement(planFeatures, 'premiumAi')
        && !inPlatformAdminMode
        && !inRefereeMode;
    const canOpenSupport = platformFeatures.support || platformFeatures.feedback;
    // The gates the sidebar's Chat entry and the chat API apply: the add-on, the
    // member's permission, and a workspace whose sidebar carries the module.
    const canUseTeamChat =
        hasPlanEntitlement(planFeatures, 'teamChat')
        && (owner || hasPermission(perms, 'USE_TEAM_CHAT'))
        && !accountingOnlyMode
        && !inPlatformAdminMode
        && !inRefereeMode;
    // Badged on the sidebar's Chat link, and on the mobile menu button that
    // opens it; team chat no longer has a header icon (UI spec §2.12).
    const chatUnreadCount = useChatUnreadCount(canUseTeamChat);
    const chatUnreadLabel = chatUnreadCount > 0 ? fmt(t.chat.badge.unread, { count: chatUnreadCount }) : '';
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

    // Resolve (and, on first ever use, provision) the platform team's workspace.
    // Only in the admin console, and only once per tab: the id is parked in the
    // per-tab workspace store, which is where `resolveTenantHeader` reads it.
    useEffect(() => {
        if (!hasResolvedUser || !inPlatformAdminMode || !canAccessPlatformProjects) return;
        if (getWorkspaceItem('platform_workspace_id')) {
            setPlatformWorkspaceReady(true);
            return;
        }

        let cancelled = false;
        api.getPlatformWorkspace()
            .then((workspace) => {
                if (cancelled || !workspace?.id) return;
                setWorkspaceItem('platform_workspace_id', workspace.id);
                setPlatformWorkspaceReady(true);
                // Re-runs the reads that were issued without a tenant header.
                setWorkspaceEpoch((epoch) => epoch + 1);
            })
            // Silent: the switch may have been turned off between `/auth/me` and
            // here, and the nav entry is already hidden in that case. Leaving
            // `platformWorkspaceReady` false keeps the pages from rendering
            // against the wrong tenant, which is the failure that matters.
            .catch(() => null);

        return () => { cancelled = true; };
    }, [hasResolvedUser, inPlatformAdminMode, canAccessPlatformProjects]);

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
        //
        // /crm/activities and /crm/follow-ups belong here for the same reason, and were
        // the gap that let a non-premium tenant land on a page that can only 403:
        // /crm/follow-ups and /crm/conversations both now redirect to /crm/activities,
        // so guarding only the two legacy paths just moved the failure one hop along.
        const premiumCrmPaths = [
            routes.crm.leads,
            routes.crm.contacts,
            routes.crm.conversations,
            routes.crm.activities,
            routes.crm.followUps,
        ];
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
        // The books switched off, or the viewer is not a platform admin. Either
        // way every /platform/accounting call 403s, so the page would render its
        // shell around an error — send them back to the console instead.
        if (!canAccessPlatformAccounting && pathname.startsWith(routes.admin.accounting.root)) {
            router.replace(routes.admin.root);
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
    }, [accountingOnlyMode, activeContext, canAccessAccounting, canAccessAccountingAdvanced, canAccessInventoryReports, canAccessPlatformAccounting, canAccessProjects, canManageTeam, canViewAudit, hasPremiumCrm, hasResolvedUser, isPlatformAdmin, pathname, platformFeatures.help, platformFeatures.support, platformFeatures.feedback, posEnabled, router, user]);

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
        // A page's own branch choice (`?branch=`) gives way to the header: the
        // page filter starts on the header branch, so a header change is the
        // user moving every page, this one included.
        const withoutBranch = stripBranchParam(`${window.location.pathname}${window.location.search}`);
        if (withoutBranch !== null) router.replace(withoutBranch, { scroll: false });
        // Every request now carries the other branch's `x-store-id`; nothing
        // cached under the old one may answer for it.
        resetWorkspaceQueries(queryClient);
        router.refresh();
    };

    const tenantLocaleConfig = (inPlatformAdminMode || inRefereeMode) ? null : activeTenant;

    // What the nav gates on. The classic sidebar, the app rail and the Home
    // tiles all resolve their menu from this, so they cannot disagree.
    const navGates = {
        appStates,
        canAccessAccounting,
        canAccessInventoryReports,
        canAccessAccountingAdvanced,
        canAccessPremiumCrm: hasPremiumCrm,
        canAccessManufacturing,
        canAccessProjects,
        canAccessPlatformAccounting,
        canAccessAdmin: isPlatformAdmin,
        canManageBilling,
        canManageTeam,
        canManageShortLinks,
        platformAdminMode: inPlatformAdminMode,
        helpEnabled: platformFeatures.help,
        supportEnabled: platformFeatures.support || platformFeatures.feedback,
        accountingOnlyMode,
        posEnabled,
        planFeatures,
        memberPermissions: perms,
        memberIsOwner: owner,
    };

    // Somebody still on a password an admin chose for them — today that means an
    // employee whose login HR just created. `JwtAuthGuard` refuses every endpoint
    // but the four the gate needs, so rendering the shell here would paint a
    // sidebar over a screenful of 403s. Returned in place of it, before any of
    // the chrome below, so no page can mount behind the gate.
    if (hasResolvedUser && user?.must_change_password) {
        return (
            <TenantLocaleProvider tenant={tenantLocaleConfig}>
                <SetPasswordGate />
            </TenantLocaleProvider>
        );
    }

    return (
        <BrandingProvider>
        <NavLayoutProvider
            tenantLayout={tenantNavLayout}
            platformAdminLayout={platformAdminNavLayout}
        >
        <PlatformFeaturesProvider features={effectivePlatformFeatures}>
        <AppShellProvider value={{ enabled: appShellOn, navGates, canManageBilling, canManageApps }}>
        <TenantLocaleProvider tenant={tenantLocaleConfig}>
        <TenantLocaleSync tenant={tenantLocaleConfig} />
        <div className="flex h-dvh min-h-dvh bg-canvas font-sans text-gray-900">
            {appShellOn ? (
                <AppShellSidebar
                    {...navGates}
                    chatUnreadCount={chatUnreadCount}
                    compactNav={useCompactChrome}
                    isOpen={mobileNavOpen}
                    onClose={closeMobileNav}
                />
            ) : (
                <Sidebar
                    {...navGates}
                    chatUnreadCount={chatUnreadCount}
                    refereeMode={inRefereeMode}
                    employeeMode={inEmployeeMode}
                    activePlanCode={activePlanCode}
                    compactNav={useCompactChrome}
                    isOpen={mobileNavOpen}
                    onClose={closeMobileNav}
                />
            )}

            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Top header */}
                <header className={`${useCompactChrome ? 'min-h-[3.25rem] py-1.5 md:px-4' : 'h-14 md:px-6'} bg-white border-b border-gray-100 flex items-center justify-between px-3 flex-shrink-0`}>
                    <div className="flex items-center gap-2 md:gap-3 min-w-0 flex-1">
                        <button
                            type="button"
                            className="relative md:hidden min-h-touch min-w-touch flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-xl transition-colors flex-shrink-0"
                            onClick={() => setMobileNavOpen(true)}
                            aria-label={[t.sidebar.openNavigation, chatUnreadLabel].filter(Boolean).join(' · ')}
                        >
                            <Menu className="w-5 h-5" />
                            {/* On a phone the Chat link is inside the drawer, so its
                                unread count needs a trace on the way in. */}
                            {chatUnreadCount > 0 ? (
                                <span aria-hidden className="absolute end-2 top-2 h-2 w-2 rounded-full bg-blue-600 ring-2 ring-white" />
                            ) : null}
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

                    {/* Only things with live state get a control here: a mic, a
                        running clock, the assistant, notifications. Preferences
                        and help live in the avatar menu, and anything with a page
                        of its own is in the sidebar — see §2.12 of the UI spec. */}
                    <div className="flex items-center gap-1 md:gap-2 flex-shrink-0">
                        <div className={headerActionsClass}>
                            {canAccessVoice ? <VoiceNavWidget /> : null}
                        </div>
                        {canTrackTime && canRenderChildren ? <TimerChip /> : null}
                        <div className={headerActionsClass}>
                            {canAccessAiChat ? <AiChatWidget /> : null}
                            <NotificationBell />
                            <div className="h-8 w-px bg-gray-200 hidden sm:block" />
                            <AvatarDropdown
                                userName={user?.name || '—'}
                                roleLabel={
                                    inPlatformAdminMode
                                        ? 'Platform Admin'
                                        : inRefereeMode
                                            ? t.referralPortal.workspace.title
                                            // The role the member actually holds, not the
                                            // coarse `UserRole` bucket it collapses into:
                                            // every module role maps to CASHIER, so the
                                            // enum shows "CASHIER" for a Sales User and a
                                            // Project User alike and never changes when
                                            // one is swapped for the other. `tenant_role`
                                            // is null for an owner by design, whose bucket
                                            // (OWNER) is the right label.
                                            : (activeTenant?.tenant_role?.name
                                                || activeTenant?.role
                                                || t.dashboardLayout.userFallbackRole)
                                }
                                avatarUrl={user?.avatar_url}
                                canSwitchAccount={canSwitchAccount}
                                onOpenSupport={canOpenSupport ? () => setSupportOpen(true) : undefined}
                            />
                        </div>
                    </div>
                </header>

                {/* Above the others: it explains why the workspace is half-locked,
                    which outranks a demo nudge or a verification reminder. */}
                {showActivationBanner && <ActivationPendingBanner />}

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
                                onClick={() => setEmailVerificationDismissed(true)}
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
                                    // Flip the cached workspace flag too, so every reader
                                    // of `me` — this banner, the onboarding redirect —
                                    // agrees before the server's answer comes back.
                                    queryClient.setQueryData(ME_QUERY_KEY, (current: any) => (current?.tenants
                                        ? {
                                            ...current,
                                            tenants: current.tenants.map((tenant: any) => (
                                                tenant.id === activeTenant?.id
                                                    ? { ...tenant, onboarding_dismissed: true }
                                                    : tenant
                                            )),
                                        }
                                        : current));
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
                        {canRenderChildren ? children : null}
                    </CompactUiProvider>
                </main>
            </div>

            {canTrackTime && canRenderChildren ? <TimeTracker /> : null}
            {supportOpen && canOpenSupport ? <SupportDialog onClose={() => setSupportOpen(false)} /> : null}
            <Toaster />
            <ServiceWorkerRegistrar />
        </div>
        </TenantLocaleProvider>
        </AppShellProvider>
        </PlatformFeaturesProvider>
        </NavLayoutProvider>
        </BrandingProvider>
    );
}
