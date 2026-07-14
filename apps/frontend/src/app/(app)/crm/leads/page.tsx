'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Plus, RefreshCw, Search, Eye, Trash2, ListChecks, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable, type BulkAction } from '@/components/data-table';
import { ImportDialog, type ImportField } from '@/components/import-dialog';
import { PageShell, PageHeader, Button, Select, StatusBadge, Input, type StatusBadgeTone } from '@/components/ui';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { compactDensity } from '@/lib/ui/compact-density';
import {
    LEAD_CATEGORIES,
    LEAD_PRIORITIES,
    LEAD_STATUSES,
} from './lead-form-fields';

interface Lead {
    id: string;
    name: string;
    mobile: string;
    email: string | null;
    category: string | null;
    priority: string;
    status: string;
    score: number;
    next_step: string | null;
    next_step_date: string | null;
    last_contacted_at: string | null;
    nextStepAssignee: { id: string; name: string } | null;
    custom_fields: Record<string, string> | null;
}

const columnHelper = createColumnHelper<Lead>();

const priorityColors: Record<string, string> = {
    LOW: 'bg-slate-50 text-slate-600',
    MEDIUM: 'bg-blue-50 text-blue-700',
    HIGH: 'bg-amber-50 text-amber-700',
    URGENT: 'bg-rose-50 text-rose-700',
};

function scoreBadgeColor(score: number): string {
    if (score >= 70) return 'bg-emerald-50 text-emerald-700';
    if (score >= 40) return 'bg-amber-50 text-amber-700';
    return 'bg-gray-100 text-gray-600';
}

const leadStatusTone: Record<string, StatusBadgeTone> = {
    NEW: 'info',
    CONTACTED: 'neutral',
    QUALIFIED: 'neutral',
    LOST: 'danger',
    CONVERTED: 'success',
};

const LEAD_IMPORT_FIELDS: ImportField[] = [
    { key: 'name', label: 'Name', required: true },
    { key: 'mobile', label: 'Mobile', required: false },
    { key: 'email', label: 'Email', required: false },
    { key: 'address', label: 'Address', required: false },
    { key: 'category', label: 'Category', required: false },
    { key: 'priority', label: 'Priority', required: false },
    { key: 'source', label: 'Source', required: false },
    { key: 'status', label: 'Status', required: false },
    { key: 'remarks', label: 'Remarks', required: false },
    { key: 'linkedin_url', label: 'LinkedIn URL', required: false },
    { key: 'fb_url', label: 'Facebook URL', required: false },
    { key: 'x_url', label: 'X (Twitter) URL', required: false },
    { key: 'website_url', label: 'Website', required: false },
    { key: 'next_step', label: 'Next Step', required: false },
    { key: 'next_step_date', label: 'Next Step Date', required: false },
];

export default function LeadsPage() {
    const { t } = useI18n();
    const m = t.crm.leads;
    const c = t.common;

    const [leads, setLeads] = useState<Lead[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('');
    const [priorityFilter, setPriorityFilter] = useState('');
    const [myTodaysActions, setMyTodaysActions] = useState(false);
    const [importOpen, setImportOpen] = useState(false);
    const [customFieldDefs, setCustomFieldDefs] = useState<{ key: string; label: string }[]>([]);
    const [selectedLeads, setSelectedLeads] = useState<Lead[]>([]);
    const [teamMembers, setTeamMembers] = useState<any[]>([]);
    const [selectionEpoch, setSelectionEpoch] = useState(0);
    const [bulkBusy, setBulkBusy] = useState(false);

    useEffect(() => {
        api.getCustomFields('LEAD').then((d: any[]) => setCustomFieldDefs(Array.isArray(d) ? d : [])).catch(() => setCustomFieldDefs([]));
        api.getTeamMembers().then((d: any) => setTeamMembers(Array.isArray(d) ? d : [])).catch(() => setTeamMembers([]));
    }, []);

    // Debounce free-text search before it triggers a server request
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search), 300);
        return () => clearTimeout(timer);
    }, [search]);

    const loadLeads = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.getLeads({
                search: debouncedSearch || undefined,
                status: statusFilter || undefined,
                category: categoryFilter || undefined,
                priority: priorityFilter || undefined,
                myActionsToday: myTodaysActions || undefined,
                limit: 100,
            });
            setLeads(data?.items ?? data ?? []);
        } catch {
            setLeads([]);
        } finally {
            setLoading(false);
        }
    }, [debouncedSearch, statusFilter, categoryFilter, priorityFilter, myTodaysActions]);

    useEffect(() => { void loadLeads(); }, [loadLeads]);

    const deleteLead = useCallback(async (lead: Lead) => {
        if (!confirm(m.deleteConfirm)) return;
        try {
            await api.deleteLead(lead.id);
            await loadLeads();
        } catch (err: unknown) {
            alert(err instanceof Error ? err.message : m.deleteFailed);
        }
    }, [m, loadLeads]);

    const clearSelection = useCallback(() => {
        setSelectedLeads([]);
        setSelectionEpoch((e) => e + 1);
    }, []);

    const runBulkAction = useCallback(async (action: 'delete' | 'status' | 'assign', value?: string) => {
        const ids = selectedLeads.map((l) => l.id);
        if (!ids.length) return;
        setBulkBusy(true);
        try {
            await api.bulkLeadAction(ids, action, value);
            await loadLeads();
            clearSelection();
        } catch (err: unknown) {
            alert(err instanceof Error ? err.message : (m as any).actionFailed ?? 'Action failed');
        } finally {
            setBulkBusy(false);
        }
    }, [selectedLeads, loadLeads, clearSelection, m]);

    const bulkDelete = useCallback(() => {
        if (!confirm(((m as any).bulkDeleteConfirm ?? 'Delete {count} selected lead(s)? This cannot be undone.').replace('{count}', String(selectedLeads.length)))) return;
        void runBulkAction('delete');
    }, [runBulkAction, selectedLeads.length, m]);

    const statusLabel = (status: string) => (m.statuses as Record<string, string>)[status] ?? status;
    const categoryLabel = (category: string) => (m.categories as Record<string, string>)[category] ?? category;
    const priorityLabel = (priority: string) => (m.priorities as Record<string, string>)[priority] ?? priority;

    const columns: ColumnDef<Lead, any>[] = useMemo(() => [
        columnHelper.accessor('name', {
            header: m.columns.name,
            cell: (info) => (
                <Link
                    href={routes.crm.leadDetail(info.row.original.id)}
                    className="font-semibold text-gray-900 hover:text-primary"
                >
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
                <StatusBadge tone={leadStatusTone[info.getValue()] ?? 'neutral'}>
                    {statusLabel(info.getValue())}
                </StatusBadge>
            ),
        }),
        columnHelper.accessor('score', {
            header: m.fields.score,
            cell: (info) => (
                <span className={`text-xs font-semibold px-2 py-1 rounded-full ${scoreBadgeColor(info.getValue() ?? 0)}`}>
                    {info.getValue() ?? 0}
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
        ...customFieldDefs.map((def) =>
            columnHelper.accessor((row) => row.custom_fields?.[def.key] ?? '', {
                id: `cf_${def.key}`,
                header: def.label,
                cell: (info) => <span className="text-gray-700">{info.getValue() as string}</span>,
            }),
        ),
        columnHelper.display({
            id: 'actions',
            header: c.actions,
            cell: (info) => {
                const lead = info.row.original;
                return (
                    <div className="flex items-center justify-end gap-1">
                        <Link
                            href={routes.crm.leadDetail(lead.id)}
                            className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors"
                            title={c.view}
                        >
                            <Eye className="w-4 h-4" />
                        </Link>
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
            size: 90,
        }),
    ], [m, c, statusLabel, categoryLabel, priorityLabel, deleteLead, customFieldDefs]);

    const importFields: ImportField[] = useMemo(
        () => [
            ...LEAD_IMPORT_FIELDS,
            ...customFieldDefs.map((def) => ({ key: def.key, label: def.label, required: false })),
        ],
        [customFieldDefs],
    );

    const bulkActions: BulkAction<Lead>[] = useMemo(
        () => [
            {
                label: c.delete,
                tone: 'danger',
                icon: <Trash2 className="w-4 h-4" />,
                onClick: bulkDelete,
            },
        ],
        [c.delete, bulkDelete],
    );

    return (
        <PageShell>
            <PageHeader
                title={m.title}
                subtitle={m.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.crm,
                    m.title,
                    'crm',
                )}
                actions={
                    <>
                        <Button variant="secondary" onClick={loadLeads} leftIcon={<RefreshCw className="w-4 h-4" />} />
                        <Button variant="secondary" onClick={() => setImportOpen(true)} leftIcon={<Upload className="w-4 h-4" />}>
                            Import
                        </Button>
                        <Link
                            href={routes.crm.leadNew}
                            className={`${compactDensity.btnPrimary} bg-blue-600 text-white hover:bg-blue-700`}
                        >
                            <Plus className="w-4 h-4" /> {m.newLead}
                        </Link>
                    </>
                }
            />

            <div className="flex flex-wrap gap-3 items-center">
                <button
                    type="button"
                    onClick={() => setMyTodaysActions((v) => !v)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                        myTodaysActions
                            ? 'bg-primary text-white border-primary hover:bg-primary-hover'
                            : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                    }`}
                >
                    <ListChecks className="w-4 h-4" />
                    {m.myTodaysActions}
                </button>
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={m.searchPlaceholder}
                        className="pl-9"
                    />
                </div>
                <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-auto max-w-[180px]">
                    <option value="">{m.allStatuses}</option>
                    {LEAD_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                </Select>
                <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="w-auto max-w-[180px]">
                    <option value="">{m.allCategories}</option>
                    {LEAD_CATEGORIES.map((cat) => <option key={cat} value={cat}>{categoryLabel(cat)}</option>)}
                </Select>
                <Select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className="w-auto max-w-[180px]">
                    <option value="">{m.allPriorities}</option>
                    {LEAD_PRIORITIES.map((p) => <option key={p} value={p}>{priorityLabel(p)}</option>)}
                </Select>
            </div>

            <DataTable<Lead>
                tableId="crm-leads"
                title={m.title}
                data={leads}
                columns={columns}
                isLoading={loading}
                showSearch={false}
                enableRowSelection
                onRowSelectionChange={setSelectedLeads}
                getRowId={(l) => l.id}
                emptyMessage={myTodaysActions ? m.myTodaysActionsEmpty : m.emptyMessage}
                clearSelectionSignal={selectionEpoch}
                bulkActions={bulkActions}
                bulkActionsDisabled={bulkBusy}
                renderBulkExtra={() => (
                    <>
                        <select
                            value=""
                            disabled={bulkBusy}
                            onChange={(e) => { const v = e.target.value; e.target.value = ''; if (v) void runBulkAction('status', v); }}
                            className="border border-primary-border bg-white rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
                        >
                            <option value="">{(m as any).bulkSetStatus ?? 'Set status…'}</option>
                            {(['NEW', 'CONTACTED', 'QUALIFIED'] as const).map((s) => (
                                <option key={s} value={s}>{statusLabel(s)}</option>
                            ))}
                        </select>
                        <select
                            value=""
                            disabled={bulkBusy}
                            onChange={(e) => { const v = e.target.value; e.target.value = ''; if (v) void runBulkAction('assign', v === '__unassign__' ? '' : v); }}
                            className="border border-primary-border bg-white rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
                        >
                            <option value="">{(m as any).bulkAssign ?? 'Assign to…'}</option>
                            <option value="__unassign__">{(m as any).bulkUnassign ?? '— Unassigned —'}</option>
                            {teamMembers.map((mem) => {
                                const id = mem.userId ?? mem.user_id ?? mem.user?.id;
                                const label = mem.name ?? mem.user?.name ?? mem.email ?? mem.user?.email ?? id;
                                return id ? <option key={id} value={id}>{label}</option> : null;
                            })}
                        </select>
                    </>
                )}
            />

            <ImportDialog
                open={importOpen}
                onClose={() => setImportOpen(false)}
                entityLabel="Leads"
                fields={importFields}
                importFn={(rows, mode) => api.importLeads(rows, mode)}
                onSuccess={() => void loadLeads()}
            />
        </PageShell>
    );
}
