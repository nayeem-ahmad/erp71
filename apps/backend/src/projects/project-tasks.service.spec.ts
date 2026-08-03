import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProjectTasksService } from './project-tasks.service';
import { ProjectSettingsService } from './project-settings.service';
import { RemainingHoursService } from './remaining-hours.service';
import { DatabaseService } from '../database/database.service';

describe('ProjectTasksService', () => {
    let service: ProjectTasksService;
    let db: any;
    let remaining: { write: jest.Mock; history: jest.Mock };

    const todo = { id: 'status-todo', category: 'TODO' };
    const doing = { id: 'status-doing', category: 'IN_PROGRESS' };
    const done = { id: 'status-done', category: 'DONE' };

    const task = (overrides: Record<string, unknown> = {}) => ({
        id: 'task-1',
        tenant_id: 'tenant-1',
        project_id: 'project-1',
        sprint_id: 'sprint-1',
        status_id: todo.id,
        status: todo,
        estimate_hours: 8,
        remaining_hours: 5,
        completed_at: null,
        parent_task_id: null,
        ...overrides,
    });

    beforeEach(async () => {
        remaining = { write: jest.fn().mockResolvedValue(true), history: jest.fn() };

        db = {
            project: { findFirst: jest.fn().mockResolvedValue({ id: 'project-1' }) },
            projectTask: {
                findFirst: jest.fn().mockResolvedValue(task()),
                findMany: jest.fn().mockResolvedValue([]),
                count: jest.fn().mockResolvedValue(0),
                create: jest.fn().mockResolvedValue({ id: 'task-new' }),
                update: jest.fn().mockResolvedValue({}),
            },
            projectTaskStatus: { findFirst: jest.fn().mockResolvedValue(todo) },
            projectTaskChecklistItem: {
                count: jest.fn().mockResolvedValue(0),
                create: jest.fn(),
                findFirst: jest.fn(),
                findMany: jest.fn().mockResolvedValue([]),
                update: jest.fn(),
                delete: jest.fn(),
            },
            projectTimeEntry: {
                groupBy: jest.fn().mockResolvedValue([]),
                aggregate: jest.fn().mockResolvedValue({ _sum: { hours: 3 } }),
            },
            sprint: { findFirst: jest.fn().mockResolvedValue({ id: 'sprint-1', project_id: 'project-1' }) },
            // Both forms: the interactive callback move() uses, and the array of
            // promises reorderChecklist() batches.
            $transaction: jest.fn(async (arg: any) =>
                typeof arg === 'function' ? arg(db) : Promise.all(arg),
            ),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ProjectTasksService,
                { provide: DatabaseService, useValue: db },
                { provide: RemainingHoursService, useValue: remaining },
                {
                    provide: ProjectSettingsService,
                    useValue: {
                        defaultTaskStatus: jest.fn().mockResolvedValue(todo),
                        listTaskStatuses: jest.fn().mockResolvedValue([todo, doing, done]),
                    },
                },
            ],
        }).compile();

        service = module.get(ProjectTasksService);
    });

    describe('create', () => {
        it('opens the remaining log at the estimate when none is given', async () => {
            await service.create('tenant-1', 'user-1', {
                projectId: 'project-1',
                title: 'Wire the panel',
                estimateHours: 6,
            } as never);

            expect(remaining.write).toHaveBeenCalledWith(
                expect.objectContaining({
                    previousHours: null,
                    newHours: 6,
                    source: 'TASK_CREATED',
                }),
            );
        });

        it('honours an explicit opening remainder over the estimate', async () => {
            await service.create('tenant-1', 'user-1', {
                projectId: 'project-1',
                title: 'Wire the panel',
                estimateHours: 6,
                remainingHours: 10,
            } as never);

            expect(remaining.write).toHaveBeenCalledWith(
                expect.objectContaining({ newHours: 10 }),
            );
        });

        it('writes no opening row for a task with no hours at all', async () => {
            await service.create('tenant-1', 'user-1', {
                projectId: 'project-1',
                title: 'Call the client',
            } as never);

            expect(remaining.write).not.toHaveBeenCalled();
        });

        it('refuses a subtask of a subtask', async () => {
            db.projectTask.findFirst.mockResolvedValue(task({ parent_task_id: 'task-parent' }));

            await expect(
                service.create('tenant-1', 'user-1', {
                    projectId: 'project-1',
                    title: 'Nested too deep',
                    parentTaskId: 'task-1',
                } as never),
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it('accepts a sprint that holds tasks from other projects', async () => {
            // Sprints are tenant-level: this exact case used to throw
            // "That sprint belongs to a different project", which is the whole
            // thing cross-project sprints exist to allow.
            db.sprint.findFirst.mockResolvedValue({ id: 'sprint-9' });

            await service.create('tenant-1', 'user-1', {
                projectId: 'project-1',
                title: 'Borrowed into a shared sprint',
                sprintId: 'sprint-9',
            } as never);

            expect(db.projectTask.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ sprint_id: 'sprint-9', project_id: 'project-1' }),
                }),
            );
        });

        it('still refuses a sprint from another tenant', async () => {
            db.sprint.findFirst.mockResolvedValue(null);

            await expect(
                service.create('tenant-1', 'user-1', {
                    projectId: 'project-1',
                    title: 'Foreign sprint',
                    sprintId: 'sprint-x',
                } as never),
            ).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe('update', () => {
        it('burns remaining to zero when a task reaches a Done column', async () => {
            db.projectTaskStatus.findFirst.mockResolvedValue(done);

            await service.update('tenant-1', 'user-1', 'task-1', { statusId: done.id } as never);

            expect(remaining.write).toHaveBeenCalledWith(
                expect.objectContaining({
                    previousHours: 5,
                    newHours: 0,
                    source: 'TASK_COMPLETED',
                }),
            );
        });

        it('restores unfinished hours when a done task is reopened', async () => {
            db.projectTask.findFirst.mockResolvedValue(
                task({ status: done, status_id: done.id, remaining_hours: 0 }),
            );
            db.projectTaskStatus.findFirst.mockResolvedValue(doing);

            await service.update('tenant-1', 'user-1', 'task-1', { statusId: doing.id } as never);

            // 8h estimated, 3h already logged → 5h genuinely left.
            expect(remaining.write).toHaveBeenCalledWith(
                expect.objectContaining({ newHours: 5, source: 'TASK_REOPENED' }),
            );
        });

        it('lets an explicit re-estimate win over the status-derived write', async () => {
            db.projectTaskStatus.findFirst.mockResolvedValue(done);

            await service.update('tenant-1', 'user-1', 'task-1', {
                statusId: done.id,
                remainingHours: 4,
            } as never);

            expect(remaining.write).toHaveBeenCalledTimes(1);
            expect(remaining.write).toHaveBeenCalledWith(
                expect.objectContaining({ newHours: 4, source: 'RE_ESTIMATED' }),
            );
        });

        it('does not touch remaining hours for an ordinary edit', async () => {
            await service.update('tenant-1', 'user-1', 'task-1', { title: 'Renamed' } as never);
            expect(remaining.write).not.toHaveBeenCalled();
        });

        it('carries the re-estimate note onto the log row', async () => {
            await service.update('tenant-1', 'user-1', 'task-1', {
                remainingHours: 12,
                remainingNote: 'client added two more rooms',
            } as never);

            expect(remaining.write).toHaveBeenCalledWith(
                expect.objectContaining({ note: 'client added two more rooms' }),
            );
        });
    });

    describe('move', () => {
        it('renumbers the target column so ordering stays stable integers', async () => {
            db.projectTask.findMany.mockResolvedValue([{ id: 'task-a' }, { id: 'task-b' }]);

            await service.move('tenant-1', 'user-1', 'task-1', {
                statusId: todo.id,
                sortOrder: 1,
            } as never);

            const orders = db.projectTask.update.mock.calls.map((c: any[]) => [
                c[0].where.id,
                c[0].data.sort_order,
            ]);
            expect(orders).toEqual([
                ['task-a', 0],
                ['task-1', 1],
                ['task-b', 2],
            ]);
        });

        it('clamps an out-of-range drop index to the end of the column', async () => {
            db.projectTask.findMany.mockResolvedValue([{ id: 'task-a' }]);

            await service.move('tenant-1', 'user-1', 'task-1', {
                statusId: todo.id,
                sortOrder: 99,
            } as never);

            const orders = db.projectTask.update.mock.calls.map((c: any[]) => c[0].where.id);
            expect(orders).toEqual(['task-a', 'task-1']);
        });

        it('burns to zero when a card is dragged into a Done column', async () => {
            db.projectTaskStatus.findFirst.mockResolvedValue(done);

            await service.move('tenant-1', 'user-1', 'task-1', {
                statusId: done.id,
                sortOrder: 0,
            } as never);

            expect(remaining.write).toHaveBeenCalledWith(
                expect.objectContaining({ newHours: 0, source: 'TASK_COMPLETED' }),
            );
        });

        it('sends a card back to the backlog when asked to clear its sprint', async () => {
            await service.move('tenant-1', 'user-1', 'task-1', {
                statusId: todo.id,
                sortOrder: 0,
                clearSprint: true,
            } as never);

            const moved = db.projectTask.update.mock.calls.find(
                (c: any[]) => c[0].where.id === 'task-1',
            );
            expect(moved[0].data.sprint_id).toBeNull();
        });
    });

    describe('board', () => {
        it('groups tasks under their column without a query per column', async () => {
            db.projectTask.findMany.mockResolvedValue([
                { id: 'task-1', status_id: todo.id },
                { id: 'task-2', status_id: done.id },
            ]);

            const board = await service.board('tenant-1', 'project-1');

            expect(db.projectTask.findMany).toHaveBeenCalledTimes(1);
            expect(board.columns).toHaveLength(3);
            expect(board.columns[0].tasks.map((t: any) => t.id)).toEqual(['task-1']);
            expect(board.columns[2].tasks.map((t: any) => t.id)).toEqual(['task-2']);
        });

        it('narrows to a sprint in scrum mode', async () => {
            await service.board('tenant-1', 'project-1', 'sprint-1');

            expect(db.projectTask.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ sprint_id: 'sprint-1' }),
                }),
            );
        });
    });

    describe('reorderChecklist', () => {
        const items = [{ id: 'item-a' }, { id: 'item-b' }, { id: 'item-c' }];

        beforeEach(() => {
            db.projectTaskChecklistItem.findMany.mockResolvedValue(items);
            db.projectTaskChecklistItem.update.mockImplementation((args: any) => args);
        });

        it('renumbers every item to its position in the submitted order', async () => {
            await service.reorderChecklist('tenant-1', 'task-1', ['item-c', 'item-a', 'item-b']);

            expect(db.projectTaskChecklistItem.update).toHaveBeenCalledWith({
                where: { id: 'item-c' },
                data: { sort_order: 0 },
            });
            expect(db.projectTaskChecklistItem.update).toHaveBeenCalledWith({
                where: { id: 'item-a' },
                data: { sort_order: 1 },
            });
            expect(db.projectTaskChecklistItem.update).toHaveBeenCalledWith({
                where: { id: 'item-b' },
                data: { sort_order: 2 },
            });
        });

        it('writes the whole sequence in one transaction', async () => {
            await service.reorderChecklist('tenant-1', 'task-1', ['item-c', 'item-a', 'item-b']);

            expect(db.$transaction).toHaveBeenCalledTimes(1);
            expect(db.$transaction.mock.calls[0][0]).toHaveLength(3);
        });

        // A partial order would renumber some items and leave the rest on their
        // old positions — two items sharing a sort_order, and `checklistItems`
        // only orders by sort_order, so the list would shuffle on every read.
        it('rejects an order that omits an item, without writing anything', async () => {
            await expect(
                service.reorderChecklist('tenant-1', 'task-1', ['item-c', 'item-a']),
            ).rejects.toBeInstanceOf(BadRequestException);

            expect(db.projectTaskChecklistItem.update).not.toHaveBeenCalled();
            expect(db.$transaction).not.toHaveBeenCalled();
        });

        it('rejects an order that repeats an item', async () => {
            await expect(
                service.reorderChecklist('tenant-1', 'task-1', ['item-a', 'item-a', 'item-b']),
            ).rejects.toBeInstanceOf(BadRequestException);

            expect(db.projectTaskChecklistItem.update).not.toHaveBeenCalled();
        });

        it('rejects an id that is not on this task', async () => {
            await expect(
                service.reorderChecklist('tenant-1', 'task-1', [
                    'item-a',
                    'item-b',
                    'item-from-another-task',
                ]),
            ).rejects.toBeInstanceOf(BadRequestException);

            expect(db.projectTaskChecklistItem.update).not.toHaveBeenCalled();
        });

        it('scopes the item lookup to the tenant and the task', async () => {
            await service.reorderChecklist('tenant-1', 'task-1', ['item-a', 'item-b', 'item-c']);

            expect(db.projectTaskChecklistItem.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ tenant_id: 'tenant-1', task_id: 'task-1' }),
                }),
            );
        });

        it('refuses a task from another tenant', async () => {
            db.projectTask.findFirst.mockResolvedValue(null);
            await expect(
                service.reorderChecklist('tenant-2', 'task-1', ['item-a']),
            ).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    it('scopes every task lookup to the tenant', async () => {
        db.projectTask.findFirst.mockResolvedValue(null);
        await expect(service.findOne('tenant-1', 'task-1')).rejects.toBeInstanceOf(NotFoundException);
        expect(db.projectTask.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ tenant_id: 'tenant-1' }),
            }),
        );
    });
});
