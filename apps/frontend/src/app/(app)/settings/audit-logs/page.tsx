'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, ScrollText } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { formatDate } from '@/lib/format';

interface AuditUser {
    id: string;
    email: string;
    name?: string | null;
}

interface AuditLogRow {
    id: string;
    action: string;
    entity: string;
    entity_id?: string | null;
    payload?: Record<string, unknown> | null;
    ip_address?: string | null;
    created_at: string;
    user?: AuditUser | null;
}

const columnHelper = createColumnHelper<AuditLogRow>();

function defaultFrom() {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return d.toISOString().slice(0, 10);
}

function defaultTo() {
    return new Date().toISOString().slice(0, 10);
}

export default function AuditLogsPage() {
    const { t } = useI18n();
    const [rows, setRows] = useState<AuditLogRow[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [forbidden, setForbidden] = useState(false);
    const [entity, setEntity] = useState('');
    const [action, setAction] = useState('');
    const [fromDate, setFromDate] = useState(defaultFrom());
    const [toDate, setToDate] = useState(defaultTo());
    const [offset, setOffset] = useState(0);
    const limit = 50;

    const loadLogs = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.getAuditLogs({
                entity: entity.trim() || undefined,
                action: action.trim() || undefined,
                from: fromDate ? `${fromDate}T00:00:00.000Z` : undefined,
                to: toDate ? `${toDate}T23:59:59.999Z` : undefined,
                limit,
                offset,
            });
            setRows(Array.isArray(data?.rows) ? data.rows : []);
            setTotal(Number(data?.total ?? 0));
            setForbidden(false);
        } catch (error: any) {
            if (error?.message?.includes('OWNER or MANAGER')) {
                setForbidden(true);
                setRows([]);
                setTotal(0);
            } else {
                console.error('Failed to load audit logs', error);
            }
        } finally {
            setLoading(false);
        }
    }, [action, entity, fromDate, offset, toDate]);

    useEffect(() => {
        void loadLogs();
    }, [loadLogs]);

    const columns: ColumnDef<AuditLogRow, any>[] = useMemo(
        () => [
            columnHelper.accessor('created_at', {
                header: t.settings.audit.columns.when,
                cell: (info) => (
                    <div>
                        <span className="text-sm text-gray-700">{formatDate(info.getValue())}</span>
                        <span className="text-xs text-gray-400 block">
                            {new Date(info.getValue()).toLocaleTimeString()}
                        </span>
                    </div>
                ),
                sortingFn: 'datetime',
                size: 150,
            }),
            columnHelper.accessor('action', {
                header: t.settings.audit.columns.action,
                cell: (info) => (
                    <span className="px-2 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-slate-100 text-slate-700 border border-slate-200">
                        {info.getValue()}
                    </span>
                ),
                size: 120,
            }),
            columnHelper.accessor('entity', {
                header: t.settings.audit.columns.entity,
                cell: (info) => (
                    <span className="text-sm font-bold text-gray-800">{info.getValue()}</span>
                ),
                size: 120,
            }),
            columnHelper.accessor('entity_id', {
                header: t.settings.audit.columns.entityId,
                cell: (info) => (
                    <span className="text-xs font-mono text-gray-500">{info.getValue() || '—'}</span>
                ),
                size: 180,
            }),
            columnHelper.accessor((row) => row.user?.email ?? row.user?.name ?? '—', {
                id: 'user',
                header: t.settings.audit.columns.user,
                cell: (info) => (
                    <span className="text-sm text-gray-600">{info.getValue()}</span>
                ),
                size: 180,
            }),
            columnHelper.accessor('payload', {
                header: t.settings.audit.columns.details,
                cell: (info) => {
                    const payload = info.getValue();
                    if (!payload || Object.keys(payload).length === 0) {
                        return <span className="text-gray-400">—</span>;
                    }
                    const text = JSON.stringify(payload);
                    return (
                        <span className="text-xs text-gray-500 line-clamp-2 font-mono" title={text}>
                            {text}
                        </span>
                    );
                },
                size: 280,
            }),
        ],
        [t],
    );

    const page = Math.floor(offset / limit) + 1;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    if (forbidden) {
        return (
            <div className="h-full overflow-y-auto p-6">
                <div className="max-w-2xl mx-auto rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center space-y-3">
                    <ScrollText className="w-10 h-10 text-amber-600 mx-auto" />
                    <h1 className="text-xl font-black text-amber-900">{t.settings.audit.forbiddenTitle}</h1>
                    <p className="text-sm text-amber-800">{t.settings.audit.forbiddenDescription}</p>
                    <Link href="/settings" className="inline-flex items-center gap-2 text-sm font-bold text-amber-900 hover:underline">
                        <ArrowLeft className="w-4 h-4" />
                        {t.common.back}
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full overflow-y-auto bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="w-full space-y-4">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <Link
                            href="/settings"
                            className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-400 hover:text-gray-700 mb-3"
                        >
                            <ArrowLeft className="w-3.5 h-3.5" />
                            {t.common.back}
                        </Link>
                        <h1 className="text-lg font-bold tracking-tight text-gray-950">{t.settings.audit.title}</h1>
                        <p className="text-xs text-gray-500 mt-0.5">
                            {t.settings.audit.description}
                        </p>
                    </div>
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <label className="space-y-1">
                        <span className="text-xs font-medium text-gray-500">{t.settings.audit.filters.entity}</span>
                        <input
                            type="text"
                            value={entity}
                            onChange={(e) => { setEntity(e.target.value); setOffset(0); }}
                            placeholder="sale, customer…"
                            className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm"
                        />
                    </label>
                    <label className="space-y-1">
                        <span className="text-xs font-medium text-gray-500">{t.settings.audit.filters.action}</span>
                        <input
                            type="text"
                            value={action}
                            onChange={(e) => { setAction(e.target.value); setOffset(0); }}
                            placeholder="CREATE, UPDATE…"
                            className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm"
                        />
                    </label>
                    <label className="space-y-1">
                        <span className="text-xs font-medium text-gray-500">{t.common.date} (from)</span>
                        <input
                            type="date"
                            value={fromDate}
                            onChange={(e) => { setFromDate(e.target.value); setOffset(0); }}
                            className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm"
                        />
                    </label>
                    <label className="space-y-1">
                        <span className="text-xs font-medium text-gray-500">{t.common.date} (to)</span>
                        <input
                            type="date"
                            value={toDate}
                            onChange={(e) => { setToDate(e.target.value); setOffset(0); }}
                            className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm"
                        />
                    </label>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-20 text-gray-400">
                        <Loader2 className="w-6 h-6 animate-spin mr-2" />
                        {t.common.loading}
                    </div>
                ) : (
                    <>
                        <DataTable
                            tableId="audit-logs"
                            title="Audit Logs"
                            data={rows}
                            columns={columns}
                            searchPlaceholder={t.settings.audit.searchPlaceholder}
                            emptyMessage={t.settings.audit.noLogs}
                        />
                        <div className="flex items-center justify-between text-sm text-gray-500">
                            <span>
                                {t.settings.audit.showing} {rows.length} / {total}
                            </span>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    disabled={offset === 0}
                                    onClick={() => setOffset(Math.max(0, offset - limit))}
                                    className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white disabled:opacity-40 font-bold text-xs"
                                >
                                    {t.settings.audit.prevPage}
                                </button>
                                <span className="text-xs font-bold">
                                    {page} / {totalPages}
                                </span>
                                <button
                                    type="button"
                                    disabled={offset + limit >= total}
                                    onClick={() => setOffset(offset + limit)}
                                    className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white disabled:opacity-40 font-bold text-xs"
                                >
                                    {t.settings.audit.nextPage}
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}