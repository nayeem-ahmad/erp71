'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { ArrowDownLeft, ArrowUpRight, CheckCircle, Loader2, Plus } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { DataTable } from '@/components/data-table';
import TenantLedgerPaymentModal from '@/components/admin/tenants/TenantLedgerPaymentModal';
import { withRunningBalances } from '@/components/admin/tenants/ledger-utils';
import type { LedgerEvent, TenantRecord } from '@/components/admin/tenants/types';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';

const columnHelper = createColumnHelper<LedgerEvent>();

export default function AdminTenantLedgerPage() {
    const { t } = useI18n();
    const m = t.admin.tenants;
    const lp = m.ledgerPage;
    const ml = m.ledger;

    const [tenants, setTenants] = useState<TenantRecord[]>([]);
    const [tenantFilter, setTenantFilter] = useState('');
    const [events, setEvents] = useState<LedgerEvent[]>([]);
    const [error, setError] = useState('');
    const [toast, setToast] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [paymentModalOpen, setPaymentModalOpen] = useState(false);

    const loadLedger = useCallback(async () => {
        setIsLoading(true);
        setError('');
        try {
            const rows = await api.getAdminTenantLedger({
                tenantId: tenantFilter || undefined,
            });
            setEvents(withRunningBalances(rows));
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : ml.loadFailed);
        } finally {
            setIsLoading(false);
        }
    }, [ml.loadFailed, tenantFilter]);

    useEffect(() => {
        api.getAdminTenants({})
            .then((rows) => setTenants(rows))
            .catch(() => null);
    }, []);

    useEffect(() => {
        void loadLedger();
    }, [loadLedger]);

    const showToast = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(''), 3500);
    };

    const columns: ColumnDef<LedgerEvent, unknown>[] = useMemo(() => [
        columnHelper.accessor('created_at', {
            header: ml.columns.date,
            cell: (info) => formatDate(info.getValue()),
        }),
        columnHelper.accessor('tenant_name', {
            header: lp.columns.tenant,
            cell: (info) => info.getValue() ?? '—',
        }),
        columnHelper.accessor('event_type', {
            header: ml.columns.type,
            cell: (info) => {
                const type = info.getValue();
                const isCredit = ['manual_payment', 'sms_credit_sale_payment', 'ai_credit_sale_payment'].includes(type);
                const isDebit = ['manual_refund', 'subscription_fee'].includes(type);
                return (
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${isCredit ? 'bg-emerald-100 text-emerald-700' : isDebit ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                        {isCredit ? <ArrowDownLeft className="w-2.5 h-2.5" /> : isDebit ? <ArrowUpRight className="w-2.5 h-2.5" /> : null}
                        {(ml.eventType as Record<string, string>)[type] ?? type}
                    </span>
                );
            },
        }),
        columnHelper.accessor('amount', {
            header: ml.columns.amount,
            cell: (info) => {
                const row = info.row.original;
                const isCredit = ['manual_payment', 'sms_credit_sale_payment', 'ai_credit_sale_payment'].includes(row.event_type);
                const value = info.getValue();
                return (
                    <span className={`font-black ${isCredit ? 'text-emerald-700' : 'text-amber-700'}`}>
                        {value !== null ? `৳${Number(value).toFixed(2)}` : '—'}
                    </span>
                );
            },
        }),
        columnHelper.accessor('running_balance', {
            header: lp.columns.runningBalance,
            cell: (info) => {
                const value = info.getValue();
                return value !== undefined ? `৳${Number(value).toFixed(2)}` : '—';
            },
        }),
        columnHelper.accessor((row) => (row.payload as Record<string, unknown> | null)?.notes as string | undefined, {
            id: 'notes',
            header: ml.columns.notes,
            cell: (info) => <span className="text-gray-500">{info.getValue() || '—'}</span>,
        }),
    ], [lp.columns, ml.columns, ml.eventType]);

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="w-full space-y-4">
                <PageHeader
                    title={lp.title}
                    subtitle={lp.subtitle}
                    breadcrumbs={nestedPageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.admin,
                        'admin',
                        [{ label: m.title, href: '/admin/tenants' }],
                        lp.title,
                    )}
                    actions={(
                        <button
                            type="button"
                            onClick={() => setPaymentModalOpen(true)}
                            className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-black text-white shadow-lg shadow-emerald-200 hover:bg-emerald-700"
                        >
                            <Plus className="w-4 h-4" />
                            {lp.recordPayment}
                        </button>
                    )}
                />

                {toast && (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-2 text-sm font-semibold text-emerald-700">
                        <CheckCircle className="w-4 h-4 shrink-0" /> {toast}
                    </div>
                )}

                {error && (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                        {error}
                    </div>
                )}

                <div className="max-w-md">
                    <select
                        value={tenantFilter}
                        onChange={(e) => setTenantFilter(e.target.value)}
                        className="w-full rounded-2xl border border-gray-100 bg-white px-4 py-3 text-sm font-medium outline-none"
                    >
                        <option value="">{lp.allTenants}</option>
                        {tenants.map((tenant) => (
                            <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
                        ))}
                    </select>
                </div>

                {isLoading ? (
                    <div className="flex items-center gap-2 rounded-3xl border border-gray-100 bg-white p-8 text-sm text-gray-500">
                        <Loader2 className="w-4 h-4 animate-spin" /> {m.loading}
                    </div>
                ) : (
                    <DataTable
                        tableId="admin-tenant-ledger"
                        columns={columns}
                        data={events}
                        title={lp.title}
                        emptyMessage={ml.noEvents}
                    />
                )}
            </div>

            <TenantLedgerPaymentModal
                open={paymentModalOpen}
                tenants={tenants}
                defaultTenantId={tenantFilter}
                onClose={() => setPaymentModalOpen(false)}
                onSuccess={(message) => {
                    showToast(message);
                    void loadLedger();
                }}
            />
        </div>
    );
}