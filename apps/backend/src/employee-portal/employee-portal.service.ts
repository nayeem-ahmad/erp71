import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AttendanceService } from '../attendance/attendance.service';
import { ApplyForLeaveDto } from './employee-portal.dto';

/**
 * The employee's own view of themselves.
 *
 * Every method takes `employeeId` and `tenantId` from `request.employee`, set
 * by `EmployeeGuard` off the token — never from the request body or a route
 * param. That is the single rule this file exists to keep.
 *
 * On salary: an employee sees their own pay without `VIEW_PAYROLL`. That
 * permission governs seeing *other people's* money, which is why the stripping
 * in `EmployeesService` does not apply here.
 */
@Injectable()
export class EmployeePortalService {
    constructor(
        private readonly db: DatabaseService,
        private readonly attendance: AttendanceService,
    ) {}

    /** Recent months are what an employee actually looks at; the rest is history. */
    private static readonly RECENT_PAYMENTS = 6;
    private static readonly RECENT_LEAVE_REQUESTS = 10;

    async getSummary(tenantId: string, employeeId: string, year?: number, month?: number) {
        const now = new Date();
        const y = year ?? now.getFullYear();
        const m = month ?? now.getMonth() + 1;

        const [attendance, leaveBalances, pendingLeave, recentPayments] = await Promise.all([
            this.attendance.getEmployeeAttendanceSummary(tenantId, employeeId, y, m),
            this.listLeaveBalances(tenantId, employeeId, y),
            this.db.leaveRequest.count({
                where: { tenant_id: tenantId, employee_id: employeeId, status: 'PENDING', deleted_at: null },
            }),
            this.listSalaryPayments(tenantId, employeeId),
        ]);

        return {
            period: { year: y, month: m },
            attendance,
            leaveBalances,
            pendingLeaveRequests: pendingLeave,
            recentPayments,
        };
    }

    async listAttendance(tenantId: string, employeeId: string, year?: number, month?: number) {
        const now = new Date();
        const y = year ?? now.getFullYear();
        const m = month ?? now.getMonth() + 1;
        const start = new Date(y, m - 1, 1);
        const end = new Date(y, m, 0);

        const records = await this.db.attendanceRecord.findMany({
            where: {
                tenant_id: tenantId,
                employee_id: employeeId,
                date: { gte: start, lte: end },
            },
            orderBy: { date: 'asc' },
            select: { id: true, date: true, status: true, clock_in: true, clock_out: true, notes: true },
        });

        return { period: { year: y, month: m }, records };
    }

    async listLeaveBalances(tenantId: string, employeeId: string, year?: number) {
        const y = year ?? new Date().getFullYear();
        const balances = await this.db.leaveBalance.findMany({
            where: { tenant_id: tenantId, employee_id: employeeId, year: y },
            include: { leave_type: { select: { id: true, name: true, days_per_year: true } } },
        });

        return balances.map((balance) => ({
            leave_type_id: balance.leave_type_id,
            leave_type: balance.leave_type?.name ?? null,
            year: balance.year,
            total_days: balance.total_days,
            used_days: balance.used_days,
            remaining_days: balance.total_days - balance.used_days,
        }));
    }

    async listLeaveRequests(tenantId: string, employeeId: string) {
        return this.db.leaveRequest.findMany({
            where: { tenant_id: tenantId, employee_id: employeeId, deleted_at: null },
            orderBy: { start_date: 'desc' },
            take: EmployeePortalService.RECENT_LEAVE_REQUESTS,
            include: { leave_type: { select: { id: true, name: true } } },
        });
    }

    /**
     * Apply for leave as yourself.
     *
     * Delegates to `AttendanceService.createLeaveRequest` so the portal and the
     * admin screen validate identically — a divergence here would mean an
     * employee could book leave the admin form would have refused.
     */
    async applyForLeave(tenantId: string, employeeId: string, dto: ApplyForLeaveDto) {
        return this.attendance.createLeaveRequest(tenantId, {
            employee_id: employeeId,
            leave_type_id: dto.leave_type_id,
            start_date: dto.start_date,
            end_date: dto.end_date,
            days: dto.days,
            reason: dto.reason,
        } as any);
    }

    /**
     * Withdraw your own pending request.
     *
     * `cancelLeaveRequest` takes an optional employee scope; passing it is what
     * stops an employee cancelling somebody else's leave by id.
     */
    async cancelLeaveRequest(tenantId: string, employeeId: string, requestId: string) {
        return this.attendance.cancelLeaveRequest(tenantId, requestId, employeeId);
    }

    async listSalaryPayments(tenantId: string, employeeId: string) {
        return this.db.salaryPayment.findMany({
            where: { tenant_id: tenantId, employee_id: employeeId },
            orderBy: { payment_date: 'desc' },
            take: EmployeePortalService.RECENT_PAYMENTS,
            select: {
                id: true,
                amount: true,
                pay_period: true,
                payment_date: true,
                payment_method: true,
                notes: true,
            },
        });
    }

    // ── Admin side: granting and revoking portal access ───────────────────────

    /**
     * Grant or revoke portal access. Behind `MANAGE_HR` on the controller.
     *
     * Requires a linked login first: portal access without a `user_id` is a
     * grant nobody can use, and silently creating an account here would be a
     * surprising side effect of a toggle.
     */
    async setPortalAccess(tenantId: string, employeeId: string, enabled: boolean) {
        const employee = await this.db.employee.findFirst({
            where: { id: employeeId, tenant_id: tenantId, deleted_at: null },
            select: { id: true, user_id: true },
        });
        if (!employee) throw new NotFoundException('Employee not found.');

        if (enabled && !employee.user_id) {
            throw new BadRequestException(
                'Link a user account to this employee before granting portal access.',
            );
        }

        return this.db.employee.update({
            where: { id: employeeId },
            data: { portal_access: enabled },
            select: { id: true, name: true, portal_access: true, user_id: true },
        });
    }
}
