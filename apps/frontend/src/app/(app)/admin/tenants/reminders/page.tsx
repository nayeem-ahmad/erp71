'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { BellRing, Loader2 } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { DataTable } from '@/components/data-table';
import type { LedgerEvent, TenantRecord } from '@/components/admin/tenants/types';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';

const columnHelper = createColumnHelper<LedgerEvent>();

export default function AdminTenantRemindersPage() {
    const { t } = useI18n();
    const m = t.admin.tenants;
    const rp = m.remindersPage;

    const [tenants, setTenants] = useState<TenantRecord[]>([]);
    const [tenantFilter, setTenantFilter] = useState('');
    const [events, setEvents] = useState<LedgerEvent[]>([]);
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(true);

    const loadReminders = useCallback(async () => {
        setIsLoading(true);
        setError('');
        try {
            const rows: LedgerEvent[] = await api.getAdminTenantReminders({
                tenantId: tenantFilter || undefined,
            });
            setEvents(rows);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : rp.loadFailed);
        } finally {
            setIsLoading(false);
        }
    }, [rp.loadFailed, tenantFilter]);

    useEffect(() => {
        api.getAdminTenants({})
            .then((rows) => setTenants(rows))
            .catch(() => null);
    }, []);

    useEffect(() => {
        void loadReminders();
    }, [loadReminders]);

    const columns: ColumnDef<LedgerEvent, unknown>[] = useMemo(() => [
        columnHelper.accessor('created_at', {
            header: rp.columns.date,
            cell: (info) => formatDate(info.getValue()),
        }),
        columnHelper.accessor('tenant_name', {
            header: rp.columns.tenant,
            cell: (info) => info.getValue() ?? '—',
        }),
        columnHelper.accessor('event_type', {
            header: rp.columns.type,
            cell: (info) => {
                const type = info.getValue();
                return (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-amber-700">
                        <BellRing className="w-2.5 h-2.5" />
                        {(rp.eventType as Record<string, string>)[type] ?? type}
                    </span>
                );
            },
        }),
        columnHelper.accessor('amount', {
            header: rp.columns.amount,
            cell: (info) => {
                const value = info.getValue();
                return (
                    <span className="font-black text-gray-700">
                        {value !== null ? `৳${Number(value).toFixed(2)}` : '—'}
                    </span>
                );
            },
        }),
        columnHelper.accessor('status', {
            header: rp.columns.status,
            cell: (info) => <span className="text-gray-500">{info.getValue() || '—'}</span>,
        }),
    ], [rp.columns, rp.eventType]);

    return (
        <div className="overflow-y-auto h-full bg-canvas p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="w-full space-y-4">
                <PageHeader
                    title={rp.title}
                    subtitle={rp.subtitle}
                    breadcrumbs={nestedPageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.admin,
                        'admin',
                        [{ label: m.title, href: '/admin/tenants' }],
                        rp.title,
                    )}
                />

                {error && (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                        {error}
                    </div>
                )}

                <div className="max-w-md">
                    <select
                        value={tenantFilter}
                        onChange={(e) => setTenantFilter(e.target.value)}
                        className="w-full rounded-2xl border border-gray-100 bg-white px-4 py-3 text-sm font-medium outline-none"
                    >
                        <option value="">{rp.allTenants}</option>
                        {tenants.map((tenant) => (
                            <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
                        ))}
                    </select>
                </div>

                {isLoading ? (
                    <div className="flex items-center gap-2 rounded-3xl border border-gray-100 bg-white p-8 text-sm text-gray-500">
                        <Loader2 className="w-4 h-4 animate-spin" /> {m.loading}
                    </div>
                ) : (
                    <DataTable
                        tableId="admin-tenant-reminders"
                        columns={columns}
                        data={events}
                        title={rp.title}
                        emptyMessage={rp.noReminders}
                    />
                )}
            </div>
        </div>
    );
}
