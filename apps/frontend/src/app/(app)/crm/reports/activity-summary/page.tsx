'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Activity, Layers, UserCheck, Users } from 'lucide-react';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { PageShell } from '@/components/ui';
import PageHeader from '@/components/ui/compact/PageHeader';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import type { CreatedRange } from '@/lib/created-range';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { useCrmMineOnly } from '@/lib/crm-scope';
import MineOnlyToggle from '@/components/crm/MineOnlyToggle';
import { formatRate } from '@/components/crm/reports/format';
import type { ActivitySummaryRow, CrmActivitySummaryReport } from '@/components/crm/reports/types';
import { defaultReportPeriod, reportPeriodFilter, reportPeriodQuery } from '../report-period';

/** The table wants a flat row; the payload keys counts by channel code. */
interface Row extends ActivitySummaryRow {
    key: string;
    label: string;
    [channel: string]: number | string | null | Record<string, number>;
}

const columnHelper = createColumnHelper<Row>();

const EMPTY_TOTALS: CrmActivitySummaryReport['totals'] = { total: 0, unspecified: 0, counts: {} };

export default function CrmActivitySummaryReportPage() {
    const { t, locale } = useI18n();
    const r = t.crm.reports;
    const c = r.common;
    const copy = r.activitySummary;
    const scope = t.crm.scope;
    const dash = t.shared.dash;

    const { mineOnly, setMineOnly, ready: scopeReady } = useCrmMineOnly();
    const [period, setPeriod] = useState<CreatedRange>(defaultReportPeriod);
    const [report, setReport] = useState<CrmActivitySummaryReport | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!scopeReady) return;
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scopeReady, mineOnly, period]);

    const load = async () => {
        setLoading(true);
        try {
            const data = await api.getCrmActivitySummaryReport({ ...reportPeriodQuery(period), mine: mineOnly });
            setReport(data ?? null);
        } catch (err) {
            setReport(null);
            toast.error(err instanceof Error ? err.message : t.common.loadFailed);
        } finally {
            setLoading(false);
        }
    };

    const channels = report?.channels ?? [];
    const totals = report?.totals ?? EMPTY_TOTALS;
    const unspecified = totals.unspecified ?? 0;

    // Flatten each person's counts onto the row so every channel is a column,
    // and name the channels once here rather than in each cell.
    const rows = useMemo<Row[]>(() => {
        if (!report) return [];
        return report.rows.map((row) => ({
            ...row,
            key: row.user_id ?? 'unassigned',
            label: row.name ?? c.unassigned,
        }));
    }, [report, c.unassigned]);

    const count = (value: number | undefined) => (value ?? 0).toLocaleString(locale);

    const columns: ColumnDef<Row, any>[] = useMemo(() => {
        const channelColumns = channels.map((channel) =>
            columnHelper.accessor((row) => (row.counts[channel.code] ?? 0) as number, {
                id: channel.code,
                header: channel.name,
                cell: (info) => count(Number(info.getValue())),
                footer: () => count(totals.counts[channel.code]),
                size: 100,
                meta: { align: 'end' },
            }),
        );

        return [
            columnHelper.accessor('label', {
                id: 'user',
                header: copy.person,
                footer: () => t.accountingShared.totals,
                size: 190,
            }),
            ...channelColumns,
            columnHelper.accessor('total', {
                id: 'total',
                header: copy.total,
                cell: (info) => count(Number(info.getValue())),
                footer: () => count(totals.total),
                size: 90,
                meta: { align: 'end' },
            }),
            columnHelper.accessor('share_pct', {
                id: 'share_pct',
                header: copy.share,
                cell: (info) => formatRate(info.getValue(), locale, dash),
                footer: () => formatRate(100, locale, dash),
                size: 90,
                meta: { align: 'end', hideOnMobile: true },
            }),
        ];
    }, [channels, totals, copy, locale, dash, t.accountingShared.totals]);

    const filters = useMemo<ListFilter[]>(() => [
        reportPeriodFilter({ label: t.hr.listUi.period, value: period, onChange: setPeriod }),
    ], [t.hr.listUi.period, period]);

    const stats = useMemo(() => {
        const busiest = rows.reduce<Row | null>((best, row) => (!best || row.total > best.total ? row : best), null);
        const items: ListStat[] = [
            { id: 'total', icon: <Activity aria-hidden />, label: copy.total, value: count(totals.total) },
            { id: 'people', icon: <Users aria-hidden />, label: copy.people, value: rows.length.toLocaleString(locale) },
            { id: 'types', icon: <Layers aria-hidden />, label: copy.typesUsed, value: channels.length.toLocaleString(locale) },
            {
                id: 'busiest',
                icon: <UserCheck aria-hidden />,
                label: copy.busiest,
                value: busiest ? busiest.label : dash,
                hint: busiest ? count(busiest.total) : undefined,
            },
        ];
        return { items, loading: loading && !report, label: copy.statsLabel };
    }, [rows, channels, totals, loading, report, locale, copy, dash]);

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

            <DataTable<Row>
                tableId="crm-activity-summary"
                columns={columns}
                data={rows}
                title={copy.title}
                isLoading={loading}
                emptyMessage={copy.empty}
                emptyIcon={<Activity className="w-16 h-16 text-gray-200" />}
                filters={filters}
                filterLayout="row"
                stats={stats}
                footerLabel={t.accountingShared.totals}
                enableColumnFilters={false}
                viewOptions
                getRowId={(row) => row.key}
            />

            <div className="space-y-1">
                <p className="text-xs text-gray-500">{copy.completedNote}</p>
                {unspecified > 0 ? (
                    <p className="text-xs text-amber-700">
                        {copy.unspecifiedNote.replace('{count}', unspecified.toLocaleString(locale))}
                    </p>
                ) : null}
            </div>
        </PageShell>
    );
}
