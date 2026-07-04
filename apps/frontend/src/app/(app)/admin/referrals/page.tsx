'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { BookOpen, CheckCircle, Loader2, Pencil, Plus } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { DataTable } from '@/components/data-table';
import RefereeFormModal from '@/components/admin/referrals/RefereeFormModal';
import type { RefereeRecord } from '@/components/admin/referrals/types';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

const columnHelper = createColumnHelper<RefereeRecord>();

export default function AdminReferralsPage() {
    const { t } = useI18n();
    const m = t.admin.referrals;
    const [referees, setReferees] = useState<RefereeRecord[]>([]);
    const [search, setSearch] = useState('');
    const [error, setError] = useState('');
    const [toast, setToast] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [formOpen, setFormOpen] = useState(false);
    const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
    const [selectedReferee, setSelectedReferee] = useState<RefereeRecord | null>(null);

    const load = useCallback(async () => {
        setIsLoading(true);
        setError('');
        try {
            const rows = await api.getAdminReferees();
            setReferees(Array.isArray(rows) ? rows : []);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : m.loadFailed);
        } finally {
            setIsLoading(false);
        }
    }, [m.loadFailed]);

    useEffect(() => {
        void load();
    }, [load]);

    const showToast = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(''), 3500);
    };

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return referees;
        return referees.filter((r) =>
            r.name.toLowerCase().includes(q)
            || r.email.toLowerCase().includes(q)
            || r.referral_code.toLowerCase().includes(q),
        );
    }, [referees, search]);

    const columns: ColumnDef<RefereeRecord, unknown>[] = useMemo(() => [
        columnHelper.accessor('name', {
            header: m.columns.name,
            cell: (info) => <span className="font-semibold text-gray-900">{info.getValue()}</span>,
        }),
        columnHelper.accessor('email', {
            header: m.columns.email,
            cell: (info) => <span className="text-gray-600">{info.getValue()}</span>,
        }),
        columnHelper.accessor('referral_code', {
            header: m.columns.code,
            cell: (info) => (
                <span className="rounded-lg bg-gray-100 px-2 py-1 font-mono text-xs font-bold tracking-wider text-gray-700">
                    {info.getValue()}
                </span>
            ),
        }),
        columnHelper.accessor('signup_discount', {
            header: m.columns.discount,
            cell: (info) => <span>{info.getValue()}%</span>,
        }),
        columnHelper.accessor('commission_rate', {
            header: m.columns.commission,
            cell: (info) => <span>{info.getValue()}%</span>,
        }),
        columnHelper.accessor((row) => row.stats.pending_signups + row.stats.earned_count + row.stats.paid_count, {
            id: 'referrals',
            header: m.columns.referrals,
            cell: (info) => info.getValue(),
        }),
        columnHelper.accessor((row) => row.stats.earned_amount, {
            id: 'earned',
            header: m.columns.earned,
            cell: (info) => <span className="font-semibold text-emerald-700">৳{Number(info.getValue()).toFixed(2)}</span>,
        }),
        columnHelper.accessor((row) => Math.max(0, row.stats.earned_amount - row.stats.paid_amount), {
            id: 'balance',
            header: m.columns.balance,
            cell: (info) => <span className="font-semibold text-amber-700">৳{Number(info.getValue()).toFixed(2)}</span>,
        }),
        columnHelper.accessor('is_active', {
            header: m.columns.status,
            cell: (info) => (
                <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${info.getValue() ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                    {info.getValue() ? m.active : m.inactive}
                </span>
            ),
        }),
        columnHelper.display({
            id: 'actions',
            header: m.columns.actions,
            cell: ({ row }) => (
                <div className="flex items-center gap-2">
                    <Link
                        href={`/admin/referrals/${row.original.id}`}
                        className="inline-flex items-center gap-1 rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                        title={m.actions.viewLedger}
                    >
                        <BookOpen className="w-3.5 h-3.5" />
                        {m.actions.viewLedger}
                    </Link>
                    <button
                        type="button"
                        onClick={() => {
                            setFormMode('edit');
                            setSelectedReferee(row.original);
                            setFormOpen(true);
                        }}
                        className="inline-flex items-center gap-1 rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                        title={m.actions.edit}
                    >
                        <Pencil className="w-3.5 h-3.5" />
                    </button>
                </div>
            ),
        }),
    ], [m]);

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="w-full space-y-4">
            <PageHeader
                title={m.title}
                subtitle={m.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.admin,
                    m.title,
                    'admin',
                )}
                actions={(
                    <button
                        type="button"
                        onClick={() => {
                            setFormMode('create');
                            setSelectedReferee(null);
                            setFormOpen(true);
                        }}
                        className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                    >
                        <Plus className="w-4 h-4" />
                        {m.addReferee}
                    </button>
                )}
            />

            {toast && (
                <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
                    <CheckCircle className="w-4 h-4" />
                    {toast}
                </div>
            )}

            {error && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                    {error}
                </div>
            )}

            <div className="max-w-md">
                <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={m.searchPlaceholder}
                    className="w-full rounded-2xl border border-gray-100 bg-white px-4 py-3 text-sm outline-none"
                />
            </div>

            {isLoading ? (
                <div className="flex items-center gap-2 rounded-3xl border border-gray-100 bg-white p-8 text-sm text-gray-500">
                    <Loader2 className="w-4 h-4 animate-spin" /> {m.loading}
                </div>
            ) : (
                <DataTable
                    tableId="admin-referrals"
                    columns={columns}
                    data={filtered}
                    title={m.title}
                    emptyMessage={m.noReferees}
                />
            )}

            <RefereeFormModal
                open={formOpen}
                mode={formMode}
                referee={selectedReferee}
                onClose={() => setFormOpen(false)}
                onSaved={(message) => {
                    showToast(message);
                    void load();
                }}
            />
            </div>
        </div>
    );
}