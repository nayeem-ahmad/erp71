'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Crown, Repeat, Users, Wallet } from 'lucide-react';
import { DataTable, type ListStat } from '@/components/data-table';
import { PageShell } from '@/components/ui';
import PageHeader from '@/components/ui/compact/PageHeader';
import { api } from '@/lib/api';
import { formatBDT, formatCalendarDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { formatRate } from '@/components/crm/reports/format';
import type { RfmReport, RfmRow, RfmSegment, RfmSegmentRow } from '@/components/crm/reports/types';

const rowHelper = createColumnHelper<RfmRow>();
const segmentHelper = createColumnHelper<RfmSegmentRow & { label: string }>();

/** Colour a segment by what it means, not by its name's alphabetical order. */
const SEGMENT_TONE: Record<RfmSegment, string> = {
    champion: 'bg-emerald-50 text-emerald-700',
    loyal: 'bg-blue-50 text-blue-700',
    new: 'bg-blue-50 text-blue-700',
    needs_attention: 'bg-amber-50 text-amber-700',
    at_risk: 'bg-red-50 text-red-700',
    hibernating: 'bg-gray-100 text-gray-600',
};

export default function CrmRfmPage() {
    const { t, locale } = useI18n();
    const r = t.crm.reports;
    const copy = r.rfm;
    const dash = t.shared.dash;

    const [report, setReport] = useState<RfmReport | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const load = async () => {
        setLoading(true);
        try {
            const data = await api.getCrmRfm();
            setReport(data ?? null);
        } catch (err) {
            setReport(null);
            toast.error(err instanceof Error ? err.message : t.common.loadFailed);
        } finally {
            setLoading(false);
        }
    };

    const rows = report?.rows ?? [];
    const totals = report?.totals ?? { customers: 0, revenue: 0, repeat: 0 };
    const count = (value: number) => value.toLocaleString(locale);

    const segmentRows = useMemo(
        () => (report?.by_segment ?? []).map((row) => ({ ...row, label: copy.segments[row.segment] })),
        [report, copy.segments],
    );

    const columns: ColumnDef<RfmRow, any>[] = useMemo(() => [
        rowHelper.accessor('name', { header: copy.columns.customer, footer: () => t.accountingShared.totals, size: 200 }),
        rowHelper.accessor('segment', {
            header: copy.columns.segment,
            cell: (info) => (
                <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${SEGMENT_TONE[info.getValue()]}`}>
                    {copy.segments[info.getValue()]}
                </span>
            ),
            size: 140,
        }),
        rowHelper.accessor('orders', {
            header: copy.columns.orders,
            cell: (info) => count(Number(info.getValue())),
            size: 85,
            meta: { align: 'end' },
        }),
        rowHelper.accessor('recency_days', {
            header: copy.columns.daysSince,
            cell: (info) => count(Number(info.getValue())),
            size: 120,
            meta: { align: 'end', hideOnMobile: true },
        }),
        rowHelper.accessor('recency', { header: copy.columns.recency, size: 95, meta: { align: 'end', hideOnMobile: true } }),
        rowHelper.accessor('frequency', { header: copy.columns.frequency, size: 95, meta: { align: 'end', hideOnMobile: true } }),
        rowHelper.accessor('monetary', { header: copy.columns.monetary, size: 90, meta: { align: 'end', hideOnMobile: true } }),
        rowHelper.accessor('code', { header: copy.columns.code, size: 80, meta: { align: 'end' } }),
        rowHelper.accessor('revenue', {
            header: copy.columns.revenue,
            cell: (info) => formatBDT(Number(info.getValue()), { locale }),
            footer: () => formatBDT(totals.revenue, { locale }),
            size: 130,
            meta: { align: 'end' },
        }),
    ], [copy, locale, totals, t.accountingShared.totals]);

    const segmentColumns: ColumnDef<RfmSegmentRow & { label: string }, any>[] = useMemo(() => [
        segmentHelper.accessor('label', { id: 'label', header: copy.columnsSegment.segment, size: 160 }),
        segmentHelper.accessor('customers', {
            header: copy.columnsSegment.customers,
            cell: (info) => count(Number(info.getValue())),
            size: 110,
            meta: { align: 'end' },
        }),
        segmentHelper.accessor('revenue', {
            header: copy.columnsSegment.revenue,
            cell: (info) => formatBDT(Number(info.getValue()), { locale }),
            size: 140,
            meta: { align: 'end' },
        }),
        segmentHelper.accessor('share_pct', {
            id: 'share_pct',
            header: copy.columnsSegment.share,
            cell: (info) => formatRate(info.getValue(), locale, dash),
            size: 100,
            meta: { align: 'end' },
        }),
    ], [copy, locale, dash]);

    const stats = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const items: ListStat[] = [
            { id: 'customers', icon: <Users aria-hidden />, label: copy.customersStat, value: count(totals.customers) },
            { id: 'revenue', icon: <Wallet aria-hidden />, label: copy.revenueStat, value: money(totals.revenue) },
            { id: 'repeat', icon: <Repeat aria-hidden />, label: copy.repeatStat, value: count(totals.repeat) },
            { id: 'asOf', icon: <Crown aria-hidden />, label: copy.segmentSection, value: report ? formatCalendarDate(report.as_of, locale) : dash },
        ];
        return { items, loading: loading && !report, label: copy.statsLabel };
    }, [totals, report, loading, locale, copy, dash]);

    return (
        <PageShell>
            <PageHeader
                title={copy.title}
                subtitle={copy.subtitle}
                breadcrumbs={modulePageBreadcrumbs(t.dashboardHome.breadcrumbHome, t.sidebar.modules.crm, copy.title, 'crm')}
            />
            <DataTable<RfmRow>
                tableId="crm-rfm"
                columns={columns}
                data={rows}
                title={copy.title}
                isLoading={loading}
                emptyMessage={copy.empty}
                emptyIcon={<Crown className="w-16 h-16 text-gray-200" />}
                stats={stats}
                footerLabel={t.accountingShared.totals}
                enableColumnFilters={false}
                viewOptions
                getRowId={(row) => row.customer_id}
            />

            {segmentRows.length > 0 ? (
                <DataTable<RfmSegmentRow & { label: string }>
                    tableId="crm-rfm-segments"
                    columns={segmentColumns}
                    data={segmentRows}
                    title={copy.segmentSection}
                    emptyMessage={copy.empty}
                    enableColumnFilters={false}
                    getRowId={(row) => row.segment}
                />
            ) : null}

            <p className="text-xs text-gray-500">{copy.note}</p>
        </PageShell>
    );
}
