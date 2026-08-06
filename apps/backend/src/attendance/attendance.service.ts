import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { paginate, PaginatedResult } from '../common/pagination.dto';
import {
    UpsertAttendanceDto,
    CreateLeaveTypeDto,
    UpdateLeaveTypeDto,
    SetLeaveBalanceDto,
    CreateLeaveRequestDto,
    ReviewLeaveRequestDto,
    LeaveRequestStatusDto,
} from './attendance.dto';
import { AttendanceCaptureService } from './attendance-capture.service';
import {
    buildLeaveCalendar,
    carryForwardDays,
    needsFurtherApproval,
    validateLeaveRequest,
    type LeaveTypePolicy,
} from './leave-policy.util';

@Injectable()
export class AttendanceService {
    constructor(
        private db: DatabaseService,
        /**
         * Leave approval writes attendance rows through this. No cycle: the
         * capture service knows about schedules and holidays, not about leave.
         */
        private readonly capture: AttendanceCaptureService,
    ) {}

    // ── Leave Types ───────────────────────────────────────────────────────────

    async listLeaveTypes(tenantId: string) {
        return this.db.leaveType.findMany({
            where: { tenant_id: tenantId, deleted_at: null },
            orderBy: { name: 'asc' },
        });
    }

    async createLeaveType(tenantId: string, dto: CreateLeaveTypeDto) {
        const existing = await this.db.leaveType.findFirst({
            where: { tenant_id: tenantId, name: dto.name },
        });
        if (existing) throw new ConflictException('A leave type with this name already exists.');

        return this.db.leaveType.create({
            data: {
                tenant_id: tenantId,
                name: dto.name,
                days_per_year: dto.days_per_year,
            },
        });
    }

    async updateLeaveType(tenantId: string, id: string, dto: UpdateLeaveTypeDto) {
        const leaveType = await this.db.leaveType.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });
        if (!leaveType) throw new NotFoundException('Leave type not found.');

        if (dto.name && dto.name !== leaveType.name) {
            const duplicate = await this.db.leaveType.findFirst({
                where: { tenant_id: tenantId, name: dto.name, NOT: { id } },
            });
            if (duplicate) throw new ConflictException('A leave type with this name already exists.');
        }

        return this.db.leaveType.update({
            where: { id },
            data: {
                ...(dto.name !== undefined ? { name: dto.name } : {}),
                ...(dto.days_per_year !== undefined ? { days_per_year: dto.days_per_year } : {}),
            },
        });
    }

    async deleteLeaveType(tenantId: string, id: string) {
        const leaveType = await this.db.leaveType.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });
        if (!leaveType) throw new NotFoundException('Leave type not found.');

        return this.db.leaveType.update({
            where: { id },
            data: { deleted_at: new Date() },
        });
    }

    // ── Attendance ────────────────────────────────────────────────────────────

    async upsertAttendance(tenantId: string, dto: UpsertAttendanceDto) {
        const employee = await this.db.employee.findFirst({
            where: { id: dto.employee_id, tenant_id: tenantId, deleted_at: null },
        });
        if (!employee) throw new NotFoundException('Employee not found.');

        const date = new Date(dto.date);

        return this.db.attendanceRecord.upsert({
            where: {
                tenant_id_employee_id_date: {
                    tenant_id: tenantId,
                    employee_id: dto.employee_id,
                    date,
                },
            },
            create: {
                tenant_id: tenantId,
                employee_id: dto.employee_id,
                date,
                status: dto.status as any,
                clock_in: dto.clock_in ? new Date(dto.clock_in) : undefined,
                clock_out: dto.clock_out ? new Date(dto.clock_out) : undefined,
                notes: dto.notes,
            },
            update: {
                status: dto.status as any,
                clock_in: dto.clock_in ? new Date(dto.clock_in) : null,
                clock_out: dto.clock_out ? new Date(dto.clock_out) : null,
                notes: dto.notes ?? null,
            },
        });
    }

    async listAttendance(
        tenantId: string,
        opts?: {
            employeeId?: string;
            startDate?: string;
            endDate?: string;
            status?: string;
            page?: number;
            limit?: number;
        },
    ): Promise<PaginatedResult<any>> {
        const page = opts?.page ?? 1;
        const limit = Math.min(opts?.limit ?? 20, 100);
        const skip = (page - 1) * limit;

        const where: any = { tenant_id: tenantId };
        if (opts?.employeeId) where.employee_id = opts.employeeId;
        if (opts?.status) where.status = opts.status;
        if (opts?.startDate || opts?.endDate) {
            where.date = {};
            if (opts?.startDate) where.date.gte = new Date(opts.startDate);
            if (opts?.endDate) where.date.lte = new Date(opts.endDate);
        }

        const [items, total] = await Promise.all([
            this.db.attendanceRecord.findMany({
                where,
                include: {
                    employee: { select: { id: true, name: true, employee_code: true } },
                },
                orderBy: { date: 'desc' },
                skip,
                take: limit,
            }),
            this.db.attendanceRecord.count({ where }),
        ]);

        return paginate(items, total, page, limit);
    }

    async getEmployeeAttendanceSummary(
        tenantId: string,
        employeeId: string,
        year: number,
        month: number,
    ) {
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0); // last day of the month

        const records = await this.db.attendanceRecord.findMany({
            where: {
                tenant_id: tenantId,
                employee_id: employeeId,
                date: { gte: startDate, lte: endDate },
            },
            select: { status: true },
        });

        // Every status gets a bucket, including the three Phase 2 added. A
        // missing key would still be counted by the loop below but would read
        // as absent from the summary — worse than a zero.
        const summary: Record<string, number> = {
            PRESENT: 0,
            ABSENT: 0,
            HALF_DAY: 0,
            HOLIDAY: 0,
            LATE: 0,
            EARLY_LEAVE: 0,
            ON_LEAVE: 0,
        };

        for (const record of records) {
            summary[record.status] = (summary[record.status] ?? 0) + 1;
        }

        return { employeeId, year, month, summary, total: records.length };
    }

    async deleteAttendance(tenantId: string, id: string) {
        const record = await this.db.attendanceRecord.findFirst({
            where: { id, tenant_id: tenantId },
        });
        if (!record) throw new NotFoundException('Attendance record not found.');

        return this.db.attendanceRecord.delete({ where: { id } });
    }

    // ── Leave Balances ────────────────────────────────────────────────────────

    async getOrCreateLeaveBalance(
        tenantId: string,
        employeeId: string,
        leaveTypeId: string,
        year: number,
    ) {
        return this.db.leaveBalance.upsert({
            where: {
                tenant_id_employee_id_leave_type_id_year: {
                    tenant_id: tenantId,
                    employee_id: employeeId,
                    leave_type_id: leaveTypeId,
                    year,
                },
            },
            create: {
                tenant_id: tenantId,
                employee_id: employeeId,
                leave_type_id: leaveTypeId,
                year,
                total_days: 0,
                used_days: 0,
            },
            update: {},
        });
    }

    async listLeaveBalances(tenantId: string, employeeId: string) {
        return this.db.leaveBalance.findMany({
            where: { tenant_id: tenantId, employee_id: employeeId },
            include: { leave_type: true },
            orderBy: [{ year: 'desc' }, { leave_type: { name: 'asc' } }],
        });
    }

    async setLeaveBalance(tenantId: string, dto: SetLeaveBalanceDto) {
        const employee = await this.db.employee.findFirst({
            where: { id: dto.employee_id, tenant_id: tenantId, deleted_at: null },
        });
        if (!employee) throw new NotFoundException('Employee not found.');

        const leaveType = await this.db.leaveType.findFirst({
            where: { id: dto.leave_type_id, tenant_id: tenantId, deleted_at: null },
        });
        if (!leaveType) throw new NotFoundException('Leave type not found.');

        return this.db.leaveBalance.upsert({
            where: {
                tenant_id_employee_id_leave_type_id_year: {
                    tenant_id: tenantId,
                    employee_id: dto.employee_id,
                    leave_type_id: dto.leave_type_id,
                    year: dto.year,
                },
            },
            create: {
                tenant_id: tenantId,
                employee_id: dto.employee_id,
                leave_type_id: dto.leave_type_id,
                year: dto.year,
                total_days: dto.total_days,
                used_days: 0,
            },
            update: {
                total_days: dto.total_days,
            },
        });
    }

    // ── Leave Requests ────────────────────────────────────────────────────────

    async createLeaveRequest(tenantId: string, dto: CreateLeaveRequestDto) {
        const employee = await this.db.employee.findFirst({
            where: { id: dto.employee_id, tenant_id: tenantId, deleted_at: null },
        });
        if (!employee) throw new NotFoundException('Employee not found.');

        const leaveType = await this.db.leaveType.findFirst({
            where: { id: dto.leave_type_id, tenant_id: tenantId, deleted_at: null },
        });
        if (!leaveType) throw new NotFoundException('Leave type not found.');

        const startDate = new Date(dto.start_date);
        const endDate = new Date(dto.end_date);

        if (startDate > endDate) {
            throw new BadRequestException('Start date must be on or before end date.');
        }

        // Policy checks (HRIS Phase 11). The balance is read here rather than
        // trusted from the client, and every failing rule is reported at once so
        // the form can show them together.
        const balance = await this.db.leaveBalance.findFirst({
            where: {
                tenant_id: tenantId,
                employee_id: dto.employee_id,
                leave_type_id: dto.leave_type_id,
                year: startDate.getFullYear(),
            },
            select: { total_days: true, used_days: true },
        });
        const remaining = balance ? balance.total_days - balance.used_days : 0;

        const errors = validateLeaveRequest(leaveType as unknown as LeaveTypePolicy, {
            days: dto.days,
            remainingDays: remaining,
            // Attachments are added to a request after it exists, so a type that
            // requires one is checked at submission rather than here — see
            // `assertAttachmentPresent`.
            hasAttachment: true,
        });
        if (errors.length > 0) {
            throw new BadRequestException(this.describeLeaveErrors(errors, remaining));
        }

        return this.db.leaveRequest.create({
            data: {
                tenant_id: tenantId,
                employee_id: dto.employee_id,
                leave_type_id: dto.leave_type_id,
                start_date: startDate,
                end_date: endDate,
                days: dto.days,
                reason: dto.reason,
                status: 'PENDING',
            },
        });
    }

    /** Turn the policy codes into something a person can act on. */
    private describeLeaveErrors(errors: string[], remaining: number): string {
        const messages: Record<string, string> = {
            NOT_POSITIVE: 'Leave must be at least half a day.',
            HALF_DAY_NOT_ALLOWED: 'This leave type cannot be taken as a half day.',
            INSUFFICIENT_BALANCE: `Only ${remaining} day(s) remain on this leave type.`,
            ATTACHMENT_REQUIRED: 'This leave type needs a supporting document.',
        };
        return errors.map((error) => messages[error] ?? error).join(' ');
    }

    /**
     * A team leave calendar for a window.
     *
     * Approved and pending both, because the question a manager is asking is
     * "who might be off", not "who is definitely off".
     */
    async getLeaveCalendar(tenantId: string, from: string, to: string) {
        const fromDate = new Date(from);
        const toDate = new Date(to);

        const requests = await this.db.leaveRequest.findMany({
            where: {
                tenant_id: tenantId,
                deleted_at: null,
                status: { in: ['APPROVED', 'PENDING'] },
                start_date: { lte: toDate },
                end_date: { gte: fromDate },
            },
            include: {
                employee: { select: { id: true, name: true } },
                leave_type: { select: { name: true } },
            },
        });

        return buildLeaveCalendar(
            requests.map((request) => ({
                employeeId: request.employee_id,
                employeeName: request.employee?.name ?? '',
                startDate: request.start_date,
                endDate: request.end_date,
                status: request.status,
                leaveType: request.leave_type?.name ?? null,
            })),
            fromDate,
            toDate,
        );
    }

    /**
     * Roll unused balances into next year, capped per leave type.
     *
     * Written as an idempotent sync rather than a cron: production applies
     * schema with `db push` and a year-end job nobody runs is worse than one
     * that can be re-run safely. Re-running is safe because the carried figure
     * is *set*, not incremented.
     */
    async runCarryForward(tenantId: string, fromYear: number) {
        const toYear = fromYear + 1;

        const [balances, types] = await Promise.all([
            this.db.leaveBalance.findMany({
                where: { tenant_id: tenantId, year: fromYear },
            }),
            this.db.leaveType.findMany({
                where: { tenant_id: tenantId, deleted_at: null },
            }),
        ]);

        const byType = new Map(types.map((type) => [type.id, type]));
        let carried = 0;

        for (const balance of balances) {
            const type = byType.get(balance.leave_type_id);
            if (!type) continue;

            const carry = carryForwardDays(
                type as unknown as LeaveTypePolicy,
                balance.total_days,
                balance.used_days,
            );
            if (carry <= 0) continue;

            await this.db.leaveBalance.upsert({
                where: {
                    tenant_id_employee_id_leave_type_id_year: {
                        tenant_id: tenantId,
                        employee_id: balance.employee_id,
                        leave_type_id: balance.leave_type_id,
                        year: toYear,
                    },
                },
                create: {
                    tenant_id: tenantId,
                    employee_id: balance.employee_id,
                    leave_type_id: balance.leave_type_id,
                    year: toYear,
                    total_days: type.days_per_year + carry,
                    used_days: 0,
                },
                // Set, never increment — that is what makes a re-run safe.
                update: { total_days: type.days_per_year + carry },
            });
            carried += 1;
        }

        return { from_year: fromYear, to_year: toYear, balances_carried: carried };
    }

    async listLeaveRequests(
        tenantId: string,
        opts?: {
            employeeId?: string;
            status?: string;
            page?: number;
            limit?: number;
        },
    ): Promise<PaginatedResult<any>> {
        const page = opts?.page ?? 1;
        const limit = Math.min(opts?.limit ?? 20, 100);
        const skip = (page - 1) * limit;

        const where: any = { tenant_id: tenantId, deleted_at: null };
        if (opts?.employeeId) where.employee_id = opts.employeeId;
        if (opts?.status) where.status = opts.status;

        const [items, total] = await Promise.all([
            this.db.leaveRequest.findMany({
                where,
                include: {
                    employee: { select: { id: true, name: true, employee_code: true } },
                    leave_type: true,
                    approver: { select: { id: true, name: true, email: true } },
                },
                orderBy: { created_at: 'desc' },
                skip,
                take: limit,
            }),
            this.db.leaveRequest.count({ where }),
        ]);

        return paginate(items, total, page, limit);
    }

    async reviewLeaveRequest(
        tenantId: string,
        requestId: string,
        reviewerUserId: string,
        dto: ReviewLeaveRequestDto,
    ) {
        const request = await this.db.leaveRequest.findFirst({
            where: { id: requestId, tenant_id: tenantId, deleted_at: null },
        });
        if (!request) throw new NotFoundException('Leave request not found.');
        if (request.status !== 'PENDING') {
            throw new BadRequestException('Only pending leave requests can be reviewed.');
        }

        const leaveType = await this.db.leaveType.findFirst({
            where: { id: request.leave_type_id, tenant_id: tenantId },
        });

        // Record this signature regardless of the outcome, so "who signed, when
        // and what they said" survives a later rejection.
        const level = (request.approvals_given ?? 0) + 1;
        await this.db.leaveRequestApproval.upsert({
            where: { request_id_level: { request_id: requestId, level } },
            create: {
                tenant_id: tenantId,
                request_id: requestId,
                level,
                decision: dto.status,
                approver_id: reviewerUserId,
                note: dto.approver_note ?? null,
            },
            update: {
                decision: dto.status,
                approver_id: reviewerUserId,
                note: dto.approver_note ?? null,
            },
        });

        // A rejection at any level ends it; there is nothing for a second
        // approver to add to "no".
        if (
            dto.status === LeaveRequestStatusDto.APPROVED
            && leaveType
            && needsFurtherApproval(leaveType as unknown as LeaveTypePolicy, level)
        ) {
            return this.db.leaveRequest.update({
                where: { id: requestId },
                data: {
                    // Still PENDING: the balance must not move and the
                    // attendance rows must not be written until the chain is
                    // complete, or a half-approved request would look taken.
                    approvals_given: level,
                    approver_note: dto.approver_note ?? null,
                },
            });
        }

        if (dto.status === LeaveRequestStatusDto.APPROVED) {
            const year = new Date(request.start_date).getFullYear();
            await this.db.leaveBalance.upsert({
                where: {
                    tenant_id_employee_id_leave_type_id_year: {
                        tenant_id: tenantId,
                        employee_id: request.employee_id,
                        leave_type_id: request.leave_type_id,
                        year,
                    },
                },
                create: {
                    tenant_id: tenantId,
                    employee_id: request.employee_id,
                    leave_type_id: request.leave_type_id,
                    year,
                    total_days: 0,
                    used_days: request.days,
                },
                update: {
                    used_days: { increment: request.days },
                },
            });

            // Write the attendance side of the approval. Before this the two
            // models shared no data at all, so an approved leave left the
            // attendance report showing the employee absent — the same fact
            // recorded two contradictory ways.
            await this.capture.markLeaveDays(
                tenantId, request.employee_id, request.start_date, request.end_date,
            );
        }

        return this.db.leaveRequest.update({
            where: { id: requestId },
            data: {
                status: dto.status as any,
                approved_by: reviewerUserId,
                approved_at: new Date(),
                approver_note: dto.approver_note ?? null,
                approvals_given: level,
            },
        });
    }

    async cancelLeaveRequest(tenantId: string, requestId: string, employeeId?: string) {
        const where: any = { id: requestId, tenant_id: tenantId, deleted_at: null };
        if (employeeId) where.employee_id = employeeId;

        const request = await this.db.leaveRequest.findFirst({ where });
        if (!request) throw new NotFoundException('Leave request not found.');

        if (request.status === 'CANCELLED') {
            throw new BadRequestException('Leave request is already cancelled.');
        }

        // If it was approved, restore the used days — and take back the
        // attendance rows the approval wrote.
        if (request.status === 'APPROVED') {
            await this.capture.unmarkLeaveDays(
                tenantId, request.employee_id, request.start_date, request.end_date,
            );
            const year = new Date(request.start_date).getFullYear();
            await this.db.leaveBalance.updateMany({
                where: {
                    tenant_id: tenantId,
                    employee_id: request.employee_id,
                    leave_type_id: request.leave_type_id,
                    year,
                },
                data: {
                    used_days: { decrement: request.days },
                },
            });
        }

        return this.db.leaveRequest.update({
            where: { id: requestId },
            data: { status: 'CANCELLED' },
        });
    }
}
