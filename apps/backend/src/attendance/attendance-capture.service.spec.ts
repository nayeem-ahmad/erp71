import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AttendanceCaptureService } from './attendance-capture.service';
import { WorkSchedulesService } from '../work-schedules/work-schedules.service';
import { DatabaseService } from '../database/database.service';

/** A 9:00–18:00 Sun–Thu week. */
const WEEK = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    is_working: weekday <= 4,
    start_minute: weekday <= 4 ? 540 : null,
    end_minute: weekday <= 4 ? 1080 : null,
    break_minutes: weekday <= 4 ? 60 : 0,
}));

/** 2026-08-10 is a Monday. */
const at = (hours: number, minutes = 0) => new Date(2026, 7, 10, hours, minutes);
const SUNDAY_OFF = new Date(2026, 7, 8); // a Saturday — non-working in this week

describe('AttendanceCaptureService', () => {
    let service: AttendanceCaptureService;
    let db: any;
    let schedules: any;

    beforeEach(async () => {
        db = {
            attendanceSettings: {
                findUnique: jest.fn().mockResolvedValue(null),
                upsert: jest.fn().mockResolvedValue({}),
            },
            attendanceRecord: {
                findFirst: jest.fn().mockResolvedValue(null),
                findMany: jest.fn().mockResolvedValue([]),
                upsert: jest.fn().mockResolvedValue({}),
                update: jest.fn().mockResolvedValue({}),
                deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
            store: {
                findMany: jest.fn().mockResolvedValue([]),
                count: jest.fn().mockResolvedValue(0),
            },
        };
        schedules = {
            resolveScheduleDays: jest.fn().mockResolvedValue(WEEK),
            holidayKeysBetween: jest.fn().mockResolvedValue(new Set<string>()),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AttendanceCaptureService,
                { provide: DatabaseService, useValue: db },
                { provide: WorkSchedulesService, useValue: schedules },
            ],
        }).compile();
        service = module.get(AttendanceCaptureService);
    });

    describe('settings', () => {
        it('returns working defaults without writing a row', async () => {
            // A tenant that has never opened the settings screen should not get
            // a row created by somebody clocking in.
            const settings = await service.getSettings('t1');
            expect(settings.self_service_enabled).toBe(true);
            expect(settings.geofence_enabled).toBe(false);
            expect(db.attendanceSettings.upsert).not.toHaveBeenCalled();
        });

        it('refuses to enable geofencing with no store located', async () => {
            // matchStore passes when no store has coordinates, so enabling it
            // would silently do nothing while the tenant believed it was on.
            db.store.count.mockResolvedValue(0);
            await expect(service.updateSettings('t1', { geofence_enabled: true }))
                .rejects.toThrow(BadRequestException);
        });

        it('enables geofencing once a store has coordinates', async () => {
            db.store.count.mockResolvedValue(1);
            await service.updateSettings('t1', { geofence_enabled: true });
            expect(db.attendanceSettings.upsert).toHaveBeenCalled();
        });

        it('allows other settings changes without a located store', async () => {
            await service.updateSettings('t1', { grace_minutes: 30 });
            expect(db.attendanceSettings.upsert).toHaveBeenCalled();
        });
    });

    describe('checkIn', () => {
        it('derives PRESENT and records no lateness for an on-time arrival', async () => {
            await service.checkIn('t1', 'emp-1', { at: at(9) });

            const data = db.attendanceRecord.upsert.mock.calls[0][0].create;
            expect(data.status).toBe('PRESENT');
            expect(data.late_minutes).toBe(0);
            expect(data.source).toBe('SELF');
        });

        it('derives LATE and records the minutes past the grace period', async () => {
            await service.checkIn('t1', 'emp-1', { at: at(9, 45) });

            const data = db.attendanceRecord.upsert.mock.calls[0][0].create;
            expect(data.status).toBe('LATE');
            expect(data.late_minutes).toBe(30);
        });

        it('honours a tenant grace period', async () => {
            db.attendanceSettings.findUnique.mockResolvedValue({
                self_service_enabled: true, geofence_enabled: false, geofence_radius_m: 200, grace_minutes: 60,
            });
            await service.checkIn('t1', 'emp-1', { at: at(9, 45) });
            expect(db.attendanceRecord.upsert.mock.calls[0][0].create.status).toBe('PRESENT');
        });

        it('records a holiday check-in as HOLIDAY', async () => {
            schedules.holidayKeysBetween.mockResolvedValue(new Set(['2026-08-10']));
            await service.checkIn('t1', 'emp-1', { at: at(9) });
            expect(db.attendanceRecord.upsert.mock.calls[0][0].create.status).toBe('HOLIDAY');
        });

        it('refuses a second check-in on the same day', async () => {
            // The first arrival is what determines lateness. Letting a later tap
            // reset it would make the status trivially defeatable.
            db.attendanceRecord.findFirst.mockResolvedValue({ id: 'a-1', clock_in: at(9) });
            await expect(service.checkIn('t1', 'emp-1', { at: at(11) }))
                .rejects.toThrow(BadRequestException);
        });

        it('allows a check-in on a day whose row exists without a clock-in', async () => {
            // e.g. an ON_LEAVE row written by an approval that was then worked.
            db.attendanceRecord.findFirst.mockResolvedValue({ id: 'a-1', clock_in: null });
            await service.checkIn('t1', 'emp-1', { at: at(9) });
            expect(db.attendanceRecord.upsert).toHaveBeenCalled();
        });

        it('refuses when self-service is turned off', async () => {
            db.attendanceSettings.findUnique.mockResolvedValue({
                self_service_enabled: false, geofence_enabled: false, geofence_radius_m: 200, grace_minutes: 15,
            });
            await expect(service.checkIn('t1', 'emp-1', { at: at(9) }))
                .rejects.toThrow(ForbiddenException);
        });

        describe('with geofencing on', () => {
            beforeEach(() => {
                db.attendanceSettings.findUnique.mockResolvedValue({
                    self_service_enabled: true, geofence_enabled: true, geofence_radius_m: 200, grace_minutes: 15,
                });
                db.store.findMany.mockResolvedValue([
                    { id: 's1', name: 'Gulshan', latitude: 23.7925, longitude: 90.4078 },
                ]);
            });

            it('refuses a check-in with no location', async () => {
                await expect(service.checkIn('t1', 'emp-1', { at: at(9) }))
                    .rejects.toThrow(BadRequestException);
            });

            it('refuses a check-in outside the fence and says how far', async () => {
                await expect(
                    service.checkIn('t1', 'emp-1', { at: at(9), latitude: 23.85, longitude: 90.41 }),
                ).rejects.toThrow(/m from Gulshan/);
            });

            it('accepts a check-in inside the fence and records where', async () => {
                await service.checkIn('t1', 'emp-1', {
                    at: at(9), latitude: 23.7925, longitude: 90.4078,
                });

                const data = db.attendanceRecord.upsert.mock.calls[0][0].create;
                expect(data.store_id).toBe('s1');
                expect(data.clock_in_lat).toBe(23.7925);
            });
        });

        it('stores no coordinates at all when geofencing is off', async () => {
            // Capturing location a tenant did not ask for is very hard to undo
            // once it is in the table.
            await service.checkIn('t1', 'emp-1', { at: at(9), latitude: 23.79, longitude: 90.4 });
            const data = db.attendanceRecord.upsert.mock.calls[0][0].create;
            expect(data).not.toHaveProperty('clock_in_lat');
            expect(data).not.toHaveProperty('store_id');
        });
    });

    describe('checkOut', () => {
        beforeEach(() => {
            db.attendanceRecord.findFirst.mockResolvedValue({ id: 'a-1', clock_in: at(9) });
        });

        it('records worked minutes with the break removed', async () => {
            await service.checkOut('t1', 'emp-1', { at: at(18) });
            const data = db.attendanceRecord.update.mock.calls[0][0].data;
            expect(data.worked_minutes).toBe(480);
            expect(data.status).toBe('PRESENT');
        });

        it('records an early departure', async () => {
            await service.checkOut('t1', 'emp-1', { at: at(17) });
            const data = db.attendanceRecord.update.mock.calls[0][0].data;
            expect(data.early_leave_minutes).toBe(60);
            expect(data.status).toBe('EARLY_LEAVE');
        });

        it('records raw overtime past the scheduled end', async () => {
            await service.checkOut('t1', 'emp-1', { at: at(20) });
            expect(db.attendanceRecord.update.mock.calls[0][0].data.overtime_minutes).toBe(120);
        });

        it('refuses a check-out with no check-in', async () => {
            db.attendanceRecord.findFirst.mockResolvedValue(null);
            await expect(service.checkOut('t1', 'emp-1', { at: at(18) }))
                .rejects.toThrow(BadRequestException);
        });

        it('refuses a check-out before the check-in', async () => {
            await expect(service.checkOut('t1', 'emp-1', { at: at(8) }))
                .rejects.toThrow(BadRequestException);
        });

        it('overwrites an earlier check-out', async () => {
            // Unlike check-in, tapping again corrects the record upward — the
            // honest direction for someone who stayed later.
            db.attendanceRecord.findFirst.mockResolvedValue({
                id: 'a-1', clock_in: at(9), clock_out: at(17),
            });
            await service.checkOut('t1', 'emp-1', { at: at(19) });
            expect(db.attendanceRecord.update.mock.calls[0][0].data.clock_out).toEqual(at(19));
        });
    });

    describe('markLeaveDays', () => {
        it('writes ON_LEAVE across the working days of the span', async () => {
            // 2026-08-10 Mon to 2026-08-12 Wed — all working days here.
            const written = await service.markLeaveDays(
                't1', 'emp-1', new Date(Date.UTC(2026, 7, 10)), new Date(Date.UTC(2026, 7, 12)),
            );

            expect(written).toBe(3);
            expect(db.attendanceRecord.upsert).toHaveBeenCalledTimes(3);
            expect(db.attendanceRecord.upsert.mock.calls[0][0].create.status).toBe('ON_LEAVE');
            expect(db.attendanceRecord.upsert.mock.calls[0][0].create.source).toBe('LEAVE');
        });

        it('skips non-working days', async () => {
            // 2026-08-14 is a Friday and 2026-08-15 a Saturday — both rest days.
            const written = await service.markLeaveDays(
                't1', 'emp-1', new Date(Date.UTC(2026, 7, 14)), new Date(Date.UTC(2026, 7, 15)),
            );
            expect(written).toBe(0);
        });

        it('skips declared holidays', async () => {
            schedules.holidayKeysBetween.mockResolvedValue(new Set(['2026-08-11']));
            const written = await service.markLeaveDays(
                't1', 'emp-1', new Date(Date.UTC(2026, 7, 10)), new Date(Date.UTC(2026, 7, 12)),
            );
            expect(written).toBe(2);
        });

        it('leaves a day the employee actually worked alone', async () => {
            // Approved leave plus a clock-in means they were at work; the
            // timesheet is the stronger evidence.
            db.attendanceRecord.findMany.mockResolvedValue([
                { date: new Date(Date.UTC(2026, 7, 11)), clock_in: at(9) },
            ]);
            const written = await service.markLeaveDays(
                't1', 'emp-1', new Date(Date.UTC(2026, 7, 10)), new Date(Date.UTC(2026, 7, 12)),
            );
            expect(written).toBe(2);
        });

        it('writes nothing for an inverted range', async () => {
            const written = await service.markLeaveDays(
                't1', 'emp-1', new Date(Date.UTC(2026, 7, 12)), new Date(Date.UTC(2026, 7, 10)),
            );
            expect(written).toBe(0);
            expect(db.attendanceRecord.upsert).not.toHaveBeenCalled();
        });
    });

    describe('unmarkLeaveDays', () => {
        it('deletes only the rows the approval wrote', async () => {
            // A day an admin later typed by hand must survive a cancellation.
            await service.unmarkLeaveDays(
                't1', 'emp-1', new Date(Date.UTC(2026, 7, 10)), new Date(Date.UTC(2026, 7, 12)),
            );
            expect(db.attendanceRecord.deleteMany.mock.calls[0][0].where.source).toBe('LEAVE');
        });
    });

    describe('today', () => {
        it('reports why the button is unavailable rather than hiding it', async () => {
            const state = await service.today('t1', 'emp-1', SUNDAY_OFF);
            expect(state.isWorkingDay).toBe(false);
            expect(state.selfServiceEnabled).toBe(true);
        });

        it('reports the scheduled hours for a working day', async () => {
            const state = await service.today('t1', 'emp-1', at(8));
            expect(state.isWorkingDay).toBe(true);
            expect(state.scheduledStartMinute).toBe(540);
            expect(state.scheduledEndMinute).toBe(1080);
        });

        it('flags a holiday', async () => {
            schedules.holidayKeysBetween.mockResolvedValue(new Set(['2026-08-10']));
            const state = await service.today('t1', 'emp-1', at(8));
            expect(state.isHoliday).toBe(true);
        });
    });
});
