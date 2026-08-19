'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, Eye, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { useLeadTaxonomy } from '@/lib/use-lead-taxonomy';
import { DataTable, createdAtColumn, CreatedRangeFilter } from '@/components/data-table';
import { applyCreatedRangeQuery, type CreatedRange } from '@/lib/created-range';
import {
    PageShell,
    PageHeader,
    Button,
    Select,
    StatusBadge,
    type StatusBadgeTone,
} from '@/components/ui';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

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
    created_at: string;
}

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

    const { options: purposes } = useLeadTaxonomy('purposes');
    const { options: channels } = useLeadTaxonomy('channels');

    const [rows, setRows] = useState<CrmActivityRow[]>([]);
    const [summary, setSummary] = useState<ActivitySummary | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [statusFilter, setStatusFilter] = useState('PLANNED');
    const [targetFilter, setTargetFilter] = useState<'' | 'customer' | 'lead'>('');
    const [purposeFilter, setPurposeFilter] = useState('');
    const [channelFilter, setChannelFilter] = useState('');
    const [overdueOnly, setOverdueOnly] = useState(false);
    const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);

    const load = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await api.getAllCrmActivities({
                status: statusFilter || undefined,
                target: targetFilter || undefined,
                purposeId: purposeFilter || undefined,
                channelId: channelFilter || undefined,
                overdue: overdueOnly || undefined,
                ...applyCreatedRangeQuery(createdRange),
            });
            setRows(Array.isArray(data) ? data : []);
        } catch {
            setError(m.loadFailed);
            setRows([]);
        } finally {
            setIsLoading(false);
        }
    }, [statusFilter, targetFilter, purposeFilter, channelFilter, overdueOnly, createdRange, m.loadFailed]);

    const loadSummary = useCallback(() => {
        api.getCrmActivitySummary().then(setSummary).catch(() => null);
    }, []);

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
                const row = info.row.original;
                const href = row.lead
                    ? `${routes.crm.leads}/${row.lead.id}`
                    : row.customer
                        ? `${routes.sales.customers}/${row.customer.id}`
                        : null;
                if (!href) return <span className="text-gray-400">—</span>;
                return (
                    <Link href={href} className="text-blue-600 hover:underline">
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
                        {new Date(value).toLocaleDateString()}
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
        columnHelper.display({
            id: 'actions',
            header: '',
            cell: (info) => {
                const row = info.row.original;
                const href = row.lead
                    ? `${routes.crm.leads}/${row.lead.id}`
                    : row.customer
                        ? `${routes.sales.customers}/${row.customer.id}`
                        : null;
                if (!href) return null;
                return (
                    <Link href={href} aria-label={m.open} className="inline-flex min-h-touch items-center text-gray-400 hover:text-blue-600">
                        <Eye className="h-4 w-4" />
                    </Link>
                );
            },
        }),
    ], [m, t.common.createdAt]);

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
                    <Button
                        variant="secondary"
                        onClick={() => { void load(); loadSummary(); }}
                        leftIcon={<RefreshCw className="h-4 w-4" />}
                    />
                }
            />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <StatCard label={m.dueToday} value={summary?.dueToday ?? 0} tone={summary && summary.dueToday > 0 ? 'warn' : 'ok'} />
                <StatCard label={m.overdue} value={summary?.overdue ?? 0} tone={summary && summary.overdue > 0 ? 'bad' : 'ok'} />
                <StatCard label={m.totalPlanned} value={summary?.total ?? 0} tone="neutral" />
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-3">
                <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-auto max-w-[180px]">
                    <option value="">{m.filters.allStatuses}</option>
                    <option value="PLANNED">{m.status.PLANNED}</option>
                    <option value="DONE">{m.status.DONE}</option>
                    <option value="CANCELLED">{m.status.CANCELLED}</option>
                </Select>
                <Select
                    value={targetFilter}
                    onChange={(e) => setTargetFilter(e.target.value as '' | 'customer' | 'lead')}
                    className="w-auto max-w-[180px]"
                >
                    <option value="">{m.filters.allTargets}</option>
                    <option value="lead">{m.filters.leads}</option>
                    <option value="customer">{m.filters.customers}</option>
                </Select>
                <Select value={purposeFilter} onChange={(e) => setPurposeFilter(e.target.value)} className="w-auto max-w-[180px]">
                    <option value="">{m.filters.allPurposes}</option>
                    {purposes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
                <Select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)} className="w-auto max-w-[180px]">
                    <option value="">{m.filters.allChannels}</option>
                    {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
                <label className="flex min-h-touch items-center gap-2 text-sm text-gray-600">
                    <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} className="h-4 w-4" />
                    {m.filters.overdueOnly}
                </label>
                <CreatedRangeFilter value={createdRange} onChange={setCreatedRange} />
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
