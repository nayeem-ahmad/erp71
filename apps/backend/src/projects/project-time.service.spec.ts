import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ProjectTimeService } from './project-time.service';
import { RemainingHoursService } from './remaining-hours.service';
import { ProjectAccessService } from './project-access.service';
import { OWNER, staff, visibilityOr } from './project-access.test-support';
import { DatabaseService } from '../database/database.service';

describe('ProjectTimeService', () => {
    let service: ProjectTimeService;
    let db: any;
    let remaining: { write: jest.Mock };

    const task = {
        id: 'task-1',
        project_id: 'project-1',
        sprint_id: 'sprint-1',
        remaining_hours: 8,
    };

    beforeEach(async () => {
        remaining = { write: jest.fn().mockResolvedValue(true) };

        db = {
            projectTask: { findFirst: jest.fn().mockResolvedValue(task) },
            userStorePermission: { findFirst: jest.fn().mockResolvedValue(null) },
            projectTimeEntry: {
                create: jest.fn().mockResolvedValue({ id: 'entry-1' }),
                findFirst: jest.fn(),
                findMany: jest.fn().mockResolvedValue([]),
                count: jest.fn().mockResolvedValue(0),
                update: jest.fn(),
                delete: jest.fn().mockResolvedValue({}),
                groupBy: jest.fn().mockResolvedValue([]),
            },
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ProjectTimeService,
                ProjectAccessService,
                { provide: DatabaseService, useValue: db },
                { provide: RemainingHoursService, useValue: remaining },
            ],
        }).compile();

        service = module.get(ProjectTimeService);
    });

    const log = (overrides: Record<string, unknown> = {}) =>
        service.create(OWNER, {
            taskId: 'task-1',
            workDate: '2026-08-03',
            hours: 3,
            ...overrides,
        } as never);

    it('suggests the remainder after logged hours when none is supplied', async () => {
        await log();

        expect(remaining.write).toHaveBeenCalledWith(
            expect.objectContaining({
                previousHours: 8,
                newHours: 5,
                source: 'TIME_LOGGED',
            }),
        );
    });

    it('accepts a remainder that did not go down — work absorbed, nothing closer to done', async () => {
        await log({ hours: 3, remainingHours: 8 });

        expect(remaining.write).toHaveBeenCalledWith(
            expect.objectContaining({ newHours: 8 }),
        );
    });

    it('accepts a remainder that went up, and calls it a re-estimate not progress', async () => {
        await log({ hours: 2, remainingHours: 14 });

        expect(remaining.write).toHaveBeenCalledWith(
            expect.objectContaining({ newHours: 14, source: 'RE_ESTIMATED' }),
        );
    });

    it('never suggests a negative remainder', async () => {
        db.projectTask.findFirst.mockResolvedValue({ ...task, remaining_hours: 1 });
        await log({ hours: 5 });

        expect(remaining.write).toHaveBeenCalledWith(expect.objectContaining({ newHours: 0 }));
    });

    it('links the log row to the entry that caused it', async () => {
        await log();
        expect(remaining.write).toHaveBeenCalledWith(
            expect.objectContaining({ timeEntryId: 'entry-1' }),
        );
    });

    it('stamps the log with the sprint the task is in right now', async () => {
        await log();
        expect(remaining.write).toHaveBeenCalledWith(
            expect.objectContaining({ sprintId: 'sprint-1' }),
        );
    });

    it('refuses to log against a task from another tenant', async () => {
        db.projectTask.findFirst.mockResolvedValue(null);
        await expect(log()).rejects.toBeInstanceOf(NotFoundException);
        expect(db.projectTimeEntry.create).not.toHaveBeenCalled();
    });

    describe('remove', () => {
        it('gives the hours back so the sprint is not short by work nobody did', async () => {
            db.projectTimeEntry.findFirst.mockResolvedValue({
                id: 'entry-1',
                hours: 3,
                task: { id: 'task-1', project_id: 'project-1', sprint_id: 'sprint-1', remaining_hours: 5 },
            });

            await service.remove(OWNER, 'entry-1');

            expect(remaining.write).toHaveBeenCalledWith(
                expect.objectContaining({
                    previousHours: 5,
                    newHours: 8,
                    source: 'TIME_ENTRY_DELETED',
                }),
            );
        });

        it('rejects an entry belonging to another tenant', async () => {
            db.projectTimeEntry.findFirst.mockResolvedValue(null);
            await expect(service.remove(OWNER, 'entry-1')).rejects.toBeInstanceOf(
                NotFoundException,
            );
            expect(db.projectTimeEntry.delete).not.toHaveBeenCalled();
        });
    });

    it('scopes the listing to the tenant', async () => {
        await service.list(OWNER, {} as never);
        expect(db.projectTimeEntry.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ tenant_id: 'tenant-1' }),
            }),
        );
    });

    it('filters the listing by person and date range', async () => {
        await service.list(OWNER, {
            userId: 'user-9',
            from: '2026-08-01',
            to: '2026-08-31',
        } as never);

        expect(db.projectTimeEntry.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    tenant_id: 'tenant-1',
                    user_id: 'user-9',
                    work_date: { gte: new Date('2026-08-01'), lte: new Date('2026-08-31') },
                }),
            }),
        );
    });

    it('falls back to the work date when the table sorts on a column the server cannot order by', async () => {
        await service.list(OWNER, { sortBy: 'actions', sortDir: 'asc' } as never);

        expect(db.projectTimeEntry.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                orderBy: [{ work_date: 'asc' }, { created_at: 'desc' }],
            }),
        );
    });

    it('orders by the task title when the table sorts on the task column', async () => {
        await service.list(OWNER, { sortBy: 'task', sortDir: 'asc' } as never);

        expect(db.projectTimeEntry.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                orderBy: [{ task: { title: 'asc' } }, { created_at: 'desc' }],
            }),
        );
    });

    describe('report', () => {
        const range = { from: '2026-08-01', to: '2026-08-31' };

        /**
         * `report` fires one groupBy per dimension in a fixed order —
         * task, user, project, date — so the mock answers positionally.
         */
        const groupings = (rows: { task: any[]; user: any[]; project: any[]; date: any[] }) => {
            db.projectTimeEntry.groupBy
                .mockResolvedValueOnce(rows.task)
                .mockResolvedValueOnce(rows.user)
                .mockResolvedValueOnce(rows.project)
                .mockResolvedValueOnce(rows.date);
        };

        const sum = (hours: number, count: number) => ({
            _sum: { hours },
            _count: { _all: count },
        });

        beforeEach(() => {
            db.projectTask.findMany = jest.fn().mockResolvedValue([]);
            db.project = { findMany: jest.fn().mockResolvedValue([]) };
            db.user = { findMany: jest.fn().mockResolvedValue([]) };
        });

        it('totals hours over the range and counts every dimension', async () => {
            groupings({
                task: [
                    { task_id: 't1', ...sum(6, 2) },
                    { task_id: 't2', ...sum(4, 1) },
                ],
                user: [{ user_id: 'u1', ...sum(10, 3) }],
                project: [{ project_id: 'p1', ...sum(10, 3) }],
                date: [
                    { work_date: new Date('2026-08-03'), ...sum(6, 2) },
                    { work_date: new Date('2026-08-04'), ...sum(4, 1) },
                ],
            });

            const result = await service.report(OWNER, { ...range } as never);

            expect(result.summary).toEqual(
                expect.objectContaining({
                    totalHours: 10,
                    entries: 3,
                    days: 2,
                    people: 1,
                    tasks: 2,
                    projects: 1,
                    avgHoursPerDay: 5,
                }),
            );
        });

        it('defaults to grouping by task, biggest first, with shares of the range total', async () => {
            groupings({
                task: [
                    { task_id: 't1', ...sum(2, 1) },
                    { task_id: 't2', ...sum(6, 2) },
                ],
                user: [],
                project: [],
                date: [{ work_date: new Date('2026-08-03'), ...sum(8, 3) }],
            });
            db.projectTask.findMany.mockResolvedValue([
                { id: 't1', title: 'Wiring', project: { code: 'P-1', name: 'Fitout' } },
                { id: 't2', title: 'Painting', project: { code: 'P-1', name: 'Fitout' } },
            ]);

            const result = await service.report(OWNER, { ...range } as never);

            expect(result.groupBy).toBe('task');
            expect(result.rows.map((row: any) => [row.label, row.hours, row.share])).toEqual([
                ['Painting', 6, 75],
                ['Wiring', 2, 25],
            ]);
            expect(result.rows[0].sublabel).toBe('P-1 · Fitout');
        });

        it('folds days into ISO weeks that agree with the days they are made of', async () => {
            groupings({
                task: [],
                user: [],
                project: [],
                date: [
                    // Mon 3 Aug and Fri 7 Aug 2026 are the same ISO week...
                    { work_date: new Date('2026-08-03'), ...sum(3, 1) },
                    { work_date: new Date('2026-08-07'), ...sum(2, 1) },
                    // ...and the following Monday is the next one.
                    { work_date: new Date('2026-08-10'), ...sum(4, 1) },
                ],
            });

            const result = await service.report(OWNER, {
                ...range,
                groupBy: 'week',
            } as never);

            expect(result.rows).toHaveLength(2);
            expect(result.rows[0]).toEqual(
                expect.objectContaining({ hours: 5, entries: 2, sublabel: '2026-08-03 — 2026-08-09' }),
            );
            expect(result.rows[1]).toEqual(expect.objectContaining({ hours: 4, entries: 1 }));
        });

        it('labels hours whose author is gone rather than dropping them', async () => {
            groupings({
                task: [],
                user: [{ user_id: null, ...sum(5, 2) }],
                project: [],
                date: [{ work_date: new Date('2026-08-03'), ...sum(5, 2) }],
            });

            const result = await service.report(OWNER, {
                ...range,
                groupBy: 'user',
            } as never);

            expect(result.rows).toEqual([
                expect.objectContaining({ key: 'unassigned', label: 'Unattributed', hours: 5 }),
            ]);
        });

        it('scopes every aggregate to the tenant and the range', async () => {
            groupings({ task: [], user: [], project: [], date: [] });

            await service.report(OWNER, { ...range, projectId: 'p1' } as never);

            for (const call of db.projectTimeEntry.groupBy.mock.calls) {
                expect(call[0].where).toEqual(
                    expect.objectContaining({
                        tenant_id: 'tenant-1',
                        project_id: 'p1',
                        work_date: { gte: new Date('2026-08-01'), lte: new Date('2026-08-31') },
                    }),
                );
            }
        });
    });

    describe('project visibility', () => {
        it('filters hour logs to projects the viewer can reach', async () => {
            await service.list(staff('user-7'), {} as never);

            expect(db.projectTimeEntry.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        AND: [{ project: { OR: visibilityOr('user-7') } }],
                    }),
                }),
            );
        });

        it('applies the same filter to the report, so the totals strip agrees with the list', async () => {
            await service.report(staff('user-7'), {} as never);

            for (const call of db.projectTimeEntry.groupBy.mock.calls) {
                expect(call[0].where).toEqual(
                    expect.objectContaining({
                        AND: [{ project: { OR: visibilityOr('user-7') } }],
                    }),
                );
            }
        });

        it('refuses to log time against a task the viewer cannot see', async () => {
            db.projectTask.findFirst.mockResolvedValue(null);

            await expect(
                service.create(staff('user-7'), {
                    taskId: 'task-1',
                    workDate: '2026-08-03',
                    hours: 3,
                } as never),
            ).rejects.toBeInstanceOf(NotFoundException);
            expect(db.projectTimeEntry.create).not.toHaveBeenCalled();
        });
    });
});
