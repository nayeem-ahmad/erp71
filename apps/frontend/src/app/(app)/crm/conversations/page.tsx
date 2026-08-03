'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { RefreshCw, Search, UserCheck } from 'lucide-react';
import { api, type LeadConversationFilters } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { useServerList } from '@/hooks/useServerList';
import { DataTable } from '@/components/data-table';
import { PageShell, PageHeader, Button, Select, Input, StatusBadge, type StatusBadgeTone } from '@/components/ui';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { channelIcon, channelLabel, useLeadTaxonomy } from '@/lib/use-lead-taxonomy';
import { LEAD_STATUSES } from '../leads/lead-form-fields';

interface Conversation {
    id: string;
    type: string;
    direction: string;
    summary: string;
    outcome: string | null;
    created_at: string;
    lead: { id: string; name: string; mobile: string | null; status: string; assigned_to: string | null } | null;
    creator: { id: string; name: string | null; email: string } | null;
}

interface ConversationSummary {
    total: number;
    thisWeek: number;
    countsByType: Record<string, number>;
    leadsTouched: number;
}

interface TeamMember {
    userId?: string;
    user_id?: string;
    user?: { id?: string; name?: string | null; email?: string };
    name?: string | null;
    email?: string;
}

const DIRECTIONS = ['INBOUND', 'OUTBOUND'] as const;

// Direction is a genuine two-value status, so it earns a badge. Channel does not — a tenant
// can define any number of them, and inventing a colour per channel would add a second
// accent palette. Channels carry their own emoji instead.
const directionTone: Record<string, StatusBadgeTone> = {
    INBOUND: 'success',
    OUTBOUND: 'info',
};

/** Local date+time formatter, matching the pattern used by the purchases ledger pages. */
function formatDateTime(value: string, locale: string) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    const dateLocale = locale === 'bn' ? 'bn-BD' : locale === 'ms' ? 'ms-MY' : 'en-GB';
    return d.toLocaleString(dateLocale, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function memberId(member: TeamMember): string | undefined {
    return member.userId ?? member.user_id ?? member.user?.id;
}

function memberLabel(member: TeamMember): string {
    return member.name ?? member.user?.name ?? member.email ?? member.user?.email ?? memberId(member) ?? '';
}

const columnHelper = createColumnHelper<Conversation>();

export default function CrmConversationsPage() {
    const { t, locale } = useI18n();
    const m = t.crm.conversations;
    const leadStatusLabels = t.crm.leads.statuses as Record<string, string>;
    // Active channels only: a retired one must stop being offered as a filter, but
    // rows already logged against it still render (channelLabel falls back to the code).
    const { options: channels } = useLeadTaxonomy('channels');

    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [typeFilter, setTypeFilter] = useState('');
    const [directionFilter, setDirectionFilter] = useState('');
    const [createdByFilter, setCreatedByFilter] = useState('');
    const [leadStatusFilter, setLeadStatusFilter] = useState('');
    const [leadAssignedToFilter, setLeadAssignedToFilter] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [mineOnly, setMineOnly] = useState(false);
    const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
    const [summary, setSummary] = useState<ConversationSummary | null>(null);

    useEffect(() => {
        api.getTeamMembers()
            .then((d: TeamMember[]) => setTeamMembers(Array.isArray(d) ? d : []))
            .catch(() => setTeamMembers([]));
    }, []);

    // Debounce free-text search before it reaches the server.
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search), 300);
        return () => clearTimeout(timer);
    }, [search]);

    const filters: LeadConversationFilters = useMemo(() => ({
        search: debouncedSearch || undefined,
        type: typeFilter || undefined,
        direction: directionFilter || undefined,
        // `mine` wins over an explicit person: the server resolves it from the JWT, so the
        // two cannot be combined into a single created_by.
        createdBy: mineOnly ? undefined : (createdByFilter || undefined),
        mine: mineOnly || undefined,
        leadStatus: leadStatusFilter || undefined,
        leadAssignedTo: leadAssignedToFilter || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
    }), [
        debouncedSearch, typeFilter, directionFilter, createdByFilter, mineOnly,
        leadStatusFilter, leadAssignedToFilter, dateFrom, dateTo,
    ]);

    const list = useServerList<Conversation>({
        tableId: 'crm-conversations',
        fetch: (params) => api.getLeadConversations({ ...filters, ...params }),
        // Every filter must be listed: a change to one invalidates the current page index.
        deps: [filters],
        initialSort: { id: 'created_at', desc: true },
    });

    // Monotonic sequence guard rather than a per-effect `cancelled` flag: the refresh
    // button fires a summary request too, and an effect-scoped flag cannot see it. Without
    // one shared counter, a slow unfiltered refresh response lands after a newer filtered
    // one and the tiles end up describing a different set than the rows below them —
    // the rows are already protected this way inside useServerList.
    const summarySeq = useRef(0);
    const loadSummary = useCallback((activeFilters: LeadConversationFilters) => {
        const seq = ++summarySeq.current;
        api.getLeadConversationSummary(activeFilters)
            .then((d: ConversationSummary) => { if (seq === summarySeq.current) setSummary(d); })
            .catch(() => { if (seq === summarySeq.current) setSummary(null); });
    }, []);

    // The tiles describe the filtered set, so they refetch alongside the rows.
    useEffect(() => { loadSummary(filters); }, [filters, loadSummary]);

    // Depends on `reload`, not on `list` — the result object is a fresh identity every
    // render, which would make this callback (and the header button) churn.
    const reload = list.reload;
    const refresh = useCallback(() => {
        void reload();
        loadSummary(filters);
    }, [reload, loadSummary, filters]);

    const clearFilters = useCallback(() => {
        setSearch('');
        setTypeFilter('');
        setDirectionFilter('');
        setCreatedByFilter('');
        setLeadStatusFilter('');
        setLeadAssignedToFilter('');
        setDateFrom('');
        setDateTo('');
        setMineOnly(false);
    }, []);

    const hasFilters =
        Boolean(search || typeFilter || directionFilter || createdByFilter
            || leadStatusFilter || leadAssignedToFilter || dateFrom || dateTo) || mineOnly;

    // Column ids must match the backend's CONVERSATION_SORTABLE allowlist
    // (created_at, type, direction, lead, creator) — an unlisted id silently
    // falls back to the default order, which reads as a dead column header.
    const columns: ColumnDef<Conversation, any>[] = useMemo(() => [
        columnHelper.accessor('created_at', {
            id: 'created_at',
            header: m.columns.date,
            cell: (info) => (
                <span className="text-sm text-gray-700 whitespace-nowrap">
                    {formatDateTime(info.getValue(), locale)}
                </span>
            ),
        }),
        columnHelper.accessor((row) => row.lead?.name ?? '', {
            id: 'lead',
            header: m.columns.lead,
            cell: (info) => {
                const lead = info.row.original.lead;
                if (!lead) return <span className="text-gray-400">—</span>;
                return (
                    <Link
                        href={routes.crm.leadDetail(lead.id)}
                        className="font-semibold text-gray-900 hover:text-primary"
                    >
                        {lead.name}
                    </Link>
                );
            },
        }),
        columnHelper.accessor((row) => row.lead?.mobile ?? '', {
            id: 'mobile',
            header: m.columns.mobile,
            cell: (info) => <span className="text-sm text-gray-600">{info.getValue() || '—'}</span>,
            enableSorting: false,
            meta: { hideOnMobile: true },
        }),
        columnHelper.accessor('type', {
            id: 'type',
            header: m.columns.type,
            cell: (info) => {
                const type = info.getValue();
                return (
                    <span className="inline-flex items-center gap-1.5 text-sm text-gray-700 whitespace-nowrap">
                        <span aria-hidden="true">{channelIcon(channels, type)}</span>
                        {channelLabel(channels, type)}
                    </span>
                );
            },
        }),
        columnHelper.accessor('direction', {
            id: 'direction',
            header: m.columns.direction,
            cell: (info) => {
                const direction = info.getValue();
                const labels = m.directions as Record<string, string>;
                return (
                    <StatusBadge tone={directionTone[direction] ?? 'neutral'}>
                        {labels[direction] ?? direction}
                    </StatusBadge>
                );
            },
            meta: { hideOnMobile: true },
        }),
        columnHelper.accessor('summary', {
            id: 'summary',
            header: m.columns.summary,
            cell: (info) => (
                <span className="text-sm text-gray-800 line-clamp-2">{info.getValue()}</span>
            ),
            enableSorting: false,
        }),
        columnHelper.accessor((row) => row.outcome ?? '', {
            id: 'outcome',
            header: m.columns.outcome,
            cell: (info) => <span className="text-xs text-gray-500">{info.getValue() || '—'}</span>,
            enableSorting: false,
            meta: { hideOnMobile: true },
        }),
        columnHelper.accessor((row) => row.creator?.name ?? row.creator?.email ?? '', {
            id: 'creator',
            header: m.columns.createdBy,
            cell: (info) => <span className="text-sm text-gray-600">{info.getValue() || '—'}</span>,
            meta: { hideOnMobile: true },
        }),
    ], [m, locale, channels]);

    const typeBreakdown = summary
        ? channels
            .filter((c) => (summary.countsByType?.[c.code] ?? 0) > 0)
            .map((c) => `${c.name}: ${summary.countsByType[c.code]}`)
            .join(' · ')
        : '';

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
                    <Button variant="secondary" onClick={refresh} leftIcon={<RefreshCw className="w-4 h-4" />} />
                }
            />

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <StatCard label={m.stats.total} value={summary?.total ?? 0} helper={typeBreakdown} />
                <StatCard label={m.stats.thisWeek} value={summary?.thisWeek ?? 0} helper="" />
                <StatCard label={m.stats.leadsTouched} value={summary?.leadsTouched ?? 0} helper="" />
            </div>

            <div className="flex flex-wrap gap-3 items-center">
                <button
                    type="button"
                    onClick={() => setMineOnly((v) => !v)}
                    className={`flex items-center gap-2 px-3 py-2 min-h-touch rounded-lg text-sm font-semibold border transition-colors ${
                        mineOnly
                            ? 'bg-primary text-white border-primary hover:bg-primary-hover'
                            : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                    }`}
                >
                    <UserCheck className="w-4 h-4" />
                    {m.mineOnly}
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

                <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-auto max-w-[180px]">
                    <option value="">{m.allTypes}</option>
                    {channels.map((c) => (
                        <option key={c.id} value={c.code}>{c.name}</option>
                    ))}
                </Select>

                <Select value={directionFilter} onChange={(e) => setDirectionFilter(e.target.value)} className="w-auto max-w-[180px]">
                    <option value="">{m.allDirections}</option>
                    {DIRECTIONS.map((d) => (
                        <option key={d} value={d}>{(m.directions as Record<string, string>)[d] ?? d}</option>
                    ))}
                </Select>

                <Select
                    value={createdByFilter}
                    onChange={(e) => setCreatedByFilter(e.target.value)}
                    disabled={mineOnly}
                    className="w-auto max-w-[180px]"
                >
                    <option value="">{m.allCreators}</option>
                    {teamMembers.map((member) => {
                        const id = memberId(member);
                        return id ? <option key={id} value={id}>{memberLabel(member)}</option> : null;
                    })}
                </Select>

                <Select value={leadStatusFilter} onChange={(e) => setLeadStatusFilter(e.target.value)} className="w-auto max-w-[180px]">
                    <option value="">{m.allLeadStatuses}</option>
                    {LEAD_STATUSES.map((s) => (
                        <option key={s} value={s}>{leadStatusLabels[s] ?? s}</option>
                    ))}
                </Select>

                <Select value={leadAssignedToFilter} onChange={(e) => setLeadAssignedToFilter(e.target.value)} className="w-auto max-w-[180px]">
                    <option value="">{m.allAssignees}</option>
                    {teamMembers.map((member) => {
                        const id = memberId(member);
                        return id ? <option key={`owner-${id}`} value={id}>{memberLabel(member)}</option> : null;
                    })}
                </Select>

                <label className="flex items-center gap-2 text-sm text-gray-600">
                    {m.dateFrom}
                    <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-auto" />
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-600">
                    {m.dateTo}
                    <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-auto" />
                </label>

                {hasFilters && (
                    <Button variant="secondary" onClick={clearFilters}>{m.clearFilters}</Button>
                )}
            </div>

            <DataTable<Conversation>
                tableId="crm-conversations"
                title={m.title}
                data={list.items}
                columns={columns}
                isLoading={list.loading}
                showSearch={false}
                serverPagination={list.serverPagination}
                getRowId={(row) => row.id}
                emptyMessage={m.emptyMessage}
            />
        </PageShell>
    );
}

function StatCard({ label, value, helper }: Readonly<{ label: string; value: number; helper: string }>) {
    return (
        <div className="rounded-lg border border-gray-100 bg-white px-5 py-4 shadow-sm">
            <p className="text-xs font-medium text-gray-500">{label}</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
            {helper && <p className="mt-1 text-xs text-gray-500 truncate" title={helper}>{helper}</p>}
        </div>
    );
}
