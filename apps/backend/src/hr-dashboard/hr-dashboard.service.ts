import { Injectable } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';
import { TenantContext } from '../database/tenant.decorator';
import {
    emptyDailyBuckets,
    formatDate,
    money,
    percent,
    resolveDateWindow,
    startOfDay,
    type DateWindow,
} from '../common/dashboard-window';
import { HrDashboardQueryDto } from './hr-dashboard.dto';

/** Ranked panels show a handful of rows; the rest is noise on a dashboard. */
const RANK_LIMIT = 6;
const RECENT_PAYMENTS = 5;

/** A contract or probation ending this soon is worth a reminder. */
const ENDING_WITHIN_DAYS = 30;

/**
 * Aggregates for the HR dashboard: who is in, who is off, and what payroll is
 * costing.
 *
 * Attendance and salary expose only per-employee summaries elsewhere
 * (`/attendance/summary/:id`, `/salary-payments/summary`), so this is the first
 * tenant-wide rollup of either.
 */
@Injectable()
export class HrDashboardService {
    constructor(private readonly db: DatabaseService) {}

    /**
     * Whether this user may see money. Owners bypass permissions everywhere else
     * in the app, so they do here too; everyone else needs the explicit grant.
     */
    private async canViewPayroll(tenant: TenantContext): Promise<boolean> {
        if (tenant.userRole === 'OWNER') return true;
        if (!tenant.storeId) return false;

        const grant = await this.db.userStorePermission.findFirst({
            where: {
                user_id: tenant.userId,
                store_id: tenant.storeId,
                permission: StorePermission.VIEW_PAYROLL,
            },
            select: { id: true },
        });
        return Boolean(grant);
    }

    async getOverview(tenant: TenantContext, query: HrDashboardQueryDto) {
        const window = resolveDateWindow(query);
        const tenantId = tenant.tenantId;

        const [canSeeMoney, headcount, attendance, leave, departments] = await Promise.all([
            this.canViewPayroll(tenant),
            this.getHeadcount(tenantId),
            this.getAttendance(tenantId, window),
            this.getLeave(tenantId, window),
            this.getDepartments(tenantId),
        ]);

        const payroll = canSeeMoney
            ? await this.getPayroll(tenantId, window)
            : null;
        const recentPayments = canSeeMoney ? await this.getRecentPayments(tenantId) : [];

        return {
            filters: { from: window.from, to: window.to },
            headcount,
            attendance,
            leave,
            payroll,
            departments,
            recent_payments: recentPayments,
            can_view_payroll: canSeeMoney,
        };
    }

    /** A stock, not a flow — the window does not apply to who works here. */
    private async getHeadcount(tenantId: string) {
        const soon = new Date();
        soon.setDate(soon.getDate() + ENDING_WITHIN_DAYS);

        const [active, inactive, joinedRecently, noDepartment] = await Promise.all([
            this.db.employee.count({ where: { tenant_id: tenantId, status: 'ACTIVE', deleted_at: null } }),
            this.db.employee.count({ where: { tenant_id: tenantId, status: 'INACTIVE', deleted_at: null } }),
            this.db.employee.count({
                where: {
                    tenant_id: tenantId,
                    deleted_at: null,
                    date_of_joining: { gte: new Date(Date.now() - ENDING_WITHIN_DAYS * 86_400_000) },
                },
            }),
            this.db.employee.count({
                where: { tenant_id: tenantId, status: 'ACTIVE', deleted_at: null, department_id: null },
            }),
        ]);

        return { active, inactive, joined_recently: joinedRecently, no_department: noDepartment };
    }

    private async getAttendance(tenantId: string, window: DateWindow) {
        const today = startOfDay(new Date());

        const [grouped, absentToday, activeCount] = await Promise.all([
            this.db.attendanceRecord.groupBy({
                by: ['status'],
                where: { tenant_id: tenantId, date: { gte: window.fromDate, lte: window.toDate } },
                _count: { _all: true },
            }),
            this.db.attendanceRecord.count({
                where: { tenant_id: tenantId, date: today, status: 'ABSENT' },
            }),
            this.db.employee.count({ where: { tenant_id: tenantId, status: 'ACTIVE', deleted_at: null } }),
        ]);

        const counts: Record<string, number> = {};
        for (const row of grouped) counts[row.status] = row._count._all;

        const present = counts.PRESENT ?? 0;
        const half = counts.HALF_DAY ?? 0;
        const absent = counts.ABSENT ?? 0;
        // Holidays are not a person failing to show up, so they are outside the
        // base entirely rather than counted as attended.
        const workingRecords = present + half + absent;

        return {
            counts,
            records: workingRecords,
            // A half day is half a day present, not a whole one.
            rate_pct: percent(present + half * 0.5, workingRecords),
            absent_today: absentToday,
            unrecorded_today: Math.max(0, activeCount - (counts.PRESENT ?? 0)),
        };
    }

    private async getLeave(tenantId: string, window: DateWindow) {
        const today = startOfDay(new Date());

        const [pending, approvedDays, onLeaveToday] = await Promise.all([
            this.db.leaveRequest.count({
                where: { tenant_id: tenantId, status: 'PENDING', deleted_at: null },
            }),
            this.db.leaveRequest.aggregate({
                where: {
                    tenant_id: tenantId,
                    status: 'APPROVED',
                    deleted_at: null,
                    start_date: { gte: window.fromDate, lte: window.toDate },
                },
                _sum: { days: true },
            }),
            this.db.leaveRequest.count({
                where: {
                    tenant_id: tenantId,
                    status: 'APPROVED',
                    deleted_at: null,
                    start_date: { lte: today },
                    end_date: { gte: today },
                },
            }),
        ]);

        return {
            pending,
            approved_days: approvedDays._sum.days ?? 0,
            on_leave_today: onLeaveToday,
        };
    }

    private async getPayroll(tenantId: string, window: DateWindow) {
        const [paid, accrued, unpaidEmployees] = await Promise.all([
            this.db.salaryPayment.aggregate({
                where: {
                    tenant_id: tenantId,
                    payment_date: { gte: window.fromDate, lte: window.toDate },
                },
                _sum: { amount: true },
                _count: { _all: true },
            }),
            this.db.employee.aggregate({
                where: { tenant_id: tenantId, status: 'ACTIVE', deleted_at: null },
                _sum: { basic_salary: true },
            }),
            this.db.employee.count({
                where: {
                    tenant_id: tenantId,
                    status: 'ACTIVE',
                    deleted_at: null,
                    basic_salary: null,
                },
            }),
        ]);

        return {
            paid_in_period: money(Number(paid._sum.amount ?? 0)),
            payments: paid._count._all,
            monthly_commitment: money(Number(accrued._sum.basic_salary ?? 0)),
            // Counted, not silently excluded: a monthly commitment that omits a
            // third of the staff is not the payroll bill.
            employees_without_salary: unpaidEmployees,
        };
    }

    private async getDepartments(tenantId: string) {
        const grouped = await this.db.employee.groupBy({
            by: ['department_id'],
            where: { tenant_id: tenantId, status: 'ACTIVE', deleted_at: null },
            _count: { _all: true },
        });

        const named = await this.db.department.findMany({
            where: { id: { in: grouped.map((row) => row.department_id).filter((id): id is string => Boolean(id)) } },
            select: { id: true, name: true },
        });
        const byId = new Map(named.map((department) => [department.id, department.name]));

        return grouped
            .map((row) => ({
                id: row.department_id,
                name: row.department_id ? (byId.get(row.department_id) ?? 'Unknown') : 'Unassigned',
                headcount: row._count._all,
            }))
            .sort((a, b) => b.headcount - a.headcount)
            .slice(0, RANK_LIMIT);
    }

    private async getRecentPayments(tenantId: string) {
        const rows = await this.db.salaryPayment.findMany({
            where: { tenant_id: tenantId },
            orderBy: { payment_date: 'desc' },
            take: RECENT_PAYMENTS,
            select: {
                id: true,
                amount: true,
                pay_period: true,
                payment_date: true,
                employee: { select: { name: true } },
            },
        });

        return rows.map((row) => ({
            id: row.id,
            employee_name: row.employee?.name ?? 'Unknown',
            amount: money(Number(row.amount)),
            pay_period: row.pay_period,
            payment_date: row.payment_date,
        }));
    }

    /** Daily present/absent counts, feeding the KPI sparklines. */
    async getTrends(tenantId: string, query: HrDashboardQueryDto) {
        const window = resolveDateWindow(query);

        const records = await this.db.attendanceRecord.findMany({
            where: { tenant_id: tenantId, date: { gte: window.fromDate, lte: window.toDate } },
            select: { date: true, status: true },
        });

        const buckets = emptyDailyBuckets(window, () => ({ present: 0, absent: 0, on_leave: 0 }));

        for (const record of records) {
            const bucket = buckets.get(formatDate(startOfDay(record.date)));
            if (!bucket) continue;
            if (record.status === 'PRESENT' || record.status === 'HALF_DAY') bucket.present += 1;
            else if (record.status === 'ABSENT') bucket.absent += 1;
        }

        return {
            points: [...buckets.entries()].map(([date, values]) => ({ date, ...values })),
        };
    }
}
