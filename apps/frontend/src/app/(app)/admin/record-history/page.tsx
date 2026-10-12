'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Settings } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { RECORD_HISTORY_ACTIONS, RECORD_HISTORY_ENTITY_TYPES } from '@erp71/shared-types';
import { DataTable, createdAtColumn, CreatedRangeFilter } from '@/components/data-table';
import { type CreatedRange } from '@/lib/created-range';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { Alert, Button, Input, PageShell, Select, StatusBadge, type StatusBadgeTone } from '@/components/ui';
import { humanizeHistoryPath } from '@/lib/record-history-format';
import RecordHistoryDetailModal from '@/components/admin/record-history/RecordHistoryDetailModal';
import RecordHistorySettingsModal from '@/components/admin/record-history/RecordHistorySettingsModal';
import type { RecordHistoryRow } from '@/components/admin/record-history/types';

const columnHelper = createColumnHelper<RecordHistoryRow>();
const PAGE_SIZE = 50;

const ACTION_TONE: Record<string, StatusBadgeTone> = {
    CREATE: 'success',
    UPDATE: 'info',
    DELETE: 'danger',
    CANCEL: 'warning',
    MERGE: 'warning',
};

/**
 * Before/after history of business records across every tenant — the
 * "who changed this invoice, and what did it say before" view. Written by
 * `@TrackHistory` routes on the backend; which types are recorded, and for how
 * long, is set from the Settings button here.
 *
 * Platform-admin access is enforced by the `(app)` layout for `/admin/*` and
 * by `PlatformAdminGuard` on the endpoint.
 */
export default function AdminRecordHistoryPage() {
    const { t, fmt } = useI18n();
    const m = t.admin.recordHistory;

    const [rows, setRows] = useState<RecordHistoryRow[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [tenants, setTenants] = useState<{ id: string; name: string }[]>([]);
    const [tenantId, setTenantId] = useState('');
    const [entityType, setEntityType] = useState('');
    const [action, setAction] = useState('');
    const [search, setSearch] = useState('');
    const [query, setQuery] = useState('');
    const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);
    // Set from an entry's "All history for this record": one record's timeline.
    const [record, setRecord] = useState<{ id: string; label: string } | null>(null);
    const [offset, setOffset] = useState(0);
    const [selected, setSelected] = useState<RecordHistoryRow | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);

    useEffect(() => {
        api.getAdminTenants()
            .then((list: { id: string; name: string }[]) =>
                setTenants([...(list ?? [])].sort((a, b) => a.name.localeCompare(b.name))),
            )
            .catch(() => setTenants([]));
    }, []);

    // Search runs as the admin stops typing, not on every keystroke.
    useEffect(() => {
        const timer = setTimeout(() => {
            setQuery(search.trim());
            setOffset(0);
        }, 300);
        return () => clearTimeout(timer);
    }, [search]);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const data = await api.getAdminRecordHistory({
                tenant_id: tenantId || undefined,
                entity_type: entityType || undefined,
                entity_id: record?.id,
                action: action || undefined,
                q: query || undefined,
                from: createdRange?.from,
                to: createdRange?.to,
                limit: PAGE_SIZE,
                offset,
            });
            setRows(Array.isArray(data?.rows) ? data.rows : []);
            setTotal(Number(data?.total ?? 0));
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : m.loadFailed);
            setRows([]);
            setTotal(0);
        } finally {
            setLoading(false);
        }
    }, [tenantId, entityType, record, action, query, createdRange, offset, m.loadFailed]);

    useEffect(() => {
        void load();
    }, [load]);

    const columns: ColumnDef<RecordHistoryRow, any>[] = useMemo(
        () => [
            createdAtColumn(columnHelper, { header: t.settings.audit.columns.when }),
            columnHelper.accessor((row) => row.tenant_name ?? row.tenant_id, {
                id: 'tenant',
                header: m.columns.tenant,
                cell: (info) => <span className="text-sm text-gray-800">{info.getValue()}</span>,
                size: 160,
            }),
            columnHelper.accessor((row) => row.entity_label ?? row.entity_id, {
                id: 'record',
                header: m.columns.record,
                cell: (info) => {
                    const row = info.row.original;
                    return (
                        <div className="min-w-0">
                            <div className="text-xs text-gray-500">
                                {m.entities[row.entity_type as keyof typeof m.entities] ?? row.entity_type}
                            </div>
                            <div className="truncate text-sm font-medium text-gray-900">{info.getValue()}</div>
                        </div>
                    );
                },
                size: 220,
            }),
            columnHelper.accessor('action', {
                header: m.columns.action,
                cell: (info) => (
                    <StatusBadge tone={ACTION_TONE[info.getValue()] ?? 'neutral'}>
                        {m.actions[info.getValue() as keyof typeof m.actions] ?? info.getValue()}
                    </StatusBadge>
                ),
                size: 120,
            }),
            columnHelper.accessor('changed_paths', {
                header: m.columns.changes,
                enableSorting: false,
                cell: (info) => {
                    const row = info.row.original;
                    if (!row.changed_paths.length) return <span className="text-gray-400">—</span>;
                    const more = row.change_count - row.changed_paths.length;
                    return (
                        <span className="text-xs text-gray-700">
                            {row.changed_paths.map(humanizeHistoryPath).join(', ')}
                            {more > 0 && <span className="text-gray-400"> {fmt(m.moreChanges, { count: more })}</span>}
                        </span>
                    );
                },
                size: 280,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor((row) => row.user?.name || row.user?.email || '—', {
                id: 'user',
                header: m.columns.user,
                cell: (info) => <span className="text-sm text-gray-600">{info.getValue()}</span>,
                size: 160,
                meta: { hideOnMobile: true },
            }),
        ],
        [t, m, fmt],
    );

    // Every filter change restarts paging: page 3 of the old filter has no
    // meaning under the new one.
    const resetTo = <T,>(set: (value: T) => void) => (value: T) => {
        set(value);
        setOffset(0);
    };

    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    return (
        <PageShell maxWidth="full">
            <PageHeader
                title={m.title}
                subtitle={m.description}
                breadcrumbs={modulePageBreadcrumbs(t.dashboardHome.breadcrumbHome, t.sidebar.modules.admin, m.title, 'admin')}
                actions={
                    <Button variant="secondary" onClick={() => setSettingsOpen(true)}>
                        <Settings className="me-1.5 h-4 w-4" />
                        {m.settings}
                    </Button>
                }
            />

            <div className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-gray-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-5 md:p-4">
                <label className="space-y-1">
                    <span className="text-xs font-medium text-gray-500">{m.filters.tenant}</span>
                    <Select value={tenantId} onChange={(e) => resetTo(setTenantId)(e.target.value)}>
                        <option value="">{m.filters.allTenants}</option>
                        {tenants.map((tenant) => (
                            <option key={tenant.id} value={tenant.id}>
                                {tenant.name}
                            </option>
                        ))}
                    </Select>
                </label>
                <label className="space-y-1">
                    <span className="text-xs font-medium text-gray-500">{m.filters.entity}</span>
                    <Select value={entityType} onChange={(e) => resetTo(setEntityType)(e.target.value)}>
                        <option value="">{m.filters.allEntities}</option>
                        {RECORD_HISTORY_ENTITY_TYPES.map((type) => (
                            <option key={type} value={type}>
                                {m.entities[type]}
                            </option>
                        ))}
                    </Select>
                </label>
                <label className="space-y-1">
                    <span className="text-xs font-medium text-gray-500">{m.filters.action}</span>
                    <Select value={action} onChange={(e) => resetTo(setAction)(e.target.value)}>
                        <option value="">{m.filters.allActions}</option>
                        {RECORD_HISTORY_ACTIONS.map((value) => (
                            <option key={value} value={value}>
                                {m.actions[value]}
                            </option>
                        ))}
                    </Select>
                </label>
                <label className="space-y-1">
                    <span className="text-xs font-medium text-gray-500">{m.filters.search}</span>
                    <Input
                        type="search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={m.filters.searchPlaceholder}
                    />
                </label>
                <div className="flex items-end">
                    <CreatedRangeFilter value={createdRange} onChange={(next) => resetTo(setCreatedRange)(next)} />
                </div>
            </div>

            {record && (
                <Alert tone="info" className="mt-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>{fmt(m.oneRecord, { label: record.label })}</span>
                        <Button variant="secondary" size="sm" onClick={() => resetTo(setRecord)(null)}>
                            {m.showAll}
                        </Button>
                    </div>
                </Alert>
            )}

            {error && (
                <Alert tone="danger" className="mt-4">
                    {error}
                </Alert>
            )}

            {loading ? (
                <div className="flex items-center justify-center py-20 text-gray-400">
                    <Loader2 className="me-2 h-6 w-6 animate-spin" />
                    {t.common.loading}
                </div>
            ) : (
                <>
                    <DataTable
                        tableId="admin-record-history"
                        title={m.title}
                        data={rows}
                        columns={columns}
                        emptyMessage={m.empty}
                        showSearch={false}
                        onRowClick={(row) => setSelected(row)}
                    />
                    <div className="mt-4 flex items-center justify-between text-sm text-gray-500">
                        <span>{fmt(m.showing, { shown: rows.length, total })}</span>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="secondary"
                                disabled={offset === 0}
                                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                            >
                                {m.prevPage}
                            </Button>
                            <span className="text-xs font-semibold">
                                {page} / {totalPages}
                            </span>
                            <Button
                                variant="secondary"
                                disabled={offset + PAGE_SIZE >= total}
                                onClick={() => setOffset(offset + PAGE_SIZE)}
                            >
                                {m.nextPage}
                            </Button>
                        </div>
                    </div>
                </>
            )}

            {selected && (
                <RecordHistoryDetailModal
                    row={selected}
                    onClose={() => setSelected(null)}
                    onShowRecordHistory={(row) => {
                        setSelected(null);
                        // One record's timeline spans every type and action
                        // filter; keep the tenant, drop the rest.
                        setEntityType('');
                        setAction('');
                        setSearch('');
                        setQuery('');
                        setCreatedRange(null);
                        resetTo(setRecord)({ id: row.entity_id, label: row.entity_label ?? row.entity_id });
                    }}
                />
            )}

            {settingsOpen && <RecordHistorySettingsModal onClose={() => setSettingsOpen(false)} />}
        </PageShell>
    );
}
