import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
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
                update: jest.fn().mockResolvedValue({ id: 'entry-1' }),
                delete: jest.fn().mockResolvedValue({}),
                groupBy: jest.fn().mockResolvedValue([]),
                aggregate: jest.fn().mockResolvedValue({ _sum: { hours: 0 }, _count: { _all: 0 } }),
            },
            projectTimeTag: { findMany: jest.fn().mockResolvedValue([]) },
            projectTimeEntryTag: {
                deleteMany: jest.fn().mockResolvedValue({}),
                createMany: jest.fn().mockResolvedValue({}),
                groupBy: jest.fn().mockResolvedValue([]),
            },
            $transaction: jest.fn(async (fn: any) => fn(db)),
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

    describe('spans', () => {
        const created = () => db.projectTimeEntry.create.mock.calls[0][0].data;

        it('stores no span when neither time is given, which is most entries', async () => {
            await log();
            expect(created()).toMatchObject({ started_at: null, ended_at: null, hours: 3 });
        });

        it('derives the hours from the span rather than trusting the figure sent', async () => {
            // The client sends 3; the times say 4.38. The times win, because
            // the row shows the times and the two must not disagree.
            await log({ startTime: '13:45', endTime: '18:08' });

            expect(created().hours).toBe(4.38);
            expect(created().started_at.toISOString()).toBe('2026-08-03T07:45:00.000Z');
        });

        it('carries the derived hours into the remaining-hours suggestion too', async () => {
            await log({ hours: 3, startTime: '09:00', endTime: '17:00' });

            // 8 remaining minus the 8 actually spanned, not the 3 that were sent.
            expect(remaining.write).toHaveBeenCalledWith(
                expect.objectContaining({ newHours: 0, source: 'TIME_LOGGED' }),
            );
        });

        it('rejects half a span with a reason rather than storing one end', async () => {
            await expect(log({ startTime: '13:45' })).rejects.toBeInstanceOf(
                BadRequestException,
            );
            expect(db.projectTimeEntry.create).not.toHaveBeenCalled();
        });

        it('rejects a start and end that are the same time', async () => {
            await expect(
                service.create(OWNER, {
                    taskId: 'task-1',
                    workDate: '2026-08-03',
                    hours: 3,
                    startTime: '09:00',
                    endTime: '09:00',
                } as never),
            ).rejects.toThrow(/same/);
        });

        it('accepts a sitting that ran past midnight', async () => {
            await log({ startTime: '22:00', endTime: '02:00' });

            expect(created().hours).toBe(4);
            // Still filed on the work date that was sent, not the next day.
            expect(created().work_date.toISOString()).toBe('2026-08-03T00:00:00.000Z');
        });
    });

    describe('overlap', () => {
        const clash = { id: 'entry-old', task: { title: 'Stock count' } };

        it('refuses a span covering a minute this person already logged', async () => {
            db.projectTimeEntry.findFirst.mockResolvedValue(clash);

            await expect(log({ startTime: '13:45', endTime: '18:08' })).rejects.toBeInstanceOf(
                ConflictException,
            );
            expect(db.projectTimeEntry.create).not.toHaveBeenCalled();
        });

        it('names the entry it clashes with', async () => {
            db.projectTimeEntry.findFirst.mockResolvedValue(clash);

            await expect(log({ startTime: '13:45', endTime: '18:08' })).rejects.toThrow(
                /Stock count/,
            );
        });

        it('checks only this person’s own entries, and only ones that have a span', async () => {
            await log({ startTime: '13:45', endTime: '18:08' });

            expect(db.projectTimeEntry.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        tenant_id: 'tenant-1',
                        user_id: 'user-1',
                        started_at: { not: null, lt: expect.any(Date) },
                        ended_at: { gt: expect.any(Date) },
                    }),
                }),
            );
        });

        it('lets an explicit allowOverlap through', async () => {
            db.projectTimeEntry.findFirst.mockResolvedValue(clash);

            await log({ startTime: '13:45', endTime: '18:08', allowOverlap: true });

            expect(db.projectTimeEntry.create).toHaveBeenCalled();
        });

        it('does not check at all for an entry with no span — 4 hours claims no minutes', async () => {
            await log({ hours: 4 });

            expect(db.projectTimeEntry.findFirst).not.toHaveBeenCalled();
        });
    });

    describe('tags', () => {
        it('writes only the tag ids that resolve in this tenant', async () => {
            db.projectTimeTag.findMany.mockResolvedValue([{ id: 'tag-a' }]);

            await log({ tagIds: ['tag-a', 'tag-elsewhere'] });

            expect(db.projectTimeEntry.create.mock.calls[0][0].data.tags).toEqual({
                create: [{ tenant_id: 'tenant-1', tag_id: 'tag-a' }],
            });
        });

        it('writes no tag join at all when none are sent', async () => {
            await log();
            expect(db.projectTimeEntry.create.mock.calls[0][0].data).not.toHaveProperty('tags');
        });

        it('filters the list by a tag with `some`, so any one of several matches', async () => {
            await service.list(OWNER, { tagId: 'tag-a' } as never);

            expect(db.projectTimeEntry.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ tags: { some: { tag_id: 'tag-a' } } }),
                }),
            );
        });
    });

    describe('update', () => {
        const stored = {
            id: 'entry-1',
            work_date: new Date('2026-08-03T00:00:00.000Z'),
            started_at: new Date('2026-08-03T07:45:00.000Z'),
            ended_at: new Date('2026-08-03T12:08:00.000Z'),
        };

        const patch = (dto: Record<string, unknown>) => {
            db.projectTimeEntry.findFirst.mockResolvedValueOnce(stored);
            return service.update(OWNER, 'entry-1', dto as never);
        };
        const written = () => db.projectTimeEntry.update.mock.calls[0][0].data;

        it('leaves the span alone when neither time is sent', async () => {
            await patch({ note: 'tidied' });

            expect(written()).toEqual({ note: 'tidied' });
        });

        it('keeps the stored start when only the end moves', async () => {
            await patch({ endTime: '19:00' });

            expect(written().started_at.toISOString()).toBe('2026-08-03T07:45:00.000Z');
            expect(written().ended_at.toISOString()).toBe('2026-08-03T13:00:00.000Z');
            expect(written().hours).toBe(5.25);
        });

        it('clears the span on an empty string, leaving the hours as they were', async () => {
            await patch({ startTime: '' });

            expect(written()).toMatchObject({ started_at: null, ended_at: null });
            expect(written()).not.toHaveProperty('hours');
        });

        it('refuses a bare hours figure on a timed entry, which its span already states', async () => {
            await expect(patch({ hours: 2 })).rejects.toThrow(/runs to a clock/);
            expect(db.projectTimeEntry.update).not.toHaveBeenCalled();
        });

        it('accepts hours alongside clearing the span — the two together are consistent', async () => {
            await patch({ hours: 2, startTime: '' });

            expect(written()).toMatchObject({ started_at: null, ended_at: null, hours: 2 });
        });

        it('accepts a bare hours correction on an entry with no span', async () => {
            db.projectTimeEntry.findFirst.mockResolvedValueOnce({
                ...stored,
                started_at: null,
                ended_at: null,
            });
            await service.update(OWNER, 'entry-1', { hours: 2 } as never);

            expect(written()).toEqual({ hours: 2 });
        });

        it('replaces tags wholesale, so an empty list means none left', async () => {
            await patch({ tagIds: [] });

            expect(db.projectTimeEntryTag.deleteMany).toHaveBeenCalledWith({
                where: { entry_id: 'entry-1' },
            });
            expect(db.projectTimeEntryTag.createMany).not.toHaveBeenCalled();
        });

        it('excludes the entry from its own overlap check', async () => {
            await patch({ startTime: '14:00', endTime: '15:00' });

            const overlapCall = db.projectTimeEntry.findFirst.mock.calls.at(-1)[0];
            expect(overlapCall.where).toMatchObject({ id: { not: 'entry-1' } });
        });
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

    describe('importRows', () => {
        beforeEach(() => {
            db.project = {
                findMany: jest.fn().mockResolvedValue([
                    { id: 'project-1', code: 'ACME', short_name: null, name: 'Acme rebuild' },
                ]),
            };
            db.projectTimeTag.findMany.mockResolvedValue([{ id: 'tag-1', name: 'Billable' }]);
            db.projectTask.findFirst.mockResolvedValue(task);
            // Nothing logged yet, so every row below is a create.
            db.projectTimeEntry.findFirst.mockResolvedValue(null);
        });

        const run = (rows: Record<string, unknown>[], mode: 'skip' | 'upsert' = 'skip') =>
            service.importRows(OWNER, rows, mode);

        it('resolves a project code and a task title, and logs under the importer', async () => {
            const result = await run([
                {
                    project: 'acme',
                    task: 'Wire the till',
                    workDate: '2026-08-03',
                    hours: '3.5',
                    note: 'Second pass',
                    tags: 'billable',
                },
            ]);

            expect(result).toMatchObject({ created: 1, errors: [] });
            expect(db.projectTimeEntry.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        task_id: 'task-1',
                        user_id: 'user-1',
                        hours: 3.5,
                        note: 'Second pass',
                    }),
                }),
            );
        });

        it('derives the hours from a span, ignoring any figure beside it', async () => {
            await run([
                {
                    project: 'ACME',
                    task: 'Wire the till',
                    workDate: '2026-08-03',
                    hours: '99',
                    startTime: '9:00',
                    endTime: '11:30',
                },
            ]);

            expect(db.projectTimeEntry.create).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ hours: 2.5 }) }),
            );
        });

        it('refuses a row carrying neither hours nor a span', async () => {
            const result = await run([
                { project: 'ACME', task: 'Wire the till', workDate: '2026-08-03' },
            ]);

            expect(result.created).toBe(0);
            expect(result.errors).toEqual([
                'Row 2: give hours, or both a start and an end time',
            ]);
        });

        it('fails the row when no task on that project carries the title', async () => {
            db.projectTask.findFirst.mockResolvedValue(null);

            const result = await run([
                { project: 'ACME', task: 'Ghost task', workDate: '2026-08-03', hours: 1 },
            ]);

            expect(result.errors).toEqual([
                'Row 2: no task named "Ghost task" on that project',
            ]);
        });

        it('resolves a title once however many rows name it', async () => {
            await run([
                { project: 'ACME', task: 'Wire the till', workDate: '2026-08-03', hours: 1 },
                { project: 'ACME', task: 'Wire the till', workDate: '2026-08-04', hours: 2 },
            ]);

            // The import's own lookup is the one asking for nothing but the id;
            // `create` makes its own richer read per entry, which is not what
            // the cache is there to spare.
            const titleLookups = db.projectTask.findFirst.mock.calls.filter(
                ([args]: [any]) => args?.where?.title !== undefined,
            );
            expect(titleLookups).toHaveLength(1);
        });

        /**
         * An hour log has no natural key, so its identity is the task, the day
         * and the note together — which is what makes running the same file
         * twice skip rather than double the hours.
         */
        it('skips an entry already logged for that task, day and note', async () => {
            db.projectTimeEntry.findFirst.mockResolvedValue({ id: 'entry-1' });

            const result = await run([
                { project: 'ACME', task: 'Wire the till', workDate: '2026-08-03', hours: 1 },
            ]);

            expect(result).toMatchObject({ created: 0, skipped: 1 });
            expect(db.projectTimeEntry.create).not.toHaveBeenCalled();
        });

        it('only looks for a duplicate among the importer\'s own hours', async () => {
            await run([
                { project: 'ACME', task: 'Wire the till', workDate: '2026-08-03', hours: 1 },
            ]);

            expect(db.projectTimeEntry.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        tenant_id: 'tenant-1',
                        user_id: 'user-1',
                        task_id: 'task-1',
                    }),
                }),
            );
        });

        it('leaves a project the viewer cannot open out of the lookup entirely', async () => {
            db.project.findMany.mockResolvedValue([]);

            const result = await run([
                { project: 'ACME', task: 'Wire the till', workDate: '2026-08-03', hours: 1 },
            ]);

            expect(result.created).toBe(0);
            expect(result.errors).toEqual(['Row 2: no project matches "ACME"']);
        });
    });

});
