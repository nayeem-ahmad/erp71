'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, CalendarClock, CheckCircle2, ListChecks } from 'lucide-react';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import GroupByChip from '@/components/hr/GroupByChip';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import type { CreatedRange } from '@/lib/created-range';
import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell } from '@/components/ui';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { useCrmMineOnly } from '@/lib/crm-scope';
import MineOnlyToggle from '@/components/crm/MineOnlyToggle';
import { formatRate } from '@/components/crm/reports/format';
import type { ComplianceCounts, FollowUpComplianceReport } from '@/components/crm/reports/types';
import { defaultReportPeriod, reportPeriodFilter, reportPeriodQuery } from '../report-period';

type GroupBy = 'person' | 'purpose';

interface Row extends ComplianceCounts {
    key: string;
    label: string;
}

const columnHelper = createColumnHelper<Row>();

const EMPTY_TOTALS: ComplianceCounts = {
    due: 0,
    on_time: 0,
    late: 0,
    overdue: 0,
    pending: 0,
    cancelled: 0,
    compliance_pct: null,
};

/** Emerald from 80%, amber from 50%, red below — the same bands the dashboard uses. */
function complianceTone(value: number | null): string {
    if (value === null) return 'text-gray-400';
    if (value >= 80) return 'text-emerald-700';
    if (value >= 50) return 'text-amber-700';
    return 'text-red-600';
}

export default function CrmFollowUpComplianceReportPage() {
    const { t, locale } = useI18n();
    const r = t.crm.reports;
    const c = r.common;
    const copy = r.followUps;
    const scope = t.crm.scope;
    const dash = t.shared.dash;

    const { mineOnly, setMineOnly, ready: scopeReady } = useCrmMineOnly();
    const [period, setPeriod] = useState<CreatedRange>(defaultReportPeriod);
    const [groupBy, setGroupBy] = useState<GroupBy>('person');
    const [report, setReport] = useState<FollowUpComplianceReport | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!scopeReady) return;
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scopeReady, mineOnly, period]);

    const load = async () => {
        setLoading(true);
        try {
            const data = await api.getCrmFollowUpCompliance({ ...reportPeriodQuery(period), mine: mineOnly });
            setReport(data ?? null);
        } catch (err) {
            setReport(null);
            toast.error(err instanceof Error ? err.message : t.common.loadFailed);
        } finally {
            setLoading(false);
        }
    };

    // Both groupings arrive in one payload, so switching is local.
    const rows = useMemo<Row[]>(() => {
        if (!report) return [];
        if (groupBy === 'purpose') {
            return report.by_purpose.map((row) => ({
                ...row,
                key: row.purpose_id ?? 'none',
                label: row.name ?? c.unspecifiedSource,
            }));
        }
        return report.by_assignee.map((row) => ({
            ...row,
            key: row.user_id ?? 'none',
            label: row.name ?? c.unassigned,
        }));
    }, [report, groupBy, c.unassigned, c.unspecifiedSource]);

    const totals = report?.totals ?? EMPTY_TOTALS;
    const undatedOpen = report?.undated_open ?? 0;

    const count = (value: number) => value.toLocaleString(locale);

    const columns: ColumnDef<Row, any>[] = useMemo(() => [
        columnHelper.accessor('label', {
            id: 'label',
            header: groupBy === 'purpose' ? copy.columns.purpose : copy.columns.person,
            footer: () => t.accountingShared.totals,
            size: 190,
        }),
        columnHelper.accessor('due', {
            header: copy.columns.due,
            cell: (info) => count(Number(info.getValue())),
            footer: () => count(totals.due),
            size: 90,
            meta: { align: 'end' },
        }),
        columnHelper.accessor('on_time', {
            header: copy.columns.onTime,
            cell: (info) => count(Number(info.getValue())),
            footer: () => count(totals.on_time),
            size: 90,
            meta: { align: 'end' },
        }),
        columnHelper.accessor('late', {
            header: copy.columns.late,
            cell: (info) => count(Number(info.getValue())),
            footer: () => count(totals.late),
            size: 80,
            meta: { align: 'end' },
        }),
        columnHelper.accessor('overdue', {
            header: copy.columns.overdue,
            cell: (info) => count(Number(info.getValue())),
            footer: () => count(totals.overdue),
            size: 90,
            meta: { align: 'end' },
        }),
        columnHelper.accessor('pending', {
            header: copy.columns.pending,
            cell: (info) => count(Number(info.getValue())),
            footer: () => count(totals.pending),
            size: 90,
            meta: { align: 'end', hideOnMobile: true },
        }),
        columnHelper.accessor('cancelled', {
            header: copy.columns.cancelled,
            cell: (info) => count(Number(info.getValue())),
            footer: () => count(totals.cancelled),
            size: 95,
            meta: { align: 'end', hideOnMobile: true },
        }),
        columnHelper.accessor('compliance_pct', {
            header: copy.columns.compliance,
            cell: (info) => (
                <span className={`font-semibold tabular-nums ${complianceTone(info.getValue())}`}>
                    {formatRate(info.getValue(), locale, dash)}
                </span>
            ),
            footer: () => formatRate(totals.compliance_pct, locale, dash),
            size: 110,
            meta: { align: 'end' },
        }),
    ], [copy, groupBy, locale, dash, totals, t.accountingShared.totals]);

    const filters = useMemo<ListFilter[]>(() => [
        reportPeriodFilter({ label: t.hr.listUi.period, value: period, onChange: setPeriod }),
    ], [t.hr.listUi.period, period]);

    const stats = useMemo(() => {
        const items: ListStat[] = [
            { id: 'due', icon: <ListChecks aria-hidden />, label: copy.columns.due, value: count(totals.due) },
            { id: 'onTime', icon: <CheckCircle2 aria-hidden />, label: copy.columns.onTime, value: count(totals.on_time) },
            { id: 'overdue', icon: <AlertTriangle aria-hidden />, label: copy.columns.overdue, value: count(totals.overdue), tone: 'danger' },
            { id: 'compliance', icon: <CalendarClock aria-hidden />, label: copy.columns.compliance, value: formatRate(totals.compliance_pct, locale, dash) },
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

            <DataTable<Row>
                tableId="crm-follow-up-compliance"
                columns={columns}
                data={rows}
                title={copy.title}
                isLoading={loading}
                emptyMessage={copy.empty}
                emptyIcon={<ListChecks className="w-16 h-16 text-gray-200" />}
                filters={filters}
                filterLayout="row"
                stats={stats}
                footerLabel={t.accountingShared.totals}
                enableColumnFilters={false}
                viewOptions
                getRowId={(row) => row.key}
                toolbarActions={(
                    <GroupByChip<GroupBy>
                        label={copy.groupBy}
                        value={groupBy}
                        onChange={setGroupBy}
                        options={[
                            { value: 'person', label: copy.byPerson },
                            { value: 'purpose', label: copy.byPurpose },
                        ]}
                    />
                )}
            />

            {undatedOpen > 0 ? (
                <p className="text-xs text-amber-700">{copy.undatedNote.replace('{count}', String(undatedOpen))}</p>
            ) : null}
        </PageShell>
    );
}
