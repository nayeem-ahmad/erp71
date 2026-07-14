'use client';

import { useEffect, useState } from 'react';
import { Database, Trash2, PackageOpen, AlertTriangle } from 'lucide-react';
import { api, fetchWithAuth } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { isOwner } from '@/lib/permissions';
import { toast } from '@/lib/toast';
import { Alert, Button, Input, PageShell } from '@/components/ui';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';

/* ------------------------------------------------------------------ */
/*  Confirmation dialog                                                */
/* ------------------------------------------------------------------ */

function ConfirmDialog({
    open,
    prompt,
    expected,
    loading,
    onConfirm,
    onCancel,
    danger,
}: {
    open: boolean;
    prompt: string;
    expected: string;
    loading: boolean;
    onConfirm: () => void;
    onCancel: () => void;
    danger?: boolean;
}) {
    const [value, setValue] = useState('');

    useEffect(() => {
        if (open) setValue('');
    }, [open]);

    if (!open) return null;

    const lines = prompt.split('\n\n');
    const bodyLines = lines.slice(0, -1).join('\n\n');
    const inputLabel = lines[lines.length - 1];

    return (
        <ModalShell size="sm" onBackdropClick={() => { setValue(''); onCancel(); }}>
            <ModalHeader
                title="Confirm"
                onClose={() => { setValue(''); onCancel(); }}
            />
            <div className="p-6 space-y-4">
                <div className="flex items-start gap-3">
                    <div className={`mt-0.5 p-2 rounded-md ${danger ? 'bg-red-100' : 'bg-amber-100'}`}>
                        <AlertTriangle className={`w-5 h-5 ${danger ? 'text-red-600' : 'text-amber-600'}`} />
                    </div>
                    <div className="space-y-2 flex-1">
                        <p className="text-sm text-gray-700 whitespace-pre-line">{bodyLines}</p>
                        <p className="text-sm font-semibold text-gray-800">{inputLabel}</p>
                        <Input
                            type="text"
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            placeholder={`Type "${expected}"`}
                            className="font-mono"
                            autoFocus
                        />
                    </div>
                </div>
            </div>
            <ModalFooter>
                <Button
                    variant="ghost"
                    onClick={() => { setValue(''); onCancel(); }}
                    disabled={loading}
                >
                    Cancel
                </Button>
                <Button
                    variant={danger ? 'danger' : 'primary'}
                    onClick={onConfirm}
                    disabled={value.trim().toLowerCase() !== expected || loading}
                    loading={loading}
                    className={!danger ? '!bg-amber-600 hover:!bg-amber-700' : undefined}
                >
                    {loading ? 'Clearing…' : 'Confirm'}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function DataManagementPage() {
    const { t } = useI18n();
    const dm = t.settingsExtras.dataManagement;

    const [role, setRole] = useState<string | null>(null);
    const [loadingDemo, setLoadingDemo] = useState(false);
    const [clearingMode, setClearingMode] = useState<'transactions' | 'all' | null>(null);
    const [dialog, setDialog] = useState<{ mode: 'transactions' | 'all' } | null>(null);

    useEffect(() => {
        api.getMe().then((me: any) => {
            const tenantId = typeof window !== 'undefined' ? localStorage.getItem('tenant_id') : null;
            const tenant = me?.tenants?.find((entry: any) => entry.id === tenantId) ?? me?.tenants?.[0];
            setRole(tenant?.role ?? null);
        }).catch(() => null);
    }, []);

    const owner = isOwner(role);

    const handleLoadDemo = async () => {
        setLoadingDemo(true);
        try {
            const res = await fetchWithAuth('/tenants/demo-data', { method: 'POST' });
            toast.success(
                dm.demoData.success
                    .replace('{products}', String(res.productsUpserted))
                    .replace('{customers}', String(res.customersUpserted))
                    .replace('{sales}', String(res.salesCreated)),
            );
        } catch (err: any) {
            toast.error(err?.message || dm.demoData.failed);
        } finally {
            setLoadingDemo(false);
        }
    };

    const handleClear = async () => {
        if (!dialog) return;
        setClearingMode(dialog.mode);
        try {
            await fetchWithAuth(`/tenants/data?mode=${dialog.mode}`, { method: 'DELETE' });
            toast.success(dialog.mode === 'all' ? dm.clearData.clearedAll : dm.clearData.clearedTransactions);
            setDialog(null);
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
                            <Button
                                onClick={handleLoadDemo}
                                disabled={loadingDemo}
                                loading={loadingDemo}
                                icon={!loadingDemo ? <Database className="w-4 h-4" /> : undefined}
                            >
                                {loadingDemo ? dm.demoData.loading : dm.demoData.button}
                            </Button>
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
                                        onClick={() => setDialog({ mode: 'transactions' })}
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
                                        onClick={() => setDialog({ mode: 'all' })}
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

            <ConfirmDialog
                open={!!dialog}
                prompt={dialog?.mode === 'all' ? dm.clearData.allConfirm : dm.clearData.transactionsConfirm}
                expected={dialog?.mode === 'all' ? dm.clearData.confirmAll : dm.clearData.confirmTransactions}
                loading={!!clearingMode}
                onConfirm={handleClear}
                onCancel={() => setDialog(null)}
                danger={dialog?.mode === 'all'}
            />
        </PageShell>
    );
}
