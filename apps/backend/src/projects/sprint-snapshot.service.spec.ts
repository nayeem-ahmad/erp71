import { Test, TestingModule } from '@nestjs/testing';
import { SprintSnapshotService } from './sprint-snapshot.service';
import { DatabaseService } from '../database/database.service';

describe('SprintSnapshotService', () => {
    let service: SprintSnapshotService;
    let db: any;

    const done = { category: 'DONE' };
    const todo = { category: 'TODO' };

    beforeEach(async () => {
        db = {
            projectTask: { findMany: jest.fn().mockResolvedValue([]) },
            projectTaskRemainingLog: { findMany: jest.fn().mockResolvedValue([]) },
            sprint: {
                findFirst: jest.fn().mockResolvedValue({
                    start_date: new Date('2026-08-02T00:00:00.000Z'),
                    end_date: new Date('2026-08-06T00:00:00.000Z'),
                }),
            },
            sprintSnapshot: {
                upsert: jest.fn().mockResolvedValue({}),
                findMany: jest.fn().mockResolvedValue([]),
            },
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [SprintSnapshotService, { provide: DatabaseService, useValue: db }],
        }).compile();

        service = module.get(SprintSnapshotService);
    });

    describe('computeCurrent', () => {
        it('totals remaining and committed hours across the sprint', async () => {
            db.projectTask.findMany.mockResolvedValue([
                { id: 't1', estimate_hours: 8, remaining_hours: 3, status: todo },
                { id: 't2', estimate_hours: 5, remaining_hours: 0, status: done },
            ]);

            const figures = await service.computeCurrent('tenant-1', 'sprint-1');

            expect(figures).toEqual({
                remaining_hours: 3,
                committed_hours: 13,
                completed_hours: 10,
                task_count: 2,
                done_task_count: 1,
            });
        });

        it('never reports negative completed hours when scope grew past the estimate', async () => {
            db.projectTask.findMany.mockResolvedValue([
                { id: 't1', estimate_hours: 4, remaining_hours: 20, status: todo },
            ]);

            const figures = await service.computeCurrent('tenant-1', 'sprint-1');
            expect(figures.completed_hours).toBe(0);
        });

        it('counts an empty sprint as zeroes rather than NaN', async () => {
            const figures = await service.computeCurrent('tenant-1', 'sprint-1');
            expect(figures.remaining_hours).toBe(0);
            expect(figures.task_count).toBe(0);
        });
    });

    describe('writeSnapshot', () => {
        it('upserts on (sprint, date) so a same-day re-run overwrites rather than doubles', async () => {
            await service.writeSnapshot('tenant-1', 'sprint-1', '2026-08-03', {
                remaining_hours: 10,
                committed_hours: 20,
                completed_hours: 10,
                task_count: 3,
                done_task_count: 1,
            });

            const call = db.sprintSnapshot.upsert.mock.calls[0][0];
            expect(call.where.sprint_id_snapshot_date).toEqual({
                sprint_id: 'sprint-1',
                snapshot_date: new Date('2026-08-03T00:00:00.000Z'),
            });
            expect(call.update.remaining_hours).toBe(10);
        });
    });

    describe('computeFromLog', () => {
        const logs = [
            // Two tasks open the sprint at 8h and 4h.
            { task_id: 't1', new_hours: 8, changed_at: new Date('2026-08-02T09:00:00Z') },
            { task_id: 't2', new_hours: 4, changed_at: new Date('2026-08-02T09:05:00Z') },
            // t1 burns down on day two.
            { task_id: 't1', new_hours: 5, changed_at: new Date('2026-08-03T11:00:00Z') },
        ];

        it('replays the newest value per task as at the end of that day', async () => {
            db.projectTaskRemainingLog.findMany.mockResolvedValue(logs);

            const figures = await service.computeFromLog('tenant-1', 'sprint-1', '2026-08-03');

            expect(figures.remaining_hours).toBe(9); // 5 + 4
            expect(figures.committed_hours).toBe(12); // openings: 8 + 4
        });

        it('reads the day boundary as end-of-day, not midnight', async () => {
            db.projectTaskRemainingLog.findMany.mockResolvedValue(logs);

            await service.computeFromLog('tenant-1', 'sprint-1', '2026-08-03');

            const where = db.projectTaskRemainingLog.findMany.mock.calls[0][0].where;
            expect(where.changed_at.lt).toEqual(new Date('2026-08-04T00:00:00.000Z'));
        });

        it('counts a task as done once its remaining reaches zero', async () => {
            db.projectTaskRemainingLog.findMany.mockResolvedValue([
                ...logs,
                { task_id: 't2', new_hours: 0, changed_at: new Date('2026-08-03T15:00:00Z') },
            ]);

            const figures = await service.computeFromLog('tenant-1', 'sprint-1', '2026-08-03');
            expect(figures.done_task_count).toBe(1);
        });

        it('raises committed hours when a task is added mid-sprint', async () => {
            db.projectTaskRemainingLog.findMany.mockResolvedValue([
                ...logs,
                { task_id: 't3', new_hours: 6, changed_at: new Date('2026-08-04T09:00:00Z') },
            ]);

            const figures = await service.computeFromLog('tenant-1', 'sprint-1', '2026-08-04');
            expect(figures.committed_hours).toBe(18); // 8 + 4 + 6
            expect(figures.task_count).toBe(3);
        });
    });

    describe('rebuild', () => {
        it('reproduces a cron-written snapshot from the log alone', async () => {
            // What the live path would have recorded on 2026-08-03.
            db.projectTask.findMany.mockResolvedValue([
                { id: 't1', estimate_hours: 8, remaining_hours: 5, status: todo },
                { id: 't2', estimate_hours: 4, remaining_hours: 4, status: todo },
            ]);
            const live = await service.computeCurrent('tenant-1', 'sprint-1');

            // The same history, replayed.
            db.projectTaskRemainingLog.findMany.mockResolvedValue([
                { task_id: 't1', new_hours: 8, changed_at: new Date('2026-08-02T09:00:00Z') },
                { task_id: 't2', new_hours: 4, changed_at: new Date('2026-08-02T09:05:00Z') },
                { task_id: 't1', new_hours: 5, changed_at: new Date('2026-08-03T11:00:00Z') },
            ]);
            const replayed = await service.computeFromLog('tenant-1', 'sprint-1', '2026-08-03');

            expect(replayed.remaining_hours).toBe(live.remaining_hours);
            expect(replayed.committed_hours).toBe(live.committed_hours);
            expect(replayed.completed_hours).toBe(live.completed_hours);
            expect(replayed.task_count).toBe(live.task_count);
        });

        it('fills only the days that have no snapshot yet', async () => {
            db.sprintSnapshot.findMany.mockResolvedValue([
                { snapshot_date: new Date('2026-08-02T00:00:00.000Z') },
                { snapshot_date: new Date('2026-08-03T00:00:00.000Z') },
            ]);

            const result = await service.rebuild('tenant-1', 'sprint-1', {
                today: new Date('2026-08-05T12:00:00.000Z'),
            });

            expect(result.skipped).toBe(2);
            expect(result.written).toBe(2); // the 4th and 5th
        });

        it('rewrites every day when explicitly told to overwrite', async () => {
            db.sprintSnapshot.findMany.mockResolvedValue([
                { snapshot_date: new Date('2026-08-02T00:00:00.000Z') },
            ]);

            const result = await service.rebuild('tenant-1', 'sprint-1', {
                overwrite: true,
                today: new Date('2026-08-04T12:00:00.000Z'),
            });

            expect(result.skipped).toBe(0);
            expect(result.written).toBe(3);
        });

        it('stops at today rather than filling the sprint’s future days', async () => {
            const result = await service.rebuild('tenant-1', 'sprint-1', {
                today: new Date('2026-08-03T12:00:00.000Z'),
            });
            expect(result.written).toBe(2); // 2nd and 3rd only
        });

        it('does nothing for a sprint that is not this tenant’s', async () => {
            db.sprint.findFirst.mockResolvedValue(null);
            const result = await service.rebuild('tenant-1', 'sprint-1');
            expect(result).toEqual({ written: 0, skipped: 0 });
        });
    });
});
