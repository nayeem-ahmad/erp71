import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { WorkSchedulesService } from './work-schedules.service';
import { DatabaseService } from '../database/database.service';

describe('WorkSchedulesService', () => {
    let service: WorkSchedulesService;
    let db: any;

    const SCHEDULE = {
        id: 'sched-1',
        tenant_id: 't1',
        name: 'Standard',
        is_default: true,
        deleted_at: null,
        days: [
            { weekday: 0, is_working: true, start_minute: 540, end_minute: 1080, break_minutes: 60 },
        ],
    };

    beforeEach(async () => {
        db = {
            holiday: {
                findMany: jest.fn().mockResolvedValue([]),
                findFirst: jest.fn().mockResolvedValue(null),
                create: jest.fn().mockResolvedValue({}),
                update: jest.fn().mockResolvedValue({}),
                delete: jest.fn().mockResolvedValue({}),
            },
            workSchedule: {
                findMany: jest.fn().mockResolvedValue([]),
                findFirst: jest.fn().mockResolvedValue(SCHEDULE),
                create: jest.fn().mockResolvedValue(SCHEDULE),
                update: jest.fn().mockResolvedValue(SCHEDULE),
                updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
            workScheduleDay: {
                deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
                createMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
            employeeSchedule: {
                findMany: jest.fn().mockResolvedValue([]),
                count: jest.fn().mockResolvedValue(0),
                upsert: jest.fn().mockResolvedValue({}),
            },
            employee: { findFirst: jest.fn().mockResolvedValue({ id: 'emp-1' }) },
        };
        db.$transaction = jest.fn(async (cb: any) => cb(db));

        const module: TestingModule = await Test.createTestingModule({
            providers: [WorkSchedulesService, { provide: DatabaseService, useValue: db }],
        }).compile();
        service = module.get(WorkSchedulesService);
    });

    describe('holidays', () => {
        it('stores the date as midnight UTC so it round-trips as a plain date', () => {
            return service.createHoliday('t1', { date: '2026-04-14', name: 'Pohela Boishakh' })
                .then(() => {
                    const data = db.holiday.create.mock.calls[0][0].data;
                    expect(data.date.toISOString()).toBe('2026-04-14T00:00:00.000Z');
                });
        });

        it('refuses a second holiday on the same date', async () => {
            db.holiday.findFirst.mockResolvedValue({ id: 'h-1' });
            await expect(service.createHoliday('t1', { date: '2026-04-14', name: 'Dup' }))
                .rejects.toThrow(ConflictException);
        });

        it('filters a year to that calendar year', async () => {
            await service.listHolidays('t1', 2026);
            const where = db.holiday.findMany.mock.calls[0][0].where;
            expect(where.date.gte.toISOString()).toBe('2026-01-01T00:00:00.000Z');
            expect(where.date.lte.toISOString()).toBe('2026-12-31T00:00:00.000Z');
        });

        it('refuses to update a holiday outside the tenant', async () => {
            db.holiday.findFirst.mockResolvedValue(null);
            await expect(service.updateHoliday('t1', 'h-9', { name: 'x' }))
                .rejects.toThrow(NotFoundException);
        });

        it('returns holiday dates as YYYY-MM-DD keys', async () => {
            db.holiday.findMany.mockResolvedValue([
                { date: new Date('2026-04-14T00:00:00.000Z') },
                { date: new Date('2026-12-16T00:00:00.000Z') },
            ]);
            const keys = await service.holidayKeysBetween('t1', new Date(), new Date());
            expect(keys.has('2026-04-14')).toBe(true);
            expect(keys.has('2026-12-16')).toBe(true);
        });
    });

    describe('schedule validation', () => {
        const day = (over: Record<string, unknown> = {}) => ({
            weekday: 0, is_working: true, start_minute: 540, end_minute: 1080, break_minutes: 60, ...over,
        });

        beforeEach(() => db.workSchedule.findFirst.mockResolvedValue(null));

        it('refuses a working day with no hours', async () => {
            // Accepting it would make every downstream sum silently zero rather
            // than fail.
            await expect(service.createSchedule('t1', {
                name: 'Bad', days: [day({ start_minute: null })],
            } as any)).rejects.toThrow(BadRequestException);
        });

        it('refuses a day that ends before it starts', async () => {
            await expect(service.createSchedule('t1', {
                name: 'Bad', days: [day({ start_minute: 1080, end_minute: 540 })],
            } as any)).rejects.toThrow(BadRequestException);
        });

        it('refuses a duplicate weekday', async () => {
            await expect(service.createSchedule('t1', {
                name: 'Bad', days: [day(), day()],
            } as any)).rejects.toThrow(BadRequestException);
        });

        it('allows a rest day with no hours', async () => {
            await service.createSchedule('t1', {
                name: 'Ok', days: [day({ is_working: false, start_minute: null, end_minute: null })],
            } as any);
            expect(db.workSchedule.create).toHaveBeenCalled();
        });

        it('blanks the hours on a rest day even if the client sent some', async () => {
            await service.createSchedule('t1', {
                name: 'Ok', days: [day({ is_working: false })],
            } as any);
            const created = db.workSchedule.create.mock.calls[0][0].data.days.create[0];
            expect(created.start_minute).toBeNull();
            expect(created.end_minute).toBeNull();
            expect(created.break_minutes).toBe(0);
        });
    });

    describe('exactly one default', () => {
        it('clears the previous default when creating a new one', async () => {
            db.workSchedule.findFirst.mockResolvedValue(null);
            await service.createSchedule('t1', {
                name: 'New', is_default: true,
                days: [{ weekday: 0, is_working: false }],
            } as any);

            expect(db.workSchedule.updateMany).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({ tenant_id: 't1', is_default: true }),
                data: { is_default: false },
            }));
        });

        it('does not clear itself when updating the current default', async () => {
            await service.updateSchedule('t1', 'sched-1', { is_default: true } as any);
            const where = db.workSchedule.updateMany.mock.calls[0][0].where;
            expect(where.NOT).toEqual({ id: 'sched-1' });
        });

        it('leaves the default alone when is_default is not sent', async () => {
            // First lookup resolves the schedule being updated; the second is
            // the name-clash check, which must find nothing.
            db.workSchedule.findFirst
                .mockResolvedValueOnce(SCHEDULE)
                .mockResolvedValueOnce(null);

            await service.updateSchedule('t1', 'sched-1', { name: 'Renamed' } as any);
            expect(db.workSchedule.updateMany).not.toHaveBeenCalled();
        });
    });

    describe('deletion guards', () => {
        it('refuses to delete the default schedule', async () => {
            db.workSchedule.findFirst.mockResolvedValue({ ...SCHEDULE, is_default: true });
            await expect(service.deleteSchedule('t1', 'sched-1')).rejects.toThrow(BadRequestException);
        });

        it('refuses to delete a schedule employees are on', async () => {
            db.workSchedule.findFirst.mockResolvedValue({ ...SCHEDULE, is_default: false });
            db.employeeSchedule.count.mockResolvedValue(3);
            await expect(service.deleteSchedule('t1', 'sched-1')).rejects.toThrow(BadRequestException);
        });

        it('soft-deletes an unused non-default schedule', async () => {
            db.workSchedule.findFirst.mockResolvedValue({ ...SCHEDULE, is_default: false });
            await service.deleteSchedule('t1', 'sched-1');
            expect(db.workSchedule.update.mock.calls[0][0].data.deleted_at).toBeInstanceOf(Date);
        });
    });

    describe('assignment', () => {
        it('upserts so re-assigning on the same date replaces rather than fails', async () => {
            await service.assign('t1', {
                employee_id: 'emp-1', schedule_id: 'sched-1', effective_from: '2026-08-01',
            });
            expect(db.employeeSchedule.upsert).toHaveBeenCalled();
            const args = db.employeeSchedule.upsert.mock.calls[0][0];
            expect(args.update).toEqual({ schedule_id: 'sched-1' });
        });

        it('refuses an employee from another tenant', async () => {
            db.employee.findFirst.mockResolvedValue(null);
            await expect(service.assign('t1', {
                employee_id: 'emp-x', schedule_id: 'sched-1', effective_from: '2026-08-01',
            })).rejects.toThrow(NotFoundException);
        });
    });

    describe('resolveScheduleDays', () => {
        it('uses the employee assignment in force on the date', async () => {
            db.employeeSchedule.findMany.mockResolvedValue([
                {
                    effective_from: new Date(Date.UTC(2026, 0, 1)),
                    schedule: { days: [{ weekday: 0, is_working: true, start_minute: 600, end_minute: 1020, break_minutes: 0 }] },
                },
            ]);

            const days = await service.resolveScheduleDays('t1', 'emp-1', new Date(Date.UTC(2026, 7, 10)));
            expect(days[0].start_minute).toBe(600);
        });

        it('falls back to the tenant default when the employee has no assignment', async () => {
            db.employeeSchedule.findMany.mockResolvedValue([]);
            db.workSchedule.findFirst.mockResolvedValue(SCHEDULE);

            const days = await service.resolveScheduleDays('t1', 'emp-1', new Date());
            expect(days[0].start_minute).toBe(540);
        });

        it('falls back to the in-code default when the tenant has no schedule at all', async () => {
            // Attendance must keep working on a tenant that has never opened
            // the schedule screen; returning nothing would make every
            // calculation silently do nothing.
            db.employeeSchedule.findMany.mockResolvedValue([]);
            db.workSchedule.findFirst.mockResolvedValue(null);

            const days = await service.resolveScheduleDays('t1', 'emp-1', new Date());
            expect(days).toHaveLength(7);
            expect(days.filter((d) => d.is_working).map((d) => d.weekday)).toEqual([0, 1, 2, 3, 4]);
        });

        it('ignores an assignment dated after the day being resolved', async () => {
            db.employeeSchedule.findMany.mockResolvedValue([
                {
                    effective_from: new Date(Date.UTC(2027, 0, 1)),
                    schedule: { days: [{ weekday: 0, is_working: true, start_minute: 600, end_minute: 1020, break_minutes: 0 }] },
                },
            ]);
            db.workSchedule.findFirst.mockResolvedValue(SCHEDULE);

            const days = await service.resolveScheduleDays('t1', 'emp-1', new Date(Date.UTC(2026, 7, 10)));
            expect(days[0].start_minute).toBe(540); // the tenant default, not the future assignment
        });
    });

    describe('ensureDefaultSchedule', () => {
        it('creates a default when the tenant has none', async () => {
            db.workSchedule.findFirst.mockResolvedValue(null);
            await service.ensureDefaultSchedule('t1');

            const data = db.workSchedule.create.mock.calls[0][0].data;
            expect(data.is_default).toBe(true);
            expect(data.days.create).toHaveLength(7);
        });

        it('does nothing when the tenant already has any schedule', async () => {
            // Checked on *any* schedule, not on a default one: a tenant that
            // deliberately has no default must not have one forced back on.
            db.workSchedule.findFirst.mockResolvedValue({ id: 'existing' });
            await service.ensureDefaultSchedule('t1');
            expect(db.workSchedule.create).not.toHaveBeenCalled();
        });
    });
});
