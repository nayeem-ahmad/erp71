'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Clock, PhoneOff, ShoppingBag, Wallet } from 'lucide-react';
import { DataTable, type ListStat } from '@/components/data-table';
import GroupByChip from '@/components/hr/GroupByChip';
import { BranchFilter, PageShell } from '@/components/ui';
import PageHeader from '@/components/ui/compact/PageHeader';
import { api } from '@/lib/api';
import { formatBDT, formatCalendarDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { handleBranchForbidden, useBranchScope } from '@/lib/branch-scope';
import { routes } from '@/lib/routes';
import type { ColdCustomerRow, ColdCustomersReport } from '@/components/crm/reports/types';

const columnHelper = createColumnHelper<ColdCustomerRow>();

const FACTORS = [1.5, 2, 3] as const;
const DEFAULT_FACTOR = 2;

export default function CrmColdCustomersReportPage() {
    const { t, locale } = useI18n();
    const r = t.crm.reports;
    const c = r.common;
    const copy = r.coldCustomers;
    const dash = t.shared.dash;

    const branch = useBranchScope();
    const [factor, setFactor] = useState<number>(DEFAULT_FACTOR);
    const [report, setReport] = useState<ColdCustomersReport | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!branch.ready) return;
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branch.ready, branch.apiStoreId, factor]);

    const load = async () => {
        setLoading(true);
        try {
            const data = await api.getColdCustomers({ storeId: branch.apiStoreId, factor });
            setReport(data ?? null);
        } catch (err) {
            setReport(null);
            if (handleBranchForbidden(err, branch, t.dashboardLayout.branchFilterForbidden)) return;
            toast.error(err instanceof Error ? err.message : t.common.loadFailed);
        } finally {
            setLoading(false);
        }
    };

    const rows = report?.rows ?? [];
    const total = report?.total ?? 0;
    const truncated = report?.truncated ?? false;

    const count = (value: number) => value.toLocaleString(locale);

    const columns: ColumnDef<ColdCustomerRow, any>[] = useMemo(() => [
        columnHelper.accessor('name', {
            header: copy.columns.customer,
            cell: (info) => (
                <Link href={routes.sales.customerDetail(info.row.original.customer_id)} className="hover:text-blue-600">
                    {info.getValue()}
                </Link>
            ),
            size: 200,
        }),
        columnHelper.accessor((row) => row.phone ?? dash, {
            id: 'phone',
            header: copy.columns.phone,
            size: 130,
            meta: { hideOnMobile: true },
        }),
        columnHelper.accessor('segment', {
            header: copy.columns.segment,
            size: 120,
            meta: { hideOnMobile: true },
        }),
        columnHelper.accessor('orders', {
            header: copy.columns.orders,
            cell: (info) => count(Number(info.getValue())),
            size: 80,
            meta: { align: 'end' },
        }),
        columnHelper.accessor('lifetime_spend', {
            header: copy.columns.lifetimeSpend,
            cell: (info) => formatBDT(Number(info.getValue()), { locale }),
            size: 130,
            meta: { align: 'end' },
        }),
        columnHelper.accessor('avg_gap_days', {
            header: copy.columns.usualGap,
            cell: (info) => Number(info.getValue()).toLocaleString(locale, { maximumFractionDigits: 1 }),
            size: 100,
            meta: { align: 'end', hideOnMobile: true },
        }),
        columnHelper.accessor('days_since_last', {
            header: copy.columns.daysSince,
            cell: (info) => count(Number(info.getValue())),
            size: 120,
            meta: { align: 'end' },
        }),
        columnHelper.accessor('overdue_days', {
            header: copy.columns.overdueBy,
            cell: (info) => (
                <span className="font-semibold tabular-nums text-amber-700">{count(Number(info.getValue()))}</span>
            ),
            size: 105,
            meta: { align: 'end' },
        }),
        columnHelper.accessor('last_contacted_at', {
            header: copy.columns.lastContacted,
            cell: (info) => info.getValue() ? formatCalendarDate(String(info.getValue()).slice(0, 10), locale) : copy.never,
            size: 130,
            meta: { hideOnMobile: true },
        }),
        columnHelper.accessor('has_open_follow_up', {
            header: copy.columns.followUp,
            cell: (info) => info.getValue() ? (
                <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                    {copy.planned}
                </span>
            ) : dash,
            size: 140,
        }),
    ], [copy, locale, dash]);

    const stats = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const spend = rows.reduce((sum, row) => sum + row.lifetime_spend, 0);
        const items: ListStat[] = [
            { id: 'total', icon: <PhoneOff aria-hidden />, label: copy.columns.customer, value: count(total) },
            { id: 'spend', icon: <Wallet aria-hidden />, label: copy.columns.lifetimeSpend, value: money(spend) },
            { id: 'orders', icon: <ShoppingBag aria-hidden />, label: copy.columns.orders, value: count(rows.reduce((sum, row) => sum + row.orders, 0)) },
            { id: 'factor', icon: <Clock aria-hidden />, label: copy.factor, value: copy.factorOption.replace('{factor}', String(factor)) },
        ];
        return { items, loading: loading && !report, label: c.statsLabel };
    }, [rows, total, factor, loading, report, locale, copy, c]);

    return (
        <PageShell>
            <PageHeader
                title={copy.title}
                subtitle={copy.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.crm,
                    copy.title,
                    'crm',
                )}
                actions={<BranchFilter scope={branch} />}
            />

            <DataTable<ColdCustomerRow>
                tableId="crm-cold-customers"
                columns={columns}
                data={rows}
                title={copy.title}
                isLoading={loading}
                emptyMessage={copy.empty}
                emptyIcon={<Clock className="w-16 h-16 text-gray-200" />}
                stats={stats}
                enableColumnFilters={false}
                viewOptions
                getRowId={(row) => row.customer_id}
                toolbarActions={(
                    <GroupByChip<string>
                        label={copy.factor}
                        value={String(factor)}
                        onChange={(next) => setFactor(Number(next))}
                        options={FACTORS.map((value) => ({
                            value: String(value),
                            label: copy.factorOption.replace('{factor}', String(value)),
                        }))}
                    />
                )}
            />

            <div className="space-y-1">
                <p className="text-xs text-gray-500">{copy.oneTimeNote}</p>
                {truncated ? (
                    <p className="text-xs text-amber-700">
                        {copy.truncatedNote
                            .replace('{shown}', count(rows.length))
                            .replace('{total}', count(total))}
                    </p>
                ) : null}
            </div>
        </PageShell>
    );
}
