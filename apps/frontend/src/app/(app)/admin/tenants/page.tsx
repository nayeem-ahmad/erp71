'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Loader2, MessageSquare, Pencil, Plus, Sparkles } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell, Button } from '@/components/ui';
import { toast } from '@/lib/toast';
import { DataTable } from '@/components/data-table';
import CreateTenantModal from '@/components/admin/tenants/CreateTenantModal';
import TenantDetailModal from '@/components/admin/tenants/TenantDetailModal';
import TenantSellCreditsModal from '@/components/admin/tenants/TenantSellCreditsModal';
import type { TenantRecord } from '@/components/admin/tenants/types';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';

const columnHelper = createColumnHelper<TenantRecord>();

export default function AdminTenantsPage() {
    const { t } = useI18n();
    const m = t.admin.tenants;
    const [tenants, setTenants] = useState<TenantRecord[]>([]);
    const [search, setSearch] = useState('');
    const [planCode, setPlanCode] = useState('');
    const [status, setStatus] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [detailTenantId, setDetailTenantId] = useState<string | null>(null);
    const [sellCreditsTenant, setSellCreditsTenant] = useState<TenantRecord | null>(null);
    const [sellCreditsKind, setSellCreditsKind] = useState<'sms' | 'ai'>('sms');

    const loadTenants = useCallback(async () => {
        setIsLoading(true);
        setError('');
        try {
            const rows = await api.getAdminTenants({
                search: search || undefined,
                planCode: planCode || undefined,
                status: status || undefined,
            });
            setTenants(rows);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : m.loadFailed);
        } finally {
            setIsLoading(false);
        }
    }, [m.loadFailed, planCode, search, status]);

    useEffect(() => {
        void loadTenants();
    }, [loadTenants]);

    const columns: ColumnDef<TenantRecord, unknown>[] = useMemo(() => [
        columnHelper.accessor('name', {
            header: m.columns.name,
            cell: (info) => <span className="font-semibold text-gray-900">{info.getValue()}</span>,
        }),
        columnHelper.accessor((row) => row.owner?.email ?? m.noOwner, {
            id: 'owner',
            header: m.columns.owner,
            cell: (info) => <span className="text-gray-600">{info.getValue()}</span>,
        }),
        columnHelper.accessor((row) => row.subscription?.plan.code ?? '—', {
            id: 'plan',
            header: m.columns.plan,
            cell: (info) => <span className="font-medium">{info.getValue()}</span>,
        }),
        columnHelper.accessor((row) => row.subscription?.status ?? m.unassigned, {
            id: 'subscriptionStatus',
            header: m.columns.status,
            cell: (info) => <span className="text-gray-600">{info.getValue()}</span>,
        }),
        columnHelper.accessor('store_count', {
            header: m.columns.stores,
            cell: (info) => info.getValue(),
        }),
        columnHelper.accessor('user_count', {
            header: m.columns.users,
            cell: (info) => info.getValue(),
        }),
        columnHelper.accessor('ledger_balance', {
            header: m.columns.ledgerBalance,
            cell: (info) => {
                const value = info.getValue() ?? 0;
                return <span className={`font-semibold ${value < 0 ? 'text-amber-700' : 'text-emerald-700'}`}>৳{Number(value).toFixed(2)}</span>;
            },
        }),
        columnHelper.accessor('sms_credits', {
            header: m.columns.smsCredits,
            cell: (info) => info.getValue() ?? 0,
        }),
        columnHelper.accessor((row) => row.ai_credits?.remaining ?? 0, {
            id: 'aiCredits',
            header: m.columns.aiCredits,
            cell: (info) => {
                const row = info.row.original;
                const remaining = row.ai_credits?.remaining ?? 0;
                const limit = row.ai_credits?.limit ?? 0;
                return <span>{remaining} / {limit}</span>;
            },
        }),
        columnHelper.accessor('created_at', {
            header: m.columns.created,
            cell: (info) => formatDate(info.getValue()),
        }),
        columnHelper.display({
            id: 'actions',
            header: m.columns.actions,
            cell: ({ row }) => {
                const tenant = row.original;
                return (
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => setDetailTenantId(tenant.id)}
                            className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white p-2 text-gray-600 hover:border-blue-300 hover:text-blue-600"
                            title={m.actions.viewEdit}
                            aria-label={m.actions.viewEdit}
                        >
                            <Pencil className="w-4 h-4" />
                        </button>
                        <button
                            type="button"
                            onClick={() => { setSellCreditsTenant(tenant); setSellCreditsKind('sms'); }}
                            className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white p-2 text-gray-600 hover:border-primary-border hover:text-blue-700"
                            title={m.actions.sellSmsCredits}
                            aria-label={m.actions.sellSmsCredits}
                        >
                            <MessageSquare className="w-4 h-4" />
                        </button>
                        <button
                            type="button"
                            onClick={() => { setSellCreditsTenant(tenant); setSellCreditsKind('ai'); }}
                            className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white p-2 text-gray-600 hover:border-violet-300 hover:text-violet-600"
                            title={m.actions.sellAiCredits}
                            aria-label={m.actions.sellAiCredits}
                        >
                            <Sparkles className="w-4 h-4" />
                        </button>
                    </div>
                );
            },
        }),
    ], [m]);

    return (
        <PageShell>
                <PageHeader
                    title={m.listTitle}
                    subtitle={m.listSubtitle}
                    breadcrumbs={nestedPageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.admin,
                        'admin',
                        [{ label: m.title, href: '/admin/tenants' }],
                        m.listTitle,
                    )}
                    actions={(
                        <Button
                            onClick={() => setShowCreateModal(true)}
                            icon={<Plus className="w-4 h-4" />}
                            className="shrink-0"
                        >
                            {m.createModal.trigger}
                        </Button>
                    )}
                />

                {error && (
                    <div className="rounded-md border border-danger bg-danger-light px-4 py-3 text-sm font-semibold text-danger-text">
                        {error}
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder={m.searchPlaceholder}
                        className="rounded-md border border-gray-100 bg-white px-4 py-3 text-sm outline-none"
                    />
                    <select value={planCode} onChange={(event) => setPlanCode(event.target.value)} className="rounded-md border border-gray-100 bg-white px-4 py-3 text-sm font-medium outline-none">
                        <option value="">{m.allPlans}</option>
                        <option value="FREE">{m.plans.free}</option>
                        <option value="BASIC">{m.plans.basic}</option>
                        <option value="ACCOUNTING">{m.plans.accounting}</option>
                        <option value="STANDARD">{m.plans.standard}</option>
                        <option value="PREMIUM">{m.plans.premium}</option>
                    </select>
                    <select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-md border border-gray-100 bg-white px-4 py-3 text-sm font-medium outline-none">
                        <option value="">{m.allStatuses}</option>
                        <option value="ACTIVE">{m.statuses.active}</option>
                        <option value="TRIALING">{m.statuses.trialing}</option>
                        <option value="PAST_DUE">{m.statuses.pastDue}</option>
                        <option value="CANCELLED">{m.statuses.cancelled}</option>
                    </select>
                </div>

                {isLoading ? (
                    <div className="flex items-center gap-2 rounded-lg border border-gray-100 bg-white p-8 text-sm text-gray-500">
                        <Loader2 className="w-4 h-4 animate-spin" /> {m.loading}
                    </div>
                ) : (
                    <DataTable
                        tableId="admin-tenants"
                        columns={columns}
                        data={tenants}
                        title={m.listTitle}
                        emptyMessage={m.noResults}
                    />
                )}

            <CreateTenantModal
                open={showCreateModal}
                onClose={() => setShowCreateModal(false)}
                onCreated={(tenantId, tenantName) => {
                    setShowCreateModal(false);
                    toast.success(formatMessage(m.createModal.successToast, { name: tenantName }));
                    void loadTenants();
                    setDetailTenantId(tenantId);
                }}
            />

            <TenantDetailModal
                tenantId={detailTenantId}
                onClose={() => setDetailTenantId(null)}
                onChanged={() => void loadTenants()}
                onToast={(msg) => toast.success(msg)}
            />

            <TenantSellCreditsModal
                open={Boolean(sellCreditsTenant)}
                kind={sellCreditsKind}
                tenant={sellCreditsTenant}
                onClose={() => setSellCreditsTenant(null)}
                onSuccess={(message) => {
                    toast.success(message);
                    void loadTenants();
                }}
            />
        </PageShell>
    );
}