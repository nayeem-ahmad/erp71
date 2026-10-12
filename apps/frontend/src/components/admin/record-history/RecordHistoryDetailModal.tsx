'use client';

import { useEffect, useState } from 'react';
import { History, Loader2 } from 'lucide-react';
import type { RecordHistoryChange } from '@erp71/shared-types';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { Alert, Button } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import {
    formatHistoryValue,
    humanizeHistoryPath,
    isEmptyHistoryValue,
    visibleEntries,
} from '@/lib/record-history-format';
import type { RecordHistoryRow } from './types';

interface RecordHistoryEntry extends RecordHistoryRow {
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    changes: RecordHistoryChange[] | null;
    user_agent: string | null;
}

interface Props {
    row: RecordHistoryRow;
    onClose: () => void;
    /** Narrow the list to this record's whole history. */
    onShowRecordHistory: (row: RecordHistoryRow) => void;
}

/**
 * One history entry: what moved, field by field, with the full before/after
 * snapshots a click away. A create or a hard delete has nothing to compare, so
 * it shows the one snapshot it has instead.
 */
export default function RecordHistoryDetailModal({ row, onClose, onShowRecordHistory }: Props) {
    const { t, locale } = useI18n();
    const m = t.admin.recordHistory;
    const d = m.detail;

    const [entry, setEntry] = useState<RecordHistoryEntry | null>(null);
    const [error, setError] = useState('');
    const [showSnapshots, setShowSnapshots] = useState(false);

    useEffect(() => {
        let cancelled = false;
        api.getAdminRecordHistoryEntry(row.id)
            .then((data: RecordHistoryEntry) => {
                if (!cancelled) setEntry(data);
            })
            .catch((err: unknown) => {
                if (!cancelled) setError(err instanceof Error ? err.message : d.loadFailed);
            });
        return () => {
            cancelled = true;
        };
    }, [row.id, d.loadFailed]);

    const fmt = (value: unknown) => formatHistoryValue(value, (iso) => formatDateTime(iso, locale));
    const entityName = m.entities[row.entity_type as keyof typeof m.entities] ?? row.entity_type;
    const actionName = m.actions[row.action as keyof typeof m.actions] ?? row.action;

    const changes = entry?.changes ?? [];
    // Nothing to compare: show the one snapshot there is.
    const single = entry && !changes.length ? (entry.after ?? entry.before) : null;
    const singleTitle = entry?.after ? d.created : d.deleted;

    return (
        <ModalShell size="2xl" onBackdropClick={onClose}>
            <ModalHeader
                title={`${entityName} · ${row.entity_label ?? row.entity_id}`}
                subtitle={`${actionName} · ${formatDateTime(row.created_at, locale)}`}
                onClose={onClose}
                closeLabel={d.close}
            />

            <div className="space-y-4 overflow-y-auto p-4">
                <dl className="grid grid-cols-1 gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs sm:grid-cols-2">
                    <Meta label={d.tenant} value={row.tenant_name ?? row.tenant_id} />
                    <Meta label={d.by} value={row.user?.name || row.user?.email || '—'} />
                    <Meta label={d.recordId} value={row.entity_id} mono />
                    <Meta label={d.ip} value={row.ip_address || '—'} mono />
                </dl>

                {error && <Alert tone="danger">{error}</Alert>}

                {!entry && !error && (
                    <div className="flex items-center justify-center py-10 text-sm text-gray-400">
                        <Loader2 className="me-2 h-5 w-5 animate-spin" />
                        {t.common.loading}
                    </div>
                )}

                {entry && changes.length > 0 && (
                    <section className="space-y-2">
                        <h3 className="text-sm font-semibold text-gray-900">{d.changes}</h3>
                        <div className="overflow-x-auto rounded-lg border border-gray-200">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50 text-xs text-gray-500">
                                    <tr>
                                        <th className="px-3 py-2 text-start font-medium">{d.field}</th>
                                        <th className="px-3 py-2 text-start font-medium">{d.before}</th>
                                        <th className="px-3 py-2 text-start font-medium">{d.after}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {changes.map((change) => (
                                        <tr key={change.path} className="align-top">
                                            <td className="px-3 py-2 font-medium text-gray-700">
                                                {humanizeHistoryPath(change.path)}
                                            </td>
                                            <td className="px-3 py-2 text-red-700">
                                                <Value text={fmt(change.from)} emptyLabel={d.empty} />
                                            </td>
                                            <td className="px-3 py-2 text-emerald-700">
                                                <Value text={fmt(change.to)} emptyLabel={d.empty} />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </section>
                )}

                {single && (
                    <section className="space-y-2">
                        <h3 className="text-sm font-semibold text-gray-900">{singleTitle}</h3>
                        <Snapshot data={single} fmt={fmt} emptyLabel={d.empty} />
                    </section>
                )}

                {entry && !entry.after && entry.action !== 'CREATE' && (
                    <Alert tone="warning">{d.gone}</Alert>
                )}

                {entry && changes.length > 0 && (
                    <div className="space-y-3">
                        <Button variant="secondary" size="sm" onClick={() => setShowSnapshots((open) => !open)}>
                            {showSnapshots ? d.hideSnapshots : d.showSnapshots}
                        </Button>
                        {showSnapshots && (
                            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                                {entry.before && (
                                    <section className="space-y-2">
                                        <h3 className="text-xs font-semibold text-gray-500">{d.before}</h3>
                                        <Snapshot data={entry.before} fmt={fmt} emptyLabel={d.empty} />
                                    </section>
                                )}
                                {entry.after && (
                                    <section className="space-y-2">
                                        <h3 className="text-xs font-semibold text-gray-500">{d.after}</h3>
                                        <Snapshot data={entry.after} fmt={fmt} emptyLabel={d.empty} />
                                    </section>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>

            <ModalFooter>
                <Button variant="secondary" onClick={() => onShowRecordHistory(row)}>
                    <History className="me-1.5 h-4 w-4" />
                    {d.recordHistory}
                </Button>
                <Button onClick={onClose}>{d.close}</Button>
            </ModalFooter>
        </ModalShell>
    );
}

function Meta({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
    return (
        <div className="min-w-0">
            <dt className="text-gray-500">{label}</dt>
            <dd className={`truncate text-gray-900 ${mono ? 'font-mono' : ''}`} title={value}>
                {value}
            </dd>
        </div>
    );
}

/**
 * Postgres stores a snapshot as JSONB, which keeps keys in its own order
 * (shortest first), so they are put back in one a person can scan: fields
 * alphabetically, then the lists of lines.
 */
function snapshotFields(data: Record<string, unknown>): [string, unknown][] {
    const isList = (value: unknown) => Array.isArray(value);
    return visibleEntries(data).sort(([a, av], [b, bv]) =>
        isList(av) === isList(bv) ? a.localeCompare(b) : isList(av) ? 1 : -1,
    );
}

/** A line already headed by its label need not repeat it ("Oil 1L — product: Oil 1L"). */
function withoutLabel(line: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(line).filter(([, value]) => value !== line._label));
}

function Value({ text, emptyLabel }: { text: string; emptyLabel: string }) {
    if (!text) return <span className="italic text-gray-400">{emptyLabel}</span>;
    return <span className="break-words">{text}</span>;
}

/**
 * A snapshot as a field list. Lines (sale items, payments, allocations) get a
 * row each under their field name, so an invoice reads like an invoice.
 */
function Snapshot({
    data,
    fmt,
    emptyLabel,
}: {
    data: Record<string, unknown>;
    fmt: (value: unknown) => string;
    emptyLabel: string;
}) {
    return (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-100">
                    {snapshotFields(data).map(([key, value]) => {
                        const lines = Array.isArray(value) && value.every((item) => item && typeof item === 'object');
                        return (
                            <tr key={key} className="align-top">
                                <td className="w-1/3 px-3 py-1.5 text-xs font-medium text-gray-500">
                                    {humanizeHistoryPath(key)}
                                </td>
                                <td className="px-3 py-1.5 text-gray-900">
                                    {lines && (value as unknown[]).length > 0 ? (
                                        <ul className="space-y-1">
                                            {(value as Record<string, unknown>[]).map((line, index) => (
                                                <li key={String(line._key ?? index)} className="text-xs">
                                                    <span className="font-medium">{String(line._label ?? index + 1)}</span>
                                                    <span className="text-gray-500"> — {fmt(withoutLabel(line))}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    ) : isEmptyHistoryValue(value) || (Array.isArray(value) && !value.length) ? (
                                        <span className="italic text-gray-400">{emptyLabel}</span>
                                    ) : (
                                        <span className="break-words">{fmt(value)}</span>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
