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

@Injectable()
export class AttendanceService {
    constructor(private db: DatabaseService) {}

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

        const summary: Record<string, number> = {
            PRESENT: 0,
            ABSENT: 0,
            HALF_DAY: 0,
            HOLIDAY: 0,
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
        }

        return this.db.leaveRequest.update({
            where: { id: requestId },
            data: {
                status: dto.status as any,
                approved_by: reviewerUserId,
                approved_at: new Date(),
                approver_note: dto.approver_note ?? null,
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

        // If it was approved, restore the used days
        if (request.status === 'APPROVED') {
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
