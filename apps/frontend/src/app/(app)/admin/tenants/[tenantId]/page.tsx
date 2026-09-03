'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Loader2, LogIn } from 'lucide-react';
import { TENANT_OVERRIDABLE_FEATURE_KEYS } from '@erp71/shared-types';
import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell, Button, Alert, ConfirmDialog } from '@/components/ui';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { formatDate } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { setCredentials, setWorkspaceItem } from '@/lib/session-store';
import { useTenantDetail, type DemoBatch } from '@/components/admin/tenants/use-tenant-detail';
import OverviewPanel from '@/components/admin/tenants/panels/OverviewPanel';
import SubscriptionPanel from '@/components/admin/tenants/panels/SubscriptionPanel';
import ConfigurationPanel from '@/components/admin/tenants/panels/ConfigurationPanel';
import IntegrationsPanel from '@/components/admin/tenants/panels/IntegrationsPanel';
import DangerZonePanel from '@/components/admin/tenants/panels/DangerZonePanel';
import type { DiscountType, SecondaryLocale } from '@/components/admin/tenants/types';

const TAB_IDS = ['overview', 'subscription', 'configuration', 'integrations', 'danger'] as const;
type TabId = (typeof TAB_IDS)[number];

/** Which pending confirmation, if any, is on screen. */
type PendingConfirm =
    | { kind: 'suspend' }
    | { kind: 'delete' }
    | { kind: 'importCatalog' }
    | { kind: 'resetNav' }
    | { kind: 'demoData'; prompt: string }
    | { kind: 'revokeAddon'; code: string; name: string };

/**
 * Platform-admin tenant detail. Replaces the old single-scroll modal: the same
 * controls, split across tabs at their own URL so a tenant can be linked to,
 * refreshed, and backed out of — and with one save for every edited section
 * instead of a save button per panel.
 */
export default function AdminTenantDetailPage() {
    const params = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const tenantId = String(params?.tenantId ?? '');

    const { t } = useI18n();
    const m = t.admin.tenants;
    const dp = m.detailPage;
    const sc = m.subscriptionControls;
    const lc = m.localizationControls;
    const ac = m.addonControls;
    const bt = m.businessTypeControls;
    const nc = m.navLayoutControls;
    const dd = m.demoData;

    const detail = useTenantDetail(tenantId);
    const { tenant, error, setError } = detail;

    const tabParam = searchParams?.get('tab');
    const activeTab: TabId = TAB_IDS.includes(tabParam as TabId) ? (tabParam as TabId) : 'overview';

    const setTab = useCallback((tab: TabId) => {
        const query = tab === 'overview' ? '' : `?tab=${tab}`;
        router.replace(`${routes.admin.tenantDetail(tenantId)}${query}`, { scroll: false });
    }, [router, tenantId]);

    const [isSaving, setIsSaving] = useState(false);
    const [isSuspending, setIsSuspending] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isImpersonating, setIsImpersonating] = useState(false);
    const [isResettingNav, setIsResettingNav] = useState(false);
    const [isImportingCatalog, setIsImportingCatalog] = useState(false);
    const [isStartingDemo, setIsStartingDemo] = useState(false);
    const [isGrantingAddon, setIsGrantingAddon] = useState(false);
    const [revokingAddonCode, setRevokingAddonCode] = useState<string | null>(null);
    const [selectedAddonCode, setSelectedAddonCode] = useState('');
    const [addonDurationDays, setAddonDurationDays] = useState('365');
    const [pending, setPending] = useState<PendingConfirm | null>(null);

    const onDemoDone = useCallback((batch: DemoBatch) => {
        if (batch.status === 'COMPLETED') {
            toast.success(formatMessage(dd.completed, { name: tenant?.name ?? '' }));
            void detail.load(tenantId, { quiet: true });
        } else if (batch.status === 'FAILED') {
            setError(batch.error || dd.failed);
        }
    }, [dd.completed, dd.failed, detail, setError, tenantId, tenant?.name]);

    // Resume demo-data progress polling on open — a load kicked off earlier may
    // still be running.
    useEffect(() => {
        if (!tenantId) return;
        void detail.pollDemoStatus(tenantId, onDemoDone);
        // Deliberately keyed on the tenant only: re-running on every render of
        // onDemoDone would start a second poll loop.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tenantId]);

    /** Saves only the sections that actually changed. */
    const saveAll = async () => {
        if (!tenant) return;
        setError('');

        // Validate before writing anything, so a bad discount can't leave the
        // other sections half-saved.
        let discountType: DiscountType | null = null;
        let discountValue: number | null = null;
        if (detail.subscriptionDirty && detail.subscription.discountMode !== 'NONE') {
            const value = Number(detail.subscription.discountValue);
            if (!Number.isFinite(value) || value <= 0) {
                setError(sc.discountInvalid);
                setTab('subscription');
                return;
            }
            if (detail.subscription.discountMode === 'PERCENTAGE' && value > 100) {
                setError(sc.discountPercentInvalid);
                setTab('subscription');
                return;
            }
            discountType = detail.subscription.discountMode;
            discountValue = value;
        }
        if (detail.localizationDirty
            && detail.localization.localization_enabled
            && !detail.localization.secondary_locale) {
            setError(lc.secondaryRequired);
            setTab('configuration');
            return;
        }

        setIsSaving(true);
        try {
            if (detail.subscriptionDirty) {
                await api.updateAdminTenantSubscription(tenant.id, {
                    planCode: detail.subscription.planCode,
                    status: detail.subscription.status,
                    cancelAtPeriodEnd: detail.subscription.cancelAtPeriodEnd,
                    discountType,
                    discountValue,
                });
            }
            if (detail.localizationDirty) {
                await api.updateAdminTenantLocalization(tenant.id, {
                    localization_enabled: detail.localization.localization_enabled,
                    secondary_locale: detail.localization.localization_enabled
                        ? (detail.localization.secondary_locale as SecondaryLocale)
                        : null,
                });
            }
            if (detail.featuresDirty) {
                const payload = Object.fromEntries(
                    TENANT_OVERRIDABLE_FEATURE_KEYS.map((key) => [
                        key,
                        detail.featureDraft[key] === 'inherit' ? null : detail.featureDraft[key] === 'on',
                    ]),
                );
                const updated = await api.updateAdminTenantFeatures(tenant.id, payload);
                detail.setFeatures(updated);
            }
            if (detail.businessTypeDirty) {
                await api.setAdminTenantBusinessType(tenant.id, detail.businessType);
            }
            await detail.load(tenant.id, { quiet: true });
            detail.resetDrafts();
            toast.success(dp.savedToast);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : dp.saveFailed);
        } finally {
            setIsSaving(false);
        }
    };

    const grantAddon = async () => {
        if (!tenant || !selectedAddonCode) return;
        setIsGrantingAddon(true);
        setError('');
        try {
            const durationDays = Number(addonDurationDays) || 365;
            const updated = await api.grantAdminTenantAddon(tenant.id, {
                addonCode: selectedAddonCode,
                durationDays,
            });
            detail.setAddons(updated);
            setSelectedAddonCode('');
            toast.success(ac.granted);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : ac.grantFailed);
        } finally {
            setIsGrantingAddon(false);
        }
    };

    const revokeAddon = async (addonCode: string) => {
        if (!tenant) return;
        setRevokingAddonCode(addonCode);
        setError('');
        try {
            const updated = await api.revokeAdminTenantAddon(tenant.id, addonCode);
            detail.setAddons(updated);
            toast.success(ac.revoked);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : ac.revokeFailed);
        } finally {
            setRevokingAddonCode(null);
        }
    };

    const importCatalog = async () => {
        if (!tenant) return;
        setIsImportingCatalog(true);
        setError('');
        try {
            const summary = await api.importAdminTenantCatalog(tenant.id);
            await detail.load(tenant.id, { quiet: true });
            toast.success(formatMessage(bt.imported, {
                created: String(summary.created),
                skipped: String(summary.skipped),
            }));
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : bt.importFailed);
        } finally {
            setIsImportingCatalog(false);
        }
    };

    const resetNav = async () => {
        if (!tenant) return;
        setIsResettingNav(true);
        setError('');
        try {
            await api.resetAdminTenantNavLayout(tenant.id);
            detail.setNavKind('pinned_default');
            toast.success(formatMessage(nc.resetSuccess, { name: tenant.name }));
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : nc.resetFailed);
        } finally {
            setIsResettingNav(false);
        }
    };

    const startDemoData = async () => {
        if (!tenant) return;
        setIsStartingDemo(true);
        setError('');
        try {
            await api.loadAdminTenantDemoData(tenant.id);
            await detail.pollDemoStatus(tenant.id, onDemoDone);
        } catch (err: unknown) {
            // A 409 means a load is already running — recover by resuming polling.
            const running = await api.getAdminTenantDemoDataStatus(tenant.id).catch(() => null);
            if (running && (running.status === 'RUNNING' || running.status === 'PENDING')) {
                await detail.pollDemoStatus(tenant.id, onDemoDone);
            } else {
                setError(err instanceof Error ? err.message : dd.failed);
            }
        } finally {
            setIsStartingDemo(false);
        }
    };

    const suspendTenant = async () => {
        if (!tenant) return;
        setIsSuspending(true);
        setError('');
        try {
            await api.suspendTenant(tenant.id, 'Suspended by platform admin');
            await detail.load(tenant.id, { quiet: true });
            toast.success(formatMessage(m.suspendedToast, { name: tenant.name }));
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : m.suspendFailed);
        } finally {
            setIsSuspending(false);
        }
    };

    const deleteTenant = async () => {
        if (!tenant) return;
        setIsDeleting(true);
        setError('');
        try {
            await api.deleteAdminTenant(tenant.id, 'Deleted by platform admin');
            toast.success(formatMessage(m.deletedToast, { name: tenant.name }));
            router.push(routes.admin.tenants);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : m.deleteFailed);
            setIsDeleting(false);
        }
    };

    const impersonate = async () => {
        if (!tenant) return;
        setIsImpersonating(true);
        setError('');
        try {
            const res: { access_token: string; impersonated_user: { email: string } } =
                await api.impersonateTenant(tenant.id);
            // No refresh token comes back with an impersonation grant — it is a
            // short, deliberately expiring window, not a session to keep alive.
            setCredentials(res);
            setWorkspaceItem('tenant_id', tenant.id);
            toast.success(formatMessage(m.impersonateToast, { email: res.impersonated_user.email }));
            setTimeout(() => { window.location.href = '/dashboard'; }, 1500);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : m.impersonateFailed);
            setIsImpersonating(false);
        }
    };

    const runPending = () => {
        if (!pending) return;
        const action = pending;
        setPending(null);
        switch (action.kind) {
            case 'suspend': return void suspendTenant();
            case 'delete': return void deleteTenant();
            case 'importCatalog': return void importCatalog();
            case 'resetNav': return void resetNav();
            case 'demoData': return void startDemoData();
            case 'revokeAddon': return void revokeAddon(action.code);
        }
    };

    const confirmProps = useMemo(() => {
        if (!pending || !tenant) return null;
        switch (pending.kind) {
            case 'suspend':
                return {
                    title: m.suspendTenant,
                    prompt: formatMessage(m.suspendConfirm, { name: tenant.name }),
                    confirmLabel: m.suspendTenant,
                    danger: true,
                    loading: isSuspending,
                };
            case 'delete':
                return {
                    title: m.deleteTenant,
                    prompt: formatMessage(m.deleteConfirm, { name: tenant.name }),
                    confirmLabel: m.deleteTenant,
                    danger: true,
                    loading: isDeleting,
                    // Irreversible and reachable in two clicks — make the admin
                    // type the tenant name rather than dismiss a dialog.
                    expected: tenant.name.toLowerCase(),
                    typePromptTemplate: dp.typeToConfirm,
                };
            case 'importCatalog':
                return {
                    title: bt.import,
                    prompt: formatMessage(bt.importConfirm, { name: tenant.name }),
                    confirmLabel: bt.import,
                    loading: isImportingCatalog,
                };
            case 'resetNav':
                return {
                    title: nc.reset,
                    prompt: formatMessage(nc.resetConfirm, { name: tenant.name }),
                    confirmLabel: nc.reset,
                    loading: isResettingNav,
                };
            case 'demoData':
                return {
                    title: dd.button,
                    prompt: pending.prompt,
                    confirmLabel: dd.button,
                    loading: isStartingDemo,
                };
            case 'revokeAddon':
                return {
                    title: ac.revoke,
                    prompt: formatMessage(ac.revokeConfirm, { name: pending.name, tenant: tenant.name }),
                    confirmLabel: ac.revoke,
                    danger: true,
                    loading: revokingAddonCode === pending.code,
                };
        }
    }, [pending, tenant, m, bt, nc, dd, ac, dp.typeToConfirm, isSuspending, isDeleting,
        isImportingCatalog, isResettingNav, isStartingDemo, revokingAddonCode]);

    const tabs: Array<{ id: TabId; label: string; danger?: boolean }> = [
        { id: 'overview', label: dp.tabs.overview },
        { id: 'subscription', label: dp.tabs.subscription },
        { id: 'configuration', label: dp.tabs.configuration },
        { id: 'integrations', label: dp.tabs.integrations },
        { id: 'danger', label: dp.tabs.danger, danger: true },
    ];

    const breadcrumbs = nestedPageBreadcrumbs(
        t.dashboardHome.breadcrumbHome,
        t.sidebar.modules.admin,
        'admin',
        [{ label: m.listTitle, href: routes.admin.tenants }],
        tenant?.name ?? '…',
    );

    if (detail.loading) {
        return (
            <PageShell>
                <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white p-8 text-sm text-gray-500">
                    <Loader2 className="w-4 h-4 animate-spin" /> {m.loading}
                </div>
            </PageShell>
        );
    }

    if (!tenant) {
        return (
            <PageShell>
                <PageHeader title={dp.notFoundTitle} breadcrumbs={breadcrumbs} />
                <Alert tone="danger">{error || m.loadDetailFailed}</Alert>
            </PageShell>
        );
    }

    return (
        <PageShell>
            <PageHeader
                title={tenant.name}
                subtitle={formatMessage(m.created, { date: formatDate(tenant.created_at) })}
                breadcrumbs={breadcrumbs}
                actions={(
                    <Button
                        onClick={() => void impersonate()}
                        disabled={isImpersonating}
                        loading={isImpersonating}
                        icon={<LogIn className="w-4 h-4" />}
                    >
                        {m.impersonateOwner}
                    </Button>
                )}
            />

            {error && <Alert tone="danger">{error}</Alert>}

            <div className="border-b border-gray-200 flex items-stretch gap-1 overflow-x-auto">
                {tabs.map((tab) => {
                    const active = tab.id === activeTab;
                    const colour = active
                        ? (tab.danger ? 'text-danger-text border-danger' : 'text-primary border-primary')
                        : `${tab.danger ? 'text-danger-text' : 'text-gray-500'} border-transparent hover:text-gray-800`;
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            onClick={() => setTab(tab.id)}
                            className={`min-h-touch whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-semibold transition-colors ${colour}`}
                        >
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            {activeTab === 'overview' && <OverviewPanel tenant={tenant} />}

            {activeTab === 'subscription' && (
                <SubscriptionPanel
                    tenant={tenant}
                    draft={detail.subscription}
                    onDraftChange={detail.setSubscription}
                    addons={detail.addons}
                    addonCatalog={detail.addonCatalog}
                    selectedAddonCode={selectedAddonCode}
                    onSelectedAddonCodeChange={setSelectedAddonCode}
                    addonDurationDays={addonDurationDays}
                    onAddonDurationDaysChange={setAddonDurationDays}
                    isGrantingAddon={isGrantingAddon}
                    revokingAddonCode={revokingAddonCode}
                    onGrantAddon={() => void grantAddon()}
                    onRevokeAddon={(code, name) => setPending({ kind: 'revokeAddon', code, name })}
                />
            )}

            {activeTab === 'configuration' && (
                <ConfigurationPanel
                    tenant={tenant}
                    features={detail.features}
                    featureDraft={detail.featureDraft}
                    onFeatureDraftChange={detail.setFeatureDraft}
                    localization={detail.localization}
                    onLocalizationChange={detail.setLocalization}
                    businessType={detail.businessType}
                    onBusinessTypeChange={detail.setBusinessType}
                    isImportingCatalog={isImportingCatalog}
                    onImportCatalog={() => setPending({ kind: 'importCatalog' })}
                    navKind={detail.navKind}
                    isResettingNav={isResettingNav}
                    onResetNav={() => setPending({ kind: 'resetNav' })}
                />
            )}

            {activeTab === 'integrations' && (
                <IntegrationsPanel
                    tenant={tenant}
                    onToast={(msg) => toast.success(msg)}
                    onError={setError}
                />
            )}

            {activeTab === 'danger' && (
                <DangerZonePanel
                    tenant={tenant}
                    demoBatch={detail.demoBatch}
                    isStartingDemo={isStartingDemo}
                    onStartDemoData={() => {
                        const completedLoads = detail.demoBatch
                            ? (detail.demoBatch.status === 'COMPLETED'
                                ? detail.demoBatch.batch_number
                                : detail.demoBatch.batch_number - 1)
                            : 0;
                        setPending({
                            kind: 'demoData',
                            prompt: completedLoads > 0
                                ? formatMessage(dd.confirmAppend, {
                                    name: tenant.name,
                                    count: String(completedLoads),
                                })
                                : formatMessage(dd.confirmFirst, { name: tenant.name }),
                        });
                    }}
                    isSuspending={isSuspending}
                    onSuspend={() => setPending({ kind: 'suspend' })}
                    isDeleting={isDeleting}
                    onDelete={() => setPending({ kind: 'delete' })}
                />
            )}

            {detail.dirtyCount > 0 && (
                <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary-border bg-primary-light px-3 py-2 shadow-lg md:px-4">
                    <p className="text-[13px] font-semibold text-primary-hover">
                        {detail.dirtyCount === 1
                            ? dp.unsavedOne
                            : formatMessage(dp.unsavedMany, { count: String(detail.dirtyCount) })}
                    </p>
                    <div className="flex items-center gap-2">
                        <Button variant="secondary" onClick={detail.resetDrafts} disabled={isSaving}>
                            {dp.discard}
                        </Button>
                        <Button onClick={() => void saveAll()} disabled={isSaving} loading={isSaving}>
                            {dp.saveChanges}
                        </Button>
                    </div>
                </div>
            )}

            {confirmProps && (
                <ConfirmDialog
                    open
                    title={confirmProps.title}
                    prompt={confirmProps.prompt}
                    confirmLabel={confirmProps.confirmLabel}
                    cancelLabel={dp.cancel}
                    danger={confirmProps.danger}
                    loading={confirmProps.loading}
                    expected={'expected' in confirmProps ? confirmProps.expected : undefined}
                    typePromptTemplate={'typePromptTemplate' in confirmProps ? confirmProps.typePromptTemplate : undefined}
                    onConfirm={runPending}
                    onCancel={() => setPending(null)}
                />
            )}
        </PageShell>
    );
}
