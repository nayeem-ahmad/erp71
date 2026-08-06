import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { OvertimeService } from './overtime.service';
import { WorkSchedulesService } from '../work-schedules/work-schedules.service';
import { DatabaseService } from '../database/database.service';

const WEEK = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    is_working: weekday <= 4,
    start_minute: weekday <= 4 ? 540 : null,
    end_minute: weekday <= 4 ? 1080 : null,
    break_minutes: weekday <= 4 ? 60 : 0,
}));

const d = (day: number) => new Date(Date.UTC(2026, 7, day)); // August 2026

describe('OvertimeService', () => {
    let service: OvertimeService;
    let db: any;
    let schedules: any;

    beforeEach(async () => {
        db = {
            attendanceRecord: { findMany: jest.fn().mockResolvedValue([]) },
            overtimeRecord: {
                findMany: jest.fn().mockResolvedValue([]),
                findFirst: jest.fn().mockResolvedValue(null),
                createMany: jest.fn().mockResolvedValue({ count: 0 }),
                update: jest.fn().mockResolvedValue({}),
            },
            attendanceMonthSnapshot: {
                findMany: jest.fn().mockResolvedValue([]),
                findFirst: jest.fn().mockResolvedValue(null),
                upsert: jest.fn().mockResolvedValue({}),
                updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
            employee: { findMany: jest.fn().mockResolvedValue([{ id: 'emp-1' }]) },
        };
        schedules = {
            holidayKeysBetween: jest.fn().mockResolvedValue(new Set<string>()),
            resolveScheduleDays: jest.fn().mockResolvedValue(WEEK),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                OvertimeService,
                { provide: DatabaseService, useValue: db },
                { provide: WorkSchedulesService, useValue: schedules },
            ],
        }).compile();
        service = module.get(OvertimeService);
    });

    describe('generateForMonth', () => {
        it('raises a pending record for each day with observed overtime', async () => {
            db.attendanceRecord.findMany.mockResolvedValue([
                { employee_id: 'emp-1', date: d(10), overtime_minutes: 60 },
                { employee_id: 'emp-1', date: d(11), overtime_minutes: 30 },
            ]);

            const result = await service.generateForMonth('t1', 2026, 8);

            expect(result.created).toBe(2);
            expect(db.overtimeRecord.createMany.mock.calls[0][0].data[0].status).toBe('PENDING');
        });

        it('leaves an existing record completely alone', async () => {
            // Re-running must never reset an approval somebody already gave.
            db.attendanceRecord.findMany.mockResolvedValue([
                { employee_id: 'emp-1', date: d(10), overtime_minutes: 999 },
            ]);
            db.overtimeRecord.findMany.mockResolvedValue([
                { employee_id: 'emp-1', date: d(10) },
            ]);

            const result = await service.generateForMonth('t1', 2026, 8);

            expect(result.created).toBe(0);
            expect(result.skipped).toBe(1);
            expect(db.overtimeRecord.createMany).not.toHaveBeenCalled();
        });

        it('does nothing when no day observed overtime', async () => {
            const result = await service.generateForMonth('t1', 2026, 8);
            expect(result).toEqual({ created: 0, skipped: 0 });
        });

        it('only looks at days with overtime above zero', async () => {
            await service.generateForMonth('t1', 2026, 8);
            expect(db.attendanceRecord.findMany.mock.calls[0][0].where.overtime_minutes)
                .toEqual({ gt: 0 });
        });
    });

    describe('review', () => {
        const PENDING = { id: 'ot-1', employee_id: 'emp-1', date: d(10), minutes: 120, status: 'PENDING' };

        beforeEach(() => db.overtimeRecord.findFirst.mockResolvedValue(PENDING));

        it('approves the observed minutes', async () => {
            await service.review('t1', 'ot-1', 'user-1', { status: 'APPROVED' });
            const data = db.overtimeRecord.update.mock.calls[0][0].data;
            expect(data.status).toBe('APPROVED');
            expect(data.approved_by).toBe('user-1');
        });

        it('allows approving fewer minutes than observed', async () => {
            // Someone who stayed three hours but was asked to stay one is a
            // normal case; all-or-nothing pushes managers into rejecting
            // honest records.
            await service.review('t1', 'ot-1', 'user-1', { status: 'APPROVED', minutes: 60 });
            expect(db.overtimeRecord.update.mock.calls[0][0].data.minutes).toBe(60);
        });

        it('refuses to approve more minutes than observed', async () => {
            await expect(service.review('t1', 'ot-1', 'user-1', { status: 'APPROVED', minutes: 300 }))
                .rejects.toThrow(BadRequestException);
        });

        it('refuses negative minutes', async () => {
            await expect(service.review('t1', 'ot-1', 'user-1', { status: 'APPROVED', minutes: -1 }))
                .rejects.toThrow(BadRequestException);
        });

        it('refuses to review something already reviewed', async () => {
            db.overtimeRecord.findFirst.mockResolvedValue({ ...PENDING, status: 'APPROVED' });
            await expect(service.review('t1', 'ot-1', 'user-1', { status: 'REJECTED' }))
                .rejects.toThrow(BadRequestException);
        });

        it('refuses a record from another tenant', async () => {
            db.overtimeRecord.findFirst.mockResolvedValue(null);
            await expect(service.review('t1', 'ot-x', 'user-1', { status: 'APPROVED' }))
                .rejects.toThrow(NotFoundException);
        });

        it('refuses to change overtime in a frozen month', async () => {
            // Without this the freeze would be decorative — the snapshot would
            // hold one set of numbers while the approvals drifted underneath.
            db.attendanceMonthSnapshot.findFirst.mockResolvedValue({ id: 'snap-1' });
            await expect(service.review('t1', 'ot-1', 'user-1', { status: 'APPROVED' }))
                .rejects.toThrow(ConflictException);
        });
    });

    describe('buildSnapshots', () => {
        const withRecords = (records: any[], overtime: any[] = []) => {
            db.attendanceRecord.findMany.mockResolvedValue(records);
            db.overtimeRecord.findMany.mockResolvedValue(overtime);
        };

        it('counts a late day as present and as late', async () => {
            // Payroll needs the headcount; a manager needs the lateness. Both.
            withRecords([
                { status: 'PRESENT', worked_minutes: 480, late_minutes: 0 },
                { status: 'LATE', worked_minutes: 450, late_minutes: 30 },
            ]);

            await service.buildSnapshots('t1', 2026, 8);
            const data = db.attendanceMonthSnapshot.upsert.mock.calls[0][0].create;

            expect(data.present_days).toBe(2);
            expect(data.late_days).toBe(1);
            expect(data.late_minutes).toBe(30);
        });

        it('counts an early departure as a present day', async () => {
            withRecords([{ status: 'EARLY_LEAVE', worked_minutes: 400, late_minutes: 0 }]);
            await service.buildSnapshots('t1', 2026, 8);
            expect(db.attendanceMonthSnapshot.upsert.mock.calls[0][0].create.present_days).toBe(1);
        });

        it('counts a half day as half a present day', async () => {
            // Payroll deducts from this figure, so it has to be pay-bearing
            // rather than a headcount of rows.
            withRecords([
                { status: 'PRESENT', worked_minutes: 480, late_minutes: 0 },
                { status: 'HALF_DAY', worked_minutes: 200, late_minutes: 0 },
            ]);
            await service.buildSnapshots('t1', 2026, 8);
            const data = db.attendanceMonthSnapshot.upsert.mock.calls[0][0].create;
            expect(data.present_days).toBe(1.5);
            expect(data.half_days).toBe(1);
        });

        it('keeps leave, absence and holidays in their own buckets', async () => {
            withRecords([
                { status: 'ON_LEAVE', worked_minutes: 0, late_minutes: 0 },
                { status: 'ABSENT', worked_minutes: 0, late_minutes: 0 },
                { status: 'HOLIDAY', worked_minutes: 0, late_minutes: 0 },
            ]);
            await service.buildSnapshots('t1', 2026, 8);
            const data = db.attendanceMonthSnapshot.upsert.mock.calls[0][0].create;
            expect(data.leave_days).toBe(1);
            expect(data.absent_days).toBe(1);
            expect(data.holiday_days).toBe(1);
            expect(data.present_days).toBe(0);
        });

        it('sums only approved overtime', async () => {
            withRecords([], [{ minutes: 60 }, { minutes: 30 }]);
            await service.buildSnapshots('t1', 2026, 8);
            expect(db.attendanceMonthSnapshot.upsert.mock.calls[0][0].create.approved_overtime_minutes).toBe(90);
            // The query is what enforces "approved only".
            expect(db.overtimeRecord.findMany.mock.calls[0][0].where.status).toBe('APPROVED');
        });

        it('counts scheduled working days excluding holidays', async () => {
            // August 2026 starts on a Saturday and holds 22 Sun–Thu days.
            await service.buildSnapshots('t1', 2026, 8);
            expect(db.attendanceMonthSnapshot.upsert.mock.calls[0][0].create.scheduled_days).toBe(22);
        });

        it('removes a declared holiday from the scheduled days', async () => {
            schedules.holidayKeysBetween.mockResolvedValue(new Set(['2026-08-10']));
            await service.buildSnapshots('t1', 2026, 8);
            expect(db.attendanceMonthSnapshot.upsert.mock.calls[0][0].create.scheduled_days).toBe(21);
        });

        it('does not subtract a holiday that falls on a rest day', async () => {
            // 2026-08-15 is a Saturday — already not a working day, so removing
            // it again would undercount the month.
            schedules.holidayKeysBetween.mockResolvedValue(new Set(['2026-08-15']));
            await service.buildSnapshots('t1', 2026, 8);
            expect(db.attendanceMonthSnapshot.upsert.mock.calls[0][0].create.scheduled_days).toBe(22);
        });

        it('skips an employee whose month is frozen', async () => {
            db.employee.findMany.mockResolvedValue([{ id: 'emp-1' }, { id: 'emp-2' }]);
            db.attendanceMonthSnapshot.findMany.mockResolvedValue([{ employee_id: 'emp-1' }]);

            const result = await service.buildSnapshots('t1', 2026, 8);

            expect(result.built).toBe(1);
            expect(result.skippedFrozen).toBe(1);
        });

        it('does not fail the whole run because one employee is frozen', async () => {
            db.employee.findMany.mockResolvedValue([{ id: 'emp-1' }, { id: 'emp-2' }]);
            db.attendanceMonthSnapshot.findMany.mockResolvedValue([{ employee_id: 'emp-1' }]);

            await expect(service.buildSnapshots('t1', 2026, 8)).resolves.toBeDefined();
            expect(db.attendanceMonthSnapshot.upsert).toHaveBeenCalledTimes(1);
        });
    });

    describe('freeze / unfreeze', () => {
        it('rebuilds before freezing so the frozen figures are current', async () => {
            // Freezing a stale snapshot would be the worst of both worlds.
            await service.freezeMonth('t1', 2026, 8);
            expect(db.attendanceMonthSnapshot.upsert).toHaveBeenCalled();
            expect(db.attendanceMonthSnapshot.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ frozen_at: null }),
                    data: expect.objectContaining({ frozen_at: expect.any(Date) }),
                }),
            );
        });

        it('does not re-stamp an already frozen row', async () => {
            expect(db.attendanceMonthSnapshot.updateMany).not.toHaveBeenCalled();
            await service.freezeMonth('t1', 2026, 8);
            expect(db.attendanceMonthSnapshot.updateMany.mock.calls[0][0].where.frozen_at).toBeNull();
        });

        it('unfreezes only rows that are frozen', async () => {
            await service.unfreezeMonth('t1', 2026, 8);
            expect(db.attendanceMonthSnapshot.updateMany.mock.calls[0][0].where.frozen_at)
                .toEqual({ not: null });
        });
    });

    describe('getFrozenSnapshot', () => {
        it('returns nothing for a month that is not frozen', async () => {
            db.attendanceMonthSnapshot.findFirst.mockResolvedValue(null);
            expect(await service.getFrozenSnapshot('t1', 'emp-1', 2026, 8)).toBeNull();
            expect(db.attendanceMonthSnapshot.findFirst.mock.calls[0][0].where.frozen_at)
                .toEqual({ not: null });
        });
    });
});
