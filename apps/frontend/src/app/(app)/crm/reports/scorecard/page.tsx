'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Activity, CheckCircle2, Trophy, Users, Wallet } from 'lucide-react';
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
import type { ScorecardReport, ScorecardRow } from '@/components/crm/reports/types';
import { defaultReportPeriod, reportPeriodFilter, reportPeriodQuery } from '../report-period';

const columnHelper = createColumnHelper<ScorecardRow>();

const EMPTY_TOTALS: ScorecardReport['totals'] = {
    open_leads: 0,
    new_leads: 0,
    activities_logged: 0,
    leads_touched: 0,
    follow_ups_due: 0,
    follow_ups_on_time_pct: null,
    overdue_now: 0,
    converted: 0,
    lost: 0,
    win_rate_pct: null,
    revenue: 0,
};

export default function CrmScorecardReportPage() {
    const { t, locale } = useI18n();
    const r = t.crm.reports;
    const c = r.common;
    const copy = r.scorecard;
    const scope = t.crm.scope;
    const dash = t.shared.dash;

    const { mineOnly, setMineOnly, ready: scopeReady } = useCrmMineOnly();
    const [period, setPeriod] = useState<CreatedRange>(defaultReportPeriod);
    const [report, setReport] = useState<ScorecardReport | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!scopeReady) return;
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scopeReady, mineOnly, period]);

    const load = async () => {
        setLoading(true);
        try {
            const data = await api.getCrmScorecard({ ...reportPeriodQuery(period), mine: mineOnly });
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

    const columns: ColumnDef<ScorecardRow, any>[] = useMemo(() => [
        columnHelper.accessor('name', {
            id: 'person',
            header: copy.columns.person,
            footer: () => t.accountingShared.totals,
            size: 180,
        }),
        columnHelper.accessor('open_leads', {
            header: copy.columns.openLeads,
            cell: (info) => count(Number(info.getValue())),
            footer: () => count(totals.open_leads),
            size: 100,
            meta: { align: 'end' },
        }),
        columnHelper.accessor('new_leads', {
            header: copy.columns.newLeads,
            cell: (info) => count(Number(info.getValue())),
            footer: () => count(totals.new_leads),
            size: 100,
            meta: { align: 'end', hideOnMobile: true },
        }),
        columnHelper.accessor('activities_logged', {
            header: copy.columns.activities,
            cell: (info) => count(Number(info.getValue())),
            footer: () => count(totals.activities_logged),
            size: 110,
            meta: { align: 'end' },
        }),
        columnHelper.accessor('leads_touched', {
            header: copy.columns.leadsTouched,
            cell: (info) => count(Number(info.getValue())),
            footer: () => count(totals.leads_touched),
            size: 110,
            meta: { align: 'end', hideOnMobile: true },
        }),
        columnHelper.accessor('follow_ups_due', {
            header: copy.columns.followUpsDue,
            cell: (info) => count(Number(info.getValue())),
            footer: () => count(totals.follow_ups_due),
            size: 110,
            meta: { align: 'end' },
        }),
        columnHelper.accessor('follow_ups_on_time_pct', {
            header: copy.columns.onTime,
            cell: (info) => formatRate(info.getValue(), locale, dash),
            footer: () => formatRate(totals.follow_ups_on_time_pct, locale, dash),
            size: 100,
            meta: { align: 'end' },
        }),
        columnHelper.accessor('overdue_now', {
            header: copy.columns.overdueNow,
            cell: (info) => count(Number(info.getValue())),
            footer: () => count(totals.overdue_now),
            size: 110,
            meta: { align: 'end' },
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
            meta: { align: 'end', hideOnMobile: true },
        }),
        columnHelper.accessor('win_rate_pct', {
            header: copy.columns.winRate,
            cell: (info) => formatRate(info.getValue(), locale, dash),
            footer: () => formatRate(totals.win_rate_pct, locale, dash),
            size: 100,
            meta: { align: 'end' },
        }),
        columnHelper.accessor('revenue', {
            header: copy.columns.revenue,
            cell: (info) => formatBDT(Number(info.getValue()), { locale }),
            footer: () => formatBDT(totals.revenue, { locale }),
            size: 140,
            meta: { align: 'end' },
        }),
    ], [copy, locale, dash, totals, t.accountingShared.totals]);

    const filters = useMemo<ListFilter[]>(() => [
        reportPeriodFilter({ label: t.hr.listUi.period, value: period, onChange: setPeriod }),
    ], [t.hr.listUi.period, period]);

    const stats = useMemo(() => {
        const money = (value: number) => formatBDT(value, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const items: ListStat[] = [
            { id: 'revenue', icon: <Wallet aria-hidden />, label: copy.columns.revenue, value: money(totals.revenue) },
            { id: 'activities', icon: <Activity aria-hidden />, label: copy.columns.activities, value: count(totals.activities_logged) },
            { id: 'onTime', icon: <CheckCircle2 aria-hidden />, label: copy.columns.onTime, value: formatRate(totals.follow_ups_on_time_pct, locale, dash) },
            { id: 'converted', icon: <Trophy aria-hidden />, label: copy.columns.converted, value: count(totals.converted) },
            { id: 'people', icon: <Users aria-hidden />, label: copy.columns.person, value: rows.length.toLocaleString(locale) },
        ];
        return { items, loading: loading && !report, label: c.statsLabel };
    }, [totals, rows.length, loading, report, locale, copy, c, dash]);

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

            <DataTable<ScorecardRow>
                tableId="crm-scorecard"
                columns={columns}
                data={rows}
                title={copy.title}
                isLoading={loading}
                emptyMessage={copy.empty}
                emptyIcon={<Trophy className="w-16 h-16 text-gray-200" />}
                filters={filters}
                filterLayout="row"
                stats={stats}
                footerLabel={t.accountingShared.totals}
                enableColumnFilters={false}
                viewOptions
                getRowId={(row) => row.user_id}
            />

            <p className="text-xs text-gray-500">{copy.revenueNote}</p>
        </PageShell>
    );
}
