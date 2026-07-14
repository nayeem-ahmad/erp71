'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { ArrowDownLeft, ArrowUpRight, Loader2, Plus } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell, Button, StatusBadge } from '@/components/ui';
import { toast } from '@/lib/toast';
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
                const tone = isCredit ? 'success' : isDebit ? 'warning' : 'neutral';
                return (
                    <StatusBadge tone={tone} className="gap-1">
                        {isCredit ? <ArrowDownLeft className="w-2.5 h-2.5" /> : isDebit ? <ArrowUpRight className="w-2.5 h-2.5" /> : null}
                        {(ml.eventType as Record<string, string>)[type] ?? type}
                    </StatusBadge>
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
                    <span className={`font-bold ${isCredit ? 'text-emerald-700' : 'text-amber-700'}`}>
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
        <PageShell>
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
                        <Button onClick={() => setPaymentModalOpen(true)} icon={<Plus className="w-4 h-4" />}>
                            {lp.recordPayment}
                        </Button>
                    )}
                />

                {error && (
                    <div className="rounded-md border border-danger bg-danger-light px-4 py-3 text-sm font-semibold text-danger-text">
                        {error}
                    </div>
                )}

                <div className="max-w-md">
                    <select
                        value={tenantFilter}
                        onChange={(e) => setTenantFilter(e.target.value)}
                        className="w-full rounded-md border border-gray-100 bg-white px-4 py-3 text-sm font-medium outline-none"
                    >
                        <option value="">{lp.allTenants}</option>
                        {tenants.map((tenant) => (
                            <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
                        ))}
                    </select>
                </div>

                {isLoading ? (
                    <div className="flex items-center gap-2 rounded-lg border border-gray-100 bg-white p-8 text-sm text-gray-500">
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

            <TenantLedgerPaymentModal
                open={paymentModalOpen}
                tenants={tenants}
                defaultTenantId={tenantFilter}
                onClose={() => setPaymentModalOpen(false)}
                onSuccess={(message) => {
                    toast.success(message);
                    void loadLedger();
                }}
            />
        </PageShell>
    );
}