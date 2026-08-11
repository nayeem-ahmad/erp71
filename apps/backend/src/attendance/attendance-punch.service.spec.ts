import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AttendancePunchService, derivePunchWindow } from './attendance-punch.service';
import { WorkSchedulesService } from '../work-schedules/work-schedules.service';
import { DatabaseService } from '../database/database.service';

/** A 9:00–18:00 Sun–Thu week with a one-hour break. */
const WEEK = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    is_working: weekday <= 4,
    start_minute: weekday <= 4 ? 540 : null,
    end_minute: weekday <= 4 ? 1080 : null,
    break_minutes: weekday <= 4 ? 60 : 0,
}));

/** 2026-08-10 is a Monday. */
const at = (hours: number, minutes = 0) => new Date(2026, 7, 10, hours, minutes);
const DAY = new Date(Date.UTC(2026, 7, 10));

const punch = (direction: 'IN' | 'OUT', moment: Date, extra: Record<string, unknown> = {}) => ({
    id: `p-${direction}-${moment.getHours()}`,
    punched_at: moment,
    direction,
    source: 'ADMIN',
    latitude: null,
    longitude: null,
    store_id: null,
    employee_id: 'emp-1',
    ...extra,
});

describe('derivePunchWindow', () => {
    it('takes the first IN and the last OUT', () => {
        const window = derivePunchWindow([
            punch('IN', at(9)),
            punch('OUT', at(13)),
            punch('IN', at(14)),
            punch('OUT', at(18)),
        ]);

        expect(window.clockIn?.punched_at).toEqual(at(9));
        expect(window.clockOut?.punched_at).toEqual(at(18));
    });

    it('does not care what order the punches arrive in', () => {
        // Rows come back ordered today, but the rule must not depend on it —
        // an edited punch can be written after a later one.
        const window = derivePunchWindow([
            punch('OUT', at(18)),
            punch('IN', at(9)),
            punch('OUT', at(13)),
        ]);

        expect(window.clockIn?.punched_at).toEqual(at(9));
        expect(window.clockOut?.punched_at).toEqual(at(18));
    });

    it('ignores an OUT that precedes the first IN', () => {
        // It belongs to the previous night's shift or is mistyped; taking it
        // would give the day a negative worked span.
        const window = derivePunchWindow([punch('OUT', at(2)), punch('IN', at(9))]);

        expect(window.clockIn?.punched_at).toEqual(at(9));
        expect(window.clockOut).toBeNull();
    });

    it('leaves a day of OUT punches with no window at all', () => {
        // A departure nobody arrived for is not evidence of a day worked, and
        // a lone clock_out would read as one.
        const window = derivePunchWindow([punch('OUT', at(18))]);

        expect(window.clockIn).toBeNull();
        expect(window.clockOut).toBeNull();
    });

    it('returns nothing for a day with no punches', () => {
        expect(derivePunchWindow([])).toEqual({ clockIn: null, clockOut: null });
    });

    it('leaves an open day with an arrival and no departure', () => {
        const window = derivePunchWindow([punch('IN', at(9))]);
        expect(window.clockIn?.punched_at).toEqual(at(9));
        expect(window.clockOut).toBeNull();
    });
});

describe('AttendancePunchService', () => {
    let service: AttendancePunchService;
    let db: any;
    let schedules: any;

    beforeEach(async () => {
        db = {
            employee: { findFirst: jest.fn().mockResolvedValue({ id: 'emp-1' }) },
            attendanceSettings: { findUnique: jest.fn().mockResolvedValue(null) },
            attendancePunch: {
                findFirst: jest.fn().mockResolvedValue(null),
                findMany: jest.fn().mockResolvedValue([]),
                count: jest.fn().mockResolvedValue(0),
                create: jest.fn().mockResolvedValue({ id: 'p-1' }),
                update: jest.fn().mockResolvedValue({ id: 'p-1' }),
                delete: jest.fn().mockResolvedValue({ id: 'p-1' }),
            },
            attendanceRecord: {
                findFirst: jest.fn().mockResolvedValue(null),
                upsert: jest.fn().mockResolvedValue({}),
                delete: jest.fn().mockResolvedValue({}),
            },
        };
        schedules = {
            resolveScheduleDays: jest.fn().mockResolvedValue(WEEK),
            holidayKeysBetween: jest.fn().mockResolvedValue(new Set<string>()),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AttendancePunchService,
                { provide: DatabaseService, useValue: db },
                { provide: WorkSchedulesService, useValue: schedules },
            ],
        }).compile();
        service = module.get(AttendancePunchService);
    });

    describe('rebuildDay', () => {
        it('writes the first IN and last OUT onto the day', async () => {
            db.attendancePunch.findMany.mockResolvedValue([
                punch('IN', at(9)),
                punch('OUT', at(13)),
                punch('IN', at(14)),
                punch('OUT', at(18)),
            ]);

            await service.rebuildDay('t1', 'emp-1', at(12));

            const data = db.attendanceRecord.upsert.mock.calls[0][0].create;
            expect(data.clock_in).toEqual(at(9));
            expect(data.clock_out).toEqual(at(18));
        });

        it('derives PRESENT and the worked minutes with the break removed', async () => {
            db.attendancePunch.findMany.mockResolvedValue([punch('IN', at(9)), punch('OUT', at(18))]);

            await service.rebuildDay('t1', 'emp-1', at(9));

            const data = db.attendanceRecord.upsert.mock.calls[0][0].create;
            expect(data.status).toBe('PRESENT');
            expect(data.worked_minutes).toBe(480);
            expect(data.late_minutes).toBe(0);
        });

        it('derives LATE past the tenant grace period', async () => {
            db.attendanceSettings.findUnique.mockResolvedValue({ grace_minutes: 60 });
            db.attendancePunch.findMany.mockResolvedValue([punch('IN', at(9, 45)), punch('OUT', at(18))]);

            await service.rebuildDay('t1', 'emp-1', at(9));

            expect(db.attendanceRecord.upsert.mock.calls[0][0].create.status).toBe('PRESENT');
        });

        it('records raw overtime past the scheduled end', async () => {
            db.attendancePunch.findMany.mockResolvedValue([punch('IN', at(9)), punch('OUT', at(20))]);

            await service.rebuildDay('t1', 'emp-1', at(9));

            expect(db.attendanceRecord.upsert.mock.calls[0][0].create.overtime_minutes).toBe(120);
        });

        it('marks a day with only OUT punches ABSENT', async () => {
            db.attendancePunch.findMany.mockResolvedValue([punch('OUT', at(18))]);

            await service.rebuildDay('t1', 'emp-1', at(18));

            const data = db.attendanceRecord.upsert.mock.calls[0][0].create;
            expect(data.status).toBe('ABSENT');
            expect(data.clock_out).toBeNull();
        });

        it('credits the day to the employee when they punched themselves in', async () => {
            db.attendancePunch.findMany.mockResolvedValue([
                punch('IN', at(9), { source: 'SELF' }),
                punch('OUT', at(18), { source: 'ADMIN' }),
            ]);

            await service.rebuildDay('t1', 'emp-1', at(9));

            expect(db.attendanceRecord.upsert.mock.calls[0][0].create.source).toBe('SELF');
        });

        it('deletes a punch-derived day once its last punch is gone', async () => {
            db.attendanceRecord.findFirst.mockResolvedValue({ id: 'a-1', source: 'PUNCH' });

            const result = await service.rebuildDay('t1', 'emp-1', at(9));

            expect(db.attendanceRecord.delete).toHaveBeenCalledWith({ where: { id: 'a-1' } });
            expect(result).toBeNull();
        });

        it('leaves an admin-typed day alone when there are no punches', async () => {
            // A tenant that types attendance directly must not lose a day
            // because somebody deleted an unrelated punch.
            db.attendanceRecord.findFirst.mockResolvedValue({ id: 'a-1', source: 'ADMIN' });

            await service.rebuildDay('t1', 'emp-1', at(9));

            expect(db.attendanceRecord.delete).not.toHaveBeenCalled();
            expect(db.attendanceRecord.upsert).not.toHaveBeenCalled();
        });

        it('leaves an ON_LEAVE day alone when there are no punches', async () => {
            db.attendanceRecord.findFirst.mockResolvedValue({ id: 'a-1', source: 'LEAVE' });

            await service.rebuildDay('t1', 'emp-1', at(9));

            expect(db.attendanceRecord.delete).not.toHaveBeenCalled();
        });

        it('records a punch on a declared holiday as HOLIDAY', async () => {
            schedules.holidayKeysBetween.mockResolvedValue(new Set(['2026-08-10']));
            db.attendancePunch.findMany.mockResolvedValue([punch('IN', at(9)), punch('OUT', at(18))]);

            await service.rebuildDay('t1', 'emp-1', at(9));

            expect(db.attendanceRecord.upsert.mock.calls[0][0].create.status).toBe('HOLIDAY');
        });

        it('groups the day by local midnight', async () => {
            await service.rebuildDay('t1', 'emp-1', at(23, 30));
            expect(db.attendancePunch.findMany.mock.calls[0][0].where.date).toEqual(DAY);
        });
    });

    describe('create', () => {
        it('stores the punch and rebuilds the day it lands on', async () => {
            db.attendancePunch.findMany.mockResolvedValue([punch('IN', at(9))]);

            await service.create('t1', {
                employee_id: 'emp-1',
                punched_at: '2026-08-10T09:00:00',
                direction: 'IN' as any,
            });

            const data = db.attendancePunch.create.mock.calls[0][0].data;
            expect(data.direction).toBe('IN');
            expect(data.date).toEqual(DAY);
            expect(data.source).toBe('ADMIN');
            expect(db.attendanceRecord.upsert).toHaveBeenCalled();
        });

        it('refuses a punch for an employee outside the tenant', async () => {
            db.employee.findFirst.mockResolvedValue(null);

            await expect(service.create('t1', {
                employee_id: 'emp-9',
                punched_at: '2026-08-10T09:00:00',
                direction: 'IN' as any,
            })).rejects.toThrow(NotFoundException);
        });

        it('refuses an unparseable moment', async () => {
            await expect(service.create('t1', {
                employee_id: 'emp-1',
                punched_at: 'not-a-time',
                direction: 'IN' as any,
            })).rejects.toThrow(BadRequestException);
        });

        it('refuses a direction that is neither IN nor OUT', async () => {
            await expect(service.create('t1', {
                employee_id: 'emp-1',
                punched_at: '2026-08-10T09:00:00',
                direction: 'SIDEWAYS' as any,
            })).rejects.toThrow(BadRequestException);
        });
    });

    describe('update', () => {
        it('rebuilds both days when a punch is moved across midnight', async () => {
            // The day it left may now have no clock-out, and the day it joined
            // has a new one. Rebuilding only the destination leaves a lie.
            db.attendancePunch.findFirst.mockResolvedValue({
                id: 'p-1', employee_id: 'emp-1', punched_at: at(23), direction: 'OUT',
            });

            await service.update('t1', 'p-1', { punched_at: '2026-08-11T01:00:00' });

            const rebuiltDays = db.attendancePunch.findMany.mock.calls.map(
                (call: any[]) => call[0].where.date.toISOString().slice(0, 10),
            );
            expect(rebuiltDays).toEqual(['2026-08-11', '2026-08-10']);
        });

        it('rebuilds one day when the punch stays put', async () => {
            db.attendancePunch.findFirst.mockResolvedValue({
                id: 'p-1', employee_id: 'emp-1', punched_at: at(9), direction: 'IN',
            });

            await service.update('t1', 'p-1', { punched_at: '2026-08-10T09:30:00' });

            expect(db.attendancePunch.findMany).toHaveBeenCalledTimes(1);
        });

        it('refuses a punch from another tenant', async () => {
            db.attendancePunch.findFirst.mockResolvedValue(null);
            await expect(service.update('t1', 'p-1', { direction: 'OUT' as any }))
                .rejects.toThrow(NotFoundException);
        });
    });

    describe('remove', () => {
        it('deletes the punch and rebuilds its day', async () => {
            db.attendancePunch.findFirst.mockResolvedValue({
                id: 'p-1', employee_id: 'emp-1', punched_at: at(18), direction: 'OUT',
            });
            db.attendancePunch.findMany.mockResolvedValue([punch('IN', at(9))]);

            const result = await service.remove('t1', 'p-1');

            expect(db.attendancePunch.delete).toHaveBeenCalledWith({ where: { id: 'p-1' } });
            expect(db.attendanceRecord.upsert.mock.calls[0][0].update.clock_out).toBeNull();
            expect(result.deleted).toBe(true);
        });

        it('refuses a punch from another tenant', async () => {
            db.attendancePunch.findFirst.mockResolvedValue(null);
            await expect(service.remove('t1', 'p-1')).rejects.toThrow(NotFoundException);
        });
    });

    describe('list', () => {
        it('filters by employee, direction and date range', async () => {
            await service.list('t1', {
                employeeId: 'emp-1',
                direction: 'IN' as any,
                startDate: '2026-08-01',
                endDate: '2026-08-31',
            } as any);

            const where = db.attendancePunch.findMany.mock.calls[0][0].where;
            expect(where.employee_id).toBe('emp-1');
            expect(where.direction).toBe('IN');
            expect(where.date.gte).toEqual(new Date('2026-08-01'));
        });

        it('caps the page size', async () => {
            await service.list('t1', { limit: 5000 } as any);
            expect(db.attendancePunch.findMany.mock.calls[0][0].take).toBe(200);
        });
    });

    describe('recordSelfPunch', () => {
        it('marks the punch as the employee’s own', async () => {
            await service.recordSelfPunch('t1', 'emp-1', 'IN', at(9));
            expect(db.attendancePunch.create.mock.calls[0][0].data.source).toBe('SELF');
        });

        it('carries the geofence match onto the punch', async () => {
            await service.recordSelfPunch('t1', 'emp-1', 'IN', at(9), {
                latitude: 23.79, longitude: 90.4, storeId: 's1',
            });

            const data = db.attendancePunch.create.mock.calls[0][0].data;
            expect(data.latitude).toBe(23.79);
            expect(data.store_id).toBe('s1');
        });
    });
});
