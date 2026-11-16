'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Target, TrendingUp, UserPlus, Wallet } from 'lucide-react';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import type { CreatedRange } from '@/lib/created-range';
import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell } from '@/components/ui';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { useCrmMineOnly } from '@/lib/crm-scope';
import MineOnlyToggle from '@/components/crm/MineOnlyToggle';
import { formatRate } from '@/components/crm/reports/format';
import type { LeadSourceReport, LeadSourceRow } from '@/components/crm/reports/types';
import { defaultReportPeriod, reportPeriodFilter, reportPeriodQuery } from '../report-period';

const columnHelper = createColumnHelper<LeadSourceRow>();

const EMPTY_TOTALS: LeadSourceReport['totals'] = {
    leads: 0,
    contacted: 0,
    contacted_pct: null,
    open: 0,
    converted: 0,
    lost: 0,
    conversion_pct: null,
    win_rate_pct: null,
    median_days_to_convert: null,
    revenue: 0,
    revenue_per_lead: null,
};

export default function CrmLeadSourceReportPage() {
    const { t, locale } = useI18n();
    const r = t.crm.reports;
    const c = r.common;
    const copy = r.leadSources;
    const scope = t.crm.scope;
    const dash = t.shared.dash;

    const { mineOnly, setMineOnly, ready: scopeReady } = useCrmMineOnly();
    const [period, setPeriod] = useState<CreatedRange>(defaultReportPeriod);
    const [report, setReport] = useState<LeadSourceReport | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!scopeReady) return;
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scopeReady, mineOnly, period]);

    const load = async () => {
        setLoading(true);
        try {
            const data = await api.getCrmLeadSourceReport({ ...reportPeriodQuery(period), mine: mineOnly });
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

    const columns: ColumnDef<LeadSourceRow, any>[] = useMemo(() => [
        columnHelper.accessor((row) => row.name ?? c.unspecifiedSource, {
            id: 'source',
            header: copy.columns.source,
            footer: () => t.accountingShared.totals,
            size: 200,
        }),
        columnHelper.accessor('leads', {
            header: copy.columns.leads,
            cell: (info) => Number(info.getValue()).toLocaleString(locale),
            footer: () => totals.leads.toLocaleString(locale),
            size: 80,
            meta: { align: 'end' },
        }),
        columnHelper.accessor('contacted_pct', {
            header: copy.columns.contacted,
            cell: (info) => formatRate(info.getValue(), locale, dash),
            footer: () => formatRate(totals.contacted_pct, locale, dash),
            size: 100,
            meta: { align: 'end' },
        }),
        columnHelper.accessor('open', {
            header: copy.columns.open,
            cell: (info) => Number(info.getValue()).toLocaleString(locale),
            footer: () => totals.open.toLocaleString(locale),
            size: 80,
            meta: { align: 'end' },
        }),
        columnHelper.accessor('converted', {
            header: copy.columns.converted,
            cell: (info) => Number(info.getValue()).toLocaleString(locale),
            footer: () => totals.converted.toLocaleString(locale),
            size: 90,
            meta: { align: 'end' },
        }),
        columnHelper.accessor('lost', {
            header: copy.columns.lost,
            cell: (info) => Number(info.getValue()).toLocaleString(locale),
            footer: () => totals.lost.toLocaleString(locale),
            size: 80,
            meta: { align: 'end' },
        }),
        columnHelper.accessor('conversion_pct', {
            header: copy.columns.conversion,
            cell: (info) => formatRate(info.getValue(), locale, dash),
            footer: () => formatRate(totals.conversion_pct, locale, dash),
            size: 110,
            meta: { align: 'end' },
        }),
        columnHelper.accessor('win_rate_pct', {
            header: copy.columns.winRate,
            cell: (info) => formatRate(info.getValue(), locale, dash),
            footer: () => formatRate(totals.win_rate_pct, locale, dash),
            size: 100,
            meta: { align: 'end' },
        }),
        columnHelper.accessor('median_days_to_convert', {
            header: copy.columns.medianDays,
            cell: (info) => info.getValue() == null ? dash : Number(info.getValue()).toLocaleString(locale),
            footer: () => totals.median_days_to_convert == null ? dash : totals.median_days_to_convert.toLocaleString(locale),
            size: 120,
            meta: { align: 'end', hideOnMobile: true },
        }),
        columnHelper.accessor('revenue', {
            header: copy.columns.revenue,
            cell: (info) => formatBDT(Number(info.getValue()), { locale }),
            footer: () => formatBDT(totals.revenue, { locale }),
            size: 130,
            meta: { align: 'end' },
        }),
        columnHelper.accessor('revenue_per_lead', {
            header: copy.columns.revenuePerLead,
            cell: (info) => info.getValue() == null ? dash : formatBDT(Number(info.getValue()), { locale }),
            footer: () => totals.revenue_per_lead == null ? dash : formatBDT(totals.revenue_per_lead, { locale }),
            size: 120,
            meta: { align: 'end', hideOnMobile: true },
        }),
    ], [c, copy, locale, dash, totals, t.accountingShared.totals]);

    const filters = useMemo<ListFilter[]>(() => [
        reportPeriodFilter({ label: t.hr.listUi.period, value: period, onChange: setPeriod }),
    ], [t.hr.listUi.period, period]);

    const stats = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const items: ListStat[] = [
            { id: 'leads', icon: <UserPlus aria-hidden />, label: copy.columns.leads, value: totals.leads.toLocaleString(locale) },
            { id: 'conversion', icon: <Target aria-hidden />, label: copy.columns.conversion, value: formatRate(totals.conversion_pct, locale, dash) },
            { id: 'revenue', icon: <Wallet aria-hidden />, label: copy.columns.revenue, value: money(totals.revenue) },
            { id: 'converted', icon: <TrendingUp aria-hidden />, label: copy.columns.converted, value: totals.converted.toLocaleString(locale) },
        ];
        return { items, loading: loading && !report, label: c.statsLabel };
    }, [totals, loading, report, locale, copy, c, dash]);

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
                actions={(
                    <MineOnlyToggle
                        value={mineOnly}
                        onChange={setMineOnly}
                        label={scope.mineOnly}
                        title={scope.mineOnlyHint}
                    />
                )}
            />

            <DataTable<LeadSourceRow>
                tableId="crm-lead-sources"
                columns={columns}
                data={rows}
                title={copy.title}
                isLoading={loading}
                emptyMessage={copy.empty}
                emptyIcon={<TrendingUp className="w-16 h-16 text-gray-200" />}
                filters={filters}
                filterLayout="row"
                stats={stats}
                footerLabel={t.accountingShared.totals}
                enableColumnFilters={false}
                viewOptions
            />

            <p className="text-xs text-gray-500">{copy.revenueNote}</p>
        </PageShell>
    );
}
