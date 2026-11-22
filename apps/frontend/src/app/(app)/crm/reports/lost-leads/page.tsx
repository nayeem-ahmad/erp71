'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Ban, CalendarClock, Timer } from 'lucide-react';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { PageShell } from '@/components/ui';
import PageHeader from '@/components/ui/compact/PageHeader';
import { api } from '@/lib/api';
import { formatCalendarDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import type { CreatedRange } from '@/lib/created-range';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { formatRate } from '@/components/crm/reports/format';
import type { LostLeadRow, LostLeadsReport, LostReasonRow } from '@/components/crm/reports/types';
import { defaultReportPeriod, reportPeriodFilter, reportPeriodQuery } from '../report-period';

const rowHelper = createColumnHelper<LostLeadRow>();
const reasonHelper = createColumnHelper<LostReasonRow & { label: string }>();

/** The server's sentinel for the folded tail — not a reason anyone typed. */
const OTHER_REASONS = '__other__';

export default function CrmLostLeadsPage() {
    const { t, locale } = useI18n();
    const r = t.crm.reports;
    const copy = r.lostLeads;
    const dash = t.shared.dash;

    const [period, setPeriod] = useState<CreatedRange>(defaultReportPeriod);
    const [report, setReport] = useState<LostLeadsReport | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [period]);

    const load = async () => {
        setLoading(true);
        try {
            const data = await api.getCrmLostLeads({ ...reportPeriodQuery(period), mine: false });
            setReport(data ?? null);
        } catch (err) {
            setReport(null);
            toast.error(err instanceof Error ? err.message : t.common.loadFailed);
        } finally {
            setLoading(false);
        }
    };

    const rows = report?.rows ?? [];
    const totals = report?.totals ?? { lost: 0, avg_days_open: null };
    const count = (value: number) => value.toLocaleString(locale);

    const reasonLabel = (reason: string | null) =>
        reason === null ? copy.noReason
            : reason === OTHER_REASONS ? copy.otherReasons
            : reason;

    const reasonRows = useMemo(
        () => (report?.by_reason ?? []).map((row) => ({ ...row, label: reasonLabel(row.reason) })),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [report, copy],
    );

    const columns: ColumnDef<LostLeadRow, any>[] = useMemo(() => [
        rowHelper.accessor('name', { header: copy.columns.lead, footer: () => t.accountingShared.totals, size: 200 }),
        rowHelper.accessor('reason', {
            header: copy.columns.reason,
            cell: (info) => reasonLabel(info.getValue()),
            size: 200,
        }),
        rowHelper.accessor('closed_at', {
            header: copy.columns.closed,
            cell: (info) => info.getValue() ? formatCalendarDate(String(info.getValue()), locale) : dash,
            size: 120,
            meta: { hideOnMobile: true },
        }),
        rowHelper.accessor('days_open', {
            header: copy.columns.daysOpen,
            cell: (info) => count(Number(info.getValue())),
            size: 110,
            meta: { align: 'end' },
        }),
    ], [copy, locale, dash, t.accountingShared.totals]);

    const reasonColumns: ColumnDef<LostReasonRow & { label: string }, any>[] = useMemo(() => [
        reasonHelper.accessor('label', { id: 'label', header: copy.columnsReason.reason, size: 240 }),
        reasonHelper.accessor('leads', {
            header: copy.columnsReason.leads,
            cell: (info) => count(Number(info.getValue())),
            size: 90,
            meta: { align: 'end' },
        }),
        reasonHelper.accessor('share_pct', {
            id: 'share_pct',
            header: copy.columnsReason.share,
            cell: (info) => formatRate(info.getValue(), locale, dash),
            size: 90,
            meta: { align: 'end' },
        }),
        reasonHelper.accessor('avg_days_open', {
            header: copy.columnsReason.avgDays,
            cell: (info) => info.getValue() == null ? dash : count(Number(info.getValue())),
            size: 120,
            meta: { align: 'end', hideOnMobile: true },
        }),
    ], [copy, locale, dash]);

    const filters = useMemo<ListFilter[]>(() => [
        reportPeriodFilter({ label: t.hr.listUi.period, value: period, onChange: setPeriod }),
    ], [t.hr.listUi.period, period]);

    const stats = useMemo(() => {
        const items: ListStat[] = [
            { id: 'lost', icon: <Ban aria-hidden />, label: copy.lostStat, value: count(totals.lost), tone: 'danger' },
            { id: 'avg', icon: <Timer aria-hidden />, label: copy.avgDaysStat, value: totals.avg_days_open == null ? dash : count(totals.avg_days_open) },
            { id: 'reasons', icon: <CalendarClock aria-hidden />, label: copy.reasonSection, value: reasonRows.length.toLocaleString(locale) },
        ];
        return { items, loading: loading && !report, label: copy.statsLabel };
    }, [totals, reasonRows.length, loading, report, locale, copy, dash]);

    return (
        <PageShell>
            <PageHeader
                title={copy.title}
                subtitle={copy.subtitle}
                breadcrumbs={modulePageBreadcrumbs(t.dashboardHome.breadcrumbHome, t.sidebar.modules.crm, copy.title, 'crm')}
            />
            <DataTable<LostLeadRow>
                tableId="crm-lost-leads"
                columns={columns}
                data={rows}
                title={copy.title}
                isLoading={loading}
                emptyMessage={copy.empty}
                emptyIcon={<Ban className="w-16 h-16 text-gray-200" />}
                filters={filters}
                filterLayout="row"
                stats={stats}
                footerLabel={t.accountingShared.totals}
                enableColumnFilters={false}
                viewOptions
                getRowId={(row) => row.lead_id}
            />

            {reasonRows.length > 0 ? (
                <DataTable<LostReasonRow & { label: string }>
                    tableId="crm-lost-leads-reasons"
                    columns={reasonColumns}
                    data={reasonRows}
                    title={copy.reasonSection}
                    emptyMessage={copy.empty}
                    enableColumnFilters={false}
                    getRowId={(row) => row.reason ?? 'none'}
                />
            ) : null}

            <p className="text-xs text-gray-500">{copy.note}</p>
        </PageShell>
    );
}
