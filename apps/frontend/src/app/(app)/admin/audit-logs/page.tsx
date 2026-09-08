'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable, createdAtColumn, CreatedRangeFilter } from '@/components/data-table';
import { type CreatedRange } from '@/lib/created-range';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { Alert, Button, Input, PageShell, Select } from '@/components/ui';

type Scope = 'platform' | 'tenant' | 'all';

interface AuditUser {
    id: string;
    email: string;
    name?: string | null;
}

interface AdminAuditLogRow {
    id: string;
    tenant_id?: string | null;
    tenant_name?: string | null;
    action: string;
    entity: string;
    entity_id?: string | null;
    payload?: Record<string, unknown> | null;
    ip_address?: string | null;
    created_at: string;
    user?: AuditUser | null;
}

const columnHelper = createColumnHelper<AdminAuditLogRow>();

/**
 * The platform-wide audit trail: every recorded action across every tenant.
 *
 * The tenant-side page at /settings/audit-logs reads the same table but is
 * pinned to one workspace. This one is the only place a platform admin can see
 * across workspaces, so the tenant column and the scope switch are the point of
 * it — `platform` (what staff did), `tenant` (one workspace, for support), and
 * `all` (everything).
 *
 * Platform-admin access is enforced by the `(app)` layout, which refuses to
 * render `/admin/*` until `/auth/me` confirms the viewer, and again by
 * `PlatformAdminGuard` on the endpoint. No local check is needed here.
 */
export default function AdminAuditLogsPage() {
    const { t } = useI18n();
    const m = t.admin.auditLogs;

    const [rows, setRows] = useState<AdminAuditLogRow[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [scope, setScope] = useState<Scope>('platform');
    const [tenantId, setTenantId] = useState('');
    const [entity, setEntity] = useState('');
    const [action, setAction] = useState('');
    const [userId, setUserId] = useState('');
    const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);
    const [offset, setOffset] = useState(0);
    const limit = 50;

    const loadLogs = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const data = await api.getAdminAuditLogs({
                scope,
                // Only meaningful for the single-workspace scope; sending it
                // otherwise would be ignored by the API anyway.
                tenant_id: scope === 'tenant' ? tenantId.trim() || undefined : undefined,
                entity: entity.trim() || undefined,
                action: action.trim() || undefined,
                user_id: userId.trim() || undefined,
                from: createdRange?.from,
                to: createdRange?.to,
                limit,
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
    }, [scope, tenantId, entity, action, userId, createdRange, offset, m.loadFailed]);

    useEffect(() => {
        void loadLogs();
    }, [loadLogs]);

    const columns: ColumnDef<AdminAuditLogRow, any>[] = useMemo(
        () => [
            createdAtColumn(columnHelper, { header: t.settings.audit.columns.when }),
            columnHelper.accessor((row) => row.tenant_name ?? row.tenant_id ?? '', {
                id: 'tenant',
                header: m.columns.tenant,
                cell: (info) => {
                    const row = info.row.original;
                    // A row with no tenant was written by a platform admin
                    // acting on the platform itself, not inside a workspace.
                    if (!row.tenant_id) {
                        return (
                            <span className="px-2 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-blue-50 text-blue-700 border border-blue-200">
                                {m.platformRow}
                            </span>
                        );
                    }
                    return (
                        <span className="text-sm text-gray-800" title={row.tenant_id}>
                            {row.tenant_name ?? row.tenant_id}
                        </span>
                    );
                },
                size: 160,
            }),
            columnHelper.accessor('action', {
                header: t.settings.audit.columns.action,
                cell: (info) => (
                    <span className="px-2 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-slate-100 text-slate-700 border border-slate-200">
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
                size: 160,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor((row) => row.user?.email ?? row.user?.name ?? '—', {
                id: 'user',
                header: t.settings.audit.columns.user,
                cell: (info) => <span className="text-sm text-gray-600">{info.getValue()}</span>,
                size: 180,
            }),
            columnHelper.accessor('ip_address', {
                header: m.columns.ip,
                cell: (info) => (
                    <span className="text-xs font-mono text-gray-500">{info.getValue() || '—'}</span>
                ),
                size: 120,
                meta: { hideOnMobile: true },
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
                size: 240,
                meta: { hideOnMobile: true },
            }),
        ],
        [t, m],
    );

    const page = Math.floor(offset / limit) + 1;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    // Every filter change restarts paging: page 3 of the old filter has no
    // meaning under the new one.
    const resetTo = <T,>(set: (value: T) => void) => (value: T) => {
        set(value);
        setOffset(0);
    };

    return (
        <PageShell maxWidth="full">
            <PageHeader
                title={m.title}
                subtitle={m.description}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.admin,
                    m.title,
                    'admin',
                )}
            />

            <div className="rounded-lg border border-gray-200 bg-white p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
                <label className="space-y-1">
                    <span className="text-xs font-medium text-gray-500">{m.scopeLabel}</span>
                    <Select
                        value={scope}
                        onChange={(e) => resetTo<Scope>(setScope)(e.target.value as Scope)}
                    >
                        <option value="platform">{m.scope.platform}</option>
                        <option value="tenant">{m.scope.tenant}</option>
                        <option value="all">{m.scope.all}</option>
                    </Select>
                </label>
                {scope === 'tenant' && (
                    <label className="space-y-1">
                        <span className="text-xs font-medium text-gray-500">{m.filters.tenant}</span>
                        <Input
                            type="text"
                            value={tenantId}
                            onChange={(e) => resetTo(setTenantId)(e.target.value)}
                            placeholder="tenant uuid…"
                        />
                    </label>
                )}
                <label className="space-y-1">
                    <span className="text-xs font-medium text-gray-500">{t.settings.audit.filters.entity}</span>
                    <Input
                        type="text"
                        value={entity}
                        onChange={(e) => resetTo(setEntity)(e.target.value)}
                        placeholder="sale, customer…"
                    />
                </label>
                <label className="space-y-1">
                    <span className="text-xs font-medium text-gray-500">{t.settings.audit.filters.action}</span>
                    <Input
                        type="text"
                        value={action}
                        onChange={(e) => resetTo(setAction)(e.target.value)}
                        placeholder="CREATE, UPDATE…"
                    />
                </label>
                <label className="space-y-1">
                    <span className="text-xs font-medium text-gray-500">{m.filters.user}</span>
                    <Input
                        type="text"
                        value={userId}
                        onChange={(e) => resetTo(setUserId)(e.target.value)}
                        placeholder="user uuid…"
                    />
                </label>
                <div className="flex items-end">
                    <CreatedRangeFilter
                        value={createdRange}
                        onChange={(next) => resetTo(setCreatedRange)(next)}
                    />
                </div>
            </div>

            {error && <Alert tone="danger" className="mt-4">{error}</Alert>}

            {loading ? (
                <div className="flex items-center justify-center py-20 text-gray-400">
                    <Loader2 className="w-6 h-6 animate-spin me-2" />
                    {t.common.loading}
                </div>
            ) : (
                <>
                    <DataTable
                        tableId="admin-audit-logs"
                        title={m.title}
                        data={rows}
                        columns={columns}
                        searchPlaceholder={t.settings.audit.searchPlaceholder}
                        emptyMessage={m.noLogs}
                    />
                    <div className="flex items-center justify-between text-sm text-gray-500 mt-4">
                        <span>
                            {t.settings.audit.showing} {rows.length} / {total}
                        </span>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="secondary"
                                disabled={offset === 0}
                                onClick={() => setOffset(Math.max(0, offset - limit))}
                            >
                                {t.settings.audit.prevPage}
                            </Button>
                            <span className="text-xs font-semibold">
                                {page} / {totalPages}
                            </span>
                            <Button
                                variant="secondary"
                                disabled={offset + limit >= total}
                                onClick={() => setOffset(offset + limit)}
                            >
                                {t.settings.audit.nextPage}
                            </Button>
                        </div>
                    </div>
                </>
            )}
        </PageShell>
    );
}
