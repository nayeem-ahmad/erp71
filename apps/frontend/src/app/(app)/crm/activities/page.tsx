'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import {
    AlertTriangle,
    CalendarPlus,
    CheckCircle2,
    ClipboardList,
    Eye,
    PhoneCall,
    RefreshCw,
    Trash2,
    UserRound,
    XCircle,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n, formatMessage } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { useCanApproveCrmActivity } from '@/lib/use-can-approve-crm-activity';
import { useLeadTaxonomy } from '@/lib/use-lead-taxonomy';
import { useTeamMemberOptions } from '@/lib/use-team-member-options';
import { useRememberedFilters } from '@/lib/use-remembered-filters';
import { useServerList } from '@/hooks/useServerList';
import { useCrmMineOnly } from '@/lib/crm-scope';
import MineOnlyToggle from '@/components/crm/MineOnlyToggle';
import CrmActivityAgenda, { CrmActivityApproval } from '@/components/crm/CrmActivityAgenda';
import {
    activityKindName,
    activityLabel,
    activityTarget,
    agendaOrder,
    nearestTargetedIndex,
    readActivityLayout,
    writeActivityLayout,
    type ActivityLayout,
    type ActivityTarget,
    type CrmActivityListRow as CrmActivityRow,
} from '@/components/crm/crm-activity-layout';
import { DataTable, ListToolbar, createdAtColumn, type BulkAction, type ResolvedListFilter } from '@/components/data-table';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { RowActions, RowActionButton, useTableViewSettings, type TableViewLayout } from '@/components/table';
import {
    applyCreatedRangeQuery,
    applyDueRangeQuery,
    createdRangeFromPreset,
    tenantDateOnly,
    type CreatedRange,
} from '@/lib/created-range';
import {
    PageShell,
    PageHeader,
    Button,
    ConfirmDialog,
    Field,
    Select,
    StatusBadge,
    type StatusBadgeTone,
} from '@/components/ui';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { formatDate } from '@/lib/format';
import CrmActivityComposer from '@/components/crm/CrmActivityComposer';
import CrmActivityDrawer, { type CrmActivityDrawerNavigation } from '@/components/crm/CrmActivityDrawer';

interface ActivitySummary {
    dueToday: number;
    overdue: number;
    total: number;
}

const statusTone: Record<string, StatusBadgeTone> = {
    PLANNED: 'warning',
    DONE: 'success',
    CANCELLED: 'neutral',
};

const columnHelper = createColumnHelper<CrmActivityRow>();

const ACTIVITIES_TABLE_ID = 'crm-activities';

/** The row the side panel is open on, and where it sat when it was opened. */
type ViewingRow = {
    activityId: string;
    /** Its place in the on-screen order when opened — where "next" resumes if it leaves the list. */
    index: number;
    target: ActivityTarget;
    label: string;
};

/**
 * Every CRM activity across the tenant — the merged replacement for the separate
 * follow-ups and conversations lists, both of which now redirect here.
 *
 * The status filter is the thing that used to be a choice of page: PLANNED is
 * what the follow-ups list showed, DONE is what the conversations list showed.
 */
export default function CrmActivitiesPage() {
    const { t } = useI18n();
    const m = t.crm.activitiesPage;
    const scopeCopy = t.crm.scope;

    const { options: purposes } = useLeadTaxonomy('purposes');
    const { options: channels } = useLeadTaxonomy('channels');

    const [summary, setSummary] = useState<ActivitySummary | null>(null);

    // Free text goes to the server with the other filters, so the count beside it
    // is the real total. Debounced, or every keystroke would be a list request.
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
        return () => clearTimeout(timer);
    }, [search]);

    // Remembered for the tab, so coming back from an activity's lead lands on
    // the same slice it was opened from. On a first visit these are the
    // defaults: PLANNED work due today — the agenda this page exists to show.
    // `createdRangeFromPreset` resolves the tenant's calendar day, so a
    // shopkeeper's "today" is not UTC's.
    const [filters, setFilter, filtersReady] = useRememberedFilters('crm-activities', {
        status: 'PLANNED',
        target: '' as '' | 'customer' | 'lead',
        purposeId: '',
        channelId: '',
        leadOwner: '',
        assignee: '',
        approval: '' as '' | 'approved' | 'pending',
        overdueOnly: false,
        createdRange: null as CreatedRange | null,
        dueRange: createdRangeFromPreset('today') as CreatedRange | null,
    });
    const {
        status: statusFilter,
        target: targetFilter,
        purposeId: purposeFilter,
        channelId: channelFilter,
        leadOwner: leadOwnerFilter,
        assignee: assigneeFilter,
        approval: approvalFilter,
        overdueOnly,
        createdRange,
        dueRange,
    } = filters;

    /**
     * "Only my activities" — the CRM-wide scope rather than one of the filters
     * above: it outlives the tab and is shared with the Overview and the other
     * CRM lists. The server resolves the assignee, so no user id is needed here.
     */
    const { mineOnly, setMineOnly, ready: scopeReady } = useCrmMineOnly();

    // Logging a call or planning one from here, rather than opening the lead
    // first: the composer asks which lead or customer it is against.
    const [composing, setComposing] = useState<'log' | 'schedule' | null>(null);

    // The row's whole lead read in place, rather than by leaving for the lead
    // page and coming back to a list that has forgotten where it was. Held by
    // the row it was opened on, not only its lead, so the drawer can step to
    // the rows either side of it.
    const [viewing, setViewing] = useState<ViewingRow | null>(null);

    // Read after mount: the server has no localStorage, so the first paint is
    // the table and the remembered layout replaces it on the next one.
    const [layout, setLayoutState] = useState<ActivityLayout>('list');
    useEffect(() => { setLayoutState(readActivityLayout()); }, []);
    const setLayout = useCallback((next: ActivityLayout) => {
        setLayoutState(next);
        writeActivityLayout(next);
    }, []);
    // Offered in View options, on the table's toolbar and on the agenda's.
    const viewLayout = useMemo<TableViewLayout>(() => ({
        label: m.layout.group,
        options: [
            { key: 'list', label: m.layout.list },
            { key: 'agenda', label: m.layout.agenda },
        ],
        value: layout,
        onChange: (next) => setLayout(next as ActivityLayout),
    }), [m.layout, layout, setLayout]);

    // Compact row spacing in View options is this page's compact layout: the
    // strip instead of the tall cards, no subtitle, and the purpose folded
    // into the subject so the table loses two columns.
    const { settings: view } = useTableViewSettings(ACTIVITIES_TABLE_ID);
    const compact = view.density === 'compact';

    // Everyone sees who has been signed off; only a reviewer can change it. The
    // switch is rendered disabled rather than hidden for the rest, so a rep can
    // tell "nobody has approved this yet" from "you cannot see the approvals".
    const canApprove = useCanApproveCrmActivity();
    const { options: memberOptions } = useTeamMemberOptions(m.filters.me);

    /**
     * "Overdue" means due before today, so it can never agree with a due range
     * that starts today — holding both would show an empty list and look broken.
     * Each control therefore releases the other.
     */
    const chooseDueRange = useCallback((next: CreatedRange | null) => {
        setFilter('dueRange', next);
        if (next) setFilter('overdueOnly', false);
    }, [setFilter]);

    const chooseOverdueOnly = useCallback((next: boolean) => {
        setFilter('overdueOnly', next);
        if (next) setFilter('dueRange', null);
    }, [setFilter]);

    /**
     * The list is paged by the server, like the leads list next door: a tenant
     * with thousands of activities used to have every one of them downloaded —
     * thirty-odd requests in a burst — and the rate limiter answered the tail
     * with a 429. Page/page size/sort live in `useServerList`; the filters below
     * are its `deps`, so changing one returns to the first page.
     */
    const listFilters = useMemo(() => ({
        status: statusFilter || undefined,
        target: targetFilter || undefined,
        purposeId: purposeFilter || undefined,
        channelId: channelFilter || undefined,
        overdue: overdueOnly || undefined,
        leadOwner: leadOwnerFilter || undefined,
        assignedTo: assigneeFilter || undefined,
        approval: approvalFilter || undefined,
        mine: mineOnly || undefined,
        search: debouncedSearch || undefined,
        ...applyDueRangeQuery(dueRange),
        ...applyCreatedRangeQuery(createdRange),
    }), [
        statusFilter,
        targetFilter,
        purposeFilter,
        channelFilter,
        overdueOnly,
        leadOwnerFilter,
        assigneeFilter,
        approvalFilter,
        mineOnly,
        debouncedSearch,
        dueRange,
        createdRange,
    ]);

    const {
        items: rows,
        loading: isLoading,
        error: listError,
        serverPagination,
        reload,
        setItems,
    } = useServerList<CrmActivityRow>({
        tableId: ACTIVITIES_TABLE_ID,
        deps: [listFilters],
        enabled: filtersReady && scopeReady,
        fetch: (params) => api.getCrmActivities({
            ...listFilters,
            page: params.page,
            limit: params.limit,
            sortBy: params.sortBy,
            sortDir: params.sortDir,
        }),
    });
    const error = listError ? m.loadFailed : null;

    // The tiles take the same scope as the list — three counts for the whole team
    // sitting above one person's rows is the disagreement this avoids.
    const loadSummary = useCallback(() => {
        if (!scopeReady) return;
        api.getCrmActivitySummary({ mine: mineOnly || undefined }).then(setSummary).catch(() => null);
    }, [mineOnly, scopeReady]);

    /**
     * What Previous / Next walk: the rows in the order they are on screen. The
     * table draws the server's order; the agenda regroups it by when work is
     * due, so it walks the agenda's order instead.
     */
    const sequence = useMemo(() => (layout === 'agenda' ? agendaOrder(rows) : rows), [layout, rows]);

    const viewRow = useCallback((row: CrmActivityRow, index: number) => {
        const target = activityTarget(row);
        if (!target) return;
        setViewing({ activityId: row.id, index, target, label: activityLabel(row) });
    }, []);

    // Read through a ref so the handler stays one function: the table's
    // columns close over it, and a fresh one per reload would rebuild them.
    const sequenceRef = useRef(sequence);
    sequenceRef.current = sequence;
    const openRow = useCallback((row: CrmActivityRow) => {
        viewRow(row, sequenceRef.current.findIndex((candidate) => candidate.id === row.id));
    }, [viewRow]);

    /**
     * Stepping off either end of a server page: ask for the next page and open
     * its first (or the previous page's last) row once it lands. `staleRows`
     * is the page being left — until `rows` is something else, the new page
     * has not arrived, whatever `isLoading` says in the render between the
     * page change and the fetch starting.
     */
    const pendingStep = useRef<{ edge: 'first' | 'last'; staleRows: CrmActivityRow[] } | null>(null);
    useEffect(() => {
        const pending = pendingStep.current;
        if (!pending || isLoading || rows === pending.staleRows) return;
        pendingStep.current = null;
        const index = pending.edge === 'first'
            ? nearestTargetedIndex(sequence, 0, 1)
            : nearestTargetedIndex(sequence, sequence.length - 1, -1);
        if (index >= 0) viewRow(sequence[index], index);
    }, [isLoading, rows, sequence, viewRow]);

    const { page, pageSize, total, onPageChange } = serverPagination;
    const viewingNav = useMemo<{ target: ActivityTarget; navigation: CrmActivityDrawerNavigation } | null>(() => {
        if (!viewing) return null;
        const found = sequence.findIndex((row) => row.id === viewing.activityId);
        // Still in the list: step either side of where it is now. Gone from it
        // — completed under the Planned filter, say — and the rows after it
        // have moved up one, so the row now in its old slot is the next one.
        const previous = nearestTargetedIndex(sequence, (found >= 0 ? found : viewing.index) - 1, -1);
        const next = nearestTargetedIndex(sequence, found >= 0 ? found + 1 : viewing.index, 1);
        const hasPreviousPage = page > 1;
        const hasNextPage = page * pageSize < total;
        const stepPage = (edge: 'first' | 'last', to: number) => () => {
            pendingStep.current = { edge, staleRows: rows };
            onPageChange(to);
        };
        return {
            // The fresh row once the list reloads, so an edit to the lead's name
            // in the Details tab reaches the drawer's title too.
            target: (found >= 0 ? activityTarget(sequence[found]) : null) ?? viewing.target,
            navigation: {
                position: found >= 0 ? (page - 1) * pageSize + found + 1 : null,
                total,
                onPrevious: previous >= 0
                    ? () => viewRow(sequence[previous], previous)
                    : hasPreviousPage ? stepPage('last', page - 1) : null,
                onNext: next >= 0
                    ? () => viewRow(sequence[next], next)
                    : hasNextPage ? stepPage('first', page + 1) : null,
            },
        };
    }, [viewing, sequence, rows, page, pageSize, total, onPageChange, viewRow]);

    /**
     * Flipped in place, not reloaded: the list is filtered and a reload would
     * pull the row out from under the cursor mid-review. The optimistic write is
     * rolled back on failure so the switch can never show a sign-off the server
     * refused.
     */
    const toggleApproval = useCallback(async (id: string, approved: boolean) => {
        setItems((current) => current.map((row) => (row.id === id ? { ...row, is_approved: approved } : row)));
        try {
            await api.setCrmActivityApproval(id, approved);
        } catch {
            setItems((current) => current.map((row) => (row.id === id ? { ...row, is_approved: !approved } : row)));
            toast.error(m.approvalFailed);
        }
    }, [m.approvalFailed, setItems]);

    useEffect(() => { loadSummary(); }, [loadSummary]);

    // Bulk work: the rows ticked in the table, and what an action over them is
    // waiting on — a confirmation, or the person a reassignment hands them to.
    const [selectedRows, setSelectedRows] = useState<CrmActivityRow[]>([]);
    const [selectionEpoch, setSelectionEpoch] = useState(0);
    const [bulkBusy, setBulkBusy] = useState(false);
    const [bulkConfirm, setBulkConfirm] = useState<'cancel' | 'delete' | null>(null);
    const [reassignOpen, setReassignOpen] = useState(false);
    const [reassignTo, setReassignTo] = useState('');

    const clearSelection = useCallback(() => {
        setSelectedRows([]);
        setSelectionEpoch((epoch) => epoch + 1);
    }, []);

    /**
     * One request per row, all at once, then the list and the tiles reloaded
     * whichever way it ends: a bulk write lands row by row, so a failure
     * part-way leaves some changed, and the list has to show what actually
     * happened rather than an all-or-nothing guess.
     */
    const runBulk = useCallback(async (
        rows: CrmActivityRow[],
        send: (row: CrmActivityRow) => Promise<unknown>,
    ) => {
        if (!rows.length) return { ok: 0, failed: 0 };
        setBulkBusy(true);
        const results = await Promise.allSettled(rows.map(send));
        const ok = results.filter((result) => result.status === 'fulfilled').length;
        setBulkBusy(false);
        clearSelection();
        void reload();
        loadSummary();
        return { ok, failed: results.length - ok };
    }, [clearSelection, reload, loadSummary]);

    const reportBulk = useCallback((ok: number, failed: number, done: string) => {
        if (ok > 0) toast.success(formatMessage(done, { count: ok }));
        if (failed > 0) toast.error(formatMessage(m.bulk.partialFailed, { count: failed }));
    }, [m.bulk.partialFailed]);

    const bulkApprove = useCallback(async (rows: CrmActivityRow[], approved: boolean) => {
        // Only a plan carries an approval; a done or cancelled row has nothing
        // for the reviewer to decide.
        const targets = rows.filter((row) => row.status === 'PLANNED');
        const { ok, failed } = await runBulk(targets, (row) => api.setCrmActivityApproval(row.id, approved));
        reportBulk(ok, failed, approved ? m.bulk.approvedMany : m.bulk.withdrawnMany);
    }, [runBulk, reportBulk, m.bulk.approvedMany, m.bulk.withdrawnMany]);

    const bulkCancel = useCallback(async () => {
        const targets = selectedRows.filter((row) => row.status === 'PLANNED');
        const { ok, failed } = await runBulk(targets, (row) => api.cancelCrmActivity(row.id));
        setBulkConfirm(null);
        reportBulk(ok, failed, m.bulk.cancelledMany);
    }, [selectedRows, runBulk, reportBulk, m.bulk.cancelledMany]);

    const bulkDelete = useCallback(async () => {
        const { ok, failed } = await runBulk(selectedRows, (row) => api.deleteCrmActivity(row.id));
        setBulkConfirm(null);
        reportBulk(ok, failed, m.bulk.deletedMany);
    }, [selectedRows, runBulk, reportBulk, m.bulk.deletedMany]);

    const bulkReassign = useCallback(async () => {
        const { ok, failed } = await runBulk(
            selectedRows,
            // '' is the DTO's way of spelling "nobody" — it stores an explicit null.
            (row) => api.updateCrmActivity(row.id, { assigned_to: reassignTo }),
        );
        setReassignOpen(false);
        setReassignTo('');
        reportBulk(ok, failed, m.bulk.reassignedMany);
    }, [selectedRows, reassignTo, runBulk, reportBulk, m.bulk.reassignedMany]);

    /** The selected plans that a cancel or an approval can actually act on. */
    const plannedSelectedCount = useMemo(
        () => selectedRows.filter((row) => row.status === 'PLANNED').length,
        [selectedRows],
    );

    /**
     * What the bulk bar offers for the current selection. Approve and cancel
     * only appear when a selected row can actually take them, so a tick on a
     * done row never offers a decision that changes nothing.
     */
    const bulkActions = useMemo<BulkAction<CrmActivityRow>[]>(() => {
        const planned = selectedRows.filter((row) => row.status === 'PLANNED');
        const allApproved = planned.length > 0 && planned.every((row) => row.is_approved);
        const actions: BulkAction<CrmActivityRow>[] = [];
        if (canApprove && planned.length > 0) {
            actions.push({
                label: allApproved ? m.bulk.withdrawApproval : m.bulk.approve,
                icon: allApproved ? <XCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />,
                onClick: (rows) => { void bulkApprove(rows, !allApproved); },
            });
        }
        if (planned.length > 0) {
            actions.push({
                label: m.bulk.cancel,
                icon: <XCircle className="h-4 w-4" />,
                onClick: () => setBulkConfirm('cancel'),
            });
        }
        actions.push({
            label: m.bulk.reassign,
            icon: <UserRound className="h-4 w-4" />,
            onClick: () => { setReassignTo(''); setReassignOpen(true); },
        });
        actions.push({
            label: m.bulk.delete,
            tone: 'danger',
            icon: <Trash2 className="h-4 w-4" />,
            onClick: () => setBulkConfirm('delete'),
        });
        return actions;
    }, [selectedRows, canApprove, m.bulk, bulkApprove]);

    const { standardColumns, compactColumns } = useMemo(() => {
        const targetColumn = columnHelper.accessor((row) => row.lead?.name ?? row.customer?.name ?? '', {
            id: 'target',
            header: m.columns.target,
            cell: (info) => {
                const target = activityTarget(info.row.original);
                if (!target) return '—';
                return (
                    <Link href={target.href} className="text-blue-600 hover:underline">
                        {info.getValue()}
                    </Link>
                );
            },
        });
        const dueColumn = columnHelper.accessor('due_at', {
            header: m.columns.due,
            enableColumnFilter: false,
            cell: (info) => {
                const value = info.getValue();
                if (!value) return '—';
                const row = info.row.original;
                const overdue = row.status === 'PLANNED' && new Date(value) < new Date();
                return (
                    <span className={`inline-flex items-center gap-1 ${overdue ? 'text-red-600' : ''}`}>
                        {overdue && <AlertTriangle className="h-3 w-3" />}
                        {formatDate(value)}
                    </span>
                );
            },
        });
        const statusColumn = columnHelper.accessor('status', {
            header: m.columns.status,
            enableColumnFilter: false,
            cell: (info) => (
                <StatusBadge tone={statusTone[info.getValue()] ?? 'neutral'}>
                    {m.status[info.getValue() as 'PLANNED' | 'DONE' | 'CANCELLED'] ?? info.getValue()}
                </StatusBadge>
            ),
        });
        const approvedColumn = columnHelper.accessor('is_approved', {
            id: 'approved',
            header: m.columns.approved,
            cell: (info) => {
                const row = info.row.original;
                // Only a plan can be approved. A DONE row records a call that
                // already happened and a CANCELLED one never will, so a switch
                // there would offer a decision that changes nothing.
                return (
                    <CrmActivityApproval
                        status={row.status}
                        approved={row.is_approved}
                        disabled={!canApprove}
                        label={m.approveActivity}
                        title={row.approver ? `${m.columns.approved} — ${row.approver.name}` : undefined}
                        onToggle={(next) => { void toggleApproval(row.id, next); }}
                    />
                );
            },
        });
        // Ahead of the link, because it is the cheaper of the two: read the
        // lead's timeline here, and leave for its page only when the answer
        // is not in it. Compact rows drop the 44px target on desktop.
        const actionsColumn = columnHelper.display({
            id: 'actions',
            header: t.common.actions,
            cell: (info) => {
                const target = activityTarget(info.row.original);
                if (!target) return null;
                return (
                    <RowActions>
                        <RowActionButton
                            icon={<ClipboardList />}
                            label={m.viewActivities}
                            onClick={() => openRow(info.row.original)}
                        />
                        <RowActionButton icon={<Eye />} label={m.open} href={target.href} />
                    </RowActions>
                );
            },
            enableSorting: false,
            enableColumnFilter: false,
            enableResizing: false,
            size: 96,
        });
        const subjectColumn = (withKind: boolean): ColumnDef<CrmActivityRow, any> => columnHelper.accessor(
            (row) => activityLabel(row),
            {
                id: 'subject',
                header: m.columns.subject,
                cell: (info) => {
                    const kind = withKind ? activityKindName(info.row.original) : '';
                    return (
                        <span>
                            {info.getValue()}
                            {kind ? <span> · {kind}</span> : null}
                        </span>
                    );
                },
            },
        );
        const standardColumns: ColumnDef<CrmActivityRow, any>[] = [
            subjectColumn(false),
            columnHelper.accessor((row) => activityKindName(row), {
                id: 'kind',
                header: m.columns.kind,
                cell: (info) => info.getValue() || '—',
            }),
            targetColumn,
            dueColumn,
            createdAtColumn(columnHelper, { header: t.common.createdAt, enableColumnFilter: false }),
            statusColumn,
            approvedColumn,
            actionsColumn,
        ];
        const compactColumns: ColumnDef<CrmActivityRow, any>[] = [
            subjectColumn(true),
            targetColumn,
            dueColumn,
            statusColumn,
            approvedColumn,
            actionsColumn,
        ];
        return { standardColumns, compactColumns };
    }, [m, t.common.createdAt, t.common.actions, canApprove, toggleApproval, openRow]);

    const activityFilters = useMemo<ResolvedListFilter[]>(() => [
        {
            id: 'status',
            type: 'select',
            label: m.columns.status,
            value: statusFilter || null,
            onChange: (next) => setFilter('status', next ?? ''),
            options: [
                { value: 'PLANNED', label: m.status.PLANNED },
                { value: 'DONE', label: m.status.DONE },
                { value: 'CANCELLED', label: m.status.CANCELLED },
            ],
        },
        {
            id: 'approval',
            type: 'select',
            label: m.columns.approved,
            value: approvalFilter || null,
            onChange: (next) => setFilter('approval', (next ?? '') as '' | 'approved' | 'pending'),
            options: [
                { value: 'approved', label: m.filters.approvalApproved },
                { value: 'pending', label: m.filters.approvalPending },
            ],
            more: true,
        },
        {
            id: 'target',
            type: 'select',
            label: m.columns.target,
            value: targetFilter || null,
            onChange: (next) => setFilter('target', (next ?? '') as '' | 'customer' | 'lead'),
            options: [
                { value: 'lead', label: m.filters.leads },
                { value: 'customer', label: m.filters.customers },
            ],
        },
        {
            id: 'purpose',
            type: 'select',
            label: t.crm.setup.tabs.purposes,
            value: purposeFilter || null,
            onChange: (next) => setFilter('purposeId', next ?? ''),
            options: purposes.map((purpose) => ({ value: purpose.id, label: purpose.name })),
            more: true,
        },
        {
            id: 'channel',
            type: 'select',
            label: t.crm.setup.tabs.channels,
            value: channelFilter || null,
            onChange: (next) => setFilter('channelId', next ?? ''),
            options: channels.map((channel) => ({ value: channel.id, label: channel.name })),
            more: true,
        },
        {
            id: 'leadOwner',
            type: 'select',
            label: t.crm.leads.fields.owner,
            value: leadOwnerFilter || null,
            onChange: (next) => setFilter('leadOwner', next ?? ''),
            options: [
                { value: 'unassigned', label: m.filters.unassigned },
                ...memberOptions.map((member) => ({ value: member.id, label: member.label })),
            ],
            more: true,
        },
        {
            id: 'assignee',
            type: 'select',
            label: t.crm.leads.fields.nextStepAssignedTo,
            value: mineOnly ? null : (assigneeFilter || null),
            onChange: (next) => setFilter('assignee', next ?? ''),
            disabled: mineOnly,
            title: mineOnly ? scopeCopy.assigneeLockedHint : undefined,
            options: memberOptions.map((member) => ({ value: member.id, label: member.label })),
        },
        {
            id: 'overdue',
            type: 'toggle',
            control: 'checkbox',
            label: m.filters.overdueOnly,
            pressed: overdueOnly,
            onChange: chooseOverdueOnly,
        },
        {
            id: 'due',
            type: 'date-range',
            label: m.filters.due,
            value: dueRange,
            onChange: chooseDueRange,
        },
        {
            id: 'created',
            type: 'date-range',
            value: createdRange,
            onChange: (next) => setFilter('createdRange', next),
            more: true,
        },
    ], [
        m, t.crm.setup.tabs.purposes, t.crm.setup.tabs.channels, t.crm.leads.fields.owner, t.crm.leads.fields.nextStepAssignedTo,
        statusFilter, approvalFilter, targetFilter, purposeFilter, channelFilter, leadOwnerFilter, assigneeFilter,
        purposes, channels, memberOptions, mineOnly, scopeCopy.assigneeLockedHint, overdueOnly, dueRange, createdRange,
        setFilter, chooseOverdueOnly, chooseDueRange,
    ]);

    return (
        <PageShell>
            <PageHeader
                title={m.title}
                subtitle={compact ? undefined : m.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.crm,
                    m.title,
                    'crm',
                )}
                actions={
                    <>
                        <MineOnlyToggle
                            value={mineOnly}
                            onChange={setMineOnly}
                            label={scopeCopy.mineOnly}
                            title={scopeCopy.mineOnlyHint}
                            size={compact ? 'sm' : 'md'}
                        />
                        <Button
                            variant="secondary"
                            onClick={() => { void reload(); loadSummary(); }}
                            leftIcon={<RefreshCw className="h-4 w-4" />}
                            aria-label={t.common.refresh}
                        />
                        <Button
                            variant="secondary"
                            onClick={() => setComposing('log')}
                            leftIcon={<PhoneCall className="h-4 w-4" />}
                        >
                            {t.crm.activities.logActivity}
                        </Button>
                        <Button
                            onClick={() => setComposing('schedule')}
                            leftIcon={<CalendarPlus className="h-4 w-4" />}
                        >
                            {t.crm.activities.scheduleActivity}
                        </Button>
                    </>
                }
            />

            {!compact ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <StatCard label={m.dueToday} value={summary?.dueToday ?? 0} tone={summary && summary.dueToday > 0 ? 'warn' : 'ok'} />
                    <StatCard label={m.overdue} value={summary?.overdue ?? 0} tone={summary && summary.overdue > 0 ? 'bad' : 'ok'} />
                    <StatCard label={m.totalPlanned} value={summary?.total ?? 0} tone="neutral" />
                </div>
            ) : (
                <StatStrip
                    dueToday={summary?.dueToday ?? 0}
                    overdue={summary?.overdue ?? 0}
                    planned={summary?.total ?? 0}
                    dueTodayOn={!overdueOnly && dueRange?.from?.slice(0, 10) === tenantDateOnly() && dueRange?.to?.slice(0, 10) === tenantDateOnly()}
                    overdueOn={overdueOnly}
                    plannedOn={statusFilter === 'PLANNED'}
                    dueTodayLabel={m.dueToday}
                    overdueLabel={m.overdue}
                    plannedLabel={m.totalPlanned}
                    onDueToday={() => chooseDueRange(createdRangeFromPreset('today'))}
                    onOverdue={() => chooseOverdueOnly(true)}
                    onPlanned={() => setFilter('status', 'PLANNED')}
                />
            )}

            {error && (
                <div className="mb-4 rounded-md border border-red-200 bg-danger-light px-4 py-3 text-sm font-semibold text-danger-text">
                    {error}
                </div>
            )}

            {layout === 'agenda' ? (
                <>
                    <ListToolbar tableId={ACTIVITIES_TABLE_ID} filters={activityFilters} filterLayout="row" layout={viewLayout} />
                    {isLoading ? (
                        <div className="rounded-lg border border-gray-100 bg-white p-8 text-sm text-gray-500">{t.common.loading}</div>
                    ) : (
                        <>
                            <CrmActivityAgenda
                                rows={rows}
                                canApprove={canApprove}
                                onToggleApproval={(id, approved) => { void toggleApproval(id, approved); }}
                                onView={openRow}
                                emptyMessage={m.emptyMessage}
                            />
                            {/* The agenda has no table footer, so it carries the
                                pager itself — one server page of rows is not the
                                whole day, and it must not look like it is. */}
                            {serverPagination.total > serverPagination.pageSize ? (
                                <div className="flex items-center justify-between rounded-lg border border-gray-100 bg-white px-4 py-2 text-sm text-gray-600">
                                    <span>
                                        {formatMessage(t.common.showingRange, {
                                            start: (serverPagination.page - 1) * serverPagination.pageSize + 1,
                                            end: Math.min(
                                                serverPagination.page * serverPagination.pageSize,
                                                serverPagination.total,
                                            ),
                                            total: serverPagination.total,
                                        })}
                                    </span>
                                    <div className="flex gap-2">
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            disabled={serverPagination.page <= 1}
                                            onClick={() => serverPagination.onPageChange(serverPagination.page - 1)}
                                        >
                                            {t.common.prevPage}
                                        </Button>
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            disabled={serverPagination.page * serverPagination.pageSize >= serverPagination.total}
                                            onClick={() => serverPagination.onPageChange(serverPagination.page + 1)}
                                        >
                                            {t.common.nextPage}
                                        </Button>
                                    </div>
                                </div>
                            ) : null}
                        </>
                    )}
                </>
            ) : (
                <DataTable
                    viewOptions
                    viewLayout={viewLayout}
                    filters={activityFilters}
                    filterLayout="row"
                    isLoading={isLoading}
                    // One id for both column sets: the row spacing that picks
                    // the set is read under this id, so switching ids with it
                    // could read a different spacing and switch straight back.
                    tableId={ACTIVITIES_TABLE_ID}
                    columns={compact ? compactColumns : standardColumns}
                    data={rows}
                    title={m.title}
                    emptyMessage={m.emptyMessage}
                    searchPlaceholder={m.searchPlaceholder}
                    searchValue={search}
                    onSearchChange={setSearch}
                    serverPagination={serverPagination}
                    enableRowSelection
                    getRowId={(row) => row.id}
                    onRowSelectionChange={setSelectedRows}
                    clearSelectionSignal={selectionEpoch}
                    bulkActions={bulkActions}
                    bulkActionsDisabled={bulkBusy}
                />
            )}

            {composing && (
                <CrmActivityComposer
                    mode={composing}
                    onClose={() => setComposing(null)}
                    onSaved={() => { void reload(); loadSummary(); }}
                />
            )}

            {viewing && viewingNav && (
                <CrmActivityDrawer
                    leadId={viewingNav.target.leadId}
                    customerId={viewingNav.target.customerId}
                    name={viewingNav.target.name}
                    phone={viewingNav.target.phone}
                    href={viewingNav.target.href}
                    activityId={viewing.activityId}
                    activityLabel={viewing.label}
                    navigation={viewingNav.navigation}
                    onClose={() => { pendingStep.current = null; setViewing(null); }}
                    // Only on a write, so merely looking never swaps the table
                    // behind the drawer for "Loading…".
                    onChanged={() => { void reload(); loadSummary(); }}
                />
            )}

            <ConfirmDialog
                open={bulkConfirm === 'cancel'}
                title={m.bulk.cancelTitle}
                prompt={formatMessage(m.bulk.cancelPrompt, { count: plannedSelectedCount })}
                confirmLabel={m.bulk.cancel}
                cancelLabel={t.common.cancel}
                loading={bulkBusy}
                onConfirm={() => { void bulkCancel(); }}
                onCancel={() => { if (!bulkBusy) setBulkConfirm(null); }}
            />

            <ConfirmDialog
                open={bulkConfirm === 'delete'}
                title={m.bulk.deleteTitle}
                prompt={formatMessage(m.bulk.deletePrompt, { count: selectedRows.length })}
                confirmLabel={m.bulk.delete}
                cancelLabel={t.common.cancel}
                loading={bulkBusy}
                danger
                onConfirm={() => { void bulkDelete(); }}
                onCancel={() => { if (!bulkBusy) setBulkConfirm(null); }}
            />

            {reassignOpen && (
                <ModalShell size="sm" onBackdropClick={() => { if (!bulkBusy) setReassignOpen(false); }}>
                    <ModalHeader
                        title={m.bulk.reassignTitle}
                        onClose={() => { if (!bulkBusy) setReassignOpen(false); }}
                    />
                    <div className="space-y-3 p-4">
                        <p className="text-sm text-gray-600">
                            {formatMessage(m.bulk.reassignPrompt, { count: selectedRows.length })}
                        </p>
                        <Field label={m.bulk.reassignTo}>
                            <Select value={reassignTo} onChange={(e) => setReassignTo(e.target.value)}>
                                <option value="">{m.filters.unassigned}</option>
                                {memberOptions.map((member) => (
                                    <option key={member.id} value={member.id}>{member.label}</option>
                                ))}
                            </Select>
                        </Field>
                    </div>
                    <ModalFooter>
                        <Button
                            variant="secondary"
                            disabled={bulkBusy}
                            onClick={() => setReassignOpen(false)}
                        >
                            {t.common.cancel}
                        </Button>
                        <Button loading={bulkBusy} onClick={() => { void bulkReassign(); }}>
                            {m.bulk.reassign}
                        </Button>
                    </ModalFooter>
                </ModalShell>
            )}
        </PageShell>
    );
}

const statToneClass = {
    ok: 'text-emerald-700',
    warn: 'text-amber-700',
    bad: 'text-danger',
    neutral: 'text-gray-900',
} as const;

function StatCard({ label, value, tone }: Readonly<{ label: string; value: number; tone: keyof typeof statToneClass }>) {
    return (
        <div className="rounded-lg border border-gray-100 bg-white px-5 py-4 shadow-sm">
            <p className="text-xs font-medium text-gray-500">{label}</p>
            <p className={`mt-1 text-2xl font-bold ${statToneClass[tone]}`}>{value}</p>
        </div>
    );
}

function StatStrip({
    dueToday, overdue, planned,
    dueTodayOn, overdueOn, plannedOn,
    dueTodayLabel, overdueLabel, plannedLabel,
    onDueToday, onOverdue, onPlanned,
}: Readonly<{
    dueToday: number;
    overdue: number;
    planned: number;
    dueTodayOn: boolean;
    overdueOn: boolean;
    plannedOn: boolean;
    dueTodayLabel: string;
    overdueLabel: string;
    plannedLabel: string;
    onDueToday: () => void;
    onOverdue: () => void;
    onPlanned: () => void;
}>) {
    const cells = [
        { label: dueTodayLabel, value: dueToday, tone: dueToday > 0 ? 'warn' as const : 'ok' as const, pressed: dueTodayOn, onClick: onDueToday },
        { label: overdueLabel, value: overdue, tone: overdue > 0 ? 'bad' as const : 'ok' as const, pressed: overdueOn, onClick: onOverdue },
        { label: plannedLabel, value: planned, tone: 'neutral' as const, pressed: plannedOn, onClick: onPlanned },
    ];
    return (
        <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-gray-100 bg-white shadow-sm">
            {cells.map((cell, index) => (
                <button
                    key={cell.label}
                    type="button"
                    aria-label={cell.label}
                    aria-pressed={cell.pressed}
                    onClick={cell.onClick}
                    className={`flex items-baseline gap-2 px-3 py-2 text-start max-md:min-h-touch ${index < cells.length - 1 ? 'border-e border-gray-100' : ''} ${cell.pressed ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                >
                    <span className={`text-base font-bold ${statToneClass[cell.tone]}`}>{cell.value}</span>
                    <span className="text-xs font-medium text-gray-500">{cell.label}</span>
                </button>
            ))}
        </div>
    );
}
