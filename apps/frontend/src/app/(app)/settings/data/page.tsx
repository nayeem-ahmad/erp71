'use client';

import { useEffect, useState } from 'react';
import { Trash2, PlugZap } from 'lucide-react';
import Link from 'next/link';
import { api, fetchWithAuth } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { isOwner } from '@/lib/permissions';
import { usePlatformFeatures } from '@/contexts/PlatformFeaturesContext';
import { toast } from '@/lib/toast';
import { Alert, Button, ConfirmDialog, PageShell } from '@/components/ui';
import { getWorkspaceItem } from '@/lib/session-store';
import DemoDataCard from './DemoDataCard';

export default function DataManagementPage() {
    const { t } = useI18n();
    const dm = t.settingsExtras.dataManagement;

    const [role, setRole] = useState<string | null>(null);
    const [clearingMode, setClearingMode] = useState<'transactions' | 'all' | null>(null);
    const [clearDialog, setClearDialog] = useState<{ mode: 'transactions' | 'all' } | null>(null);

    // Bumped after a clear so the demo card remounts and refetches: clearing
    // wipes the batch history the card is showing.
    const [demoCardKey, setDemoCardKey] = useState(0);

    const owner = isOwner(role);
    // Per-tenant switch: the import only appears for workspaces we have
    // enabled it for, and only for the owner.
    const { externalImport } = usePlatformFeatures();

    useEffect(() => {
        api.getMe().then((me: any) => {
            const tenantId = typeof window !== 'undefined' ? getWorkspaceItem('tenant_id') : null;
            const tenant = me?.tenants?.find((entry: any) => entry.id === tenantId) ?? me?.tenants?.[0];
            setRole(tenant?.role ?? null);
        }).catch(() => null);
    }, []);

    const handleClear = async () => {
        if (!clearDialog) return;
        setClearingMode(clearDialog.mode);
        try {
            await fetchWithAuth(`/tenants/data?mode=${clearDialog.mode}`, { method: 'DELETE' });
            toast.success(clearDialog.mode === 'all' ? dm.clearData.clearedAll : dm.clearData.clearedTransactions);
            setClearDialog(null);
            setDemoCardKey((key) => key + 1); // Clear Data also resets the demo-batch history.
        } catch (err: any) {
            toast.error(err?.message || dm.clearData.failed);
        } finally {
            setClearingMode(null);
        }
    };

    return (
        <PageShell maxWidth="full">
            <PageHeader
                title={dm.title}
                subtitle={dm.description}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accountSettings,
                    dm.title,
                    'settings',
                )}
            />

            <div className="mt-4">
                {!owner ? (
                    <Alert tone="warning">{dm.ownerOnly}</Alert>
                ) : (
                    <div className="space-y-4">
                        {externalImport ? (
                            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 space-y-4">
                                <div className="flex items-start gap-3">
                                    <div className="p-2 rounded-md bg-blue-50 mt-0.5">
                                        <PlugZap className="w-5 h-5 text-blue-600" />
                                    </div>
                                    <div className="flex-1 space-y-1">
                                        <h2 className="text-base font-bold text-gray-900">Import from another ERP</h2>
                                        <p className="text-sm text-gray-500">
                                            Bring your sales and purchase history across from Express Retail Pro. You
                                            can preview an import before anything is written.
                                        </p>
                                    </div>
                                </div>
                                <Link
                                    href="/settings/data/external-import"
                                    className="inline-flex min-h-touch items-center gap-2 rounded-lg border border-blue-200 bg-white px-5 py-3 text-sm font-semibold text-blue-700 transition hover:bg-blue-50"
                                >
                                    <PlugZap className="w-4 h-4" />
                                    Set up import
                                </Link>
                            </div>
                        ) : null}

                        <DemoDataCard key={demoCardKey} />

                        {/* Clear Data */}
                        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 space-y-5">
                            <div className="flex items-start gap-3">
                                <div className="p-2 rounded-md bg-red-50 mt-0.5">
                                    <Trash2 className="w-5 h-5 text-red-600" />
                                </div>
                                <div className="flex-1 space-y-1">
                                    <h2 className="text-base font-bold text-gray-900">{dm.clearData.title}</h2>
                                    <p className="text-sm text-gray-500">{dm.clearData.description}</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {/* Transactions only */}
                                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
                                    <div>
                                        <p className="text-sm font-bold text-amber-900">{dm.clearData.transactionsTitle}</p>
                                        <p className="text-xs text-amber-700 mt-1">{dm.clearData.transactionsDesc}</p>
                                    </div>
                                    <Button
                                        variant="secondary"
                                        onClick={() => setClearDialog({ mode: 'transactions' })}
                                        disabled={!!clearingMode}
                                        loading={clearingMode === 'transactions'}
                                        icon={clearingMode !== 'transactions' ? <Trash2 className="w-3.5 h-3.5" /> : undefined}
                                        className="!border-amber-400 !text-amber-700 hover:!bg-amber-100"
                                    >
                                        {dm.clearData.transactionsButton}
                                    </Button>
                                </div>

                                {/* All data */}
                                <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-3">
                                    <div>
                                        <p className="text-sm font-bold text-red-900">{dm.clearData.allTitle}</p>
                                        <p className="text-xs text-red-700 mt-1">{dm.clearData.allDesc}</p>
                                    </div>
                                    <Button
                                        variant="secondary"
                                        onClick={() => setClearDialog({ mode: 'all' })}
                                        disabled={!!clearingMode}
                                        loading={clearingMode === 'all'}
                                        icon={clearingMode !== 'all' ? <Trash2 className="w-3.5 h-3.5" /> : undefined}
                                        className="!border-red-400 !text-red-700 hover:!bg-red-100"
                                    >
                                        {dm.clearData.allButton}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Clear Data confirmation (type-to-confirm) */}
            <ConfirmDialog
                open={!!clearDialog}
                title={dm.dialog.title}
                prompt={clearDialog?.mode === 'all' ? dm.clearData.allConfirm : dm.clearData.transactionsConfirm}
                expected={clearDialog?.mode === 'all' ? dm.clearData.confirmAll : dm.clearData.confirmTransactions}
                typePromptTemplate={dm.dialog.typePrompt}
                confirmLabel={dm.dialog.confirm}
                cancelLabel={dm.dialog.cancel}
                workingLabel={dm.clearData.clearing}
                loading={!!clearingMode}
                danger={clearDialog?.mode === 'all'}
                onConfirm={handleClear}
                onCancel={() => setClearDialog(null)}
            />
        </PageShell>
    );
}
