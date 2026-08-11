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
                createMany: jest.fn().mockResolvedValue({ count: 0 }),
                update: jest.fn().mockResolvedValue({}),
                delete: jest.fn().mockResolvedValue({}),
                deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
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

    describe('holidays for the year', () => {
        const holiday = (date: string, name: string) => ({
            id: `h-${date}`, date: new Date(`${date}T00:00:00.000Z`), name,
        });

        describe('bulk add', () => {
            it('creates the dates the tenant does not have yet', async () => {
                const result = await service.bulkCreateHolidays('t1', {
                    items: [
                        { date: '2026-02-21', name: 'Shaheed Day' },
                        { date: '2026-03-26', name: 'Independence Day' },
                    ],
                });

                expect(result).toEqual({ created: 2, updated: 0, skipped: 0 });
                expect(db.holiday.createMany.mock.calls[0][0].data).toHaveLength(2);
            });

            it('skips a date that already has a holiday instead of failing the batch', async () => {
                // One clash must not throw away the other rows — an import run
                // twice should be a no-op, not an error.
                db.holiday.findMany.mockResolvedValue([holiday('2026-02-21', 'Shaheed Day')]);

                const result = await service.bulkCreateHolidays('t1', {
                    items: [
                        { date: '2026-02-21', name: 'Renamed' },
                        { date: '2026-03-26', name: 'Independence Day' },
                    ],
                });

                expect(result).toEqual({ created: 1, updated: 0, skipped: 1 });
                expect(db.holiday.update).not.toHaveBeenCalled();
            });

            it('renames an existing date when overwrite is set', async () => {
                db.holiday.findMany.mockResolvedValue([holiday('2026-02-21', 'Shaheed Day')]);

                const result = await service.bulkCreateHolidays('t1', {
                    items: [{ date: '2026-02-21', name: 'Mother Language Day' }],
                    overwrite: true,
                });

                expect(result).toEqual({ created: 0, updated: 1, skipped: 0 });
                expect(db.holiday.update.mock.calls[0][0].data).toEqual({ name: 'Mother Language Day' });
            });

            it('counts an unchanged name as skipped rather than updated', async () => {
                db.holiday.findMany.mockResolvedValue([holiday('2026-02-21', 'Shaheed Day')]);

                const result = await service.bulkCreateHolidays('t1', {
                    items: [{ date: '2026-02-21', name: 'Shaheed Day' }],
                    overwrite: true,
                });

                expect(result).toEqual({ created: 0, updated: 0, skipped: 1 });
            });

            it('keeps the last name when the payload repeats a date', async () => {
                // The unique index would reject the second row, and the caller
                // meant both — so the later intent wins.
                const result = await service.bulkCreateHolidays('t1', {
                    items: [
                        { date: '2026-02-21', name: 'First' },
                        { date: '2026-02-21', name: 'Second' },
                    ],
                });

                expect(result.created).toBe(1);
                expect(db.holiday.createMany.mock.calls[0][0].data[0].name).toBe('Second');
            });

            it('stores bulk dates as midnight UTC, like the single-date path', async () => {
                await service.bulkCreateHolidays('t1', {
                    items: [{ date: '2026-04-14', name: 'Pohela Boishakh' }],
                });
                const stored = db.holiday.createMany.mock.calls[0][0].data[0].date;
                expect(stored.toISOString()).toBe('2026-04-14T00:00:00.000Z');
            });

            it('rejects a year outside the supported range', async () => {
                await expect(service.bulkCreateHolidays('t1', {
                    items: [{ date: '1899-01-01', name: 'Too early' }],
                })).rejects.toThrow(BadRequestException);
            });
        });

        describe('copy year', () => {
            it('lands each holiday on the same day of the month', async () => {
                db.holiday.findMany
                    .mockResolvedValueOnce([holiday('2026-12-16', 'Victory Day')]) // source year
                    .mockResolvedValueOnce([]); // clash lookup inside the bulk add

                const result = await service.copyHolidaysToYear('t1', { from_year: 2026, to_year: 2027 });

                expect(result).toMatchObject({ created: 1, unmapped: 0 });
                expect(db.holiday.createMany.mock.calls[0][0].data[0].date.toISOString())
                    .toBe('2027-12-16T00:00:00.000Z');
            });

            it('reports 29 February rather than sliding it onto the 28th', async () => {
                // Moving it would invent a holiday the tenant never declared.
                db.holiday.findMany
                    .mockResolvedValueOnce([
                        holiday('2028-02-29', 'Leap day'),
                        holiday('2028-05-01', 'May Day'),
                    ])
                    .mockResolvedValueOnce([]);

                const result = await service.copyHolidaysToYear('t1', { from_year: 2028, to_year: 2029 });

                expect(result.unmapped).toBe(1);
                expect(db.holiday.createMany.mock.calls[0][0].data).toHaveLength(1);
            });

            it('refuses to copy a year onto itself', async () => {
                await expect(service.copyHolidaysToYear('t1', { from_year: 2026, to_year: 2026 }))
                    .rejects.toThrow(BadRequestException);
            });

            it('refuses to copy from a year with no holidays', async () => {
                db.holiday.findMany.mockResolvedValue([]);
                await expect(service.copyHolidaysToYear('t1', { from_year: 2025, to_year: 2026 }))
                    .rejects.toThrow(BadRequestException);
            });
        });

        describe('clear year', () => {
            it('deletes only the requested year, scoped to the tenant', async () => {
                db.holiday.deleteMany.mockResolvedValue({ count: 7 });

                const result = await service.clearHolidayYear('t1', 2026);

                expect(result).toEqual({ deleted: 7 });
                const where = db.holiday.deleteMany.mock.calls[0][0].where;
                expect(where.tenant_id).toBe('t1');
                expect(where.date.gte.toISOString()).toBe('2026-01-01T00:00:00.000Z');
                expect(where.date.lte.toISOString()).toBe('2026-12-31T00:00:00.000Z');
            });

            it('rejects a nonsense year', async () => {
                await expect(service.clearHolidayYear('t1', 12)).rejects.toThrow(BadRequestException);
                expect(db.holiday.deleteMany).not.toHaveBeenCalled();
            });
        });

        describe('suggestions', () => {
            it('resolves the fixed-date national holidays into the asked-for year', async () => {
                const suggestions = await service.suggestHolidays('t1', 2027);
                expect(suggestions.every((item) => item.date.startsWith('2027-'))).toBe(true);
                expect(suggestions.map((item) => item.date)).toContain('2027-12-16');
            });

            it('flags the ones the tenant already has', async () => {
                db.holiday.findMany.mockResolvedValue([holiday('2026-12-16', 'Victory Day')]);

                const suggestions = await service.suggestHolidays('t1', 2026);
                const victoryDay = suggestions.find((item) => item.date === '2026-12-16');
                expect(victoryDay?.exists).toBe(true);
                expect(suggestions.filter((item) => item.exists)).toHaveLength(1);
            });
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
