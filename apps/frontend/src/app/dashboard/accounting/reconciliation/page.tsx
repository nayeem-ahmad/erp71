'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle, RefreshCw, XCircle } from 'lucide-react';
import Link from 'next/link';
import { createColumnHelper } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { api } from '../../../../lib/api';

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
                header: 'Event',
                cell: (info) => (
                    <span className="text-sm font-medium text-gray-800">
                        {EVENT_TYPE_LABELS[info.getValue()] ?? info.getValue()}
                    </span>
                ),
            }),
            columnHelper.accessor('sourceModule', {
                header: 'Module',
                cell: (info) => (
                    <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-700">
                        {info.getValue()}
                    </span>
                ),
            }),
            columnHelper.accessor('sourceId', {
                header: 'Source',
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
                header: 'Status',
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
                header: 'Attempts',
                cell: (info) => (
                    <span className="text-sm text-gray-500 font-mono">{info.getValue()}</span>
                ),
            }),
            columnHelper.accessor('lastError', {
                header: 'Last Error',
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
                header: 'Voucher',
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
                header: 'Last Attempt',
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
                                className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium disabled:opacity-50"
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
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="max-w-[1200px] mx-auto space-y-6">
                {/* Header */}
                <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                        <Link href="/dashboard/accounting" className="hover:text-gray-600 transition-colors">
                            <ArrowLeft className="w-4 h-4 inline mr-1" />
                            Accounting
                        </Link>
                        <span>/</span>
                        <span className="text-gray-600 font-medium">Posting Exceptions</span>
                    </div>
                    <div className="flex items-end justify-between gap-6 flex-wrap">
                        <div className="flex items-center gap-3">
                            <div className="inline-flex rounded-2xl border border-rose-100 bg-rose-50 px-3 py-3 text-rose-700">
                                <AlertTriangle className="h-5 w-5" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-black tracking-tight text-gray-950">Posting Exceptions</h1>
                                <p className="text-sm text-gray-500 mt-0.5">
                                    Monitor and replay failed or skipped accounting posting events.
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-500">
                                {pagination.total} event{pagination.total !== 1 ? 's' : ''}
                            </span>
                            <button
                                onClick={() => loadEvents(pagination.page)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg bg-white hover:bg-gray-50 transition-colors"
                            >
                                <RefreshCw className="w-3.5 h-3.5" />
                                Refresh
                            </button>
                        </div>
                    </div>
                </div>

                {/* Filters */}
                <div className="flex flex-wrap gap-3">
                    <select
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                        className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                        <option value="">All statuses</option>
                        <option value="pending">Pending</option>
                        <option value="failed">Failed</option>
                        <option value="posted">Posted</option>
                        <option value="skipped">Skipped</option>
                    </select>
                    {uniqueModules.length > 1 && (
                        <select
                            value={filterModule}
                            onChange={(e) => setFilterModule(e.target.value)}
                            className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                            <option value="">All modules</option>
                            {uniqueModules.map((m) => (
                                <option key={m} value={m}>{m}</option>
                            ))}
                        </select>
                    )}
                </div>

                {/* Table */}
                {loading ? (
                    <div className="text-center py-16 text-gray-400">Loading posting events...</div>
                ) : (
                    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                        <DataTable
                            tableId="posting-exceptions"
                            title="Posting Events"
                            columns={columns}
                            data={events}
                        />
                    </div>
                )}

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="flex justify-center items-center gap-2">
                        <button
                            disabled={pagination.page <= 1}
                            onClick={() => loadEvents(pagination.page - 1)}
                            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40 transition-colors"
                        >
                            Previous
                        </button>
                        <span className="text-sm text-gray-500">
                            Page {pagination.page} of {totalPages}
                        </span>
                        <button
                            disabled={pagination.page >= totalPages}
                            onClick={() => loadEvents(pagination.page + 1)}
                            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40 transition-colors"
                        >
                            Next
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
