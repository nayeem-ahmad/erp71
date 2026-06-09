'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowLeft, Zap, X } from 'lucide-react';
import NotificationBell from '@/components/NotificationBell';
import Sidebar from '@/components/Sidebar';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import FeedbackWidget from '@/components/FeedbackWidget';
import ServiceWorkerRegistrar from '@/components/ServiceWorkerRegistrar';
import { BrandingProvider } from '@/lib/branding';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { syncLocalePreferenceFromSession } from '@/lib/localization/preference';

type DashboardLayoutProps = Readonly<{ children: React.ReactNode }>;

export default function DashboardLayout({ children }: DashboardLayoutProps) {
    const { t } = useI18n();
    const pathname = usePathname();
    const router = useRouter();
    const [user, setUser] = useState<any>(null);
    const [hasResolvedUser, setHasResolvedUser] = useState(false);
    const [activeStoreId, setActiveStoreId] = useState<string>('');
    const [showOnboardingBanner, setShowOnboardingBanner] = useState(false);

    useEffect(() => {
        api.getMe().then((me) => {
            syncLocalePreferenceFromSession(me, { overwrite: false });
            setUser(me);
        }).catch(() => null)
            .finally(() => setHasResolvedUser(true));
    }, []);

    useEffect(() => {
        const done = localStorage.getItem('onboarding_complete');
        if (!done && pathname === '/dashboard') setShowOnboardingBanner(true);
    }, [pathname]);

    const isDashboardHome = pathname === '/dashboard';
    const activeTenantId = globalThis.window === undefined ? null : localStorage.getItem('tenant_id');
    const activeTenant = user?.tenants?.find((tenant: any) => tenant.id === activeTenantId) || user?.tenants?.[0];
    const tenantStores = activeTenant?.stores || [];
    const primaryRole = activeTenant?.role;
    const activePlanCode = activeTenant?.subscription?.plan?.code || null;
    const planFeatures = (activeTenant?.subscription?.plan?.features_json || {}) as Record<string, unknown>;
    const hasPaidPlan = activePlanCode && activePlanCode !== 'FREE';
    const hasAccountingEntitlement = Boolean(planFeatures.premiumAccounting) || activePlanCode === 'STANDARD' || activePlanCode === 'PREMIUM';
    const hasInventoryReportEntitlement = Boolean(planFeatures.premiumInventoryReports) || activePlanCode === 'STANDARD' || activePlanCode === 'PREMIUM';
    const isPlatformAdmin = Boolean(user?.is_platform_admin);
    const canManageBilling = primaryRole === 'OWNER' || primaryRole === 'MANAGER';
    const canAccessAccounting = (primaryRole === 'OWNER' || primaryRole === 'MANAGER') && hasPaidPlan && hasAccountingEntitlement;
    const canAccessInventoryReports = Boolean(hasInventoryReportEntitlement);

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

        if (!canAccessAccounting && pathname.startsWith('/dashboard/accounting')) {
            router.replace('/dashboard');
        }
        if (!canAccessInventoryReports && pathname.startsWith('/dashboard/inventory/reports')) {
            router.replace('/dashboard/inventory');
        }
        if (!isPlatformAdmin && pathname.startsWith('/dashboard/admin')) {
            router.replace('/dashboard');
        }
    }, [canAccessAccounting, canAccessInventoryReports, hasResolvedUser, isPlatformAdmin, pathname, router]);

    // Build a human-readable page title from the path
    const pageTitle = (() => {
        const segments = pathname.split('/').filter(Boolean);
        if (segments.length <= 1) return t.dashboardLayout.defaultPageTitle;
        const last = segments.at(-1);
        if (!last) return t.dashboardLayout.defaultPageTitle;
        // If it looks like a UUID / id segment, step up one
        const isId = /^[0-9a-f-]{8,}$/i.test(last);
        const label = isId ? (segments.at(-2) ?? last) : last;
        return label
            .split('-')
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
    })();

    const handleStoreChange = (storeId: string) => {
        setActiveStoreId(storeId);
        localStorage.setItem('store_id', storeId);
        router.refresh();
    };

    return (
        <BrandingProvider>
        <div className="flex h-screen bg-[#f9fafb] font-sans text-[#111827]">
            <Sidebar
                canAccessAccounting={canAccessAccounting}
                canAccessInventoryReports={canAccessInventoryReports}
                canAccessAdmin={isPlatformAdmin}
                canManageBilling={canManageBilling}
                activePlanCode={activePlanCode}
            />

            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Top header */}
                <header className="h-14 bg-white border-b border-gray-100 flex items-center justify-between px-6 flex-shrink-0">
                    <div className="flex items-center space-x-3">
                        {isDashboardHome ? null : (
                            <button
                                onClick={() => router.back()}
                                className="flex items-center space-x-1.5 text-gray-500 hover:text-gray-900 transition-colors group"
                            >
                                <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
                                <span className="text-sm font-semibold">{t.common.back}</span>
                            </button>
                        )}
                        {!isDashboardHome && (
                            <span className="text-gray-300 text-sm select-none">·</span>
                        )}
                        <span className="text-sm font-bold text-gray-700 tracking-tight">{pageTitle}</span>
                    </div>

                    <div className="flex items-center space-x-4">
                        <LanguageSwitcher />
                        {tenantStores.length > 0 ? (
                            <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-2 py-1">
                                <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">{t.dashboardLayout.branchLabel}</span>
                                <select
                                    value={activeStoreId}
                                    onChange={(e) => handleStoreChange(e.target.value)}
                                    className="bg-transparent text-xs font-semibold text-gray-700 outline-none"
                                    aria-label="Select branch"
                                >
                                    {tenantStores.map((store: any) => (
                                        <option key={store.id} value={store.id}>
                                            {store.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        ) : null}
                        <NotificationBell />
                        <div className="h-8 w-px bg-gray-200" />
                        <div className="flex items-center space-x-3">
                            <div className="text-right hidden sm:block">
                                <p className="text-sm font-semibold tracking-tight leading-none">{user?.name || '—'}</p>
                                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">
                                    {activeTenant?.role || t.dashboardLayout.userFallbackRole}
                                </p>
                            </div>
                            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 text-sm font-black border border-blue-200 cursor-pointer hover:scale-105 transition-transform">
                                {user?.name?.split(' ').map((n: string) => n[0]).join('') || '??'}
                            </div>
                        </div>
                    </div>
                </header>

                {/* Onboarding banner */}
                {showOnboardingBanner && (
                    <div className="bg-blue-600 text-white px-6 py-2.5 flex items-center justify-between gap-4 flex-shrink-0">
                        <div className="flex items-center gap-2 text-sm font-medium">
                            <Zap className="w-4 h-4 flex-shrink-0" />
                            <span>{t.dashboardLayout.onboardingMessage}</span>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                            <button
                                onClick={() => router.push('/dashboard/onboarding')}
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
                    {children}
                </main>
            </div>

            <FeedbackWidget />
            <ServiceWorkerRegistrar />
        </div>
        </BrandingProvider>
    );
}
