'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Menu, Zap, X } from 'lucide-react';
import NotificationBell from '@/components/NotificationBell';
import AvatarDropdown from '@/components/AvatarDropdown';
import Sidebar from '@/components/Sidebar';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import DemoSandboxBanner from '@/components/DemoSandboxBanner';
import FloatingAssistDock from '@/components/FloatingAssistDock';
import VoiceNavWidget from '@/components/VoiceNavWidget';
import AppHeaderMobileMenu from '@/components/AppHeaderMobileMenu';
import Toaster from '@/components/Toaster';
import ServiceWorkerRegistrar from '@/components/ServiceWorkerRegistrar';
import { CompactUiProvider } from '@/contexts/CompactUiContext';
import { BrandingProvider } from '@/lib/branding';
import { formatPlanDisplayName } from '@/lib/plan-display';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { applyTenantContext, isShopWorkspacePath } from '@/lib/auth-session';
import { syncLocalePreferenceFromSession } from '@/lib/localization/preference';
import { routes } from '@/lib/routes';
import { toast } from '@/lib/toast';

const ACCOUNTING_PLAN_CODES = new Set(['ACCOUNTING', 'STANDARD', 'PREMIUM']);

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

    useEffect(() => {
        api.getMe().then((me) => {
            syncLocalePreferenceFromSession(me, { overwrite: false });
            setUser(me);
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
    // workspaceEpoch bumps after we restore a shop context from localStorage.
    void workspaceEpoch;
    const activeContext = globalThis.window === undefined ? null : localStorage.getItem('active_context');
    const activeTenantId = globalThis.window === undefined ? null : localStorage.getItem('tenant_id');
    // Platform admins choose between the admin console and any shop they belong
    // to. In admin-console mode we never resolve a shop/tenant so the dashboard
    // shows only platform-admin options.
    const inPlatformAdminMode = Boolean(user?.is_platform_admin) && activeContext === 'platform-admin';
    const tenantCount = user?.tenants?.length || 0;
    const contextCount = (user?.is_platform_admin ? 1 : 0) + tenantCount;
    const canSwitchAccount = contextCount > 1;
    const activeTenant = inPlatformAdminMode
        ? null
        : user?.tenants?.find((tenant: any) => tenant.id === activeTenantId) || user?.tenants?.[0];

    useEffect(() => {
        if (inPlatformAdminMode) return;
        const done = localStorage.getItem('onboarding_complete');
        if (!done && pathname === routes.home) setShowOnboardingBanner(true);
    }, [pathname, inPlatformAdminMode]);

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
        const done = localStorage.getItem('onboarding_complete');
        if (done) return;
        if (pathname === routes.home) {
            router.replace(routes.onboarding);
        }
    }, [hasResolvedUser, pathname, router, inPlatformAdminMode]);

    const tenantStores = activeTenant?.stores || [];
    const primaryRole = activeTenant?.role;
    const activePlan = activeTenant?.subscription?.plan ?? null;
    const activePlanCode = activePlan?.code || null;
    const activePlanLabel = formatPlanDisplayName(activePlan);
    const planFeatures = (activeTenant?.subscription?.plan?.features_json || {}) as Record<string, unknown>;
    const hasPaidPlan = activePlanCode && activePlanCode !== 'FREE';
    const hasAccountingEntitlement =
        Boolean(planFeatures.premiumAccounting)
        || (activePlanCode ? ACCOUNTING_PLAN_CODES.has(activePlanCode) : false);
    const hasInventoryReportEntitlement = Boolean(planFeatures.premiumInventoryReports) || activePlanCode === 'STANDARD' || activePlanCode === 'PREMIUM';
    const hasPremiumCrm = activePlanCode === 'PREMIUM' || Boolean(planFeatures.premiumCrm);
    const isPlatformAdmin = inPlatformAdminMode;
    const canManageBilling = primaryRole === 'OWNER' || primaryRole === 'MANAGER';
    const canManageTeam = primaryRole === 'OWNER' || primaryRole === 'MANAGER';
    const canViewAudit = canManageTeam;
    const canAccessAccounting =
        (primaryRole === 'OWNER' || primaryRole === 'MANAGER' || primaryRole === 'ACCOUNTANT')
        && hasPaidPlan
        && hasAccountingEntitlement;
    const canAccessInventoryReports = Boolean(hasInventoryReportEntitlement);

    // Platform admins can land on shop URLs after refresh while still in admin-console
    // context (active_context=platform-admin). Restore the last shop workspace automatically.
    useEffect(() => {
        if (!hasResolvedUser || !user) return;
        if (localStorage.getItem('active_context') !== 'platform-admin') return;
        if (!isShopWorkspacePath(pathname)) return;

        const tenants = user.tenants ?? [];
        if (tenants.length === 0) return;

        const rememberedTenantId = localStorage.getItem('last_tenant_id') || localStorage.getItem('tenant_id');
        const tenant = tenants.find((entry: { id: string }) => entry.id === rememberedTenantId) || tenants[0];
        applyTenantContext(tenant);
        setWorkspaceEpoch((epoch) => epoch + 1);
    }, [hasResolvedUser, pathname, user]);

    useEffect(() => {
        if (!activeTenant) return;

        const savedStoreId = localStorage.getItem('store_id');
        const hasSavedStore = tenantStores.some((store: any) => store.id === savedStoreId);
        const resolvedStoreId = hasSavedStore ? savedStoreId : tenantStores[0]?.id;

        if (resolvedStoreId) {
            setActiveStoreId(resolvedStoreId);
            if (resolvedStoreId !== savedStoreId) {
                localStorage.setItem('store_id', resolvedStoreId);
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
        if (!isPlatformAdmin && pathname.startsWith(routes.admin.root)) {
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
        if (!hasPremiumCrm && pathname.startsWith(routes.crm.leads)) {
            router.replace(routes.crm.root);
        }
    }, [canAccessAccounting, canAccessInventoryReports, canManageTeam, canViewAudit, hasPremiumCrm, hasResolvedUser, isPlatformAdmin, pathname, router, user]);

    const activeStore =
        tenantStores.find((store: { id: string }) => store.id === activeStoreId) ?? tenantStores[0];
    const headerStoreLabel = inPlatformAdminMode
        ? 'Platform Admin'
        : activeStore?.name ?? activeTenant?.name ?? t.dashboardLayout.defaultPageTitle;

    const handleStoreChange = (storeId: string) => {
        setActiveStoreId(storeId);
        localStorage.setItem('store_id', storeId);
        router.refresh();
    };

    return (
        <BrandingProvider>
        <div className="flex h-dvh min-h-dvh bg-[#f9fafb] font-sans text-[#111827]">
            <Sidebar
                canAccessAccounting={canAccessAccounting}
                canAccessInventoryReports={canAccessInventoryReports}
                canAccessPremiumCrm={hasPremiumCrm}
                canAccessAdmin={isPlatformAdmin}
                canManageBilling={canManageBilling}
                canManageTeam={canManageTeam}
                platformAdminMode={inPlatformAdminMode}
                activePlanCode={activePlanCode}
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
                            {tenantStores.length > 1 && !inPlatformAdminMode ? (
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
                            {!inPlatformAdminMode && activePlanLabel ? (
                                <span className="min-w-0 truncate text-[11px] font-medium text-gray-500 leading-tight">
                                    {activePlanLabel}
                                </span>
                            ) : null}
                        </div>
                    </div>

                    <div className="flex items-center gap-1.5 md:gap-4 flex-shrink-0">
                        <div className="hidden md:contents">
                            <VoiceNavWidget />
                            <div className="h-8 w-px bg-gray-200 hidden sm:block" />
                            <LanguageSwitcher />
                        </div>
                        <AppHeaderMobileMenu />
                        <NotificationBell />
                        <div className="h-8 w-px bg-gray-200 hidden sm:block" />
                        <AvatarDropdown
                            userName={user?.name || '—'}
                            roleLabel={
                                inPlatformAdminMode
                                    ? 'Platform Admin'
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
                            Verify your email to secure your account and receive billing alerts.
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                            <button
                                disabled={resendingVerification}
                                onClick={async () => {
                                    setResendingVerification(true);
                                    try {
                                        await api.resendVerificationEmail();
                                        toast.success('Verification email sent — check your inbox.');
                                    } catch (err: unknown) {
                                        const message = err instanceof Error ? err.message : 'Failed to send verification email.';
                                        toast.error(message);
                                    } finally {
                                        setResendingVerification(false);
                                    }
                                }}
                                className="text-xs font-bold bg-white text-amber-700 px-3 py-1 rounded-lg hover:bg-amber-50 transition-colors disabled:opacity-60"
                            >
                                {resendingVerification ? 'Sending…' : 'Resend email'}
                            </button>
                            <button
                                onClick={() => setShowEmailVerificationBanner(false)}
                                className="text-amber-100 hover:text-white transition-colors"
                                aria-label="Dismiss"
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
                                onClick={() => { localStorage.setItem('onboarding_complete', '1'); setShowOnboardingBanner(false); }}
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
            <FloatingAssistDock />
            <ServiceWorkerRegistrar />
        </div>
        </BrandingProvider>
    );
}
