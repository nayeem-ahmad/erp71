'use client';

import { Suspense, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Plus, RefreshCw, Search, Eye, Trash2, ListChecks, Upload, Clock } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { DEFAULT_PAGE_SIZE } from '@/lib/ui/compact-density';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable, createdAtColumn, CreatedRangeFilter, type BulkAction } from '@/components/data-table';
import { applyCreatedRangeQuery, type CreatedRange } from '@/lib/created-range';
import { fetchAllPages } from '@/components/data-table/fetch-all-pages';
import { ImportDialog, type ImportField } from '@/components/import-dialog';
import { PageShell, PageHeader, Button, Select, StatusBadge, Input, type StatusBadgeTone } from '@/components/ui';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { compactDensity } from '@/lib/ui/compact-density';
import {
    LEAD_PRIORITIES,
    LEAD_STATUSES,
} from './lead-form-fields';
import { useLeadTaxonomy } from '@/lib/use-lead-taxonomy';
import Avatar from '@/components/Avatar';

type TaxonomyRef = { id: string; name: string } | null;

interface Lead {
    id: string;
    name: string;
    mobile: string;
    email: string | null;
    /** Legacy enum value; `categoryOption` is authoritative once backfilled. */
    category: string | null;
    categoryOption: TaxonomyRef;
    source: string | null;
    sourceOption: TaxonomyRef;
    priority: string;
    status: string;
    score: number;
    photo_url: string | null;
    next_step: string | null;
    next_step_date: string | null;
    last_contacted_at: string | null;
    /** The lead's owner. `nextStepAssignee` below is the *activity* assignee. */
    assignee: { id: string; name: string } | null;
    nextStepAssignee: { id: string; name: string } | null;
    custom_fields: Record<string, string> | null;
    created_at: string;
}

const columnHelper = createColumnHelper<Lead>();

const priorityColors: Record<string, string> = {
    LOW: 'bg-gray-50 text-gray-600',
    MEDIUM: 'bg-blue-50 text-blue-700',
    HIGH: 'bg-amber-50 text-amber-700',
    URGENT: 'bg-danger-light text-danger-text',
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

/**
 * Mirrors OPEN_LEAD_STATUS_FILTER in crm-leads.dto.ts — the sentinel standing for
 * NEW + CONTACTED + QUALIFIED at once. The CRM dashboard's attention tiles count
 * open leads, so their "View all" links need a filter that says exactly that.
 */
const OPEN_STATUS_FILTER = 'open';

/**
 * Fallback window for the "no activity" toggle when the URL does not name one.
 * A deep link from the dashboard carries the days the tile actually rendered
 * (`stale_after_days`), and that number is what gets queried *and* labelled — so
 * this default only applies to someone switching the filter on by hand here.
 */
const DEFAULT_STALE_DAYS = 14;

/** Upper bound the API enforces on `staleDays`; beyond it the request is a 400. */
const MAX_STALE_DAYS = 3650;

/**
 * Both param readers drop anything the API would reject, so a hand-edited or
 * long-outdated URL opens an unfiltered list rather than an empty one behind a
 * failed request.
 */
function readStatusParam(value: string | null): string {
    if (value === OPEN_STATUS_FILTER) return value;
    return LEAD_STATUSES.includes(value as (typeof LEAD_STATUSES)[number]) ? (value as string) : '';
}

/** Mirrors LeadEmailPresence in crm-leads.dto.ts; anything else means no filter. */
const EMAIL_PRESENCE_VALUES = ['has', 'empty'] as const;

function readEmailPresenceParam(value: string | null): string {
    return EMAIL_PRESENCE_VALUES.includes(value as (typeof EMAIL_PRESENCE_VALUES)[number])
        ? (value as string)
        : '';
}

function readStaleDaysParam(value: string | null): number | null {
    const days = Number(value);
    return Number.isInteger(days) && days > 0 && days <= MAX_STALE_DAYS ? days : null;
}

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

function LeadsPage() {
    const { t, locale, fmt } = useI18n();
    const m = t.crm.leads;
    const c = t.common;

    // Filters can arrive in the URL so another screen can link at a specific
    // slice — the CRM dashboard's "leads with no owner" and "leads untouched for
    // N days" tiles both do, and their counts only mean anything if the list
    // they open holds precisely the rows that were counted. Read once, as the
    // initial state: from here on the controls own these, so changing one is not
    // undone by the query string it was seeded from.
    const searchParams = useSearchParams();
    const staleDaysParam = readStaleDaysParam(searchParams.get('staleDays'));

    const [leads, setLeads] = useState<Lead[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState(() => readStatusParam(searchParams.get('status')));
    const [categoryFilter, setCategoryFilter] = useState('');
    const [sourceFilter, setSourceFilter] = useState('');
    const [priorityFilter, setPriorityFilter] = useState('');
    const [ownerFilter, setOwnerFilter] = useState(() => searchParams.get('assignedTo') ?? '');
    // Seeded from the URL like the filters above, so a link can open the leads
    // that have no address — the same shape the dashboard's tiles link with.
    const [emailFilter, setEmailFilter] = useState(
        () => readEmailPresenceParam(searchParams.get('emailPresence')),
    );
    // Held apart from the toggle so switching the filter off and on again keeps
    // the window the link asked for, rather than snapping back to the default.
    const [staleDays] = useState(() => staleDaysParam ?? DEFAULT_STALE_DAYS);
    const [staleOnly, setStaleOnly] = useState(() => staleDaysParam !== null);
    const [myTodaysActions, setMyTodaysActions] = useState(false);
    const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);
    const [importOpen, setImportOpen] = useState(false);
    const [customFieldDefs, setCustomFieldDefs] = useState<{ key: string; label: string }[]>([]);
    const [selectedLeads, setSelectedLeads] = useState<Lead[]>([]);
    const [teamMembers, setTeamMembers] = useState<any[]>([]);
    const { options: sourceOptions } = useLeadTaxonomy('sources');
    const { options: categoryOptions } = useLeadTaxonomy('categories');
    const [selectionEpoch, setSelectionEpoch] = useState(0);
    const [bulkBusy, setBulkBusy] = useState(false);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
    const [sort, setSort] = useState<{ id: string; desc: boolean } | null>(null);
    // Guards against out-of-order responses: a filter/sort change while on page > 1 fires a
    // stale-page fetch, then the reset-to-page-1 effect fires a second fetch. Only the latest
    // in-flight request may commit its result.
    const loadSeq = useRef(0);

    useEffect(() => {
        api.getCustomFields('LEAD').then((d: any[]) => setCustomFieldDefs(Array.isArray(d) ? d : [])).catch(() => setCustomFieldDefs([]));
        api.getTeamMembers().then((d: any) => setTeamMembers(Array.isArray(d) ? d : [])).catch(() => setTeamMembers([]));
    }, []);

    // Debounce free-text search before it triggers a server request
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search), 300);
        return () => clearTimeout(timer);
    }, [search]);

    const fetchAllRows = useCallback(
        (onProgress?: (loaded: number, total: number) => void) =>
            fetchAllPages(
                ({ page: p, limit, sortBy, sortDir }) =>
                    api.getLeads({
                        search: debouncedSearch || undefined,
                        status: statusFilter || undefined,
                        category: categoryFilter || undefined,
                        source: sourceFilter || undefined,
                        priority: priorityFilter || undefined,
                        assignedTo: ownerFilter || undefined,
                        emailPresence: emailFilter || undefined,
                        staleDays: staleOnly ? staleDays : undefined,
                        myActionsToday: myTodaysActions || undefined,
                        page: p,
                        limit,
                        sortBy,
                        sortDir,
                        ...applyCreatedRangeQuery(createdRange),
                    }),
                { sort, onProgress },
            ),
        [debouncedSearch, statusFilter, categoryFilter, sourceFilter, priorityFilter, ownerFilter, emailFilter, staleOnly, staleDays, myTodaysActions, createdRange, sort],
    );

    const loadLeads = useCallback(async () => {
        const seq = ++loadSeq.current;
        setLoading(true);
        try {
            const data = await api.getLeads({
                search: debouncedSearch || undefined,
                status: statusFilter || undefined,
                category: categoryFilter || undefined,
                source: sourceFilter || undefined,
                priority: priorityFilter || undefined,
                assignedTo: ownerFilter || undefined,
                emailPresence: emailFilter || undefined,
                staleDays: staleOnly ? staleDays : undefined,
                myActionsToday: myTodaysActions || undefined,
                page,
                limit: pageSize,
                sortBy: sort?.id,
                sortDir: sort ? (sort.desc ? 'desc' : 'asc') : undefined,
                ...applyCreatedRangeQuery(createdRange),
            });
            if (seq !== loadSeq.current) return;
            setLeads(data?.items ?? []);
            setTotal(data?.total ?? 0);
        } catch {
            if (seq !== loadSeq.current) return;
            setLeads([]);
            setTotal(0);
        } finally {
            if (seq === loadSeq.current) setLoading(false);
        }
    }, [debouncedSearch, statusFilter, categoryFilter, sourceFilter, priorityFilter, ownerFilter, emailFilter, staleOnly, staleDays, myTodaysActions, createdRange, page, pageSize, sort]);

    useEffect(() => { void loadLeads(); }, [loadLeads]);

    // Any change to filters/search/sort returns to the first page.
    useEffect(() => {
        setPage(1);
    }, [debouncedSearch, statusFilter, categoryFilter, sourceFilter, priorityFilter, ownerFilter, emailFilter, staleOnly, staleDays, myTodaysActions, createdRange, sort]);

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
    const priorityLabel = (priority: string) => (m.priorities as Record<string, string>)[priority] ?? priority;

    const memberOptions = useMemo(
        () => teamMembers
            .map((mem) => {
                const id = mem.userId ?? mem.user_id ?? mem.user?.id;
                return id ? { id, label: mem.name ?? mem.user?.name ?? mem.email ?? mem.user?.email ?? id } : null;
            })
            .filter((entry): entry is { id: string; label: string } => entry !== null),
        [teamMembers],
    );

    const columns: ColumnDef<Lead, any>[] = useMemo(() => [
        columnHelper.accessor('name', {
            header: m.columns.name,
            // Accessor and id are unchanged, so the server-side sort key still
            // works — the avatar rides along inside the same column.
            cell: (info) => (
                <div className="flex items-center gap-2.5">
                    <Avatar src={info.row.original.photo_url} name={info.row.original.name} />
                    <Link
                        href={routes.crm.leadDetail(info.row.original.id)}
                        className="font-semibold text-gray-900 hover:text-primary"
                    >
                        {info.getValue()}
                    </Link>
                </div>
            ),
        }),
        columnHelper.accessor('mobile', { header: m.fields.mobile, enableSorting: false }),
        columnHelper.accessor('email', {
            header: m.fields.email,
            cell: (info) => info.getValue() || '—',
            // Not in the backend's LEAD_SORTABLE allowlist, so a sort request on
            // it would silently fall back to the default order.
            enableSorting: false,
            meta: { hideOnMobile: true },
        }),
        // Explicit `id`s: an accessor function has no inferable key, and the id
        // is what DataTable emits as `sortBy` for the server-side sort.
        columnHelper.accessor((row) => row.categoryOption?.name ?? row.category ?? '', {
            id: 'category',
            header: m.fields.category,
            cell: (info) => (info.getValue() as string) || '—',
        }),
        columnHelper.accessor((row) => row.sourceOption?.name ?? row.source ?? '', {
            id: 'source',
            header: m.columns.source,
            cell: (info) => (info.getValue() as string) || '—',
            meta: { hideOnMobile: true },
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
        columnHelper.accessor('assignee', {
            id: 'assignee',
            // "Lead Owner" reads unambiguously on its own, so this is the same
            // label the form uses — unlike the next-step assignee below, which
            // needs a column-scoped one.
            header: m.fields.owner,
            cell: (info) => info.getValue()?.name ?? '—',
            enableSorting: false,
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
            enableSorting: false,
        }),
        columnHelper.accessor('next_step_date', {
            header: m.fields.nextStepDate,
            cell: (info) => info.getValue() ? formatDate(info.getValue() as string) : '—',
        }),
        columnHelper.accessor('nextStepAssignee', {
            // The column-scoped label, not `fields.nextStepAssignedTo` — that one
            // reads "Assigned To" because the form's "Next Step" section header
            // already scopes it, which a bare table column does not.
            header: m.columns.nextStepAssignedTo,
            cell: (info) => info.getValue()?.name ?? '—',
            enableSorting: false,
        }),
        ...customFieldDefs.map((def) =>
            columnHelper.accessor((row) => row.custom_fields?.[def.key] ?? '', {
                id: `cf_${def.key}`,
                header: def.label,
                cell: (info) => <span className="text-gray-700">{info.getValue() as string}</span>,
                enableSorting: false,
            }),
        ),
        createdAtColumn(columnHelper, { header: c.createdAt, locale }),
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
                            className="p-1.5 rounded-lg text-gray-400 hover:text-danger hover:bg-danger-light transition-colors"
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
    ], [m, c, locale, statusLabel, priorityLabel, deleteLead, customFieldDefs]);

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
                {/* The dashboard's stale tile links straight here. A visible,
                    togglable control rather than an invisible URL filter, so a
                    shortened list always says why it is short — and can be
                    widened again without editing the address bar. */}
                <button
                    type="button"
                    onClick={() => setStaleOnly((v) => !v)}
                    aria-pressed={staleOnly}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                        staleOnly
                            ? 'bg-primary text-white border-primary hover:bg-primary-hover'
                            : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                    }`}
                >
                    <Clock className="w-4 h-4" />
                    {fmt(m.noActivityFilter, { days: staleDays })}
                </button>
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                    <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={m.searchPlaceholder}
                        className="ps-9"
                    />
                </div>
                <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-auto max-w-[180px]">
                    <option value="">{m.allStatuses}</option>
                    {/* Mirrors OPEN_LEAD_STATUS_FILTER in crm-leads.dto.ts. The
                        three working stages as one choice — what the dashboard's
                        attention tiles count, and so what their links open. */}
                    <option value={OPEN_STATUS_FILTER}>{m.openPipeline}</option>
                    {LEAD_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                </Select>
                <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="w-auto max-w-[180px]">
                    <option value="">{m.allCategories}</option>
                    {categoryOptions.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                </Select>
                <Select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className="w-auto max-w-[180px]">
                    <option value="">{m.allSources}</option>
                    {sourceOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
                <Select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className="w-auto max-w-[180px]">
                    <option value="">{m.allPriorities}</option>
                    {LEAD_PRIORITIES.map((p) => <option key={p} value={p}>{priorityLabel(p)}</option>)}
                </Select>
                <Select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} className="w-auto max-w-[180px]">
                    <option value="">{m.allOwners}</option>
                    {/* Mirrors UNASSIGNED_OWNER_FILTER in crm-leads.dto.ts. Every lead
                        created before the owner field existed is unowned, so reaching
                        them to distribute is the main use of this filter. */}
                    <option value="unassigned">{m.fields.unassigned}</option>
                    {memberOptions.map((mem) => <option key={mem.id} value={mem.id}>{mem.label}</option>)}
                </Select>
                {/* Presence, not a value match — free-text search already covers
                    the address itself. "No email" is the one that earns the
                    control: it lists the leads no campaign can reach. */}
                <Select value={emailFilter} onChange={(e) => setEmailFilter(e.target.value)} className="w-auto max-w-[180px]">
                    <option value="">{m.allEmails}</option>
                    <option value="has">{m.hasEmail}</option>
                    <option value="empty">{m.noEmail}</option>
                </Select>
                <CreatedRangeFilter value={createdRange} onChange={setCreatedRange} />
            </div>

            <DataTable<Lead>
                tableId="crm-leads"
                title={m.title}
                data={leads}
                columns={columns}
                isLoading={loading}
                showSearch={false}
                serverPagination={{
                    total,
                    page,
                    pageSize,
                    onPageChange: setPage,
                    onPageSizeChange: (size) => { setPageSize(size); setPage(1); },
                    sort,
                    onSortChange: setSort,
                    fetchAllRows,
                }}
                enableRowSelection
                onRowSelectionChange={setSelectedLeads}
                getRowId={(l) => l.id}
                emptyMessage={
                    myTodaysActions
                        ? m.myTodaysActionsEmpty
                        : staleOnly
                            ? fmt(m.noActivityEmpty, { days: staleDays })
                            : m.emptyMessage
                }
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
                            {memberOptions.map((mem) => <option key={mem.id} value={mem.id}>{mem.label}</option>)}
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

export default function LeadsPageWrapper() {
    // useSearchParams needs a Suspense boundary to keep the route statically
    // renderable under the app router.
    return (
        <Suspense fallback={null}>
            <LeadsPage />
        </Suspense>
    );
}
