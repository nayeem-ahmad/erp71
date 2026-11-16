'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, CalendarClock, Hourglass, Layers } from 'lucide-react';
import { DataTable, type ListStat } from '@/components/data-table';
import GroupByChip from '@/components/hr/GroupByChip';
import { PageShell } from '@/components/ui';
import PageHeader from '@/components/ui/compact/PageHeader';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { formatCalendarDate } from '@/lib/format';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { useCrmMineOnly } from '@/lib/crm-scope';
import MineOnlyToggle from '@/components/crm/MineOnlyToggle';
import { formatRate } from '@/components/crm/reports/format';
import type { LeadAgingReport } from '@/components/crm/reports/types';

type GroupBy = 'age' | 'stage';

interface Row {
    key: string;
    label: string;
    leads: number;
    share_pct: number | null;
    stale: number;
    oldest_days: number | null;
    avg_age_days: number | null;
}

const columnHelper = createColumnHelper<Row>();

const EMPTY_TOTALS: LeadAgingReport['totals'] = {
    open: 0,
    stale: 0,
    stale_pct: null,
    avg_age_days: null,
    oldest_days: null,
};

export default function CrmLeadAgingReportPage() {
    const { t, locale } = useI18n();
    const r = t.crm.reports;
    const c = r.common;
    const copy = r.leadAging;
    const scope = t.crm.scope;
    const dash = t.shared.dash;

    const { mineOnly, setMineOnly, ready: scopeReady } = useCrmMineOnly();
    const [groupBy, setGroupBy] = useState<GroupBy>('age');
    const [report, setReport] = useState<LeadAgingReport | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!scopeReady) return;
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scopeReady, mineOnly]);

    const load = async () => {
        setLoading(true);
        try {
            const data = await api.getCrmLeadAging({ mine: mineOnly });
            setReport(data ?? null);
        } catch (err) {
            setReport(null);
            toast.error(err instanceof Error ? err.message : t.common.loadFailed);
        } finally {
            setLoading(false);
        }
    };

    // Both groupings arrive in one payload, so switching is local — no refetch.
    const rows = useMemo<Row[]>(() => {
        if (!report) return [];
        // An empty pipeline draws the empty state rather than six zero rows: a
        // band with nothing in it is not a finding, and six of them read as a
        // broken table.
        if (report.totals.open === 0) return [];
        if (groupBy === 'stage') {
            return report.by_stage.map((row) => ({
                key: row.status,
                label: copy.stages[row.status as keyof typeof copy.stages] ?? row.status,
                leads: row.leads,
                share_pct: report.totals.open > 0
                    ? Math.round((row.leads / report.totals.open) * 1000) / 10
                    : null,
                stale: row.stale,
                oldest_days: row.oldest_days,
                avg_age_days: row.avg_age_days,
            }));
        }
        return report.buckets.map((row) => ({
            key: row.key,
            label: copy.buckets[row.key],
            leads: row.leads,
            share_pct: row.share_pct,
            stale: row.stale,
            oldest_days: row.oldest_days,
            avg_age_days: null,
        }));
    }, [report, groupBy, copy]);

    const totals = report?.totals ?? EMPTY_TOTALS;
    const count = (value: number) => value.toLocaleString(locale);
    const days = (value: number | null) => value == null ? dash : count(value);

    const columns: ColumnDef<Row, any>[] = useMemo(() => [
        columnHelper.accessor('label', {
            id: 'label',
            header: groupBy === 'stage' ? copy.columns.stage : copy.columns.bucket,
            footer: () => t.accountingShared.totals,
            size: 180,
        }),
        columnHelper.accessor('leads', {
            header: copy.columns.leads,
            cell: (info) => count(Number(info.getValue())),
            footer: () => count(totals.open),
            size: 110,
            meta: { align: 'end' },
        }),
        columnHelper.accessor('share_pct', {
            header: copy.columns.share,
            cell: (info) => formatRate(info.getValue(), locale, dash),
            footer: () => formatRate(100, locale, dash),
            size: 90,
            meta: { align: 'end', hideOnMobile: true },
        }),
        columnHelper.accessor('stale', {
            header: copy.columns.stale,
            cell: (info) => {
                const value = Number(info.getValue());
                return <span className={value > 0 ? 'font-semibold tabular-nums text-amber-700' : 'tabular-nums'}>{count(value)}</span>;
            },
            footer: () => count(totals.stale),
            size: 90,
            meta: { align: 'end' },
        }),
        columnHelper.accessor('avg_age_days', {
            header: copy.columns.average,
            cell: (info) => groupBy === 'stage' ? days(info.getValue()) : dash,
            footer: () => days(totals.avg_age_days),
            size: 110,
            meta: { align: 'end', hideOnMobile: true },
        }),
        columnHelper.accessor('oldest_days', {
            header: copy.columns.oldest,
            cell: (info) => days(info.getValue()),
            footer: () => days(totals.oldest_days),
            size: 110,
            meta: { align: 'end' },
        }),
    ], [copy, groupBy, locale, dash, totals, t.accountingShared.totals]);

    const stats = useMemo(() => {
        const items: ListStat[] = [
            { id: 'open', icon: <Layers aria-hidden />, label: copy.columns.leads, value: count(totals.open) },
            { id: 'stale', icon: <AlertTriangle aria-hidden />, label: copy.columns.stale, value: count(totals.stale), tone: totals.stale > 0 ? 'warning' : 'default' },
            { id: 'stalePct', icon: <CalendarClock aria-hidden />, label: copy.columns.share, value: formatRate(totals.stale_pct, locale, dash), hint: copy.columns.stale },
            { id: 'average', icon: <Hourglass aria-hidden />, label: copy.columns.average, value: days(totals.avg_age_days) },
        ];
        return { items, loading: loading && !report, label: copy.statsLabel };
    }, [totals, loading, report, locale, copy, dash]);

    const staleNote = copy.staleNote.replace('{days}', String(report?.stale_after_days ?? 14));
    const asOf = report ? copy.asOf.replace('{date}', formatCalendarDate(report.as_of, locale)) : null;

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
                tableId="crm-lead-aging"
                columns={columns}
                data={rows}
                title={copy.title}
                isLoading={loading}
                emptyMessage={copy.empty}
                emptyIcon={<Hourglass className="w-16 h-16 text-gray-200" />}
                stats={stats}
                footerLabel={t.accountingShared.totals}
                enableColumnFilters={false}
                viewOptions
                getRowId={(row) => row.key}
                toolbarActions={(
                    <GroupByChip<GroupBy>
                        label={c.groupBy}
                        value={groupBy}
                        onChange={setGroupBy}
                        options={[
                            { value: 'age', label: copy.columns.bucket },
                            { value: 'stage', label: copy.columns.stage },
                        ]}
                    />
                )}
            />

            <div className="space-y-1">
                <p className="text-xs text-gray-500">{copy.ageNote}</p>
                <p className="text-xs text-amber-700">{staleNote}</p>
                {asOf ? <p className="text-xs text-gray-500">{asOf}</p> : null}
            </div>
        </PageShell>
    );
}
