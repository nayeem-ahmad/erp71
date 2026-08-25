import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ProjectTimerService } from './project-timer.service';
import { RemainingHoursService } from './remaining-hours.service';
import { ProjectAccessService } from './project-access.service';
import { OWNER, staff, visibilityOr } from './project-access.test-support';
import { DatabaseService } from '../database/database.service';

const task = {
    id: 'task-1',
    project_id: 'project-1',
    sprint_id: 'sprint-1',
    remaining_hours: 8,
};

/** Started this many seconds ago, as the row the db would hand back. */
const runningFor = (seconds: number, overrides: Record<string, unknown> = {}) => ({
    id: 'timer-1',
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    task_id: 'task-1',
    project_id: 'project-1',
    started_at: new Date(Date.now() - seconds * 1000),
    note: null,
    tag_ids: [],
    task: { id: 'task-1', title: 'Rewire the counter' },
    project: { id: 'project-1', code: 'BS23', name: 'Bashundhara fit-out' },
    ...overrides,
});

describe('ProjectTimerService', () => {
    let service: ProjectTimerService;
    let db: any;
    let remaining: { write: jest.Mock };

    beforeEach(async () => {
        remaining = { write: jest.fn().mockResolvedValue(true) };

        db = {
            projectTask: { findFirst: jest.fn().mockResolvedValue(task) },
            userStorePermission: { findFirst: jest.fn().mockResolvedValue(null) },
            projectTimer: {
                findFirst: jest.fn().mockResolvedValue(null),
                create: jest.fn(async ({ data }: any) => runningFor(0, data)),
                update: jest.fn(async ({ data }: any) => runningFor(60, data)),
                delete: jest.fn().mockResolvedValue({}),
            },
            projectTimeTag: { findMany: jest.fn().mockResolvedValue([]) },
            projectTimeEntry: {
                create: jest.fn().mockResolvedValue({ id: 'entry-1', started_at: null, ended_at: null }),
                findFirst: jest.fn().mockResolvedValue(null),
            },
            $transaction: jest.fn(async (fn: any) => fn(db)),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ProjectTimerService,
                ProjectAccessService,
                { provide: DatabaseService, useValue: db },
                { provide: RemainingHoursService, useValue: remaining },
            ],
        }).compile();

        service = module.get(ProjectTimerService);
    });

    describe('start', () => {
        it('never takes a start time from the caller — the column is left to the default', async () => {
            await service.start(OWNER, { taskId: 'task-1' } as never);

            const data = db.projectTimer.create.mock.calls[0][0].data;
            expect(data).not.toHaveProperty('started_at');
            expect(data).toMatchObject({
                tenant_id: 'tenant-1',
                user_id: 'user-1',
                task_id: 'task-1',
                project_id: 'project-1',
            });
        });

        it('refuses a second timer rather than silently stopping the first', async () => {
            db.projectTimer.findFirst.mockResolvedValue(runningFor(600));

            await expect(service.start(OWNER, { taskId: 'task-2' } as never)).rejects.toThrow(
                ConflictException,
            );
            expect(db.projectTimer.create).not.toHaveBeenCalled();
            // Above all: no hour log is written as a side effect of pressing start.
            expect(db.projectTimeEntry.create).not.toHaveBeenCalled();
        });

        it('names the task already running, so the refusal is actionable', async () => {
            db.projectTimer.findFirst.mockResolvedValue(runningFor(600));

            await expect(service.start(OWNER, { taskId: 'task-2' } as never)).rejects.toThrow(
                /Rewire the counter/,
            );
        });

        it('refuses a task the viewer cannot see', async () => {
            db.projectTask.findFirst.mockResolvedValue(null);

            await expect(service.start(OWNER, { taskId: 'task-9' } as never)).rejects.toThrow(
                NotFoundException,
            );
        });

        it('filters the task lookup by what a non-privileged viewer may open', async () => {
            const viewer = staff();
            db.projectTask.findFirst.mockResolvedValue(task);

            await service.start(viewer, { taskId: 'task-1' } as never);

            expect(db.projectTask.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        tenant_id: 'tenant-1',
                        deleted_at: null,
                        AND: [{ project: { OR: visibilityOr(viewer.userId) } }],
                    }),
                }),
            );
        });

        it('drops tag ids that do not resolve in this tenant', async () => {
            db.projectTimeTag.findMany.mockResolvedValue([{ id: 'tag-live' }]);

            await service.start(OWNER, {
                taskId: 'task-1',
                tagIds: ['tag-live', 'tag-from-another-workspace'],
            } as never);

            expect(db.projectTimer.create.mock.calls[0][0].data.tag_ids).toEqual(['tag-live']);
        });
    });

    describe('stop', () => {
        it('writes the entry with the span the server measured', async () => {
            const timer = runningFor(2 * 3600);
            db.projectTimer.findFirst.mockResolvedValue(timer);

            await service.stop(OWNER, {} as never);

            const data = db.projectTimeEntry.create.mock.calls[0][0].data;
            expect(data.started_at).toBe(timer.started_at);
            expect(data.ended_at).toBeInstanceOf(Date);
            expect(data.hours).toBeCloseTo(2, 2);
        });

        it('deletes the timer in the same transaction that writes the entry', async () => {
            db.projectTimer.findFirst.mockResolvedValue(runningFor(3600));

            await service.stop(OWNER, {} as never);

            expect(db.$transaction).toHaveBeenCalled();
            expect(db.projectTimer.delete).toHaveBeenCalledWith({ where: { id: 'timer-1' } });
        });

        it('files a sitting that ran past midnight under the day it began', async () => {
            // 23:30 Dhaka on the 18th is 17:30Z on the 18th; it ends on the 19th.
            const startedAt = new Date('2026-08-18T17:30:00.000Z');
            jest.spyOn(Date, 'now').mockReturnValue(
                new Date('2026-08-18T19:30:00.000Z').getTime(),
            );
            db.projectTimer.findFirst.mockResolvedValue(runningFor(0, { started_at: startedAt }));

            await service.stop(OWNER, {} as never);

            const data = db.projectTimeEntry.create.mock.calls[0][0].data;
            // UTC midnight of the 18th — what a `@db.Date` column reads as the
            // 18th. The instant Dhaka's 18th began (17th, 18:00Z) would be
            // stored as the 17th.
            expect(data.work_date.toISOString()).toBe('2026-08-18T00:00:00.000Z');
            jest.restoreAllMocks();
        });

        it('records even a few seconds — a stop never swallows the sitting', async () => {
            db.projectTimer.findFirst.mockResolvedValue(runningFor(4));

            const result = await service.stop(OWNER, {} as never);

            expect(db.projectTimeEntry.create).toHaveBeenCalled();
            expect(result.entry).not.toBeNull();
            // Floored to the smallest figure the column holds, so the row does
            // not read as "nothing happened".
            expect(db.projectTimeEntry.create.mock.calls[0][0].data.hours).toBe(0.01);
        });

        it('suggests the remainder after the hours, same as a manual log', async () => {
            db.projectTimer.findFirst.mockResolvedValue(runningFor(3 * 3600));

            await service.stop(OWNER, {} as never);

            expect(remaining.write).toHaveBeenCalledWith(
                expect.objectContaining({ previousHours: 8, source: 'TIME_LOGGED' }),
            );
            expect(remaining.write.mock.calls[0][0].newHours).toBeCloseTo(5, 1);
        });

        it('calls a stated remainder a re-estimate, not progress', async () => {
            db.projectTimer.findFirst.mockResolvedValue(runningFor(3600));

            await service.stop(OWNER, { remainingHours: 12 } as never);

            expect(remaining.write).toHaveBeenCalledWith(
                expect.objectContaining({ newHours: 12, source: 'RE_ESTIMATED' }),
            );
        });

        it('reports an overlap but still writes the row — a clock must always stop', async () => {
            db.projectTimer.findFirst.mockResolvedValue(runningFor(3600));
            db.projectTimeEntry.findFirst.mockResolvedValue({
                id: 'entry-old',
                task: { title: 'Stock count' },
            });

            const result = await service.stop(OWNER, {} as never);

            expect(db.projectTimeEntry.create).toHaveBeenCalled();
            expect(result.overlap).toEqual({ id: 'entry-old', taskTitle: 'Stock count' });
        });

        it('throws when nothing is running', async () => {
            await expect(service.stop(OWNER, {} as never)).rejects.toThrow(NotFoundException);
        });
    });

    describe('current', () => {
        it('is null when nothing is running', async () => {
            expect(await service.current(OWNER)).toBeNull();
        });

        it('reads only the caller’s own timer', async () => {
            db.projectTimer.findFirst.mockResolvedValue(runningFor(90));

            await service.current(OWNER);

            expect(db.projectTimer.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { tenant_id: 'tenant-1', user_id: 'user-1' },
                }),
            );
        });

        it('carries the elapsed seconds so the client ticks from the server’s clock', async () => {
            db.projectTimer.findFirst.mockResolvedValue(runningFor(125));

            const timer = await service.current(OWNER);

            expect(timer?.elapsed_seconds).toBeGreaterThanOrEqual(124);
            expect(timer?.elapsed_seconds).toBeLessThanOrEqual(126);
        });
    });

    describe('discard', () => {
        it('deletes the timer and records nothing', async () => {
            db.projectTimer.findFirst.mockResolvedValue(runningFor(7200));

            await service.discard(OWNER);

            expect(db.projectTimer.delete).toHaveBeenCalledWith({ where: { id: 'timer-1' } });
            expect(db.projectTimeEntry.create).not.toHaveBeenCalled();
            expect(remaining.write).not.toHaveBeenCalled();
        });

        it('throws when nothing is running', async () => {
            await expect(service.discard(OWNER)).rejects.toThrow(NotFoundException);
        });
    });

    describe('update', () => {
        it('changes the note and leaves the start alone when none is sent', async () => {
            db.projectTimer.findFirst.mockResolvedValue(runningFor(600));

            await service.update(OWNER, { note: '  counter wiring  ' } as never);

            const data = db.projectTimer.update.mock.calls[0][0].data;
            expect(data).toEqual({ note: 'counter wiring' });
        });

        it('corrects the start to the last instant that read that wall clock', async () => {
            // 11:00 Dhaka on the 18th is 05:00Z; 09:00 Dhaka is 03:00Z the same
            // day, so "I actually started at nine" is two hours back, not a day.
            jest.spyOn(Date, 'now').mockReturnValue(
                new Date('2026-08-18T05:00:00.000Z').getTime(),
            );
            db.projectTimer.findFirst.mockResolvedValue(runningFor(600));

            await service.update(OWNER, { startTime: '09:00' } as never);

            const data = db.projectTimer.update.mock.calls[0][0].data;
            expect(data.started_at.toISOString()).toBe('2026-08-18T03:00:00.000Z');
            jest.restoreAllMocks();
        });

        it('reads a start still ahead on today’s clock as yesterday’s', async () => {
            // 00:20 Dhaka on the 19th, correcting a sitting that began at 22:00
            // the evening before. Tomorrow's 22:00 has not happened yet.
            jest.spyOn(Date, 'now').mockReturnValue(
                new Date('2026-08-18T18:20:00.000Z').getTime(),
            );
            db.projectTimer.findFirst.mockResolvedValue(runningFor(600));

            await service.update(OWNER, { startTime: '22:00' } as never);

            expect(db.projectTimer.update.mock.calls[0][0].data.started_at.toISOString()).toBe(
                '2026-08-18T16:00:00.000Z',
            );
            jest.restoreAllMocks();
        });

        it('refuses a start time that is not a wall clock', async () => {
            db.projectTimer.findFirst.mockResolvedValue(runningFor(600));

            await expect(service.update(OWNER, { startTime: 'half nine' } as never)).rejects.toThrow(
                BadRequestException,
            );
            expect(db.projectTimer.update).not.toHaveBeenCalled();
        });

        it('hands back the corrected start as a wall clock the field can show', async () => {
            jest.spyOn(Date, 'now').mockReturnValue(
                new Date('2026-08-18T05:00:00.000Z').getTime(),
            );
            db.projectTimer.findFirst.mockResolvedValue(runningFor(600));
            db.projectTimer.update.mockResolvedValue(
                runningFor(0, { started_at: new Date('2026-08-18T03:00:00.000Z') }),
            );

            const timer = await service.update(OWNER, { startTime: '09:00' } as never);

            expect(timer.start_time).toBe('09:00');
            expect(timer.elapsed_seconds).toBe(2 * 3600);
            jest.restoreAllMocks();
        });

        it('clears the note when it is emptied', async () => {
            db.projectTimer.findFirst.mockResolvedValue(runningFor(600));

            await service.update(OWNER, { note: '   ' } as never);

            expect(db.projectTimer.update.mock.calls[0][0].data).toEqual({ note: null });
        });

        it('leaves tags alone when none are sent', async () => {
            db.projectTimer.findFirst.mockResolvedValue(runningFor(600));

            await service.update(OWNER, { note: 'x' } as never);

            expect(db.projectTimer.update.mock.calls[0][0].data).not.toHaveProperty('tag_ids');
        });
    });
});
