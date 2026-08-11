import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { WorkSchedulesService } from '../work-schedules/work-schedules.service';
import { assessDay, deriveStatus, type ScheduleDay } from '../work-schedules/schedule.util';
import { isValidPoint, matchStore, type GeofenceMatch } from './geofence.util';
import { AttendancePunchService } from './attendance-punch.service';

/**
 * Turning a clock-in into an attendance row — HRIS Phase 3.
 *
 * Kept separate from `AttendanceService`, which is the admin CRUD surface. The
 * difference is not cosmetic: everything here derives its result from the
 * employee's schedule rather than accepting a status a human typed, and the
 * employee id always comes from the caller's token.
 */
@Injectable()
export class AttendanceCaptureService {
    constructor(
        private readonly db: DatabaseService,
        private readonly schedules: WorkSchedulesService,
        /**
         * A portal check-in is a punch like any other and belongs in the same
         * log, so an admin looking at an employee's day sees every tap rather
         * than only the two the summary kept.
         */
        private readonly punches: AttendancePunchService,
    ) {}

    /** Local midnight for a moment, as a `@db.Date` value. */
    private dateOnly(at: Date): Date {
        return new Date(Date.UTC(at.getFullYear(), at.getMonth(), at.getDate()));
    }

    private dateKey(at: Date): string {
        return this.dateOnly(at).toISOString().slice(0, 10);
    }

    async getSettings(tenantId: string) {
        const existing = await this.db.attendanceSettings.findUnique({ where: { tenant_id: tenantId } });
        if (existing) return existing;

        // Defaults without writing a row: a tenant that has never opened the
        // settings screen should not get one created by a check-in.
        return {
            tenant_id: tenantId,
            self_service_enabled: true,
            geofence_enabled: false,
            geofence_radius_m: 200,
            grace_minutes: 15,
        } as const;
    }

    async updateSettings(tenantId: string, patch: {
        self_service_enabled?: boolean;
        geofence_enabled?: boolean;
        geofence_radius_m?: number;
        grace_minutes?: number;
    }) {
        if (patch.geofence_enabled) {
            const located = await this.db.store.count({
                where: { tenant_id: tenantId, latitude: { not: null }, longitude: { not: null } },
            });
            if (located === 0) {
                // Enabling a fence with nothing to fence would silently do
                // nothing (matchStore passes when no store has coordinates), so
                // the tenant would believe it was on.
                throw new BadRequestException(
                    'Set the location of at least one store before turning on geofenced attendance.',
                );
            }
        }

        return this.db.attendanceSettings.upsert({
            where: { tenant_id: tenantId },
            create: { tenant_id: tenantId, ...patch },
            update: patch,
        });
    }

    /**
     * Resolve where a check-in happened, and refuse it if it is out of range.
     *
     * Returns a null match when geofencing is off — the caller then stores no
     * coordinates at all, rather than storing them "just in case". Capturing
     * location a tenant did not ask for is the kind of thing that is very hard
     * to undo once it is in the table.
     */
    private async resolveLocation(
        tenantId: string,
        settings: { geofence_enabled: boolean; geofence_radius_m: number },
        point: { latitude?: number; longitude?: number } | undefined,
    ): Promise<GeofenceMatch | null> {
        if (!settings.geofence_enabled) return null;

        if (!isValidPoint(point?.latitude, point?.longitude)) {
            throw new BadRequestException('Location is required to check in. Allow location access and try again.');
        }

        const stores = await this.db.store.findMany({
            where: { tenant_id: tenantId },
            select: { id: true, name: true, latitude: true, longitude: true },
        });

        const match = matchStore(
            { latitude: point!.latitude!, longitude: point!.longitude! },
            stores,
            settings.geofence_radius_m,
        );

        if (!match.withinFence) {
            // Say by how much. An employee who genuinely is at work and is being
            // refused cannot act on a bare "rejected".
            throw new ForbiddenException(
                `You appear to be ${match.distanceMetres}m from ${match.store?.name ?? 'any store'}. ` +
                `Check in within ${settings.geofence_radius_m}m of your workplace.`,
            );
        }

        return match;
    }

    private async scheduleDayFor(tenantId: string, employeeId: string, date: Date): Promise<ScheduleDay | null> {
        const days = await this.schedules.resolveScheduleDays(tenantId, employeeId, date);
        return days.find((day) => day.weekday === date.getDay()) ?? null;
    }

    /**
     * Clock in.
     *
     * Idempotent in the direction that matters: a second check-in on the same
     * day does **not** overwrite the first. The first arrival is the one that
     * determines lateness, and letting a later tap reset it would make the
     * status trivially defeatable.
     */
    async checkIn(
        tenantId: string,
        employeeId: string,
        opts: { at?: Date; latitude?: number; longitude?: number } = {},
    ) {
        const settings = await this.getSettings(tenantId);
        if (!settings.self_service_enabled) {
            throw new ForbiddenException('Self check-in is turned off for this business.');
        }

        const at = opts.at ?? new Date();
        const date = this.dateOnly(at);

        const existing = await this.db.attendanceRecord.findFirst({
            where: { tenant_id: tenantId, employee_id: employeeId, date },
        });
        if (existing?.clock_in) {
            throw new BadRequestException('You have already checked in today.');
        }

        const match = await this.resolveLocation(tenantId, settings, opts);
        const [day, holidayKeys] = await Promise.all([
            this.scheduleDayFor(tenantId, employeeId, at),
            this.schedules.holidayKeysBetween(tenantId, date, date),
        ]);

        const isHoliday = holidayKeys.has(this.dateKey(at));
        const assessment = assessDay(day, at, null, settings.grace_minutes);
        const status = deriveStatus(day, assessment, { isHoliday, hasClockIn: true });

        const data = {
            clock_in: at,
            status: status as any,
            late_minutes: assessment.lateMinutes,
            source: 'SELF',
            ...(match ? {
                clock_in_lat: opts.latitude ?? null,
                clock_in_lng: opts.longitude ?? null,
                store_id: match.store?.id ?? null,
            } : {}),
        };

        // Log first, summarise second. A stray punch with no day row is
        // recoverable — the next rebuild produces the row from it — whereas a
        // day row with no punch behind it is a figure with no evidence.
        await this.punches.recordSelfPunch(tenantId, employeeId, 'IN', at, match ? {
            latitude: opts.latitude ?? null,
            longitude: opts.longitude ?? null,
            storeId: match.store?.id ?? null,
        } : undefined);

        return this.db.attendanceRecord.upsert({
            where: {
                tenant_id_employee_id_date: { tenant_id: tenantId, employee_id: employeeId, date },
            },
            create: { tenant_id: tenantId, employee_id: employeeId, date, ...data },
            update: data,
        });
    }

    /**
     * Clock out.
     *
     * Unlike check-in this *does* overwrite: someone who taps again after
     * staying later is correcting the record upward, which is the honest
     * direction. The status is recomputed from both ends each time.
     */
    async checkOut(
        tenantId: string,
        employeeId: string,
        opts: { at?: Date; latitude?: number; longitude?: number } = {},
    ) {
        const settings = await this.getSettings(tenantId);
        if (!settings.self_service_enabled) {
            throw new ForbiddenException('Self check-out is turned off for this business.');
        }

        const at = opts.at ?? new Date();
        const date = this.dateOnly(at);

        const record = await this.db.attendanceRecord.findFirst({
            where: { tenant_id: tenantId, employee_id: employeeId, date },
        });
        if (!record?.clock_in) {
            throw new BadRequestException('You have not checked in today.');
        }
        if (record.clock_in > at) {
            throw new BadRequestException('Check-out cannot be before check-in.');
        }

        const match = await this.resolveLocation(tenantId, settings, opts);
        const [day, holidayKeys] = await Promise.all([
            this.scheduleDayFor(tenantId, employeeId, at),
            this.schedules.holidayKeysBetween(tenantId, date, date),
        ]);

        const isHoliday = holidayKeys.has(this.dateKey(at));
        const assessment = assessDay(day, record.clock_in, at, settings.grace_minutes);
        const status = deriveStatus(day, assessment, { isHoliday, hasClockIn: true });

        await this.punches.recordSelfPunch(tenantId, employeeId, 'OUT', at, match ? {
            latitude: opts.latitude ?? null,
            longitude: opts.longitude ?? null,
            storeId: match.store?.id ?? null,
        } : undefined);

        return this.db.attendanceRecord.update({
            where: { id: record.id },
            data: {
                clock_out: at,
                status: status as any,
                late_minutes: assessment.lateMinutes,
                early_leave_minutes: assessment.earlyLeaveMinutes,
                worked_minutes: assessment.workedMinutes,
                overtime_minutes: assessment.overtimeMinutes,
                ...(match ? {
                    clock_out_lat: opts.latitude ?? null,
                    clock_out_lng: opts.longitude ?? null,
                } : {}),
            },
        });
    }

    /** Today's row for an employee, for the portal's check-in button state. */
    async today(tenantId: string, employeeId: string, now: Date = new Date()) {
        const date = this.dateOnly(now);
        const [record, day, holidayKeys, settings] = await Promise.all([
            this.db.attendanceRecord.findFirst({
                where: { tenant_id: tenantId, employee_id: employeeId, date },
            }),
            this.scheduleDayFor(tenantId, employeeId, now),
            this.schedules.holidayKeysBetween(tenantId, date, date),
            this.getSettings(tenantId),
        ]);

        return {
            date: this.dateKey(now),
            record,
            isHoliday: holidayKeys.has(this.dateKey(now)),
            isWorkingDay: Boolean(day?.is_working),
            scheduledStartMinute: day?.start_minute ?? null,
            scheduledEndMinute: day?.end_minute ?? null,
            selfServiceEnabled: settings.self_service_enabled,
            geofenceEnabled: settings.geofence_enabled,
        };
    }

    /**
     * Write `ON_LEAVE` rows across an approved leave request.
     *
     * Called from the leave approval, which is what stops the attendance report
     * and the leave report contradicting each other — before this they shared
     * no data at all.
     *
     * Skips days that are not working days and days that already carry a
     * clock-in: someone who worked and *also* had leave approved for that date
     * was at work, and the timesheet is the stronger evidence.
     */
    async markLeaveDays(
        tenantId: string,
        employeeId: string,
        startDate: Date,
        endDate: Date,
    ): Promise<number> {
        const start = this.dateOnly(startDate);
        const end = this.dateOnly(endDate);
        if (end < start) return 0;

        const [days, holidayKeys, existing] = await Promise.all([
            this.schedules.resolveScheduleDays(tenantId, employeeId, start),
            this.schedules.holidayKeysBetween(tenantId, start, end),
            this.db.attendanceRecord.findMany({
                where: {
                    tenant_id: tenantId,
                    employee_id: employeeId,
                    date: { gte: start, lte: end },
                },
                select: { date: true, clock_in: true },
            }),
        ]);

        const worked = new Set(
            existing
                .filter((record) => record.clock_in)
                .map((record) => record.date.toISOString().slice(0, 10)),
        );
        const byWeekday = new Map(days.map((day) => [day.weekday, day]));

        let written = 0;
        for (
            let cursor = new Date(start);
            cursor <= end;
            cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)
        ) {
            const key = cursor.toISOString().slice(0, 10);
            if (worked.has(key) || holidayKeys.has(key)) continue;
            if (!byWeekday.get(cursor.getUTCDay())?.is_working) continue;

            await this.db.attendanceRecord.upsert({
                where: {
                    tenant_id_employee_id_date: {
                        tenant_id: tenantId, employee_id: employeeId, date: cursor,
                    },
                },
                create: {
                    tenant_id: tenantId,
                    employee_id: employeeId,
                    date: cursor,
                    status: 'ON_LEAVE' as any,
                    source: 'LEAVE',
                },
                update: { status: 'ON_LEAVE' as any, source: 'LEAVE' },
            });
            written += 1;
        }

        return written;
    }

    /**
     * Undo `markLeaveDays` when an approved request is cancelled.
     *
     * Deletes only rows this service wrote (`source = 'LEAVE'`), so a day an
     * admin later typed by hand survives the cancellation.
     */
    async unmarkLeaveDays(
        tenantId: string,
        employeeId: string,
        startDate: Date,
        endDate: Date,
    ): Promise<number> {
        const result = await this.db.attendanceRecord.deleteMany({
            where: {
                tenant_id: tenantId,
                employee_id: employeeId,
                date: { gte: this.dateOnly(startDate), lte: this.dateOnly(endDate) },
                source: 'LEAVE',
            },
        });
        return result.count;
    }
}
