'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, CalendarPlus, ClipboardList, Eye, PhoneCall, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { useCanApproveCrmActivity } from '@/lib/use-can-approve-crm-activity';
import { useLeadTaxonomy } from '@/lib/use-lead-taxonomy';
import { useTeamMemberOptions } from '@/lib/use-team-member-options';
import { useRememberedFilters } from '@/lib/use-remembered-filters';
import { useCrmMineOnly } from '@/lib/crm-scope';
import MineOnlyToggle from '@/components/crm/MineOnlyToggle';
import CrmActivityAgenda, { CrmActivityApproval } from '@/components/crm/CrmActivityAgenda';
import {
    activityKindName,
    activityLabel,
    activityTarget,
    readActivityLayout,
    writeActivityLayout,
    type ActivityLayout,
    type ActivityTarget,
    type CrmActivityListRow as CrmActivityRow,
} from '@/components/crm/crm-activity-layout';
import { DataTable, FilterBar, createdAtColumn, type ResolvedListFilter } from '@/components/data-table';
import { RowActions, RowActionButton } from '@/components/table';
import { useIsMdUp } from '@/hooks/useMediaQuery';
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
    StatusBadge,
    type StatusBadgeTone,
} from '@/components/ui';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { formatDate } from '@/lib/format';
import CrmActivityComposer from '@/components/crm/CrmActivityComposer';
import CrmActivityDrawer from '@/components/crm/CrmActivityDrawer';

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
    const isMdUp = useIsMdUp();

    const { options: purposes } = useLeadTaxonomy('purposes');
    const { options: channels } = useLeadTaxonomy('channels');

    const [rows, setRows] = useState<CrmActivityRow[]>([]);
    const [summary, setSummary] = useState<ActivitySummary | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

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
    // page and coming back to a list that has forgotten where it was.
    const [viewing, setViewing] = useState<ActivityTarget | null>(null);

    // Read after mount: the server has no localStorage, so the first paint is
    // Standard and the remembered layout replaces it on the next one.
    const [layout, setLayoutState] = useState<ActivityLayout>('standard');
    useEffect(() => { setLayoutState(readActivityLayout()); }, []);
    const setLayout = useCallback((next: ActivityLayout) => {
        setLayoutState(next);
        writeActivityLayout(next);
    }, []);

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

    const load = useCallback(async () => {
        // Nothing is fetched until the remembered filters and the scope are in:
        // otherwise a return visit would fire one request for the defaults and a
        // second for the remembered slice, and briefly render the wrong list.
        if (!filtersReady || !scopeReady) return;
        setIsLoading(true);
        setError(null);
        try {
            const data = await api.getAllCrmActivities({
                status: statusFilter || undefined,
                target: targetFilter || undefined,
                purposeId: purposeFilter || undefined,
                channelId: channelFilter || undefined,
                overdue: overdueOnly || undefined,
                leadOwner: leadOwnerFilter || undefined,
                assignedTo: assigneeFilter || undefined,
                approval: approvalFilter || undefined,
                mine: mineOnly || undefined,
                ...applyDueRangeQuery(dueRange),
                ...applyCreatedRangeQuery(createdRange),
            });
            setRows(Array.isArray(data) ? data : []);
        } catch {
            setError(m.loadFailed);
            setRows([]);
        } finally {
            setIsLoading(false);
        }
    }, [
        statusFilter,
        targetFilter,
        purposeFilter,
        channelFilter,
        overdueOnly,
        leadOwnerFilter,
        assigneeFilter,
        approvalFilter,
        mineOnly,
        dueRange,
        createdRange,
        filtersReady,
        scopeReady,
        m.loadFailed,
    ]);

    // The tiles take the same scope as the list — three counts for the whole team
    // sitting above one person's rows is the disagreement this avoids.
    const loadSummary = useCallback(() => {
        if (!scopeReady) return;
        api.getCrmActivitySummary({ mine: mineOnly || undefined }).then(setSummary).catch(() => null);
    }, [mineOnly, scopeReady]);

    /**
     * Flipped in place, not reloaded: the list is filtered and a reload would
     * pull the row out from under the cursor mid-review. The optimistic write is
     * rolled back on failure so the switch can never show a sign-off the server
     * refused.
     */
    const toggleApproval = useCallback(async (id: string, approved: boolean) => {
        setRows((current) => current.map((row) => (row.id === id ? { ...row, is_approved: approved } : row)));
        try {
            await api.setCrmActivityApproval(id, approved);
        } catch {
            setRows((current) => current.map((row) => (row.id === id ? { ...row, is_approved: !approved } : row)));
            toast.error(m.approvalFailed);
        }
    }, [m.approvalFailed]);

    useEffect(() => { void load(); }, [load]);
    useEffect(() => { loadSummary(); }, [loadSummary]);


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
                            onClick={() => setViewing(target)}
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
    }, [m, t.common.createdAt, t.common.actions, canApprove, toggleApproval]);

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
        },
        {
            id: 'channel',
            type: 'select',
            label: t.crm.setup.tabs.channels,
            value: channelFilter || null,
            onChange: (next) => setFilter('channelId', next ?? ''),
            options: channels.map((channel) => ({ value: channel.id, label: channel.name })),
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
                subtitle={layout === 'standard' ? m.subtitle : undefined}
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
                            size={layout === 'standard' ? 'md' : 'sm'}
                        />
                        <LayoutSwitch
                            value={layout}
                            onChange={setLayout}
                            groupLabel={m.layout.group}
                            labels={m.layout}
                        />
                        <Button
                            variant="secondary"
                            onClick={() => { void load(); loadSummary(); }}
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

            {layout === 'standard' ? (
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
                    <FilterBar filters={activityFilters} compact={!isMdUp} />
                    {isLoading ? (
                        <div className="rounded-lg border border-gray-100 bg-white p-8 text-sm text-gray-500">{t.common.loading}</div>
                    ) : (
                        <CrmActivityAgenda
                            rows={rows}
                            canApprove={canApprove}
                            onToggleApproval={(id, approved) => { void toggleApproval(id, approved); }}
                            onView={(row) => {
                                const target = activityTarget(row);
                                if (target) setViewing(target);
                            }}
                            emptyMessage={m.emptyMessage}
                        />
                    )}
                </>
            ) : (
                <DataTable
                    viewOptions
                    filters={activityFilters}
                    isLoading={isLoading}
                    tableId={layout === 'compact' ? 'crm-activities-compact' : 'crm-activities'}
                    columns={layout === 'compact' ? compactColumns : standardColumns}
                    data={rows}
                    title={m.title}
                    emptyMessage={m.emptyMessage}
                    searchPlaceholder={m.searchPlaceholder}
                />
            )}

            {composing && (
                <CrmActivityComposer
                    mode={composing}
                    onClose={() => setComposing(null)}
                    onSaved={() => { void load(); loadSummary(); }}
                />
            )}

            {viewing && (
                <CrmActivityDrawer
                    leadId={viewing.leadId}
                    customerId={viewing.customerId}
                    name={viewing.name}
                    phone={viewing.phone}
                    href={viewing.href}
                    onClose={() => setViewing(null)}
                    // Only on a write, so merely looking never swaps the table
                    // behind the drawer for "Loading…".
                    onChanged={() => { void load(); loadSummary(); }}
                />
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

function LayoutSwitch({
    value, onChange, groupLabel, labels,
}: Readonly<{
    value: ActivityLayout;
    onChange: (next: ActivityLayout) => void;
    groupLabel: string;
    labels: Record<ActivityLayout, string>;
}>) {
    const options: ActivityLayout[] = ['standard', 'compact', 'agenda'];
    return (
        <div role="radiogroup" aria-label={groupLabel} className="inline-flex overflow-hidden rounded-lg border border-gray-200 bg-white">
            {options.map((id) => {
                const on = value === id;
                return (
                    <button
                        key={id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => onChange(id)}
                        className={`px-2.5 py-1.5 text-xs font-semibold max-md:min-h-touch focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${on ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                    >
                        {labels[id]}
                    </button>
                );
            })}
        </div>
    );
}

