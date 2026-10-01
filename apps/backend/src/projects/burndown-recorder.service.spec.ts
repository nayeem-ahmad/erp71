import { Test, TestingModule } from '@nestjs/testing';
import { BurndownRecorder } from './burndown-recorder.service';
import { DatabaseService } from '../database/database.service';

describe('BurndownRecorder', () => {
    let recorder: BurndownRecorder;
    let db: any;

    const done = { category: 'DONE' };
    const todo = { category: 'TODO' };

    beforeEach(async () => {
        db = {
            projectTask: {
                findMany: jest.fn().mockResolvedValue([
                    { id: 't1', estimate_hours: 8, remaining_hours: 3, status: todo },
                    { id: 't2', estimate_hours: 5, remaining_hours: 0, status: done },
                ]),
            },
            sprint: {
                findMany: jest.fn().mockResolvedValue([{ id: 'sprint-1' }]),
            },
            sprintBurndownPoint: {
                findFirst: jest.fn().mockResolvedValue(null),
                create: jest.fn().mockResolvedValue({}),
            },
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [BurndownRecorder, { provide: DatabaseService, useValue: db }],
        }).compile();

        recorder = module.get(BurndownRecorder);
    });

    describe('computeCurrent', () => {
        it('totals remaining and committed hours and counts done tasks', async () => {
            expect(await recorder.computeCurrent('tenant-1', 'sprint-1')).toEqual({
                remaining_hours: 3,
                committed_hours: 13,
                task_count: 2,
                done_task_count: 1,
            });
            expect(db.projectTask.findMany.mock.calls[0][0].where).toEqual({
                tenant_id: 'tenant-1',
                sprint_id: 'sprint-1',
                deleted_at: null,
            });
        });
    });

    describe('record', () => {
        it('stores the recomputed totals with the cause and the task behind it', async () => {
            await recorder.record('tenant-1', ['sprint-1'], 'WORK_LOGGED', 't1');

            expect(db.sprintBurndownPoint.create).toHaveBeenCalledWith({
                data: {
                    tenant_id: 'tenant-1',
                    sprint_id: 'sprint-1',
                    remaining_hours: 3,
                    committed_hours: 13,
                    task_count: 2,
                    done_task_count: 1,
                    cause: 'WORK_LOGGED',
                    task_id: 't1',
                },
            });
        });

        it('only records running sprints, and asks once per distinct id', async () => {
            await recorder.record('tenant-1', ['sprint-1', null, undefined, 'sprint-1', 'sprint-2'], 'TASK_ADDED');

            expect(db.sprint.findMany).toHaveBeenCalledWith({
                where: { tenant_id: 'tenant-1', id: { in: ['sprint-1', 'sprint-2'] }, status: 'ACTIVE' },
                select: { id: true },
            });
            // Only sprint-1 came back ACTIVE.
            expect(db.sprintBurndownPoint.create).toHaveBeenCalledTimes(1);
        });

        it('does nothing at all when no sprint is named', async () => {
            await recorder.record('tenant-1', [null, undefined], 'TASK_REMOVED');
            expect(db.sprint.findMany).not.toHaveBeenCalled();
            expect(db.sprintBurndownPoint.create).not.toHaveBeenCalled();
        });

        it('writes nothing for a planned or completed sprint', async () => {
            db.sprint.findMany.mockResolvedValue([]);
            await recorder.record('tenant-1', ['sprint-1'], 'WORK_LOGGED');
            expect(db.sprintBurndownPoint.create).not.toHaveBeenCalled();
        });

        it('skips a point that would repeat the latest one exactly', async () => {
            db.sprintBurndownPoint.findFirst.mockResolvedValue({
                remaining_hours: 3,
                committed_hours: 13,
                task_count: 2,
                done_task_count: 1,
            });
            await recorder.record('tenant-1', ['sprint-1'], 'STATUS_CHANGED', 't1');
            expect(db.sprintBurndownPoint.create).not.toHaveBeenCalled();
        });

        it('records a change in any one figure', async () => {
            db.sprintBurndownPoint.findFirst.mockResolvedValue({
                remaining_hours: 3,
                committed_hours: 13,
                task_count: 2,
                done_task_count: 0,
            });
            await recorder.record('tenant-1', ['sprint-1'], 'STATUS_CHANGED', 't2');
            expect(db.sprintBurndownPoint.create).toHaveBeenCalledTimes(1);
        });

        it.each(['STARTED', 'COMPLETED'] as const)('always records %s, even when nothing moved', async (cause) => {
            db.sprintBurndownPoint.findFirst.mockResolvedValue({
                remaining_hours: 3,
                committed_hours: 13,
                task_count: 2,
                done_task_count: 1,
            });
            await recorder.record('tenant-1', ['sprint-1'], cause);
            expect(db.sprintBurndownPoint.create).toHaveBeenCalledTimes(1);
        });

        it('never throws — a failed point must not fail the edit behind it', async () => {
            db.sprintBurndownPoint.create.mockRejectedValue(new Error('db down'));
            await expect(recorder.record('tenant-1', ['sprint-1'], 'WORK_LOGGED')).resolves.toBeUndefined();
        });
    });

    describe('causeForSource', () => {
        it.each([
            ['TIME_LOGGED', 'WORK_LOGGED'],
            ['TIME_ENTRY_DELETED', 'WORK_LOGGED'],
            ['RE_ESTIMATED', 'RE_ESTIMATED'],
            ['TASK_CREATED', 'TASK_ADDED'],
            ['TASK_COMPLETED', 'STATUS_CHANGED'],
            ['TASK_REOPENED', 'STATUS_CHANGED'],
        ])('maps %s to %s', (source, cause) => {
            expect(BurndownRecorder.causeForSource(source)).toBe(cause);
        });
    });
});
