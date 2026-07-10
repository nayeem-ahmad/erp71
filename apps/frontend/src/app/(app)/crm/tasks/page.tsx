'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { RefreshCw, CheckCircle2, Eye, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { DataTable } from '@/components/data-table';
import { PageShell, PageHeader, Button } from '@/components/ui/compact';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

interface CrmTask {
    id: string;
    type: string;
    title: string;
    due_at: string;
    status: string;
    notes: string | null;
    customer: { id: string; name: string; phone: string | null } | null;
    lead: { id: string; name: string; mobile: string | null } | null;
    assignee: { id: string; name: string; email: string } | null;
}

interface TaskSummary {
    dueToday: number;
    overdue: number;
    total: number;
}

const TASK_TYPE_KEYS: Record<string, 'followUp' | 'collection' | 'birthday' | 'reorderReminder'> = {
    FOLLOW_UP: 'followUp',
    COLLECTION: 'collection',
    BIRTHDAY: 'birthday',
    REORDER_REMINDER: 'reorderReminder',
};

const taskTypeColors: Record<string, string> = {
    FOLLOW_UP: 'bg-blue-50 text-blue-700',
    COLLECTION: 'bg-amber-50 text-amber-700',
    BIRTHDAY: 'bg-rose-50 text-rose-700',
    REORDER_REMINDER: 'bg-violet-50 text-violet-700',
};

const statusColors: Record<string, string> = {
    PENDING: 'bg-blue-50 text-blue-700',
    DONE: 'bg-emerald-50 text-emerald-700',
    SNOOZED: 'bg-gray-100 text-gray-600',
};

const columnHelper = createColumnHelper<CrmTask>();

export default function CrmTasksPage() {
    const { t } = useI18n();
    const m = t.crmTasks;

    const [tasks, setTasks] = useState<CrmTask[]>([]);
    const [summary, setSummary] = useState<TaskSummary | null>(null);
    const [statusFilter, setStatusFilter] = useState('');
    const [targetFilter, setTargetFilter] = useState<'' | 'customer' | 'lead'>('');
    const [dueTodayOnly, setDueTodayOnly] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');

    const loadTasks = useCallback(async () => {
        setIsLoading(true);
        setError('');
        try {
            const res = await api.getCrmTasks({
                status: statusFilter || undefined,
                target: targetFilter || undefined,
                dueToday: dueTodayOnly || undefined,
                limit: 100,
            });
            setTasks(res?.items ?? res ?? []);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : m.emptyMessage);
        } finally {
            setIsLoading(false);
        }
    }, [statusFilter, targetFilter, dueTodayOnly, m.emptyMessage]);

    const loadSummary = useCallback(() => {
        api.getCrmTaskSummary().then(setSummary).catch(() => null);
    }, []);

    useEffect(() => { void loadTasks(); }, [loadTasks]);
    useEffect(() => { loadSummary(); }, [loadSummary]);

    const markDone = useCallback(async (id: string) => {
        try {
            await api.updateCrmTask(id, { status: 'DONE' });
            await loadTasks();
            loadSummary();
        } catch {
            /* surfaced on next load */
        }
    }, [loadTasks, loadSummary]);

    const columns: ColumnDef<CrmTask, unknown>[] = useMemo(() => [
        columnHelper.accessor((row) => row.customer?.name ?? row.lead?.name ?? '—', {
            id: 'target',
            header: `${m.columns.customer} / ${m.columns.lead}`,
            cell: (info) => {
                const row = info.row.original;
                if (row.customer) {
                    return (
                        <Link href={routes.sales.customerDetail(row.customer.id)} className="font-semibold text-gray-900 hover:text-violet-600">
                            {row.customer.name}
                        </Link>
                    );
                }
                if (row.lead) {
                    return (
                        <Link href={routes.crm.leadDetail(row.lead.id)} className="font-semibold text-gray-900 hover:text-violet-600">
                            {row.lead.name}
                        </Link>
                    );
                }
                return <span className="text-gray-400">—</span>;
            },
        }),
        columnHelper.accessor('type', {
            header: m.columns.type,
            cell: (info) => {
                const type = info.getValue();
                return (
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${taskTypeColors[type] ?? 'bg-gray-100 text-gray-600'}`}>
                        {m.types[TASK_TYPE_KEYS[type]] ?? type}
                    </span>
                );
            },
        }),
        columnHelper.accessor('title', {
            header: m.columns.title,
            cell: (info) => {
                const row = info.row.original;
                return <span className={`text-gray-800 ${row.status === 'DONE' ? 'line-through text-gray-400' : ''}`}>{info.getValue()}</span>;
            },
        }),
        columnHelper.accessor('due_at', {
            header: m.columns.dueDate,
            cell: (info) => {
                const row = info.row.original;
                const overdue = new Date(row.due_at) < new Date() && row.status === 'PENDING';
                return (
                    <span className={`inline-flex items-center gap-1 ${overdue ? 'font-bold text-rose-600' : 'text-gray-600'}`}>
                        {overdue && <AlertTriangle className="w-3 h-3" />}
                        {formatDate(row.due_at)}
                    </span>
                );
            },
        }),
        columnHelper.accessor((row) => row.assignee?.name ?? '', {
            id: 'assignee',
            header: m.columns.assignee,
            cell: (info) => <span className="text-gray-500">{info.getValue() || '—'}</span>,
        }),
        columnHelper.accessor('status', {
            header: m.columns.status,
            cell: (info) => {
                const status = info.getValue();
                return (
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${statusColors[status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {status === 'DONE' ? m.done : status === 'PENDING' ? m.pending : status}
                    </span>
                );
            },
        }),
        columnHelper.display({
            id: 'actions',
            header: '',
            cell: (info) => {
                const row = info.row.original;
                return (
                    <div className="flex items-center justify-end gap-1">
                        {row.status === 'PENDING' && (
                            <button
                                type="button"
                                onClick={() => void markDone(row.id)}
                                title={m.markDone}
                                className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-50"
                            >
                                <CheckCircle2 className="w-4 h-4" />
                            </button>
                        )}
                        {row.customer && (
                            <Link
                                href={routes.sales.customerDetail(row.customer.id)}
                                title={m.viewCustomer}
                                className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50"
                            >
                                <Eye className="w-4 h-4" />
                            </Link>
                        )}
                    </div>
                );
            },
            enableSorting: false,
        }),
    ], [m, markDone]);

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
                        onClick={() => { void loadTasks(); loadSummary(); }}
                        leftIcon={<RefreshCw className="w-4 h-4" />}
                    />
                }
            />

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <StatCard label={m.dueToday} value={summary?.dueToday ?? 0} tone={summary && summary.dueToday > 0 ? 'warn' : 'ok'} />
                <StatCard label={m.overdue} value={summary?.overdue ?? 0} tone={summary && summary.overdue > 0 ? 'bad' : 'ok'} />
                <StatCard label={m.total} value={summary?.total ?? 0} tone="neutral" />
            </div>

            <div className="flex flex-wrap items-center gap-3 mb-4">
                <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none"
                >
                    <option value="">{m.all}</option>
                    <option value="PENDING">{m.pending}</option>
                    <option value="DONE">{m.done}</option>
                </select>
                <select
                    value={targetFilter}
                    onChange={(e) => setTargetFilter(e.target.value as '' | 'customer' | 'lead')}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none"
                >
                    <option value="">{m.targetFilter.all}</option>
                    <option value="customer">{m.targetFilter.customers}</option>
                    <option value="lead">{m.targetFilter.leads}</option>
                </select>
                <label className="flex items-center gap-2 text-sm text-gray-600">
                    <input type="checkbox" checked={dueTodayOnly} onChange={(e) => setDueTodayOnly(e.target.checked)} className="h-4 w-4" />
                    {m.dueTodayOnly}
                </label>
            </div>

            {error && (
                <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                    {error}
                </div>
            )}

            {isLoading ? (
                <div className="rounded-xl border border-gray-100 bg-white p-8 text-sm text-gray-500">{t.common.loading}</div>
            ) : (
                <DataTable
                    tableId="crm-tasks"
                    columns={columns}
                    data={tasks}
                    title={m.title}
                    emptyMessage={m.emptyMessage}
                />
            )}
        </PageShell>
    );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: 'ok' | 'warn' | 'bad' | 'neutral' }) {
    const toneClasses: Record<string, string> = {
        ok: 'text-emerald-700',
        warn: 'text-amber-700',
        bad: 'text-rose-700',
        neutral: 'text-gray-900',
    };
    return (
        <div className="rounded-2xl border border-gray-100 bg-white px-5 py-4 shadow-sm">
            <p className="text-xs font-medium text-gray-500">{label}</p>
            <p className={`mt-1 text-2xl font-black ${toneClasses[tone]}`}>{value}</p>
        </div>
    );
}
