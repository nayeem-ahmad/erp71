import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { WorkSchedulesService } from '../work-schedules/work-schedules.service';
import { assessDay, deriveStatus, type ScheduleDay } from '../work-schedules/schedule.util';
import { paginate, type PaginatedResult } from '../common/pagination.dto';
import type { CreatePunchDto, PunchQueryDto, UpdatePunchDto } from './attendance.dto';

/** Both halves of a punch. Not an enum in the schema — see the model comment. */
export type PunchDirection = 'IN' | 'OUT';

export interface DayPunch {
    punched_at: Date;
    direction: string;
    source?: string;
    latitude?: number | null;
    longitude?: number | null;
    store_id?: string | null;
}

/**
 * The pair of times a day's summary should carry, given its punches.
 *
 * **First IN, last OUT.** Pure, exported and tested on its own because it is
 * the whole rule the feature turns on, and a database is a poor place to read
 * a policy from.
 *
 * An OUT that precedes the first IN is ignored rather than used: it belongs to
 * the previous day's shift or is a mistyped row, and taking it would produce a
 * negative worked span. An OUT with no IN at all leaves the day with no
 * clock-out for the same reason — a departure nobody arrived for is not
 * evidence of a day worked, and `clock_out` alone would read as one.
 */
export function derivePunchWindow(punches: DayPunch[]): {
    clockIn: DayPunch | null;
    clockOut: DayPunch | null;
} {
    const ordered = [...punches].sort((a, b) => a.punched_at.getTime() - b.punched_at.getTime());

    const clockIn = ordered.find((punch) => punch.direction === 'IN') ?? null;
    if (!clockIn) return { clockIn: null, clockOut: null };

    const outs = ordered.filter(
        (punch) => punch.direction === 'OUT' && punch.punched_at >= clockIn.punched_at,
    );

    return { clockIn, clockOut: outs.length ? outs[outs.length - 1] : null };
}

/**
 * Managing the raw in/out log, and keeping the day's `AttendanceRecord` in step
 * with it.
 *
 * `AttendanceRecord` holds one arrival and one departure per employee per day.
 * That is enough for a summary and wrong as a record: a midday errand, a split
 * shift or a time typed at the wrong hour all need more than two slots, and
 * before this there was nowhere to put them or to note why a figure changed.
 *
 * So punches are the evidence and the day row is derived. Every write here ends
 * in `rebuildDay`, which re-derives `clock_in`, `clock_out`, the status and the
 * minute figures from the punches that survive the write — the summary can
 * never drift from the log, because it is never edited independently of it.
 */
@Injectable()
export class AttendancePunchService {
    constructor(
        private readonly db: DatabaseService,
        private readonly schedules: WorkSchedulesService,
    ) {}

    /** Local midnight for a moment, as a `@db.Date` value. */
    private dateOnly(at: Date): Date {
        return new Date(Date.UTC(at.getFullYear(), at.getMonth(), at.getDate()));
    }

    private dateKey(at: Date): string {
        return this.dateOnly(at).toISOString().slice(0, 10);
    }

    private async scheduleDayFor(tenantId: string, employeeId: string, date: Date): Promise<ScheduleDay | null> {
        const days = await this.schedules.resolveScheduleDays(tenantId, employeeId, date);
        return days.find((day) => day.weekday === date.getDay()) ?? null;
    }

    private async requireEmployee(tenantId: string, employeeId: string) {
        const employee = await this.db.employee.findFirst({
            where: { id: employeeId, tenant_id: tenantId, deleted_at: null },
        });
        if (!employee) throw new NotFoundException('Employee not found.');
        return employee;
    }

    private parseMoment(value: string): Date {
        const at = new Date(value);
        if (Number.isNaN(at.getTime())) {
            throw new BadRequestException('Enter a valid date and time for the punch.');
        }
        return at;
    }

    private normaliseDirection(value: string): PunchDirection {
        const direction = value?.toUpperCase();
        if (direction !== 'IN' && direction !== 'OUT') {
            throw new BadRequestException('A punch must be either IN or OUT.');
        }
        return direction;
    }

    // ── Reads ─────────────────────────────────────────────────────────────────

    async list(tenantId: string, opts: PunchQueryDto = {} as PunchQueryDto): Promise<PaginatedResult<any>> {
        const page = opts.page ?? 1;
        const limit = Math.min(opts.limit ?? 50, 200);

        const where: any = { tenant_id: tenantId };
        if (opts.employeeId) where.employee_id = opts.employeeId;
        if (opts.direction) where.direction = this.normaliseDirection(opts.direction);
        if (opts.startDate || opts.endDate) {
            where.date = {};
            if (opts.startDate) where.date.gte = new Date(opts.startDate);
            if (opts.endDate) where.date.lte = new Date(opts.endDate);
        }

        const [items, total] = await Promise.all([
            this.db.attendancePunch.findMany({
                where,
                include: {
                    employee: { select: { id: true, name: true, employee_code: true } },
                    store: { select: { id: true, name: true } },
                },
                // Newest first, and within a day newest punch first — the
                // management screen is read as "what happened most recently".
                orderBy: [{ date: 'desc' }, { punched_at: 'desc' }],
                skip: (page - 1) * limit,
                take: limit,
            }),
            this.db.attendancePunch.count({ where }),
        ]);

        return paginate(items, total, page, limit);
    }

    /**
     * One day's punches for one employee, with the summary they produce.
     *
     * Returned together on purpose: the screen that edits punches is the screen
     * that needs to show what the edit did to the day.
     */
    async listDay(tenantId: string, employeeId: string, dateInput: string) {
        const date = this.dateOnly(new Date(dateInput));

        const [punches, record] = await Promise.all([
            this.db.attendancePunch.findMany({
                where: { tenant_id: tenantId, employee_id: employeeId, date },
                orderBy: { punched_at: 'asc' },
            }),
            this.db.attendanceRecord.findFirst({
                where: { tenant_id: tenantId, employee_id: employeeId, date },
            }),
        ]);

        return { date: date.toISOString().slice(0, 10), employeeId, punches, record };
    }

    // ── Writes ────────────────────────────────────────────────────────────────

    async create(tenantId: string, dto: CreatePunchDto) {
        await this.requireEmployee(tenantId, dto.employee_id);

        const at = this.parseMoment(dto.punched_at);
        const direction = this.normaliseDirection(dto.direction);

        const punch = await this.db.attendancePunch.create({
            data: {
                tenant_id: tenantId,
                employee_id: dto.employee_id,
                date: this.dateOnly(at),
                punched_at: at,
                direction,
                source: dto.source ?? 'ADMIN',
                notes: dto.notes ?? null,
            },
        });

        const record = await this.rebuildDay(tenantId, dto.employee_id, at);
        return { punch, record };
    }

    async update(tenantId: string, id: string, dto: UpdatePunchDto) {
        const existing = await this.db.attendancePunch.findFirst({
            where: { id, tenant_id: tenantId },
        });
        if (!existing) throw new NotFoundException('In/out record not found.');

        const at = dto.punched_at ? this.parseMoment(dto.punched_at) : existing.punched_at;
        const direction = dto.direction ? this.normaliseDirection(dto.direction) : existing.direction;

        const punch = await this.db.attendancePunch.update({
            where: { id },
            data: {
                punched_at: at,
                date: this.dateOnly(at),
                direction,
                ...(dto.notes !== undefined ? { notes: dto.notes || null } : {}),
            },
        });

        // Moving a punch across midnight leaves *two* days wrong: the one it
        // left, which may now have no clock-out, and the one it joined.
        const record = await this.rebuildDay(tenantId, existing.employee_id, at);
        if (this.dateKey(existing.punched_at) !== this.dateKey(at)) {
            await this.rebuildDay(tenantId, existing.employee_id, existing.punched_at);
        }

        return { punch, record };
    }

    async remove(tenantId: string, id: string) {
        const existing = await this.db.attendancePunch.findFirst({
            where: { id, tenant_id: tenantId },
        });
        if (!existing) throw new NotFoundException('In/out record not found.');

        await this.db.attendancePunch.delete({ where: { id } });

        const record = await this.rebuildDay(tenantId, existing.employee_id, existing.punched_at);
        return { deleted: true, record };
    }

    /**
     * Re-derive one day's `AttendanceRecord` from its punches.
     *
     * Called after every punch write, and safe to call at any other time — it
     * reads the log and writes the summary, with no state of its own.
     *
     * Two things it deliberately does *not* do. It never clears a day that has
     * no punches but was written by hand or by a leave approval: a tenant that
     * types attendance directly, or an `ON_LEAVE` row, must survive somebody
     * deleting an unrelated punch. And it keeps whatever `notes` the day row
     * already carries, because those are an admin's words about the day, not a
     * figure derived from times.
     */
    async rebuildDay(tenantId: string, employeeId: string, day: Date) {
        const date = this.dateOnly(day);

        const [punches, existing, settings] = await Promise.all([
            this.db.attendancePunch.findMany({
                where: { tenant_id: tenantId, employee_id: employeeId, date },
                orderBy: { punched_at: 'asc' },
            }),
            this.db.attendanceRecord.findFirst({
                where: { tenant_id: tenantId, employee_id: employeeId, date },
            }),
            this.db.attendanceSettings.findUnique({ where: { tenant_id: tenantId } }),
        ]);

        const graceMinutes = settings?.grace_minutes ?? 15;

        if (punches.length === 0) {
            // Only a row this log produced may be removed by this log.
            if (existing && (existing.source === 'PUNCH' || existing.source === 'SELF')) {
                await this.db.attendanceRecord.delete({ where: { id: existing.id } });
                return null;
            }
            return existing ?? null;
        }

        const { clockIn, clockOut } = derivePunchWindow(punches as DayPunch[]);
        const reference = clockIn?.punched_at ?? punches[0].punched_at;

        const [scheduleDay, holidayKeys] = await Promise.all([
            this.scheduleDayFor(tenantId, employeeId, reference),
            this.schedules.holidayKeysBetween(tenantId, date, date),
        ]);

        const isHoliday = holidayKeys.has(this.dateKey(reference));
        const assessment = assessDay(
            scheduleDay,
            clockIn?.punched_at ?? null,
            clockOut?.punched_at ?? null,
            graceMinutes,
        );
        const status = deriveStatus(scheduleDay, assessment, {
            isHoliday,
            hasClockIn: Boolean(clockIn),
        });

        // The day is credited to whoever produced its arrival — "who says you
        // were here" is the first question asked of any attendance dispute.
        const source = clockIn?.source === 'SELF' ? 'SELF' : 'PUNCH';

        const data = {
            clock_in: clockIn?.punched_at ?? null,
            clock_out: clockOut?.punched_at ?? null,
            status: status as any,
            late_minutes: assessment.lateMinutes,
            early_leave_minutes: assessment.earlyLeaveMinutes,
            worked_minutes: assessment.workedMinutes,
            overtime_minutes: assessment.overtimeMinutes,
            source,
            clock_in_lat: clockIn?.latitude ?? null,
            clock_in_lng: clockIn?.longitude ?? null,
            clock_out_lat: clockOut?.latitude ?? null,
            clock_out_lng: clockOut?.longitude ?? null,
            store_id: clockIn?.store_id ?? null,
        };

        return this.db.attendanceRecord.upsert({
            where: {
                tenant_id_employee_id_date: { tenant_id: tenantId, employee_id: employeeId, date },
            },
            create: { tenant_id: tenantId, employee_id: employeeId, date, ...data },
            update: data,
        });
    }

    /**
     * Record a punch made by the employee themselves.
     *
     * Called by `AttendanceCaptureService` after it has applied its own rules
     * (self-service on, geofence passed, no second check-in). It only writes
     * the log row — the capture service still computes the day row itself, and
     * would reach the same answer through `rebuildDay`, because a check-in is
     * refused twice and a check-out always becomes the latest OUT.
     */
    async recordSelfPunch(
        tenantId: string,
        employeeId: string,
        direction: PunchDirection,
        at: Date,
        location?: { latitude?: number | null; longitude?: number | null; storeId?: string | null },
    ) {
        return this.db.attendancePunch.create({
            data: {
                tenant_id: tenantId,
                employee_id: employeeId,
                date: this.dateOnly(at),
                punched_at: at,
                direction,
                source: 'SELF',
                latitude: location?.latitude ?? null,
                longitude: location?.longitude ?? null,
                store_id: location?.storeId ?? null,
            },
        });
    }
}
