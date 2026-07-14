'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle, RefreshCw, XCircle } from 'lucide-react';
import { createColumnHelper } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import {
    AccountingPageShell,
} from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { api } from '@/lib/api';
import { useI18n, formatMessage } from '@/lib/i18n';
import { compactDensity } from '@/lib/ui/compact-density';

const STATUS_STYLES: Record<string, string> = {
    posted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
    failed: 'bg-red-50 text-red-700 border-red-200',
    skipped: 'bg-gray-50 text-gray-500 border-gray-200',
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
    posted: <CheckCircle className="w-3 h-3" />,
    pending: <RefreshCw className="w-3 h-3" />,
    failed: <XCircle className="w-3 h-3" />,
    skipped: <AlertTriangle className="w-3 h-3" />,
};

const EVENT_TYPE_LABELS: Record<string, string> = {
    sale: 'Sale',
    sale_return: 'Sale Return',
    purchase: 'Purchase',
    purchase_return: 'Purchase Return',
    inventory_adjustment: 'Inventory Adjustment',
    fund_movement: 'Fund Movement',
};

interface PostingEvent {
    id: string;
    eventType: string;
    sourceModule: string;
    sourceType: string;
    sourceId: string;
    status: string;
    attemptCount: number;
    lastError: string | null;
    lastAttemptAt: string | null;
    voucher: {
        id: string;
        voucher_number: string;
        voucher_type: string;
    } | null;
}

interface Pagination {
    page: number;
    limit: number;
    total: number;
}

const columnHelper = createColumnHelper<PostingEvent>();

export default function PostingExceptionsPage() {
    const { t, locale } = useI18n();
    const [events, setEvents] = useState<PostingEvent[]>([]);
    const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0 });
    const [loading, setLoading] = useState(true);
    const [filterStatus, setFilterStatus] = useState('');
    const [filterModule, setFilterModule] = useState('');
    const [retryingId, setRetryingId] = useState<string | null>(null);
    const [retryMessage, setRetryMessage] = useState<{ id: string; text: string; ok: boolean } | null>(null);

    useEffect(() => {
        void loadEvents();
    }, [filterStatus, filterModule]);

    const loadEvents = async (page = 1) => {
        setLoading(true);
        try {
            const data = await api.getPostingExceptions({
                status: filterStatus || undefined,
                module: filterModule || undefined,
                page,
                limit: 20,
            });
            setEvents(data.data ?? []);
            setPagination(data.pagination ?? { page: 1, limit: 20, total: 0 });
        } catch (err) {
            console.error('Failed to load posting exceptions', err);
        } finally {
            setLoading(false);
        }
    };

    const handleRetry = async (id: string) => {
        setRetryingId(id);
        setRetryMessage(null);
        try {
            const result = await api.retryPostingException(id);
            setRetryMessage({ id, text: result.message ?? 'Retry queued.', ok: true });
            await loadEvents(pagination.page);
        } catch (err: any) {
            setRetryMessage({ id, text: err.message ?? 'Retry failed.', ok: false });
        } finally {
            setRetryingId(null);
        }
    };

    const uniqueModules = useMemo(() => {
        const mods = new Set(events.map((e) => e.sourceModule));
        return [...mods].sort();
    }, [events]);

    const columns = useMemo(
        () => [
            columnHelper.accessor('eventType', {
                header: t.postingExceptions.columns.event,
                cell: (info) => (
                    <span className="text-sm font-medium text-gray-800">
                        {EVENT_TYPE_LABELS[info.getValue()] ?? info.getValue()}
                    </span>
                ),
            }),
            columnHelper.accessor('sourceModule', {
                header: t.postingExceptions.columns.module,
                cell: (info) => (
                    <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-700">
                        {info.getValue()}
                    </span>
                ),
            }),
            columnHelper.accessor('sourceId', {
                header: t.postingExceptions.columns.source,
                cell: (info) => (
                    <div>
                        <span className="block text-xs text-gray-500">{info.row.original.sourceType}</span>
                        <span className="block font-mono text-xs text-gray-700 truncate max-w-[120px]" title={info.getValue()}>
                            {info.getValue()}
                        </span>
                    </div>
                ),
            }),
            columnHelper.accessor('status', {
                header: t.accountingShared.status,
                cell: (info) => {
                    const s = info.getValue();
                    return (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${STATUS_STYLES[s] ?? 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                            {STATUS_ICONS[s]}
                            {s}
                        </span>
                    );
                },
            }),
            columnHelper.accessor('attemptCount', {
                header: t.postingExceptions.columns.attempts,
                cell: (info) => (
                    <span className="text-sm text-gray-500 font-mono">{info.getValue()}</span>
                ),
            }),
            columnHelper.accessor('lastError', {
                header: t.postingExceptions.columns.lastError,
                cell: (info) => {
                    const err = info.getValue();
                    return err ? (
                        <span className="text-xs text-red-600 font-mono" title={err}>
                            {err.length > 40 ? `${err.slice(0, 40)}…` : err}
                        </span>
                    ) : (
                        <span className="text-gray-300 text-xs">—</span>
                    );
                },
            }),
            columnHelper.display({
                id: 'voucher',
                header: t.postingExceptions.columns.voucher,
                cell: ({ row }) => {
                    const v = row.original.voucher;
                    return v ? (
                        <span className="font-mono text-xs text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                            {v.voucher_number}
                        </span>
                    ) : (
                        <span className="text-gray-300 text-xs">—</span>
                    );
                },
            }),
            columnHelper.accessor('lastAttemptAt', {
                header: t.postingExceptions.columns.lastAttempt,
                cell: (info) => {
                    const v = info.getValue();
                    return v ? (
                        <span className="text-xs text-gray-500">
                            {new Date(v).toLocaleString()}
                        </span>
                    ) : (
                        <span className="text-gray-300 text-xs">—</span>
                    );
                },
            }),
            columnHelper.display({
                id: 'actions',
                header: '',
                cell: ({ row }) => {
                    const event = row.original;
                    if (event.status === 'posted' || event.status === 'skipped') return null;
                    const isRetrying = retryingId === event.id;
                    return (
                        <div className="flex flex-col items-start gap-1">
                            <button
                                onClick={() => handleRetry(event.id)}
                                disabled={isRetrying}
                                className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary-hover font-medium disabled:opacity-50"
                            >
                                <RefreshCw className={`w-3.5 h-3.5 ${isRetrying ? 'animate-spin' : ''}`} />
                                {isRetrying ? 'Retrying…' : 'Retry'}
                            </button>
                            {retryMessage?.id === event.id && (
                                <span className={`text-xs ${retryMessage.ok ? 'text-emerald-600' : 'text-red-600'}`}>
                                    {retryMessage.text}
                                </span>
                            )}
                        </div>
                    );
                },
            }),
        ],
        [retryingId, retryMessage],
    );

    const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.limit));

    return (
        <AccountingPageShell maxWidth="full">
            <PageHeader
                title={t.postingExceptions.title}
                subtitle={t.postingExceptions.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    t.postingExceptions.title,
                    'accounting',
                )}
                actions={(
                    <>
                        <span className="text-xs text-gray-500">
                            {pagination.total} event{pagination.total !== 1 ? 's' : ''}
                        </span>
                        <button onClick={() => loadEvents(pagination.page)} className={compactDensity.btnSecondary}>
                            <RefreshCw className="w-3.5 h-3.5" />
                            Refresh
                        </button>
                    </>
                )}
            />

            <div className={compactDensity.filterBar}>
                <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className={compactDensity.formField}>
                    <option value="">All statuses</option>
                    <option value="pending">Pending</option>
                    <option value="failed">Failed</option>
                    <option value="posted">Posted</option>
                    <option value="skipped">Skipped</option>
                </select>
                {uniqueModules.length > 1 && (
                    <select value={filterModule} onChange={(e) => setFilterModule(e.target.value)} className={compactDensity.formField}>
                        <option value="">All modules</option>
                        {uniqueModules.map((m) => (
                            <option key={m} value={m}>{m}</option>
                        ))}
                    </select>
                )}
            </div>

            {loading ? (
                <div className="text-center py-12 text-gray-400 text-sm">{t.postingExceptions.title}...</div>
            ) : (
                <DataTable
                    tableId="posting-exceptions"
                    title={t.accountingShared.postingEvents}
                    columns={columns}
                    data={events}
                />
            )}

            {totalPages > 1 && (
                <div className="flex justify-center items-center gap-2">
                    <button
                        disabled={pagination.page <= 1}
                        onClick={() => loadEvents(pagination.page - 1)}
                        className={`${compactDensity.btnSecondary} disabled:opacity-40`}
                    >
                        Previous
                    </button>
                    <span className="text-xs text-gray-500">
                        Page {pagination.page} of {totalPages}
                    </span>
                    <button
                        disabled={pagination.page >= totalPages}
                        onClick={() => loadEvents(pagination.page + 1)}
                        className={`${compactDensity.btnSecondary} disabled:opacity-40`}
                    >
                        Next
                    </button>
                </div>
            )}
        </AccountingPageShell>
    );
}
