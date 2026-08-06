import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { WorkSchedulesService } from '../work-schedules/work-schedules.service';

/**
 * Overtime approval and the frozen monthly snapshot — HRIS Phase 4.
 *
 * This is the contract between attendance and payroll. Everything the payroll
 * run needs about a month lives in one `AttendanceMonthSnapshot` row, and once
 * that row is frozen it stops changing — which is what makes a payroll re-run
 * produce the same pay it produced the first time.
 */
@Injectable()
export class OvertimeService {
    constructor(
        private readonly db: DatabaseService,
        private readonly schedules: WorkSchedulesService,
    ) {}

    private monthRange(year: number, month: number) {
        return {
            start: new Date(Date.UTC(year, month - 1, 1)),
            end: new Date(Date.UTC(year, month, 0)),
        };
    }

    // ── Overtime ──────────────────────────────────────────────────────────────

    /**
     * Raise a PENDING overtime record for every day of the month whose
     * attendance row observed overtime and which has no record yet.
     *
     * Idempotent: an existing record for a day is left exactly as it is, even
     * if the underlying minutes have since changed. Re-running this must never
     * reset an approval somebody already gave — a manager who approved 90
     * minutes has approved 90 minutes, and a later correction is a decision for
     * a human, not a sweep.
     */
    async generateForMonth(tenantId: string, year: number, month: number) {
        const { start, end } = this.monthRange(year, month);

        const records = await this.db.attendanceRecord.findMany({
            where: {
                tenant_id: tenantId,
                date: { gte: start, lte: end },
                overtime_minutes: { gt: 0 },
            },
            select: { employee_id: true, date: true, overtime_minutes: true },
        });
        if (records.length === 0) return { created: 0, skipped: 0 };

        const existing = await this.db.overtimeRecord.findMany({
            where: { tenant_id: tenantId, date: { gte: start, lte: end } },
            select: { employee_id: true, date: true },
        });
        const seen = new Set(
            existing.map((row) => `${row.employee_id}:${row.date.toISOString().slice(0, 10)}`),
        );

        const fresh = records.filter(
            (row) => !seen.has(`${row.employee_id}:${row.date.toISOString().slice(0, 10)}`),
        );

        if (fresh.length > 0) {
            await this.db.overtimeRecord.createMany({
                data: fresh.map((row) => ({
                    tenant_id: tenantId,
                    employee_id: row.employee_id,
                    date: row.date,
                    minutes: row.overtime_minutes,
                    status: 'PENDING',
                })),
                skipDuplicates: true,
            });
        }

        return { created: fresh.length, skipped: records.length - fresh.length };
    }

    async list(tenantId: string, opts: { year?: number; month?: number; status?: string; employeeId?: string } = {}) {
        const where: any = { tenant_id: tenantId };
        if (opts.status) where.status = opts.status;
        if (opts.employeeId) where.employee_id = opts.employeeId;
        if (opts.year && opts.month) {
            const { start, end } = this.monthRange(opts.year, opts.month);
            where.date = { gte: start, lte: end };
        }

        return this.db.overtimeRecord.findMany({
            where,
            include: { employee: { select: { id: true, name: true, employee_code: true } } },
            orderBy: [{ date: 'desc' }],
        });
    }

    /**
     * Approve or reject overtime.
     *
     * A reviewer may approve *fewer* minutes than were observed — an employee
     * who stayed three hours but was only asked to stay one is a normal case,
     * and forcing all-or-nothing would push managers into rejecting honest
     * records. More than observed is refused: that would be inventing hours.
     */
    async review(
        tenantId: string,
        id: string,
        reviewerUserId: string,
        dto: { status: 'APPROVED' | 'REJECTED'; minutes?: number; note?: string },
    ) {
        const record = await this.db.overtimeRecord.findFirst({ where: { id, tenant_id: tenantId } });
        if (!record) throw new NotFoundException('Overtime record not found.');
        if (record.status !== 'PENDING') {
            throw new BadRequestException('Only pending overtime can be reviewed.');
        }

        await this.assertMonthNotFrozen(tenantId, record.employee_id, record.date);

        if (dto.minutes != null) {
            if (dto.minutes < 0) throw new BadRequestException('Approved minutes cannot be negative.');
            if (dto.minutes > record.minutes) {
                throw new BadRequestException(
                    `Cannot approve more than the ${record.minutes} minutes recorded.`,
                );
            }
        }

        return this.db.overtimeRecord.update({
            where: { id },
            data: {
                status: dto.status,
                ...(dto.minutes != null ? { minutes: dto.minutes } : {}),
                approved_by: reviewerUserId,
                approved_at: new Date(),
                note: dto.note ?? null,
            },
        });
    }

    /**
     * Refuse to change anything that a frozen month already accounted for.
     *
     * Without this the freeze would be decorative: the snapshot would hold last
     * month's numbers while the underlying approvals drifted, and the two would
     * disagree with nobody being told.
     */
    private async assertMonthNotFrozen(tenantId: string, employeeId: string, date: Date) {
        const snapshot = await this.db.attendanceMonthSnapshot.findFirst({
            where: {
                tenant_id: tenantId,
                employee_id: employeeId,
                year: date.getUTCFullYear(),
                month: date.getUTCMonth() + 1,
                frozen_at: { not: null },
            },
            select: { id: true },
        });
        if (snapshot) {
            throw new ConflictException(
                'This month has been frozen for payroll. Unfreeze it before changing overtime.',
            );
        }
    }

    // ── Monthly snapshot ──────────────────────────────────────────────────────

    /**
     * Rebuild the month's snapshot for every active employee.
     *
     * Frozen rows are skipped rather than failing the whole run: a month is
     * frozen per employee, and one settled leaver must not stop the rest of the
     * payroll being prepared.
     */
    async buildSnapshots(tenantId: string, year: number, month: number) {
        const { start, end } = this.monthRange(year, month);

        const [employees, frozen, holidayKeys] = await Promise.all([
            this.db.employee.findMany({
                where: { tenant_id: tenantId, status: 'ACTIVE', deleted_at: null },
                select: { id: true },
            }),
            this.db.attendanceMonthSnapshot.findMany({
                where: { tenant_id: tenantId, year, month, frozen_at: { not: null } },
                select: { employee_id: true },
            }),
            this.schedules.holidayKeysBetween(tenantId, start, end),
        ]);

        const frozenIds = new Set(frozen.map((row) => row.employee_id));
        let built = 0;

        for (const employee of employees) {
            if (frozenIds.has(employee.id)) continue;

            const [records, overtime, scheduleDays] = await Promise.all([
                this.db.attendanceRecord.findMany({
                    where: { tenant_id: tenantId, employee_id: employee.id, date: { gte: start, lte: end } },
                    select: { status: true, worked_minutes: true, late_minutes: true },
                }),
                this.db.overtimeRecord.findMany({
                    where: {
                        tenant_id: tenantId, employee_id: employee.id,
                        date: { gte: start, lte: end }, status: 'APPROVED',
                    },
                    select: { minutes: true },
                }),
                this.schedules.resolveScheduleDays(tenantId, employee.id, start),
            ]);

            const counts = { present: 0, absent: 0, half: 0, leave: 0, holiday: 0, late: 0 };
            let workedMinutes = 0;
            let lateMinutes = 0;

            for (const record of records) {
                workedMinutes += record.worked_minutes ?? 0;
                lateMinutes += record.late_minutes ?? 0;
                switch (record.status) {
                    case 'PRESENT': counts.present += 1; break;
                    // A late day is still a present day for pay. Counting it in
                    // both places is deliberate: payroll needs the headcount,
                    // a manager needs the lateness.
                    case 'LATE': counts.present += 1; counts.late += 1; break;
                    case 'EARLY_LEAVE': counts.present += 1; break;
                    case 'HALF_DAY': counts.half += 1; break;
                    case 'ABSENT': counts.absent += 1; break;
                    case 'ON_LEAVE': counts.leave += 1; break;
                    case 'HOLIDAY': counts.holiday += 1; break;
                }
            }

            const working = new Set(scheduleDays.filter((day) => day.is_working).map((day) => day.weekday));
            let scheduledDays = 0;
            for (
                let cursor = new Date(start);
                cursor <= end;
                cursor = new Date(cursor.getTime() + 86_400_000)
            ) {
                if (holidayKeys.has(cursor.toISOString().slice(0, 10))) continue;
                if (working.has(cursor.getUTCDay())) scheduledDays += 1;
            }

            const data = {
                // A half day is half a day of attendance. Payroll deducts from
                // this figure, so it has to be the pay-bearing count, not a
                // headcount of rows.
                present_days: counts.present + counts.half * 0.5,
                absent_days: counts.absent,
                half_days: counts.half,
                leave_days: counts.leave,
                holiday_days: counts.holiday,
                late_days: counts.late,
                scheduled_days: scheduledDays,
                worked_minutes: workedMinutes,
                late_minutes: lateMinutes,
                approved_overtime_minutes: overtime.reduce((sum, row) => sum + row.minutes, 0),
            };

            await this.db.attendanceMonthSnapshot.upsert({
                where: {
                    tenant_id_employee_id_year_month: {
                        tenant_id: tenantId, employee_id: employee.id, year, month,
                    },
                },
                create: { tenant_id: tenantId, employee_id: employee.id, year, month, ...data },
                update: data,
            });
            built += 1;
        }

        return { built, skippedFrozen: frozenIds.size };
    }

    async listSnapshots(tenantId: string, year: number, month: number) {
        return this.db.attendanceMonthSnapshot.findMany({
            where: { tenant_id: tenantId, year, month },
            include: { employee: { select: { id: true, name: true, employee_code: true } } },
            orderBy: { employee: { name: 'asc' } },
        });
    }

    /**
     * Freeze the month. Called by the payroll run before it computes anything.
     *
     * Rebuilds first, so the frozen figures are the current ones rather than
     * whatever was cached — freezing a stale snapshot would be the worst of
     * both worlds.
     */
    async freezeMonth(tenantId: string, year: number, month: number) {
        await this.buildSnapshots(tenantId, year, month);
        const result = await this.db.attendanceMonthSnapshot.updateMany({
            where: { tenant_id: tenantId, year, month, frozen_at: null },
            data: { frozen_at: new Date() },
        });
        return { frozen: result.count };
    }

    /**
     * Unfreeze, so a correction can be made and payroll re-run.
     *
     * Deliberately not a silent side effect of editing an attendance row: an
     * unfreeze means last month's pay may change, and that should be somebody's
     * explicit decision.
     */
    async unfreezeMonth(tenantId: string, year: number, month: number) {
        const result = await this.db.attendanceMonthSnapshot.updateMany({
            where: { tenant_id: tenantId, year, month, frozen_at: { not: null } },
            data: { frozen_at: null },
        });
        return { unfrozen: result.count };
    }

    /** The snapshot a payroll run should read, or null if the month is not ready. */
    async getFrozenSnapshot(tenantId: string, employeeId: string, year: number, month: number) {
        return this.db.attendanceMonthSnapshot.findFirst({
            where: {
                tenant_id: tenantId, employee_id: employeeId, year, month,
                frozen_at: { not: null },
            },
        });
    }
}
