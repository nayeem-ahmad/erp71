'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, CalendarPlus, ClipboardList, Eye, PhoneCall, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { useCanApproveCrmActivity } from '@/lib/use-can-approve-crm-activity';
import { routes } from '@/lib/routes';
import { useLeadTaxonomy } from '@/lib/use-lead-taxonomy';
import { useTeamMemberOptions } from '@/lib/use-team-member-options';
import { useRememberedFilters } from '@/lib/use-remembered-filters';
import { useCrmMineOnly } from '@/lib/crm-scope';
import MineOnlyToggle from '@/components/crm/MineOnlyToggle';
import { DataTable, createdAtColumn, CreatedRangeFilter } from '@/components/data-table';
import {
    applyCreatedRangeQuery,
    applyDueRangeQuery,
    createdRangeFromPreset,
    type CreatedRange,
} from '@/lib/created-range';
import {
    PageShell,
    PageHeader,
    Button,
    Select,
    StatusBadge,
    Switch,
    type StatusBadgeTone,
} from '@/components/ui';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { formatDate } from '@/lib/format';
import CrmActivityComposer from '@/components/crm/CrmActivityComposer';
import CrmActivityDrawer from '@/components/crm/CrmActivityDrawer';

interface CrmActivityRow {
    id: string;
    subject: string | null;
    summary: string | null;
    status: string;
    due_at: string | null;
    completed_at: string | null;
    purpose: { id: string; name: string; icon: string | null } | null;
    channel: { id: string; name: string; icon: string | null } | null;
    customer: { id: string; name: string; phone: string | null } | null;
    lead: { id: string; name: string; mobile: string | null } | null;
    assignee: { id: string; name: string; email: string } | null;
    is_approved: boolean;
    approver: { id: string; name: string; email: string } | null;
    created_at: string;
}

interface ActivitySummary {
    dueToday: number;
    overdue: number;
    total: number;
}

/**
 * The lead or customer a row hangs off, in the shape both the link column and
 * the drawer want. Held separately from the row it came from because the
 * drawer outlives it: a write inside reloads the list, and the row object the
 * drawer was opened from is gone by the time it closes.
 */
type ActivityTarget = {
    leadId?: string;
    customerId?: string;
    name: string;
    phone: string | null;
    href: string;
};

function targetOf(row: CrmActivityRow): ActivityTarget | null {
    if (row.lead) {
        return {
            leadId: row.lead.id,
            name: row.lead.name,
            phone: row.lead.mobile,
            href: `${routes.crm.leads}/${row.lead.id}`,
        };
    }
    if (row.customer) {
        return {
            customerId: row.customer.id,
            name: row.customer.name,
            phone: row.customer.phone,
            href: `${routes.sales.customers}/${row.customer.id}`,
        };
    }
    return null;
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


    const columns = useMemo<ColumnDef<CrmActivityRow, any>[]>(() => [
        columnHelper.accessor((row) => row.subject ?? row.summary ?? '', {
            id: 'subject',
            header: m.columns.subject,
            cell: (info) => <span className="font-medium text-gray-800">{info.getValue()}</span>,
        }),
        columnHelper.accessor((row) => row.purpose?.name ?? row.channel?.name ?? '', {
            id: 'kind',
            header: m.columns.kind,
            cell: (info) => <span className="text-gray-600">{info.getValue() || '—'}</span>,
        }),
        columnHelper.accessor((row) => row.lead?.name ?? row.customer?.name ?? '', {
            id: 'target',
            header: m.columns.target,
            cell: (info) => {
                const target = targetOf(info.row.original);
                if (!target) return <span className="text-gray-400">—</span>;
                return (
                    <Link href={target.href} className="text-blue-600 hover:underline">
                        {info.getValue()}
                    </Link>
                );
            },
        }),
        columnHelper.accessor('due_at', {
            header: m.columns.due,
            cell: (info) => {
                const value = info.getValue();
                if (!value) return <span className="text-gray-400">—</span>;
                const row = info.row.original;
                const overdue = row.status === 'PLANNED' && new Date(value) < new Date();
                return (
                    <span className={`inline-flex items-center gap-1 ${overdue ? 'font-bold text-red-600' : 'text-gray-600'}`}>
                        {overdue && <AlertTriangle className="h-3 w-3" />}
                        {formatDate(value)}
                    </span>
                );
            },
        }),
        createdAtColumn(columnHelper, { header: t.common.createdAt }),
        columnHelper.accessor('status', {
            header: m.columns.status,
            cell: (info) => (
                <StatusBadge tone={statusTone[info.getValue()] ?? 'neutral'}>
                    {m.status[info.getValue() as 'PLANNED' | 'DONE' | 'CANCELLED'] ?? info.getValue()}
                </StatusBadge>
            ),
        }),
        columnHelper.accessor('is_approved', {
            id: 'approved',
            header: m.columns.approved,
            cell: (info) => {
                const row = info.row.original;
                // Only a plan can be approved. A DONE row records a call that
                // already happened and a CANCELLED one never will, so a switch
                // there would offer a decision that changes nothing.
                if (row.status !== 'PLANNED') return <span className="text-gray-400">—</span>;
                return (
                    <Switch
                        checked={row.is_approved}
                        onCheckedChange={(next) => { void toggleApproval(row.id, next); }}
                        disabled={!canApprove}
                        aria-label={m.approveActivity}
                        title={row.approver ? `${m.columns.approved} — ${row.approver.name}` : undefined}
                    />
                );
            },
        }),
        columnHelper.display({
            id: 'actions',
            header: '',
            cell: (info) => {
                const target = targetOf(info.row.original);
                if (!target) return null;
                return (
                    <div className="flex items-center gap-1">
                        {/* Ahead of the link, because it is the cheaper of the
                            two: read the lead's timeline here, and leave for
                            its page only when the answer is not in it. */}
                        <button
                            type="button"
                            onClick={() => setViewing(target)}
                            aria-label={m.viewActivities}
                            title={m.viewActivities}
                            className="inline-flex min-h-touch items-center text-gray-400 hover:text-blue-600"
                        >
                            <ClipboardList className="h-4 w-4" />
                        </button>
                        <Link
                            href={target.href}
                            aria-label={m.open}
                            title={m.open}
                            className="inline-flex min-h-touch items-center text-gray-400 hover:text-blue-600"
                        >
                            <Eye className="h-4 w-4" />
                        </Link>
                    </div>
                );
            },
        }),
    ], [m, t.common.createdAt, canApprove, toggleApproval]);

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

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <StatCard label={m.dueToday} value={summary?.dueToday ?? 0} tone={summary && summary.dueToday > 0 ? 'warn' : 'ok'} />
                <StatCard label={m.overdue} value={summary?.overdue ?? 0} tone={summary && summary.overdue > 0 ? 'bad' : 'ok'} />
                <StatCard label={m.totalPlanned} value={summary?.total ?? 0} tone="neutral" />
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-3">
                {/* The scope, not a filter: it outlives the tab and is shared with
                    the Overview and the other CRM lists. First in the row because
                    it decides what every control after it is narrowing. */}
                <MineOnlyToggle
                    value={mineOnly}
                    onChange={setMineOnly}
                    label={scopeCopy.mineOnly}
                    title={scopeCopy.mineOnlyHint}
                />
                <Select value={statusFilter} onChange={(e) => setFilter('status', e.target.value)} className="w-auto max-w-[180px]">
                    <option value="">{m.filters.allStatuses}</option>
                    <option value="PLANNED">{m.status.PLANNED}</option>
                    <option value="DONE">{m.status.DONE}</option>
                    <option value="CANCELLED">{m.status.CANCELLED}</option>
                </Select>
                <Select
                    value={approvalFilter}
                    onChange={(e) => setFilter('approval', e.target.value as '' | 'approved' | 'pending')}
                    className="w-auto max-w-[180px]"
                >
                    <option value="">{m.filters.allApprovals}</option>
                    <option value="approved">{m.filters.approvalApproved}</option>
                    <option value="pending">{m.filters.approvalPending}</option>
                </Select>
                <Select
                    value={targetFilter}
                    onChange={(e) => setFilter('target', e.target.value as '' | 'customer' | 'lead')}
                    className="w-auto max-w-[180px]"
                >
                    <option value="">{m.filters.allTargets}</option>
                    <option value="lead">{m.filters.leads}</option>
                    <option value="customer">{m.filters.customers}</option>
                </Select>
                <Select value={purposeFilter} onChange={(e) => setFilter('purposeId', e.target.value)} className="w-auto max-w-[180px]">
                    <option value="">{m.filters.allPurposes}</option>
                    {purposes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
                <Select value={channelFilter} onChange={(e) => setFilter('channelId', e.target.value)} className="w-auto max-w-[180px]">
                    <option value="">{m.filters.allChannels}</option>
                    {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
                <Select
                    value={leadOwnerFilter}
                    onChange={(e) => setFilter('leadOwner', e.target.value)}
                    className="w-auto max-w-[180px]"
                >
                    <option value="">{m.filters.allOwners}</option>
                    {/* Mirrors UNASSIGNED_OWNER_FILTER in crm-leads.dto.ts. */}
                    <option value="unassigned">{m.filters.unassigned}</option>
                    {memberOptions.map((mem) => <option key={mem.id} value={mem.id}>{mem.label}</option>)}
                </Select>
                {/* Disabled rather than hidden while the scope is on: the API pins
                    the assignee to the caller either way, and a control that still
                    looked live would be offering a choice it could not honour. */}
                <Select
                    value={mineOnly ? '' : assigneeFilter}
                    onChange={(e) => setFilter('assignee', e.target.value)}
                    disabled={mineOnly}
                    title={mineOnly ? scopeCopy.assigneeLockedHint : undefined}
                    className="w-auto max-w-[180px]"
                >
                    <option value="">{mineOnly ? scopeCopy.mineOnly : m.filters.allAssignees}</option>
                    {memberOptions.map((mem) => <option key={mem.id} value={mem.id}>{mem.label}</option>)}
                </Select>
                <label className="flex min-h-touch items-center gap-2 text-sm text-gray-600">
                    <input type="checkbox" checked={overdueOnly} onChange={(e) => chooseOverdueOnly(e.target.checked)} className="h-4 w-4" />
                    {m.filters.overdueOnly}
                </label>
                <CreatedRangeFilter value={dueRange} onChange={chooseDueRange} label={m.filters.due} />
                <CreatedRangeFilter value={createdRange} onChange={(next) => setFilter('createdRange', next)} />
            </div>

            {error && (
                <div className="mb-4 rounded-md border border-red-200 bg-danger-light px-4 py-3 text-sm font-semibold text-danger-text">
                    {error}
                </div>
            )}

            {isLoading ? (
                <div className="rounded-lg border border-gray-100 bg-white p-8 text-sm text-gray-500">{t.common.loading}</div>
            ) : (
                <DataTable
                    tableId="crm-activities"
                    columns={columns}
                    data={rows}
                    title={m.title}
                    emptyMessage={m.emptyMessage}
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

function StatCard({ label, value, tone }: Readonly<{ label: string; value: number; tone: 'ok' | 'warn' | 'bad' | 'neutral' }>) {
    const toneClasses: Record<string, string> = {
        ok: 'text-emerald-700',
        warn: 'text-amber-700',
        bad: 'text-danger',
        neutral: 'text-gray-900',
    };
    return (
        <div className="rounded-lg border border-gray-100 bg-white px-5 py-4 shadow-sm">
            <p className="text-xs font-medium text-gray-500">{label}</p>
            <p className={`mt-1 text-2xl font-bold ${toneClasses[tone]}`}>{value}</p>
        </div>
    );
}
