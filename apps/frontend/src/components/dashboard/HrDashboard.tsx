'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';
import { useModuleDashboard } from '@/lib/use-module-dashboard';
import { routes } from '@/lib/routes';
import ModuleDashboard, {
    AttentionSection,
    DashboardSection,
    KpiTileGrid,
    type DashboardMount,
    type KpiTileSpec,
} from '@/components/dashboard/ModuleDashboard';
import { type AttentionItem } from '@/components/dashboard/AttentionStrip';
import { RankedListPanel, type RankedItem } from '@/components/dashboard/RankedListPanel';
import type { DashboardIdentity } from './dashboard-identity';

type OverviewResponse = {
    filters: { from: string; to: string };
    headcount: { active: number; inactive: number; joined_recently: number; no_department: number };
    attendance: {
        counts: Record<string, number>;
        records: number;
        rate_pct: number | null;
        absent_today: number;
        unrecorded_today: number;
    };
    leave: { pending: number; approved_days: number; on_leave_today: number };
    payroll: {
        paid_in_period: number;
        payments: number;
        monthly_commitment: number;
        employees_without_salary: number;
    } | null;
    departments: Array<{ id: string | null; name: string; headcount: number }>;
    recent_payments: Array<{
        id: string;
        employee_name: string;
        amount: number;
        pay_period: string;
        payment_date: string;
    }>;
    can_view_payroll: boolean;
};

type TrendPoint = { date: string; present: number; absent: number; on_leave: number };

/**
 * HR > Overview: who is in, who is off, and what payroll is costing.
 *
 * The payroll half is gated on `VIEW_PAYROLL` server-side. A user without it
 * gets a shorter dashboard with the tile saying so, not an error page.
 */
export default function HrDashboard({
    greeting,
    tenantName,
    variant = 'page',
}: Readonly<DashboardIdentity & { variant?: DashboardMount }>) {
    const { t, locale } = useI18n();
    const copy = t.dashboardHome;
    const hr = copy.hr;

    const {
        range,
        setRange,
        overview,
        previous: prev,
        trends,
        loading,
        error,
        deltaContext,
        compare,
    } = useModuleDashboard<OverviewResponse, TrendPoint>({
        fetchOverview: (window) => api.getHrDashboardOverview(window),
        fetchTrends: (window) => api.getHrDashboardTrends(window),
        unavailableMessage: hr.overviewUnavailable,
    });

    const money = (value: number) => formatBDT(value, { locale });
    const headcount = overview?.headcount;
    const attendance = overview?.attendance;
    const leave = overview?.leave;
    const payroll = overview?.payroll;

    const kpiTiles: KpiTileSpec[] = [
        {
            key: 'headcount',
            title: hr.kpiHeadcount,
            // Who works here is a stock; comparing it to last month reads as
            // churn, which this figure is not.
            value: String(headcount?.active ?? 0),
            delta: { label: '—', positive: true },
            note: formatMessage(hr.helperInactive, {
                count: headcount?.inactive ?? 0,
                joined: headcount?.joined_recently ?? 0,
            }),
        },
        {
            key: 'attendance',
            title: hr.kpiAttendance,
            value: attendance?.rate_pct == null ? '—' : `${attendance.rate_pct}%`,
            points: trends.map((point) => point.present),
            delta: compare(attendance?.rate_pct, prev?.attendance.rate_pct),
            note: formatMessage(hr.helperAttendanceRecords, { count: attendance?.records ?? 0 }),
        },
        {
            key: 'leave',
            title: hr.kpiLeaveDays,
            value: String(leave?.approved_days ?? 0),
            delta: compare(leave?.approved_days, prev?.leave.approved_days),
            note: formatMessage(hr.helperOnLeave, { count: leave?.on_leave_today ?? 0 }),
        },
        {
            key: 'payroll',
            title: hr.kpiPayroll,
            value: payroll == null ? '—' : money(payroll.paid_in_period),
            delta: compare(payroll?.paid_in_period, prev?.payroll?.paid_in_period),
            note: payrollNote(),
        },
    ];

    function payrollNote(): string | undefined {
        if (!overview) return undefined;
        if (!overview.can_view_payroll) return hr.payrollLocked;
        // Says what the commitment leaves out rather than presenting a figure
        // that silently omits part of the staff.
        if (payroll && payroll.employees_without_salary > 0) {
            return formatMessage(hr.helperNoSalary, {
                amount: money(payroll.monthly_commitment),
                count: payroll.employees_without_salary,
            });
        }
        return formatMessage(hr.helperMonthlyCommitment, {
            amount: money(payroll?.monthly_commitment ?? 0),
        });
    }

    const attentionItems = useMemo<AttentionItem[]>(() => {
        const items: AttentionItem[] = [];
        if (!overview) return items;

        if (overview.attendance.absent_today > 0) {
            items.push({
                id: 'absent',
                tone: 'red',
                value: String(overview.attendance.absent_today),
                label: formatMessage(hr.attnAbsentToday, { count: overview.attendance.absent_today }),
                href: routes.hr.attendance,
                cta: hr.viewAll,
            });
        }
        if (overview.leave.pending > 0) {
            items.push({
                id: 'pending-leave',
                tone: 'amber',
                value: String(overview.leave.pending),
                label: formatMessage(hr.attnPendingLeave, { count: overview.leave.pending }),
                href: routes.hr.leaves,
                cta: hr.viewAll,
            });
        }
        if (overview.attendance.unrecorded_today > 0) {
            items.push({
                id: 'unrecorded',
                tone: 'amber',
                value: String(overview.attendance.unrecorded_today),
                label: formatMessage(hr.attnUnrecordedToday, { count: overview.attendance.unrecorded_today }),
                href: routes.hr.attendance,
                cta: hr.viewAll,
            });
        }
        if (overview.headcount.no_department > 0) {
            items.push({
                id: 'no-department',
                tone: 'blue',
                value: String(overview.headcount.no_department),
                label: formatMessage(hr.attnNoDepartment, { count: overview.headcount.no_department }),
                href: routes.hr.employees,
                cta: hr.viewAll,
            });
        }
        // Only raised for someone who can see payroll — it is a money problem.
        if (overview.payroll && overview.payroll.employees_without_salary > 0) {
            items.push({
                id: 'no-salary',
                tone: 'blue',
                value: String(overview.payroll.employees_without_salary),
                label: formatMessage(hr.attnNoSalary, { count: overview.payroll.employees_without_salary }),
                href: routes.hr.employees,
                cta: hr.viewAll,
            });
        }
        return items;
    }, [overview, hr]);

    const departmentItems = useMemo<RankedItem[]>(
        () => (overview?.departments ?? []).map((row) => ({
            id: row.id ?? 'unassigned',
            name: row.name,
            meta: hr.departmentMeta,
            amount: String(row.headcount),
        })),
        [overview?.departments, hr],
    );

    return (
        <ModuleDashboard
            mount={variant}
            greeting={greeting}
            tenantName={tenantName}
            subtitle={hr.subtitle}
            range={range}
            onRangeChange={setRange}
            error={error}
        >
            <AttentionSection
                items={attentionItems}
                loading={loading}
                label={copy.sectionAttention}
                allClearLabel={hr.attnAllClear}
            />

            <DashboardSection label={hr.sectionTeam}>
                <KpiTileGrid tiles={kpiTiles} loading={loading} deltaContext={deltaContext} />
            </DashboardSection>

            <DashboardSection label={hr.sectionBreakdown}>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <RankedListPanel
                        title={hr.departmentsTitle}
                        items={departmentItems}
                        emptyLabel={hr.departmentsEmpty}
                    />

                    {overview?.can_view_payroll ? (
                        <div className="rounded-xl border border-gray-100 bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                            <div className="mb-2 flex items-center justify-between gap-2">
                                <h3 className="text-xs font-bold text-gray-900">{hr.paymentsTitle}</h3>
                                <Link
                                    href={routes.hr.salaryPayments}
                                    className="text-[10px] font-bold text-primary hover:underline"
                                >
                                    {hr.viewAll}
                                </Link>
                            </div>
                            {overview.recent_payments.length === 0 ? (
                                <p className="py-4 text-center text-[11px] text-gray-400">{hr.paymentsEmpty}</p>
                            ) : (
                                <ul>
                                    {overview.recent_payments.map((row) => (
                                        <li
                                            key={row.id}
                                            className="flex items-center gap-2 border-b border-gray-50 py-1.5 text-[11px] last:border-0"
                                        >
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate font-semibold text-gray-900">
                                                    {row.employee_name}
                                                </span>
                                                <span className="block text-[10px] text-gray-400">
                                                    {formatMessage(hr.paymentMeta, { period: row.pay_period })}
                                                </span>
                                            </span>
                                            <span className="shrink-0 font-bold tabular-nums text-gray-900">
                                                {money(row.amount)}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    ) : null}
                </div>
            </DashboardSection>
        </ModuleDashboard>
    );
}
