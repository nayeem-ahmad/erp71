'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { UserPlus, Plus, RefreshCw, Search, Eye, Pencil, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import {
    LEAD_CATEGORIES,
    LEAD_PRIORITIES,
    LEAD_STATUSES,
    LeadFormFields,
    emptyLeadForm,
    leadFormToPayload,
    leadToFormState,
    validateLeadForm,
    type LeadFormState,
} from './lead-form-fields';

interface Lead {
    id: string;
    name: string;
    mobile: string;
    email: string | null;
    category: string | null;
    priority: string;
    status: string;
    next_step: string | null;
    next_step_date: string | null;
    last_contacted_at: string | null;
    nextStepAssignee: { id: string; name: string } | null;
}

const columnHelper = createColumnHelper<Lead>();

const priorityColors: Record<string, string> = {
    LOW: 'bg-slate-50 text-slate-600',
    MEDIUM: 'bg-blue-50 text-blue-700',
    HIGH: 'bg-amber-50 text-amber-700',
    URGENT: 'bg-rose-50 text-rose-700',
};

type ModalMode = 'create' | 'edit' | null;

export default function LeadsPage() {
    const { t } = useI18n();
    const m = t.crm.leads;
    const c = t.common;
    const [leads, setLeads] = useState<Lead[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('');
    const [priorityFilter, setPriorityFilter] = useState('');
    const [modalMode, setModalMode] = useState<ModalMode>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState(emptyLeadForm());
    const [teamMembers, setTeamMembers] = useState<any[]>([]);

    useEffect(() => {
        api.getTeamMembers().then((data) => setTeamMembers(Array.isArray(data) ? data : [])).catch(() => null);
    }, []);

    const loadLeads = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.getLeads({
                search: search || undefined,
                status: statusFilter || undefined,
                category: categoryFilter || undefined,
                priority: priorityFilter || undefined,
                limit: 100,
            });
            setLeads(data?.items ?? data ?? []);
        } catch {
            setLeads([]);
        } finally {
            setLoading(false);
        }
    }, [search, statusFilter, categoryFilter, priorityFilter]);

    useEffect(() => { void loadLeads(); }, [loadLeads]);

    const closeModal = () => {
        setModalMode(null);
        setEditingId(null);
        setForm(emptyLeadForm());
    };

    const openCreate = () => {
        setForm(emptyLeadForm());
        setEditingId(null);
        setModalMode('create');
    };

    const openEdit = useCallback(async (lead: Lead) => {
        if (lead.status === 'CONVERTED') {
            alert(m.cannotEditConverted);
            return;
        }
        try {
            const full = await api.getLead(lead.id);
            setForm(leadToFormState(full));
            setEditingId(lead.id);
            setModalMode('edit');
        } catch (err: unknown) {
            alert(err instanceof Error ? err.message : m.detail.saveFailed);
        }
    }, [m]);

    const formErrorMessage = (code: string | null) => {
        if (!code) return null;
        if (code === 'INVALID_EMAIL') return m.validation?.invalidEmail ?? 'Please enter a valid email address.';
        if (code === 'NAME_REQUIRED') return `${m.columns.name} is required.`;
        if (code === 'MOBILE_REQUIRED') return `${m.fields.mobile} is required.`;
        return m.createFailed;
    };

    const saveLead = async () => {
        const validationError = validateLeadForm(form);
        if (validationError) {
            alert(formErrorMessage(validationError));
            return;
        }
        setSaving(true);
        try {
            const payload = leadFormToPayload(form);
            if (modalMode === 'edit' && editingId) {
                await api.updateLead(editingId, payload);
            } else {
                await api.createLead(payload);
            }
            closeModal();
            await loadLeads();
        } catch (err: unknown) {
            alert(err instanceof Error ? err.message : (modalMode === 'edit' ? m.detail.saveFailed : m.createFailed));
        } finally {
            setSaving(false);
        }
    };

    const deleteLead = useCallback(async (lead: Lead) => {
        if (!confirm(m.deleteConfirm)) return;
        try {
            await api.deleteLead(lead.id);
            await loadLeads();
        } catch (err: unknown) {
            alert(err instanceof Error ? err.message : m.deleteFailed);
        }
    }, [m, loadLeads]);

    const statusLabel = (status: string) => (m.statuses as Record<string, string>)[status] ?? status;
    const categoryLabel = (category: string) => (m.categories as Record<string, string>)[category] ?? category;
    const priorityLabel = (priority: string) => (m.priorities as Record<string, string>)[priority] ?? priority;

    const columns: ColumnDef<Lead, any>[] = useMemo(() => [
        columnHelper.accessor('name', {
            header: m.columns.name,
            cell: (info) => (
                <Link href={routes.crm.leadDetail(info.row.original.id)} className="font-semibold text-gray-900 hover:text-violet-600">
                    {info.getValue()}
                </Link>
            ),
        }),
        columnHelper.accessor('mobile', { header: m.fields.mobile }),
        columnHelper.accessor('category', {
            header: m.fields.category,
            cell: (info) => info.getValue() ? categoryLabel(info.getValue() as string) : '—',
        }),
        columnHelper.accessor('priority', {
            header: m.fields.priority,
            cell: (info) => (
                <span className={`text-xs font-semibold px-2 py-1 rounded-full ${priorityColors[info.getValue()] ?? 'bg-gray-100 text-gray-700'}`}>
                    {priorityLabel(info.getValue())}
                </span>
            ),
        }),
        columnHelper.accessor('status', {
            header: m.columns.status,
            cell: (info) => (
                <span className="text-xs font-semibold px-2 py-1 rounded-full bg-violet-50 text-violet-700">
                    {statusLabel(info.getValue())}
                </span>
            ),
        }),
        columnHelper.accessor('next_step', {
            header: m.fields.nextStep,
            cell: (info) => info.getValue() ?? '—',
        }),
        columnHelper.accessor('next_step_date', {
            header: m.fields.nextStepDate,
            cell: (info) => info.getValue() ? formatDate(info.getValue() as string) : '—',
        }),
        columnHelper.accessor('nextStepAssignee', {
            header: m.fields.nextStepAssignedTo,
            cell: (info) => info.getValue()?.name ?? '—',
        }),
        columnHelper.display({
            id: 'actions',
            header: c.actions,
            cell: (info) => {
                const lead = info.row.original;
                const isConverted = lead.status === 'CONVERTED';
                return (
                    <div className="flex items-center justify-end gap-1">
                        <Link
                            href={routes.crm.leadDetail(lead.id)}
                            className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors"
                            title={c.view}
                        >
                            <Eye className="w-4 h-4" />
                        </Link>
                        {!isConverted && (
                            <button
                                type="button"
                                onClick={() => void openEdit(lead)}
                                className="p-1.5 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
                                title={c.edit}
                            >
                                <Pencil className="w-4 h-4" />
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => void deleteLead(lead)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                            title={c.delete}
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                );
            },
            enableSorting: false,
            enableColumnFilter: false,
            enableResizing: false,
            size: 110,
        }),
    ], [m, c, statusLabel, categoryLabel, priorityLabel, openEdit, deleteLead]);

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
                        onClick={openCreate}
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
                <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
                    <option value="">{m.allCategories}</option>
                    {LEAD_CATEGORIES.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
                </select>
                <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
                    <option value="">{m.allPriorities}</option>
                    {LEAD_PRIORITIES.map((p) => <option key={p} value={p}>{priorityLabel(p)}</option>)}
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

            {modalMode && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 space-y-4 my-8">
                        <h2 className="text-lg font-bold">
                            {modalMode === 'edit' ? m.detail.editLead : m.newLead}
                        </h2>
                        <LeadFormFields
                            form={form}
                            onChange={setForm}
                            teamMembers={teamMembers}
                            showStatus={modalMode === 'edit'}
                        />
                        <div className="flex justify-end gap-2 pt-2">
                            <button onClick={closeModal} className="px-4 py-2 text-sm border rounded-lg">{c.cancel}</button>
                            <button onClick={saveLead} disabled={saving} className="px-4 py-2 text-sm bg-violet-600 text-white rounded-lg disabled:opacity-50">
                                {saving ? '...' : (modalMode === 'edit' ? m.detail.saveLead : m.newLead)}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}