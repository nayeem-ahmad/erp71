'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell, Button } from '@/components/ui';
import NavLayoutEditor from '@/components/admin/NavLayoutEditor';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import {
    getDefaultNavLayout,
    type NavLayoutNode,
    type NavScope,
} from '@erp71/shared-types';

export default function PlatformNavigationSettingsPage() {
    const { t } = useI18n();
    const m = t.admin.platformSettings.navigation;
    const [scope, setScope] = useState<NavScope>('tenant');
    const [layout, setLayout] = useState<NavLayoutNode[]>(getDefaultNavLayout('tenant'));
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [resetting, setResetting] = useState(false);
    const [isDefault, setIsDefault] = useState(true);
    const [tenantOverrides, setTenantOverrides] = useState<Array<{
        tenantId: string;
        tenantName: string;
        kind: 'custom' | 'pinned_default';
        updatedAt: string;
    }>>([]);
    const [loadingOverrides, setLoadingOverrides] = useState(true);
    const [resettingAllTenants, setResettingAllTenants] = useState(false);

    const tenantOverrideCopy = m.tenantOverrides;

    const loadLayout = useCallback(async (nextScope: NavScope) => {
        setLoading(true);
        try {
            const data = await api.getAdminNavLayout(nextScope);
            setLayout(data?.layout ?? getDefaultNavLayout(nextScope));
            setIsDefault(Boolean(data?.isDefault ?? true));
        } catch {
            setLayout(getDefaultNavLayout(nextScope));
            toast.error(t.admin.platformSettings.common.loadFailed);
        } finally {
            setLoading(false);
        }
    }, [t.admin.platformSettings.common.loadFailed]);

    const loadTenantOverrides = useCallback(async () => {
        setLoadingOverrides(true);
        try {
            const rows = await api.getAdminTenantNavOverrides();
            setTenantOverrides(Array.isArray(rows) ? rows : []);
        } catch {
            setTenantOverrides([]);
        } finally {
            setLoadingOverrides(false);
        }
    }, []);

    useEffect(() => {
        loadLayout(scope);
    }, [scope, loadLayout]);

    useEffect(() => {
        loadTenantOverrides();
    }, [loadTenantOverrides]);

    const handleSave = async () => {
        setSaving(true);
        try {
            await api.saveAdminNavLayout(scope, layout);
            setIsDefault(false);
            window.dispatchEvent(new CustomEvent('erp71:nav-layout-updated'));
            toast.success(t.admin.platformSettings.common.saved);
        } catch {
            toast.error(t.admin.platformSettings.common.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    const handleReset = async () => {
        setResetting(true);
        try {
            const defaults = await api.resetAdminNavLayout(scope);
            setLayout(defaults ?? getDefaultNavLayout(scope));
            setIsDefault(true);
            window.dispatchEvent(new CustomEvent('erp71:nav-layout-updated'));
            toast.success(m.resetSuccess);
        } catch {
            toast.error(m.resetFailed);
        } finally {
            setResetting(false);
        }
    };

    const handleResetAllTenants = async () => {
        if (!window.confirm(tenantOverrideCopy.resetAllConfirm)) return;
        setResettingAllTenants(true);
        try {
            const result = await api.resetAllAdminTenantNavLayouts();
            await loadTenantOverrides();
            window.dispatchEvent(new CustomEvent('erp71:nav-layout-updated'));
            toast.success(
                tenantOverrideCopy.resetAllSuccess.replace(
                    '{count}',
                    String(result?.resetCount ?? 0),
                ),
            );
        } catch {
            toast.error(tenantOverrideCopy.resetAllFailed);
        } finally {
            setResettingAllTenants(false);
        }
    };

    const overrideRows = useMemo(() => tenantOverrides, [tenantOverrides]);

    const toggleExpand = (id: string) => {
        setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
    };

    return (
        <PageShell>
            <div className="max-w-4xl mx-auto space-y-6">
                <PageHeader
                    title={m.title}
                    subtitle={m.description}
                    breadcrumbs={nestedPageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.admin,
                        'admin',
                        [{ label: t.admin.platformSettings.index.title, href: routes.admin.platformSettings.root }],
                        m.title,
                    )}
                />


                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    {m.notice}
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                        {([
                            { id: 'tenant' as NavScope, label: m.scopes.tenant },
                            { id: 'platform_admin' as NavScope, label: m.scopes.platformAdmin },
                        ]).map((tab) => (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setScope(tab.id)}
                                className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition-colors ${
                                    scope === tab.id
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                        <span className="ml-auto text-xs text-gray-500">
                            {isDefault ? m.usingDefaults : m.usingCustom}
                        </span>
                    </div>

                    {loading ? (
                        <div className="flex items-center justify-center py-16 text-gray-500">
                            <Loader2 className="w-5 h-5 animate-spin mr-2" />
                            {t.admin.platformSettings.common.loading}
                        </div>
                    ) : (
                        <NavLayoutEditor
                            layout={layout}
                            messages={t as Record<string, unknown>}
                            expanded={expanded}
                            onLayoutChange={setLayout}
                            onToggleExpand={toggleExpand}
                        />
                    )}

                    <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-gray-100">
                        <Button
                            type="button"
                            onClick={handleSave}
                            disabled={loading}
                            loading={saving}
                        >
                            {saving ? t.admin.platformSettings.common.saving : t.admin.platformSettings.common.saveSettings}
                        </Button>
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={handleReset}
                            disabled={loading}
                            loading={resetting}
                            icon={!resetting ? <RotateCcw className="w-4 h-4" /> : undefined}
                        >
                            {m.resetToDefaults}
                        </Button>
                    </div>
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <h2 className="text-base font-bold text-gray-900">{tenantOverrideCopy.title}</h2>
                            <p className="mt-1 text-sm text-gray-500">{tenantOverrideCopy.description}</p>
                        </div>
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={handleResetAllTenants}
                            disabled={loadingOverrides}
                            loading={resettingAllTenants}
                            icon={!resettingAllTenants ? <RotateCcw className="w-4 h-4" /> : undefined}
                        >
                            {tenantOverrideCopy.resetAll}
                        </Button>
                    </div>

                    {loadingOverrides ? (
                        <div className="flex items-center justify-center py-8 text-gray-500">
                            <Loader2 className="w-5 h-5 animate-spin mr-2" />
                            {t.admin.platformSettings.common.loading}
                        </div>
                    ) : overrideRows.length === 0 ? (
                        <p className="text-sm text-gray-500 py-4">{tenantOverrideCopy.empty}</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b text-left text-gray-500">
                                        <th className="py-2 pr-4 font-semibold">{tenantOverrideCopy.columns.tenant}</th>
                                        <th className="py-2 pr-4 font-semibold">{tenantOverrideCopy.columns.kind}</th>
                                        <th className="py-2 font-semibold">{tenantOverrideCopy.columns.updated}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {overrideRows.map((row) => (
                                        <tr key={row.tenantId} className="border-b border-gray-50">
                                            <td className="py-2 pr-4 font-medium text-gray-900">{row.tenantName}</td>
                                            <td className="py-2 pr-4 text-gray-600">
                                                {row.kind === 'custom'
                                                    ? tenantOverrideCopy.kinds.custom
                                                    : tenantOverrideCopy.kinds.pinned_default}
                                            </td>
                                            <td className="py-2 text-gray-500">
                                                {new Date(row.updatedAt).toLocaleString()}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </PageShell>
    );
}