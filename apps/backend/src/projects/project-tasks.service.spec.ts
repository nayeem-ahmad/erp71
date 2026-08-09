import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProjectTasksService } from './project-tasks.service';
import { ProjectSettingsService } from './project-settings.service';
import { RemainingHoursService } from './remaining-hours.service';
import { ProjectActivityService } from './project-activity.service';
import { DatabaseService } from '../database/database.service';

describe('ProjectTasksService', () => {
    let service: ProjectTasksService;
    let db: any;
    let remaining: { write: jest.Mock; history: jest.Mock };
    let activity: { record: jest.Mock; watch: jest.Mock; notifyWatchers: jest.Mock };

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
        activity = {
            record: jest.fn().mockResolvedValue(null),
            watch: jest.fn().mockResolvedValue(null),
            notifyWatchers: jest.fn().mockResolvedValue(0),
        };

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
            user: { findFirst: jest.fn().mockResolvedValue({ name: 'Karim', email: 'k@x.com' }) },
            employee: { findFirst: jest.fn().mockResolvedValue({ name: 'Rahim Uddin' }) },
            projectLabel: {
                count: jest.fn().mockResolvedValue(0),
                findMany: jest.fn().mockResolvedValue([]),
            },
            projectTaskLabel: {
                deleteMany: jest.fn(),
                createMany: jest.fn(),
                count: jest.fn().mockResolvedValue(0),
            },
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
                { provide: ProjectActivityService, useValue: activity },
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

    describe('labels', () => {
        it('replaces the whole set: clears first, then writes what was sent', async () => {
            db.projectLabel.count.mockResolvedValue(2);

            await service.update('tenant-1', 'user-1', 'task-1', {
                labelIds: ['label-a', 'label-b'],
            } as never);

            expect(db.projectTaskLabel.deleteMany).toHaveBeenCalledWith({
                where: { task_id: 'task-1' },
            });
            expect(db.projectTaskLabel.createMany).toHaveBeenCalledWith({
                data: [
                    { tenant_id: 'tenant-1', task_id: 'task-1', label_id: 'label-a' },
                    { tenant_id: 'tenant-1', task_id: 'task-1', label_id: 'label-b' },
                ],
            });
        });

        it('clears every label when sent an empty array', async () => {
            await service.update('tenant-1', 'user-1', 'task-1', { labelIds: [] } as never);

            expect(db.projectTaskLabel.deleteMany).toHaveBeenCalled();
            expect(db.projectTaskLabel.createMany).not.toHaveBeenCalled();
        });

        it('leaves the labels alone when the field is absent', async () => {
            // PATCH semantics: undefined means "do not touch", which must not be
            // confused with the empty array that means "remove them all".
            await service.update('tenant-1', 'user-1', 'task-1', { title: 'Renamed' } as never);

            expect(db.projectTaskLabel.deleteMany).not.toHaveBeenCalled();
        });

        // The join table carries a tenant_id but nothing validates it on write,
        // so an unchecked id would let one tenant tag with another's label.
        it('refuses a label id that is not this tenant’s', async () => {
            db.projectLabel.count.mockResolvedValue(1);

            await expect(
                service.update('tenant-1', 'user-1', 'task-1', {
                    labelIds: ['label-a', 'label-from-another-tenant'],
                } as never),
            ).rejects.toBeInstanceOf(BadRequestException);

            expect(db.projectTaskLabel.createMany).not.toHaveBeenCalled();
        });

        it('scopes the label check to the tenant', async () => {
            db.projectLabel.count.mockResolvedValue(1);
            await service.update('tenant-1', 'user-1', 'task-1', {
                labelIds: ['label-a'],
            } as never);

            expect(db.projectLabel.count).toHaveBeenCalledWith({
                where: { tenant_id: 'tenant-1', id: { in: ['label-a'] } },
            });
        });

        it('de-duplicates a repeated id rather than violating the primary key', async () => {
            db.projectLabel.count.mockResolvedValue(1);

            await service.update('tenant-1', 'user-1', 'task-1', {
                labelIds: ['label-a', 'label-a'],
            } as never);

            expect(db.projectTaskLabel.createMany).toHaveBeenCalledWith({
                data: [{ tenant_id: 'tenant-1', task_id: 'task-1', label_id: 'label-a' }],
            });
        });

        it('tags a task on create', async () => {
            db.projectLabel.count.mockResolvedValue(1);

            await service.create('tenant-1', 'user-1', {
                projectId: 'project-1',
                title: 'Wire the panel',
                labelIds: ['label-a'],
            } as never);

            expect(db.projectTaskLabel.createMany).toHaveBeenCalledWith({
                data: [{ tenant_id: 'tenant-1', task_id: 'task-new', label_id: 'label-a' }],
            });
        });
    });

    describe('dates', () => {
        it('stores a start date', async () => {
            await service.update('tenant-1', 'user-1', 'task-1', {
                startDate: '2026-08-05',
            } as never);

            expect(db.projectTask.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ start_date: new Date('2026-08-05') }),
                }),
            );
        });

        // '' is the only way to express "no date" over PATCH, where undefined
        // already means "leave alone".
        it('clears a date when sent an empty string', async () => {
            await service.update('tenant-1', 'user-1', 'task-1', { dueDate: '' } as never);

            expect(db.projectTask.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ due_date: null }) }),
            );
        });

        it('leaves a date alone when the field is absent', async () => {
            await service.update('tenant-1', 'user-1', 'task-1', { title: 'Renamed' } as never);

            const data = db.projectTask.update.mock.calls.at(-1)[0].data;
            expect(data).not.toHaveProperty('due_date');
            expect(data).not.toHaveProperty('start_date');
        });
    });

    describe('activity', () => {
        it('records the creation and subscribes the creator', async () => {
            await service.create('tenant-1', 'user-1', {
                projectId: 'project-1',
                title: 'Wire the panel',
            } as never);

            expect(activity.record).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'CREATED', actorId: 'user-1' }),
            );
            expect(activity.watch).toHaveBeenCalledWith('tenant-1', 'task-new', 'user-1');
        });

        it('subscribes whoever the new task lands on', async () => {
            await service.create('tenant-1', 'user-1', {
                projectId: 'project-1',
                title: 'Wire the panel',
                assigneeId: 'user-2',
            } as never);

            expect(activity.watch).toHaveBeenCalledWith('tenant-1', 'task-new', 'user-2');
        });

        it('records a rename with both sides', async () => {
            db.projectTask.findFirst.mockResolvedValue(task({ title: 'Old name' }));

            await service.update('tenant-1', 'user-1', 'task-1', { title: 'New name' } as never);

            expect(activity.record).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'RENAMED',
                    data: { from: 'Old name', to: 'New name' },
                }),
            );
        });

        // Otherwise every save writes "renamed it from X to X" and the feed
        // becomes unreadable.
        it('records nothing when a field is sent unchanged', async () => {
            db.projectTask.findFirst.mockResolvedValue(task({ title: 'Same' }));

            await service.update('tenant-1', 'user-1', 'task-1', { title: 'Same' } as never);

            expect(activity.record).not.toHaveBeenCalled();
        });

        it('records a status change with the column names, not their ids', async () => {
            db.projectTaskStatus.findFirst.mockResolvedValue({
                id: doing.id,
                name: 'In Progress',
                category: doing.category,
            });

            await service.update('tenant-1', 'user-1', 'task-1', { statusId: doing.id } as never);

            expect(activity.record).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'STATUS_CHANGED' }),
            );
        });

        it('records an assignment and notifies, naming the new holder', async () => {
            await service.update('tenant-1', 'user-1', 'task-1', {
                assigneeId: 'user-2',
            } as never);

            expect(activity.record).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'ASSIGNED', data: { to: 'Karim' } }),
            );
            expect(activity.watch).toHaveBeenCalledWith('tenant-1', 'task-1', 'user-2');
            expect(activity.notifyWatchers).toHaveBeenCalled();
        });

        it('records an unassignment as a null target rather than skipping it', async () => {
            db.projectTask.findFirst.mockResolvedValue(task({ assignee_id: 'user-2' }));

            await service.update('tenant-1', 'user-1', 'task-1', { assigneeId: '' } as never);

            expect(activity.record).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'ASSIGNED', data: { to: null } }),
            );
        });

        it('records a re-estimate with both numbers', async () => {
            await service.update('tenant-1', 'user-1', 'task-1', { remainingHours: 2 } as never);

            expect(activity.record).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'RE_ESTIMATED', data: { from: 5, to: 2 } }),
            );
        });

        it('records a move and tells the watchers', async () => {
            db.projectTaskStatus.findFirst.mockResolvedValue({
                id: doing.id,
                name: 'In Progress',
                category: doing.category,
            });

            await service.move('tenant-1', 'user-1', 'task-1', {
                statusId: doing.id,
                sortOrder: 0,
            } as never);

            expect(activity.record).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'STATUS_CHANGED' }),
            );
            expect(activity.notifyWatchers).toHaveBeenCalledWith(
                expect.objectContaining({ actorId: 'user-1' }),
            );
        });

        // Reordering within a column is not news.
        it('records nothing when a card is dropped back in the same column', async () => {
            await service.move('tenant-1', 'user-1', 'task-1', {
                statusId: todo.id,
                sortOrder: 2,
            } as never);

            expect(activity.record).not.toHaveBeenCalled();
            expect(activity.notifyWatchers).not.toHaveBeenCalled();
        });
    });

    describe('per-project columns and covers', () => {
        // Columns belong to a project now, so a status id from another board
        // would put the card somewhere nobody on this one can see.
        it('refuses a column that belongs to another project', async () => {
            db.projectTaskStatus.findFirst.mockResolvedValue({
                ...todo,
                name: 'To Do',
                project_id: 'project-other',
            });

            await expect(
                service.create('tenant-1', 'user-1', {
                    projectId: 'project-1',
                    title: 'Wrong board',
                    statusId: todo.id,
                } as never),
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it('accepts a template column, which belongs to no project', async () => {
            db.projectTaskStatus.findFirst.mockResolvedValue({
                ...todo,
                name: 'To Do',
                project_id: null,
            });

            await expect(
                service.create('tenant-1', 'user-1', {
                    projectId: 'project-1',
                    title: 'Fine',
                    statusId: todo.id,
                } as never),
            ).resolves.toBeDefined();
        });

        it('stores a cover colour', async () => {
            await service.update('tenant-1', 'user-1', 'task-1', { coverColor: 'BLUE' } as never);

            expect(db.projectTask.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ cover_color: 'BLUE' }),
                }),
            );
        });

        it('removes a cover with an empty string, the PATCH-clearing convention', async () => {
            await service.update('tenant-1', 'user-1', 'task-1', { coverColor: '' } as never);

            expect(db.projectTask.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ cover_color: null }),
                }),
            );
        });

        it('leaves the cover alone when the field is absent', async () => {
            await service.update('tenant-1', 'user-1', 'task-1', { title: 'Renamed' } as never);

            const data = db.projectTask.update.mock.calls.at(-1)[0].data;
            expect(data).not.toHaveProperty('cover_color');
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
