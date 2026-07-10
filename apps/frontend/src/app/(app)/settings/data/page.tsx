'use client';

import { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Loader2, Database, Trash2, PackageOpen, AlertTriangle } from 'lucide-react';
import { api, fetchWithAuth } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { isOwner } from '@/lib/permissions';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ToastState = { type: 'success' | 'error'; message: string } | null;

/* ------------------------------------------------------------------ */
/*  Toast                                                              */
/* ------------------------------------------------------------------ */

function Toast({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(onDismiss, 4000);
        return () => clearTimeout(t);
    }, [toast, onDismiss]);

    if (!toast) return null;
    const ok = toast.type === 'success';
    return (
        <div
            className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl px-4 py-3 shadow-lg border text-sm font-semibold transition-all ${
                ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'
            }`}
        >
            {ok ? (
                <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
            ) : (
                <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
            )}
            {toast.message}
        </div>
    );
}

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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-md p-6 space-y-4">
                <div className="flex items-start gap-3">
                    <div className={`mt-0.5 p-2 rounded-xl ${danger ? 'bg-red-100' : 'bg-amber-100'}`}>
                        <AlertTriangle className={`w-5 h-5 ${danger ? 'text-red-600' : 'text-amber-600'}`} />
                    </div>
                    <div className="space-y-2 flex-1">
                        <p className="text-sm text-gray-700 whitespace-pre-line">{bodyLines}</p>
                        <p className="text-sm font-semibold text-gray-800">{inputLabel}</p>
                        <input
                            type="text"
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            placeholder={`Type "${expected}"`}
                            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent font-mono"
                            autoFocus
                        />
                    </div>
                </div>
                <div className="flex gap-2 justify-end">
                    <button
                        onClick={() => { setValue(''); onCancel(); }}
                        disabled={loading}
                        className="px-4 py-2 text-sm font-semibold text-gray-600 hover:text-gray-800 disabled:opacity-60 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={value.trim().toLowerCase() !== expected || loading}
                        className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
                            danger ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'
                        }`}
                    >
                        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                        {loading ? 'Clearing…' : 'Confirm'}
                    </button>
                </div>
            </div>
        </div>
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
    const [toast, setToast] = useState<ToastState>(null);

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
            setToast({
                type: 'success',
                message: dm.demoData.success
                    .replace('{products}', String(res.productsUpserted))
                    .replace('{customers}', String(res.customersUpserted))
                    .replace('{sales}', String(res.salesCreated)),
            });
        } catch (err: any) {
            setToast({ type: 'error', message: err?.message || dm.demoData.failed });
        } finally {
            setLoadingDemo(false);
        }
    };

    const handleClear = async () => {
        if (!dialog) return;
        setClearingMode(dialog.mode);
        try {
            await fetchWithAuth(`/tenants/data?mode=${dialog.mode}`, { method: 'DELETE' });
            setToast({
                type: 'success',
                message: dialog.mode === 'all' ? dm.clearData.clearedAll : dm.clearData.clearedTransactions,
            });
            setDialog(null);
        } catch (err: any) {
            setToast({ type: 'error', message: err?.message || dm.clearData.failed });
        } finally {
            setClearingMode(null);
        }
    };

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="w-full space-y-4">
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

                {!owner ? (
                    <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 flex items-center gap-3 text-sm text-amber-800 font-medium">
                        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                        {dm.ownerOnly}
                    </div>
                ) : (
                    <div className="space-y-4">
                        {/* Load Demo Data */}
                        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4">
                            <div className="flex items-start gap-3">
                                <div className="p-2 rounded-xl bg-blue-50 mt-0.5">
                                    <PackageOpen className="w-5 h-5 text-blue-600" />
                                </div>
                                <div className="flex-1 space-y-1">
                                    <h2 className="text-base font-bold text-gray-900">{dm.demoData.title}</h2>
                                    <p className="text-sm text-gray-500">{dm.demoData.description}</p>
                                </div>
                            </div>
                            <button
                                onClick={handleLoadDemo}
                                disabled={loadingDemo}
                                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
                            >
                                {loadingDemo ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        {dm.demoData.loading}
                                    </>
                                ) : (
                                    <>
                                        <Database className="w-4 h-4" />
                                        {dm.demoData.button}
                                    </>
                                )}
                            </button>
                        </div>

                        {/* Clear Data */}
                        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-5">
                            <div className="flex items-start gap-3">
                                <div className="p-2 rounded-xl bg-red-50 mt-0.5">
                                    <Trash2 className="w-5 h-5 text-red-600" />
                                </div>
                                <div className="flex-1 space-y-1">
                                    <h2 className="text-base font-bold text-gray-900">{dm.clearData.title}</h2>
                                    <p className="text-sm text-gray-500">{dm.clearData.description}</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {/* Transactions only */}
                                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
                                    <div>
                                        <p className="text-sm font-bold text-amber-900">{dm.clearData.transactionsTitle}</p>
                                        <p className="text-xs text-amber-700 mt-1">{dm.clearData.transactionsDesc}</p>
                                    </div>
                                    <button
                                        onClick={() => setDialog({ mode: 'transactions' })}
                                        disabled={!!clearingMode}
                                        className="inline-flex items-center gap-2 rounded-xl border border-amber-400 bg-white px-3 py-2 text-xs font-bold text-amber-700 hover:bg-amber-100 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                                    >
                                        {clearingMode === 'transactions' ? (
                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        ) : (
                                            <Trash2 className="w-3.5 h-3.5" />
                                        )}
                                        {dm.clearData.transactionsButton}
                                    </button>
                                </div>

                                {/* All data */}
                                <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-3">
                                    <div>
                                        <p className="text-sm font-bold text-red-900">{dm.clearData.allTitle}</p>
                                        <p className="text-xs text-red-700 mt-1">{dm.clearData.allDesc}</p>
                                    </div>
                                    <button
                                        onClick={() => setDialog({ mode: 'all' })}
                                        disabled={!!clearingMode}
                                        className="inline-flex items-center gap-2 rounded-xl border border-red-400 bg-white px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                                    >
                                        {clearingMode === 'all' ? (
                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        ) : (
                                            <Trash2 className="w-3.5 h-3.5" />
                                        )}
                                        {dm.clearData.allButton}
                                    </button>
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

            <Toast toast={toast} onDismiss={() => setToast(null)} />
        </div>
    );
}
