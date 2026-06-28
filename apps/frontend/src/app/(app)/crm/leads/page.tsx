'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { UserPlus, Plus, RefreshCw, Search } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';

interface Lead {
    id: string;
    name: string;
    phone: string;
    email: string | null;
    source: string;
    status: string;
    last_contacted_at: string | null;
    assignee: { id: string; name: string } | null;
}

const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'LOST', 'CONVERTED'] as const;
const LEAD_SOURCES = ['WALK_IN', 'PHONE', 'FACEBOOK', 'REFERRAL', 'WEBSITE', 'OTHER'] as const;

const columnHelper = createColumnHelper<Lead>();

export default function LeadsPage() {
    const { t } = useI18n();
    const m = t.crm.leads;
    const [leads, setLeads] = useState<Lead[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [sourceFilter, setSourceFilter] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({ name: '', phone: '', email: '', source: 'OTHER', notes: '' });

    const loadLeads = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.getLeads({
                search: search || undefined,
                status: statusFilter || undefined,
                source: sourceFilter || undefined,
                limit: 100,
            });
            setLeads(data?.items ?? data ?? []);
        } catch {
            setLeads([]);
        } finally {
            setLoading(false);
        }
    }, [search, statusFilter, sourceFilter]);

    useEffect(() => { void loadLeads(); }, [loadLeads]);

    const createLead = async () => {
        if (!form.name.trim() || !form.phone.trim()) return;
        setSaving(true);
        try {
            await api.createLead({
                name: form.name.trim(),
                phone: form.phone.trim(),
                email: form.email.trim() || undefined,
                source: form.source,
                notes: form.notes.trim() || undefined,
            });
            setShowModal(false);
            setForm({ name: '', phone: '', email: '', source: 'OTHER', notes: '' });
            await loadLeads();
        } catch {
            alert(m.createFailed);
        } finally {
            setSaving(false);
        }
    };

    const statusLabel = (status: string) => (m.statuses as Record<string, string>)[status] ?? status;
    const sourceLabel = (source: string) => (m.sources as Record<string, string>)[source] ?? source;

    const columns: ColumnDef<Lead, any>[] = useMemo(() => [
        columnHelper.accessor('name', {
            header: m.columns.name,
            cell: (info) => (
                <Link href={routes.crm.leadDetail(info.row.original.id)} className="font-semibold text-gray-900 hover:text-violet-600">
                    {info.getValue()}
                </Link>
            ),
        }),
        columnHelper.accessor('phone', { header: m.columns.phone }),
        columnHelper.accessor('source', {
            header: m.columns.source,
            cell: (info) => sourceLabel(info.getValue()),
        }),
        columnHelper.accessor('status', {
            header: m.columns.status,
            cell: (info) => (
                <span className="text-xs font-semibold px-2 py-1 rounded-full bg-violet-50 text-violet-700">
                    {statusLabel(info.getValue())}
                </span>
            ),
        }),
        columnHelper.accessor('last_contacted_at', {
            header: m.columns.lastContact,
            cell: (info) => info.getValue() ? formatDate(info.getValue() as string) : '—',
        }),
        columnHelper.accessor('assignee', {
            header: m.columns.assigned,
            cell: (info) => info.getValue()?.name ?? '—',
        }),
    ], [m, statusLabel, sourceLabel]);

    return (
        <div className="p-6 w-full">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                        <UserPlus className="w-7 h-7 text-violet-600" />
                        {m.title}
                    </h1>
                    <p className="text-gray-500 text-sm mt-1">{m.subtitle}</p>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={loadLeads} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
                        <RefreshCw className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => setShowModal(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-semibold hover:bg-violet-700"
                    >
                        <Plus className="w-4 h-4" /> {m.newLead}
                    </button>
                </div>
            </div>

            <div className="flex flex-wrap gap-3 mb-4">
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={m.searchPlaceholder}
                        className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm"
                    />
                </div>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
                    <option value="">{m.allStatuses}</option>
                    {LEAD_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                </select>
                <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
                    <option value="">{m.allSources}</option>
                    {LEAD_SOURCES.map((s) => <option key={s} value={s}>{sourceLabel(s)}</option>)}
                </select>
            </div>

            <DataTable<Lead>
                tableId="crm-leads"
                title={m.title}
                data={leads}
                columns={columns}
                isLoading={loading}
                emptyMessage={m.emptyMessage}
            />

            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
                        <h2 className="text-lg font-bold">{m.newLead}</h2>
                        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={m.columns.name} className="w-full border rounded-lg px-3 py-2 text-sm" />
                        <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder={m.columns.phone} className="w-full border rounded-lg px-3 py-2 text-sm" />
                        <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Email" className="w-full border rounded-lg px-3 py-2 text-sm" />
                        <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
                            {LEAD_SOURCES.map((s) => <option key={s} value={s}>{sourceLabel(s)}</option>)}
                        </select>
                        <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder={m.detail.notes} className="w-full border rounded-lg px-3 py-2 text-sm" rows={3} />
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm border rounded-lg">Cancel</button>
                            <button onClick={createLead} disabled={saving} className="px-4 py-2 text-sm bg-violet-600 text-white rounded-lg disabled:opacity-50">
                                {saving ? '...' : m.newLead}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}