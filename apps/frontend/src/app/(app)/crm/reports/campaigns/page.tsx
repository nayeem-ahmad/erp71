'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Megaphone, Package, ShoppingCart, Wallet } from 'lucide-react';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { PageShell } from '@/components/ui';
import PageHeader from '@/components/ui/compact/PageHeader';
import { api } from '@/lib/api';
import { formatBDT, formatCalendarDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import type { CreatedRange } from '@/lib/created-range';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { formatRate } from '@/components/crm/reports/format';
import type { CampaignPerformanceReport, CampaignPerformanceRow } from '@/components/crm/reports/types';
import { defaultReportPeriod, reportPeriodFilter, reportPeriodQuery } from '../report-period';

const columnHelper = createColumnHelper<CampaignPerformanceRow>();

const EMPTY: CampaignPerformanceReport = {
    filters: { from: '', to: '', mine: false },
    rows: [],
    by_channel: [],
    totals: { campaigns: 0, recipients: 0, delivered: 0, failed: 0, orders: 0, revenue: 0, delivery_pct: null, conversion_pct: null },
};

export default function CrmCampaignPerformancePage() {
    const { t, locale } = useI18n();
    const r = t.crm.reports;
    const copy = r.campaigns;
    const dash = t.shared.dash;

    const [period, setPeriod] = useState<CreatedRange>(defaultReportPeriod);
    const [report, setReport] = useState<CampaignPerformanceReport | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [period]);

    const load = async () => {
        setLoading(true);
        try {
            const data = await api.getCrmCampaignPerformance({ ...reportPeriodQuery(period), mine: false });
            setReport(data ?? null);
        } catch (err) {
            setReport(null);
            toast.error(err instanceof Error ? err.message : t.common.loadFailed);
        } finally {
            setLoading(false);
        }
    };

    const current = report ?? EMPTY;
    const rows = current.rows;
    const totals = current.totals;
    const count = (value: number) => value.toLocaleString(locale);

    const columns: ColumnDef<CampaignPerformanceRow, any>[] = useMemo(() => [
        columnHelper.accessor('name', { header: copy.columns.campaign, footer: () => t.accountingShared.totals, size: 180 }),
        columnHelper.accessor('channel', { header: copy.columns.channel, size: 100, meta: { hideOnMobile: true } }),
        columnHelper.accessor('sent_at', {
            header: copy.columns.sent,
            cell: (info) => info.getValue() ? formatCalendarDate(String(info.getValue()).slice(0, 10), locale) : dash,
            size: 110,
            meta: { hideOnMobile: true },
        }),
        columnHelper.accessor('recipients', {
            header: copy.columns.recipients,
            cell: (info) => count(Number(info.getValue())),
            footer: () => count(totals.recipients),
            size: 100,
            meta: { align: 'end' },
        }),
        columnHelper.accessor('delivery_pct', {
            id: 'deliveryPct',
            header: copy.columns.delivery,
            cell: (info) => formatRate(info.getValue(), locale, dash),
            footer: () => formatRate(totals.delivery_pct, locale, dash),
            size: 105,
            meta: { align: 'end' },
        }),
        columnHelper.accessor('orders', {
            header: copy.columns.orders,
            cell: (info) => count(Number(info.getValue())),
            footer: () => count(totals.orders),
            size: 85,
            meta: { align: 'end' },
        }),
        columnHelper.accessor('conversion_pct', {
            id: 'conversionPct',
            header: copy.columns.conversion,
            cell: (info) => formatRate(info.getValue(), locale, dash),
            footer: () => formatRate(totals.conversion_pct, locale, dash),
            size: 110,
            meta: { align: 'end', hideOnMobile: true },
        }),
        columnHelper.accessor('revenue', {
            header: copy.columns.revenue,
            cell: (info) => formatBDT(Number(info.getValue()), { locale }),
            footer: () => formatBDT(totals.revenue, { locale }),
            size: 130,
            meta: { align: 'end' },
        }),
        columnHelper.accessor('revenue_per_order', {
            header: copy.columns.perOrder,
            cell: (info) => info.getValue() == null ? dash : formatBDT(Number(info.getValue()), { locale }),
            size: 125,
            meta: { align: 'end', hideOnMobile: true },
        }),
    ], [copy, locale, dash, totals, t.accountingShared.totals]);

    const filters = useMemo<ListFilter[]>(() => [
        reportPeriodFilter({ label: t.hr.listUi.period, value: period, onChange: setPeriod }),
    ], [t.hr.listUi.period, period]);

    const stats = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const items: ListStat[] = [
            { id: 'campaigns', icon: <Megaphone aria-hidden />, label: copy.campaignCount, value: count(totals.campaigns) },
            { id: 'recipients', icon: <Package aria-hidden />, label: copy.columns.recipients, value: count(totals.recipients) },
            { id: 'orders', icon: <ShoppingCart aria-hidden />, label: copy.columns.orders, value: count(totals.orders) },
            { id: 'revenue', icon: <Wallet aria-hidden />, label: copy.columns.revenue, value: money(totals.revenue) },
        ];
        return { items, loading: loading && !report, label: copy.statsLabel };
    }, [totals, loading, report, locale, copy]);

    return (
        <PageShell>
            <PageHeader
                title={copy.title}
                subtitle={copy.subtitle}
                breadcrumbs={modulePageBreadcrumbs(t.dashboardHome.breadcrumbHome, t.sidebar.modules.crm, copy.title, 'crm')}
            />
            <DataTable<CampaignPerformanceRow>
                tableId="crm-campaign-performance"
                columns={columns}
                data={rows}
                title={copy.title}
                isLoading={loading}
                emptyMessage={copy.empty}
                emptyIcon={<Megaphone className="w-16 h-16 text-gray-200" />}
                filters={filters}
                filterLayout="row"
                stats={stats}
                footerLabel={t.accountingShared.totals}
                enableColumnFilters={false}
                viewOptions
                getRowId={(row) => row.campaign_id}
            />
            <p className="text-xs text-gray-500">{copy.sentNote}</p>
        </PageShell>
    );
}
