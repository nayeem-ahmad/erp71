'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Database, Trash2, PackageOpen } from 'lucide-react';
import { api, fetchWithAuth } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { isOwner } from '@/lib/permissions';
import { toast } from '@/lib/toast';
import { Alert, Button, ConfirmDialog, PageShell } from '@/components/ui';

interface DemoBatch {
    status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
    phase?: string | null;
    processed: number;
    total: number;
    batch_number: number;
    error?: string | null;
}

/** Number of completed demo-data loads, given the tenant's latest batch. */
function getCompletedLoads(batch: DemoBatch | null): number {
    if (!batch) return 0;
    return batch.status === 'COMPLETED' ? batch.batch_number : batch.batch_number - 1;
}

export default function DataManagementPage() {
    const { t } = useI18n();
    const dm = t.settingsExtras.dataManagement;

    const [role, setRole] = useState<string | null>(null);
    const [clearingMode, setClearingMode] = useState<'transactions' | 'all' | null>(null);
    const [clearDialog, setClearDialog] = useState<{ mode: 'transactions' | 'all' } | null>(null);

    const [demoBatch, setDemoBatch] = useState<DemoBatch | null>(null);
    const [demoConfirm, setDemoConfirm] = useState(false);
    const [demoStarting, setDemoStarting] = useState(false);
    const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const owner = isOwner(role);
    const running = demoBatch?.status === 'RUNNING' || demoBatch?.status === 'PENDING' || demoStarting;
    // "N previous loads": the latest completed batch number, or one less if a
    // load is currently in flight.
    const completedLoads = getCompletedLoads(demoBatch);

    const fetchStatus = useCallback(async (): Promise<DemoBatch | null> => {
        try {
            return (await fetchWithAuth('/tenants/demo-data/status')) as DemoBatch | null;
        } catch {
            return null;
        }
    }, []);

    const poll = useCallback(async () => {
        const batch = await fetchStatus();
        setDemoBatch(batch);
        if (batch && (batch.status === 'RUNNING' || batch.status === 'PENDING')) {
            pollTimer.current = setTimeout(poll, 2000);
        } else if (batch?.status === 'COMPLETED') {
            toast.success(dm.demoData.completed);
        } else if (batch?.status === 'FAILED') {
            toast.error(batch.error || dm.demoData.failed);
        }
    }, [fetchStatus, dm.demoData.completed, dm.demoData.failed]);

    useEffect(() => {
        api.getMe().then((me: any) => {
            const tenantId = typeof window !== 'undefined' ? localStorage.getItem('tenant_id') : null;
            const tenant = me?.tenants?.find((entry: any) => entry.id === tenantId) ?? me?.tenants?.[0];
            setRole(tenant?.role ?? null);
        }).catch(() => null);

        // Resume polling if a load is already in flight (e.g. after a refresh).
        fetchStatus().then((batch) => {
            setDemoBatch(batch);
            if (batch && (batch.status === 'RUNNING' || batch.status === 'PENDING')) {
                pollTimer.current = setTimeout(poll, 2000);
            }
        });

        return () => { if (pollTimer.current) clearTimeout(pollTimer.current); };
    }, [fetchStatus, poll]);

    const startDemo = async () => {
        setDemoConfirm(false);
        setDemoStarting(true);
        try {
            await fetchWithAuth('/tenants/demo-data', { method: 'POST' });
            const batch = await fetchStatus();
            setDemoBatch(batch);
            pollTimer.current = setTimeout(poll, 2000);
        } catch (err: any) {
            // A 409 means a load is already running — recover by resuming polling
            // rather than surfacing a hard error.
            const batch = await fetchStatus();
            if (batch && (batch.status === 'RUNNING' || batch.status === 'PENDING')) {
                setDemoBatch(batch);
                toast.error(dm.demoData.alreadyRunning);
                pollTimer.current = setTimeout(poll, 2000);
            } else {
                toast.error(err?.message || dm.demoData.failed);
            }
        } finally {
            setDemoStarting(false);
        }
    };

    const handleClear = async () => {
        if (!clearDialog) return;
        setClearingMode(clearDialog.mode);
        try {
            await fetchWithAuth(`/tenants/data?mode=${clearDialog.mode}`, { method: 'DELETE' });
            toast.success(clearDialog.mode === 'all' ? dm.clearData.clearedAll : dm.clearData.clearedTransactions);
            setClearDialog(null);
            setDemoBatch(null); // Clear Data also resets the demo-batch history.
        } catch (err: any) {
            toast.error(err?.message || dm.clearData.failed);
        } finally {
            setClearingMode(null);
        }
    };

    const progressPct = demoBatch && demoBatch.total > 0
        ? Math.min(100, Math.round((demoBatch.processed / demoBatch.total) * 100))
        : 0;

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
                        {/* Load Demo Data */}
                        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 space-y-4">
                            <div className="flex items-start gap-3">
                                <div className="p-2 rounded-md bg-blue-50 mt-0.5">
                                    <PackageOpen className="w-5 h-5 text-blue-600" />
                                </div>
                                <div className="flex-1 space-y-1">
                                    <h2 className="text-base font-bold text-gray-900">{dm.demoData.title}</h2>
                                    <p className="text-sm text-gray-500">{dm.demoData.description}</p>
                                </div>
                            </div>

                            {running ? (
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between text-sm">
                                        <span className="font-medium text-gray-700">
                                            {demoBatch?.phase || dm.demoData.generating}
                                        </span>
                                        {demoBatch && demoBatch.total > 0 && (
                                            <span className="text-gray-500">
                                                {dm.demoData.progress
                                                    .replace('{processed}', String(demoBatch.processed))
                                                    .replace('{total}', String(demoBatch.total))}
                                            </span>
                                        )}
                                    </div>
                                    <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
                                        <div
                                            className="h-full bg-blue-600 transition-all duration-500"
                                            style={{ width: `${progressPct}%` }}
                                        />
                                    </div>
                                </div>
                            ) : (
                                <Button
                                    onClick={() => setDemoConfirm(true)}
                                    icon={<Database className="w-4 h-4" />}
                                >
                                    {dm.demoData.button}
                                </Button>
                            )}
                        </div>

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

            {/* Load Demo Data confirmation (plain confirm — no type-to-confirm) */}
            <ConfirmDialog
                open={demoConfirm}
                title={dm.demoData.confirmTitle}
                prompt={completedLoads > 0
                    ? dm.demoData.confirmAppend.replace('{count}', String(completedLoads))
                    : dm.demoData.confirmFirst}
                confirmLabel={dm.demoData.confirmButton}
                cancelLabel={dm.dialog.cancel}
                loading={demoStarting}
                onConfirm={startDemo}
                onCancel={() => setDemoConfirm(false)}
            />

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
