import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
    AssignScheduleDto, CreateHolidayDto, CreateWorkScheduleDto, UpdateHolidayDto, UpdateWorkScheduleDto,
} from './work-schedules.dto';
import {
    DEFAULT_SCHEDULE_NAME,
    ScheduleDay,
    buildDefaultScheduleDays,
    scheduleInForce,
} from './schedule.util';

/**
 * Holidays and work schedules — the baseline attendance is measured against.
 *
 * Phase 2 of the HRIS plan. Nothing here is user-visible on its own; it exists
 * so Phase 3 can decide whether a clock-in is late and Phase 4 can decide what
 * counts as overtime.
 */
@Injectable()
export class WorkSchedulesService {
    constructor(private readonly db: DatabaseService) {}

    /** Midnight UTC for a YYYY-MM-DD string, matching how `@db.Date` round-trips. */
    private toDateOnly(value: string | Date): Date {
        const date = value instanceof Date ? value : new Date(value);
        return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    }

    // ── Holidays ──────────────────────────────────────────────────────────────

    async listHolidays(tenantId: string, year?: number) {
        const where: any = { tenant_id: tenantId };
        if (year) {
            where.date = {
                gte: new Date(Date.UTC(year, 0, 1)),
                lte: new Date(Date.UTC(year, 11, 31)),
            };
        }
        return this.db.holiday.findMany({ where, orderBy: { date: 'asc' } });
    }

    async createHoliday(tenantId: string, dto: CreateHolidayDto) {
        const date = this.toDateOnly(dto.date);
        const existing = await this.db.holiday.findFirst({ where: { tenant_id: tenantId, date } });
        if (existing) throw new ConflictException('A holiday is already set for this date.');

        return this.db.holiday.create({
            data: { tenant_id: tenantId, date, name: dto.name },
        });
    }

    async updateHoliday(tenantId: string, id: string, dto: UpdateHolidayDto) {
        const holiday = await this.db.holiday.findFirst({ where: { id, tenant_id: tenantId } });
        if (!holiday) throw new NotFoundException('Holiday not found.');

        const date = dto.date ? this.toDateOnly(dto.date) : undefined;
        if (date) {
            const clash = await this.db.holiday.findFirst({
                where: { tenant_id: tenantId, date, NOT: { id } },
            });
            if (clash) throw new ConflictException('A holiday is already set for this date.');
        }

        return this.db.holiday.update({
            where: { id },
            data: { ...(date ? { date } : {}), ...(dto.name ? { name: dto.name } : {}) },
        });
    }

    async deleteHoliday(tenantId: string, id: string) {
        const holiday = await this.db.holiday.findFirst({ where: { id, tenant_id: tenantId } });
        if (!holiday) throw new NotFoundException('Holiday not found.');
        return this.db.holiday.delete({ where: { id } });
    }

    /** The holiday dates in a range, as `YYYY-MM-DD` keys for O(1) lookup. */
    async holidayKeysBetween(tenantId: string, from: Date, to: Date): Promise<Set<string>> {
        const holidays = await this.db.holiday.findMany({
            where: { tenant_id: tenantId, date: { gte: from, lte: to } },
            select: { date: true },
        });
        return new Set(holidays.map((holiday) => holiday.date.toISOString().slice(0, 10)));
    }

    // ── Schedules ─────────────────────────────────────────────────────────────

    async listSchedules(tenantId: string) {
        return this.db.workSchedule.findMany({
            where: { tenant_id: tenantId, deleted_at: null },
            include: { days: { orderBy: { weekday: 'asc' } } },
            orderBy: [{ is_default: 'desc' }, { name: 'asc' }],
        });
    }

    async getSchedule(tenantId: string, id: string) {
        const schedule = await this.db.workSchedule.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
            include: { days: { orderBy: { weekday: 'asc' } } },
        });
        if (!schedule) throw new NotFoundException('Work schedule not found.');
        return schedule;
    }

    /**
     * Reject a day that claims to be working but has no hours — it would make
     * every downstream calculation silently zero rather than fail.
     */
    private validateDays(days: { is_working: boolean; start_minute?: number | null; end_minute?: number | null; weekday: number }[]) {
        const seen = new Set<number>();
        for (const day of days) {
            if (seen.has(day.weekday)) {
                throw new BadRequestException(`Weekday ${day.weekday} is listed more than once.`);
            }
            seen.add(day.weekday);

            if (!day.is_working) continue;
            if (day.start_minute == null || day.end_minute == null) {
                throw new BadRequestException('A working day needs both a start and an end time.');
            }
            if (day.end_minute <= day.start_minute) {
                throw new BadRequestException('A working day must end after it starts.');
            }
        }
    }

    async createSchedule(tenantId: string, dto: CreateWorkScheduleDto) {
        this.validateDays(dto.days);

        const duplicate = await this.db.workSchedule.findFirst({
            where: { tenant_id: tenantId, name: dto.name, deleted_at: null },
        });
        if (duplicate) throw new ConflictException('A schedule with this name already exists.');

        return this.db.$transaction(async (tx) => {
            if (dto.is_default) await this.clearDefault(tx, tenantId);
            return tx.workSchedule.create({
                data: {
                    tenant_id: tenantId,
                    name: dto.name,
                    is_default: dto.is_default ?? false,
                    days: {
                        create: dto.days.map((day) => ({
                            weekday: day.weekday,
                            is_working: day.is_working,
                            start_minute: day.is_working ? day.start_minute ?? null : null,
                            end_minute: day.is_working ? day.end_minute ?? null : null,
                            break_minutes: day.is_working ? day.break_minutes ?? 0 : 0,
                        })),
                    },
                },
                include: { days: { orderBy: { weekday: 'asc' } } },
            });
        });
    }

    async updateSchedule(tenantId: string, id: string, dto: UpdateWorkScheduleDto) {
        await this.getSchedule(tenantId, id);
        if (dto.days) this.validateDays(dto.days);

        if (dto.name) {
            const clash = await this.db.workSchedule.findFirst({
                where: { tenant_id: tenantId, name: dto.name, deleted_at: null, NOT: { id } },
            });
            if (clash) throw new ConflictException('A schedule with this name already exists.');
        }

        return this.db.$transaction(async (tx) => {
            if (dto.is_default) await this.clearDefault(tx, tenantId, id);

            if (dto.days) {
                // Replace wholesale rather than diff: a schedule has at most
                // seven rows, and a partial update would leave a weekday the
                // caller deleted silently in place.
                await tx.workScheduleDay.deleteMany({ where: { schedule_id: id } });
                await tx.workScheduleDay.createMany({
                    data: dto.days.map((day) => ({
                        schedule_id: id,
                        weekday: day.weekday,
                        is_working: day.is_working,
                        start_minute: day.is_working ? day.start_minute ?? null : null,
                        end_minute: day.is_working ? day.end_minute ?? null : null,
                        break_minutes: day.is_working ? day.break_minutes ?? 0 : 0,
                    })),
                });
            }

            return tx.workSchedule.update({
                where: { id },
                data: {
                    ...(dto.name ? { name: dto.name } : {}),
                    ...(dto.is_default !== undefined ? { is_default: dto.is_default } : {}),
                },
                include: { days: { orderBy: { weekday: 'asc' } } },
            });
        });
    }

    /**
     * Exactly one default per tenant, enforced here rather than by a partial
     * unique index — Prisma cannot express `UNIQUE (tenant_id) WHERE is_default`
     * and `db push` would not create a raw one.
     */
    private async clearDefault(tx: any, tenantId: string, exceptId?: string) {
        await tx.workSchedule.updateMany({
            where: {
                tenant_id: tenantId,
                is_default: true,
                ...(exceptId ? { NOT: { id: exceptId } } : {}),
            },
            data: { is_default: false },
        });
    }

    async deleteSchedule(tenantId: string, id: string) {
        const schedule = await this.getSchedule(tenantId, id);
        if (schedule.is_default) {
            throw new BadRequestException('The default schedule cannot be deleted. Make another one default first.');
        }

        const assigned = await this.db.employeeSchedule.count({ where: { schedule_id: id } });
        if (assigned > 0) {
            throw new BadRequestException('Cannot delete a schedule that employees are assigned to.');
        }

        return this.db.workSchedule.update({ where: { id }, data: { deleted_at: new Date() } });
    }

    // ── Assignment ────────────────────────────────────────────────────────────

    async assign(tenantId: string, dto: AssignScheduleDto) {
        const [employee, schedule] = await Promise.all([
            this.db.employee.findFirst({ where: { id: dto.employee_id, tenant_id: tenantId, deleted_at: null } }),
            this.db.workSchedule.findFirst({ where: { id: dto.schedule_id, tenant_id: tenantId, deleted_at: null } }),
        ]);
        if (!employee) throw new NotFoundException('Employee not found.');
        if (!schedule) throw new NotFoundException('Work schedule not found.');

        const effective_from = this.toDateOnly(dto.effective_from);

        // Re-assigning on a date already recorded replaces it, rather than
        // failing on the unique constraint — two schedules cannot both start on
        // the same day, so the later intent is the right one.
        return this.db.employeeSchedule.upsert({
            where: {
                tenant_id_employee_id_effective_from: {
                    tenant_id: tenantId, employee_id: dto.employee_id, effective_from,
                },
            },
            create: {
                tenant_id: tenantId,
                employee_id: dto.employee_id,
                schedule_id: dto.schedule_id,
                effective_from,
            },
            update: { schedule_id: dto.schedule_id },
        });
    }

    async listAssignments(tenantId: string, employeeId: string) {
        return this.db.employeeSchedule.findMany({
            where: { tenant_id: tenantId, employee_id: employeeId },
            include: { schedule: { select: { id: true, name: true } } },
            orderBy: { effective_from: 'desc' },
        });
    }

    /**
     * The schedule days in force for an employee on a date.
     *
     * Falls back to the tenant default when the employee has no assignment
     * covering that date — a brand-new employee, or a date before their first
     * assignment. Returning null instead would make every attendance
     * calculation for them silently do nothing.
     */
    async resolveScheduleDays(tenantId: string, employeeId: string, date: Date): Promise<ScheduleDay[]> {
        const assignments = await this.db.employeeSchedule.findMany({
            where: { tenant_id: tenantId, employee_id: employeeId },
            orderBy: { effective_from: 'desc' },
            include: { schedule: { include: { days: { orderBy: { weekday: 'asc' } } } } },
        });

        const inForce = scheduleInForce(assignments, this.toDateOnly(date));
        if (inForce?.schedule?.days?.length) return inForce.schedule.days as ScheduleDay[];

        const fallback = await this.db.workSchedule.findFirst({
            where: { tenant_id: tenantId, is_default: true, deleted_at: null },
            include: { days: { orderBy: { weekday: 'asc' } } },
        });
        if (fallback?.days?.length) return fallback.days as ScheduleDay[];

        // No schedule configured at all. The in-code default keeps attendance
        // working on a tenant that has never opened this screen.
        return buildDefaultScheduleDays();
    }

    /**
     * Create the tenant's default schedule if it has none.
     *
     * Idempotent and safe to call on every boot — see `sync-work-schedules.ts`
     * for why this is a boot-time sync rather than a migration.
     */
    async ensureDefaultSchedule(tenantId: string) {
        const existing = await this.db.workSchedule.findFirst({
            where: { tenant_id: tenantId, deleted_at: null },
            select: { id: true },
        });
        if (existing) return existing;

        return this.db.workSchedule.create({
            data: {
                tenant_id: tenantId,
                name: DEFAULT_SCHEDULE_NAME,
                is_default: true,
                days: { create: buildDefaultScheduleDays() },
            },
            select: { id: true },
        });
    }
}
