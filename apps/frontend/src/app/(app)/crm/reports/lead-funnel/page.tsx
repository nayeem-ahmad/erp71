'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Filter, TrendingUp, UserPlus, Users } from 'lucide-react';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { PageShell } from '@/components/ui';
import PageHeader from '@/components/ui/compact/PageHeader';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import type { CreatedRange } from '@/lib/created-range';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { formatRate } from '@/components/crm/reports/format';
import type { FunnelRow, LeadFunnelReport } from '@/components/crm/reports/types';
import { defaultReportPeriod, reportPeriodFilter, reportPeriodQuery } from '../report-period';

const columnHelper = createColumnHelper<FunnelRow>();

const EMPTY_TOTALS: LeadFunnelReport['totals'] = {
    arrived: 0, converted: 0, lost: 0, open: 0, conversion_pct: null,
};

export default function CrmLeadFunnelPage() {
    const { t, locale } = useI18n();
    const r = t.crm.reports;
    const copy = r.leadFunnel;
    const dash = t.shared.dash;

    const [period, setPeriod] = useState<CreatedRange>(defaultReportPeriod);
    const [report, setReport] = useState<LeadFunnelReport | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [period]);

    const load = async () => {
        setLoading(true);
        try {
            const data = await api.getCrmLeadFunnel({ ...reportPeriodQuery(period), mine: false });
            setReport(data ?? null);
        } catch (err) {
            setReport(null);
            toast.error(err instanceof Error ? err.message : t.common.loadFailed);
        } finally {
            setLoading(false);
        }
    };

    const rows = report?.rows ?? [];
    const totals = report?.totals ?? EMPTY_TOTALS;
    const count = (value: number) => value.toLocaleString(locale);

    const columns: ColumnDef<FunnelRow, any>[] = useMemo(() => [
        columnHelper.accessor('month', { id: 'month', header: copy.columns.month, footer: () => t.accountingShared.totals, size: 110 }),
        columnHelper.accessor('arrived', {
            header: copy.columns.arrived,
            cell: (info) => count(Number(info.getValue())),
            footer: () => count(totals.arrived),
            size: 90,
            meta: { align: 'end' },
        }),
        columnHelper.accessor('new', {
            header: copy.columns.new,
            cell: (info) => count(Number(info.getValue())),
            size: 80,
            meta: { align: 'end', hideOnMobile: true },
        }),
        columnHelper.accessor('contacted', {
            header: copy.columns.contacted,
            cell: (info) => count(Number(info.getValue())),
            size: 100,
            meta: { align: 'end', hideOnMobile: true },
        }),
        columnHelper.accessor('qualified', {
            header: copy.columns.qualified,
            cell: (info) => count(Number(info.getValue())),
            size: 95,
            meta: { align: 'end', hideOnMobile: true },
        }),
        columnHelper.accessor('converted', {
            header: copy.columns.converted,
            cell: (info) => count(Number(info.getValue())),
            footer: () => count(totals.converted),
            size: 100,
            meta: { align: 'end' },
        }),
        columnHelper.accessor('lost', {
            header: copy.columns.lost,
            cell: (info) => count(Number(info.getValue())),
            footer: () => count(totals.lost),
            size: 80,
            meta: { align: 'end' },
        }),
        columnHelper.accessor('open', {
            header: copy.columns.open,
            cell: (info) => count(Number(info.getValue())),
            footer: () => count(totals.open),
            size: 105,
            meta: { align: 'end' },
        }),
        columnHelper.accessor('conversion_pct', {
            id: 'conversion_pct',
            header: copy.columns.conversion,
            cell: (info) => formatRate(info.getValue(), locale, dash),
            footer: () => formatRate(totals.conversion_pct, locale, dash),
            size: 110,
            meta: { align: 'end' },
        }),
    ], [copy, locale, dash, totals, t.accountingShared.totals]);

    const filters = useMemo<ListFilter[]>(() => [
        reportPeriodFilter({ label: t.hr.listUi.period, value: period, onChange: setPeriod }),
    ], [t.hr.listUi.period, period]);

    const stats = useMemo(() => {
        const items: ListStat[] = [
            { id: 'arrived', icon: <UserPlus aria-hidden />, label: copy.arrivedStat, value: count(totals.arrived) },
            { id: 'converted', icon: <TrendingUp aria-hidden />, label: copy.convertedStat, value: count(totals.converted) },
            { id: 'open', icon: <Users aria-hidden />, label: copy.openStat, value: count(totals.open) },
            { id: 'rate', icon: <Filter aria-hidden />, label: copy.rateStat, value: formatRate(totals.conversion_pct, locale, dash) },
        ];
        return { items, loading: loading && !report, label: copy.statsLabel };
    }, [totals, loading, report, locale, copy, dash]);

    return (
        <PageShell>
            <PageHeader
                title={copy.title}
                subtitle={copy.subtitle}
                breadcrumbs={modulePageBreadcrumbs(t.dashboardHome.breadcrumbHome, t.sidebar.modules.crm, copy.title, 'crm')}
            />
            <DataTable<FunnelRow>
                tableId="crm-lead-funnel"
                columns={columns}
                data={rows}
                title={copy.title}
                isLoading={loading}
                emptyMessage={copy.empty}
                emptyIcon={<Filter className="w-16 h-16 text-gray-200" />}
                filters={filters}
                filterLayout="row"
                stats={stats}
                footerLabel={t.accountingShared.totals}
                enableColumnFilters={false}
                viewOptions
                getRowId={(row) => row.month}
            />
            <p className="text-xs text-gray-500">{copy.note}</p>
        </PageShell>
    );
}
