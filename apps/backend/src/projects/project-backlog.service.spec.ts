import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProjectBacklogService } from './project-backlog.service';
import { ProjectAccessService } from './project-access.service';
import { ProjectTasksService } from './project-tasks.service';
import { ProjectStoriesService } from './project-stories.service';
import { ProjectEpicsService } from './project-epics.service';
import { OWNER, accessDbMock } from './project-access.test-support';
import { DatabaseService } from '../database/database.service';

describe('ProjectBacklogService', () => {
    let service: ProjectBacklogService;
    let db: any;
    let tasks: { assertTask: jest.Mock; update: jest.Mock; bulkRemove: jest.Mock };
    let stories: { update: jest.Mock; remove: jest.Mock };
    let epics: { update: jest.Mock; remove: jest.Mock };

    beforeEach(async () => {
        db = {
            ...accessDbMock(),
            project: {
                findFirst: jest.fn().mockResolvedValue({ id: 'project-1', code: 'OTB', name: 'Online till' }),
                findMany: jest.fn().mockResolvedValue([{ id: 'project-1', code: 'OTB', name: 'Online till' }]),
            },
            projectEpic: {
                findMany: jest.fn().mockResolvedValue([{ id: 'epic-1' }]),
                findFirst: jest.fn().mockResolvedValue({ id: 'epic-1' }),
                update: jest.fn((args) => ({ op: 'epic', ...args })),
            },
            projectUserStory: {
                findMany: jest.fn().mockResolvedValue([{ id: 'story-1', status: 'READY' }]),
                findFirst: jest.fn().mockResolvedValue({ id: 'story-1', epic_id: 'epic-1' }),
                update: jest.fn((args) => ({ op: 'story', ...args })),
            },
            projectTask: {
                findMany: jest.fn().mockResolvedValue([
                    {
                        id: 'task-1',
                        project_id: 'project-1',
                        reference: 7,
                        user_story_id: 'story-1',
                        estimate_hours: '4.50',
                        remaining_hours: null,
                        status: { category: 'IN_PROGRESS' },
                    },
                ]),
                update: jest.fn((args) => ({ op: 'task', ...args })),
            },
            projectTimeEntry: {
                groupBy: jest.fn().mockResolvedValue([{ task_id: 'task-1', _sum: { hours: '2.25' } }]),
            },
            $transaction: jest.fn().mockResolvedValue([]),
        };
        tasks = {
            assertTask: jest.fn().mockResolvedValue({
                id: 'task-1',
                project_id: 'project-1',
                user_story_id: 'story-1',
                parent_task_id: null,
            }),
            update: jest.fn().mockResolvedValue({}),
            bulkRemove: jest.fn().mockResolvedValue({ deleted: 1, skipped: 0 }),
        };
        stories = { update: jest.fn().mockResolvedValue({}), remove: jest.fn().mockResolvedValue({}) };
        epics = { update: jest.fn().mockResolvedValue({}), remove: jest.fn().mockResolvedValue({}) };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ProjectBacklogService,
                ProjectAccessService,
                { provide: DatabaseService, useValue: db },
                { provide: ProjectTasksService, useValue: tasks },
                { provide: ProjectStoriesService, useValue: stories },
                { provide: ProjectEpicsService, useValue: epics },
            ],
        }).compile();

        service = module.get(ProjectBacklogService);
    });

    describe('get', () => {
        it('returns epics, stories and top-level tasks as flat rows, with keys and logged hours', async () => {
            const result: any = await service.get(OWNER, 'project-1');

            expect(result.project.code).toBe('OTB');
            expect(result.epics).toEqual([{ id: 'epic-1' }]);
            expect(result.tasks[0]).toMatchObject({
                key: 'OTB-7',
                estimate_hours: 4.5,
                remaining_hours: null,
                logged_hours: 2.25,
            });
        });

        it('leaves subtasks and deleted tasks out, orders by backlog order, and scopes every read to the tenant', async () => {
            await service.get(OWNER, 'project-1');

            const call = db.projectTask.findMany.mock.calls.at(-1)[0];
            const taskWhere = JSON.stringify(call.where);
            expect(taskWhere).toContain('"parent_task_id":null');
            expect(taskWhere).toContain('"deleted_at":null');
            expect(taskWhere).toContain('"tenant_id":"tenant-1"');
            expect(call.orderBy).toEqual([{ backlog_order: 'asc' }, { reference: 'asc' }]);
            expect(db.projectEpic.findMany.mock.calls[0][0].where).toEqual({
                tenant_id: 'tenant-1',
                project_id: { in: ['project-1'] },
            });
        });

        it("brings a stale story's status in line with its tasks before reading", async () => {
            await service.get(OWNER, 'project-1');

            expect(db.projectUserStory.update).toHaveBeenCalledWith({
                where: { id: 'story-1' },
                data: { status: 'IN_PROGRESS' },
            });
        });

        it('reports a project that is not there as missing', async () => {
            db.project.findFirst.mockResolvedValue(null);
            await expect(service.get(OWNER, 'project-x')).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe('list', () => {
        it('reads only projects with scope, and only tasks filed under a story', async () => {
            const result: any = await service.list(OWNER);

            expect(result.projects).toHaveLength(1);
            expect(JSON.stringify(db.project.findMany.mock.calls[0][0].where)).toContain('"epics":{"some":{}}');
            expect(JSON.stringify(db.projectTask.findMany.mock.calls[0][0].where)).toContain(
                '"user_story_id":{"not":null}',
            );
        });

        it('reads nothing more when no project has scope', async () => {
            db.project.findMany.mockResolvedValue([]);
            const result: any = await service.list(OWNER);
            expect(result).toEqual({ projects: [], epics: [], stories: [], tasks: [] });
            expect(db.projectTask.findMany).not.toHaveBeenCalled();
        });
    });

    describe('reorderScope', () => {
        it('writes the new order of the epics, ignoring ids that are not this project’s', async () => {
            db.projectEpic.findMany.mockResolvedValue([{ id: 'epic-1' }, { id: 'epic-2' }]);

            await service.reorderScope(OWNER, 'project-1', {
                kind: 'epic',
                id: 'epic-2',
                orderedIds: ['epic-2', 'epic-foreign', 'epic-1'],
            });

            const writes = db.$transaction.mock.calls[0][0];
            expect(writes.map((w: any) => [w.where.id, w.data.sort_order])).toEqual([
                ['epic-2', 0],
                ['epic-1', 1],
            ]);
        });

        it('refuses to put an epic under anything', async () => {
            await expect(
                service.reorderScope(OWNER, 'project-1', {
                    kind: 'epic',
                    id: 'epic-1',
                    parentId: 'epic-2',
                    orderedIds: [],
                }),
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it('moves a story to another epic through the story service, then orders that epic', async () => {
            db.projectUserStory.findMany.mockResolvedValue([{ id: 'story-9' }, { id: 'story-1' }]);

            await service.reorderScope(OWNER, 'project-1', {
                kind: 'story',
                id: 'story-1',
                parentId: 'epic-2',
                orderedIds: ['story-1', 'story-9'],
            });

            expect(stories.update).toHaveBeenCalledWith(OWNER, 'story-1', { epicId: 'epic-2' });
            expect(db.projectUserStory.findMany.mock.calls.at(-1)[0].where).toMatchObject({ epic_id: 'epic-2' });
            const writes = db.$transaction.mock.calls[0][0];
            expect(writes.map((w: any) => w.where.id)).toEqual(['story-1', 'story-9']);
        });

        it('takes a story out of its epic when the parent is null', async () => {
            db.projectUserStory.findMany.mockResolvedValue([{ id: 'story-1' }]);
            await service.reorderScope(OWNER, 'project-1', {
                kind: 'story',
                id: 'story-1',
                parentId: null,
                orderedIds: ['story-1'],
            });
            expect(stories.update).toHaveBeenCalledWith(OWNER, 'story-1', { epicId: '' });
        });

        it('does not touch the epic on a plain reorder', async () => {
            db.projectUserStory.findMany.mockResolvedValue([{ id: 'story-1' }]);
            await service.reorderScope(OWNER, 'project-1', { kind: 'story', id: 'story-1', orderedIds: ['story-1'] });
            expect(stories.update).not.toHaveBeenCalled();
        });

        it('reports a story from another project as missing', async () => {
            db.projectUserStory.findFirst.mockResolvedValue(null);
            await expect(
                service.reorderScope(OWNER, 'project-1', { kind: 'story', id: 'story-x', orderedIds: [] }),
            ).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe('reorderTasks', () => {
        it('moves a task to another story through the task service, then writes its backlog order', async () => {
            db.projectTask.findMany.mockResolvedValue([{ id: 'task-2' }, { id: 'task-1' }]);

            await service.reorderTasks(OWNER, 'project-1', {
                id: 'task-1',
                parentId: 'story-2',
                orderedIds: ['task-1', 'task-2'],
            });

            expect(tasks.update).toHaveBeenCalledWith(OWNER, 'task-1', { userStoryId: 'story-2' });
            const writes = db.$transaction.mock.calls[0][0];
            expect(writes.map((w: any) => [w.where.id, w.data.backlog_order])).toEqual([
                ['task-1', 0],
                ['task-2', 1],
            ]);
        });

        it('keeps members the page did not list, after the listed ones', async () => {
            db.projectTask.findMany.mockResolvedValue([{ id: 'task-1' }, { id: 'task-new' }]);
            await service.reorderTasks(OWNER, 'project-1', { id: 'task-1', orderedIds: ['task-1'] });
            const writes = db.$transaction.mock.calls[0][0];
            expect(writes.map((w: any) => w.where.id)).toEqual(['task-1', 'task-new']);
        });

        it('refuses a subtask', async () => {
            tasks.assertTask.mockResolvedValue({ id: 'task-1', project_id: 'project-1', parent_task_id: 'task-0' });
            await expect(
                service.reorderTasks(OWNER, 'project-1', { id: 'task-1', orderedIds: [] }),
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it('reports a task from another project as missing', async () => {
            tasks.assertTask.mockResolvedValue({ id: 'task-1', project_id: 'project-2', parent_task_id: null });
            await expect(
                service.reorderTasks(OWNER, 'project-1', { id: 'task-1', orderedIds: [] }),
            ).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe('bulkScope', () => {
        it('applies a story status row by row and reports the rows that refuse', async () => {
            stories.update
                .mockResolvedValueOnce({})
                .mockRejectedValueOnce(new BadRequestException("This story's status follows its tasks"));

            const result = await service.bulkScope(OWNER, 'project-1', {
                kind: 'story',
                ids: ['story-1', 'story-2'],
                action: 'status',
                value: 'READY',
            });

            expect(result.updated).toBe(1);
            expect(result.skipped).toEqual([{ id: 'story-2', reason: "This story's status follows its tasks" }]);
        });

        it('moves stories out of their epic', async () => {
            await service.bulkScope(OWNER, 'project-1', {
                kind: 'story',
                ids: ['story-1'],
                action: 'epic',
                value: null,
            });
            expect(stories.update).toHaveBeenCalledWith(OWNER, 'story-1', { epicId: '' });
        });

        it('deletes epics through the epic service', async () => {
            await service.bulkScope(OWNER, 'project-1', { kind: 'epic', ids: ['epic-1'], action: 'delete' });
            expect(epics.remove).toHaveBeenCalledWith(OWNER, 'epic-1');
        });

        it('refuses a status that is not an epic status before touching any row', async () => {
            await expect(
                service.bulkScope(OWNER, 'project-1', { kind: 'epic', ids: ['epic-1'], action: 'status', value: 'READY' }),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(epics.update).not.toHaveBeenCalled();
        });

        it('refuses to move an epic to an epic', async () => {
            await expect(
                service.bulkScope(OWNER, 'project-1', { kind: 'epic', ids: ['epic-1'], action: 'epic', value: null }),
            ).rejects.toBeInstanceOf(BadRequestException);
        });
    });

    describe('bulkTasks', () => {
        it('sets a column on each task through the task service', async () => {
            const result = await service.bulkTasks(OWNER, 'project-1', {
                ids: ['task-1'],
                action: 'status',
                value: 'status-done',
            });
            expect(tasks.update).toHaveBeenCalledWith(OWNER, 'task-1', { statusId: 'status-done' });
            expect(result).toEqual({ updated: 1, skipped: [] });
        });

        it('assigns to an employee and clears the user assignee', async () => {
            const employeeId = '11111111-2222-4333-8444-555555555555';
            await service.bulkTasks(OWNER, 'project-1', {
                ids: ['task-1'],
                action: 'assignee',
                value: `employee:${employeeId}`,
            });
            expect(tasks.update).toHaveBeenCalledWith(OWNER, 'task-1', {
                assigneeEmployeeId: employeeId,
                assigneeId: '',
            });
        });

        it('deletes only this project’s tasks, in one call', async () => {
            db.projectTask.findMany.mockResolvedValue([{ id: 'task-1' }]);
            const result = await service.bulkTasks(OWNER, 'project-1', {
                ids: ['task-1', 'task-other'],
                action: 'delete',
            });
            expect(tasks.bulkRemove).toHaveBeenCalledWith(OWNER, ['task-1']);
            expect(result.skipped).toEqual([{ id: 'task-other', reason: 'Task not found' }]);
        });

        it('skips a task from another project instead of changing it', async () => {
            tasks.assertTask.mockResolvedValue({ id: 'task-1', project_id: 'project-2' });
            const result = await service.bulkTasks(OWNER, 'project-1', {
                ids: ['task-1'],
                action: 'priority',
                value: 'HIGH',
            });
            expect(tasks.update).not.toHaveBeenCalled();
            expect(result.skipped).toHaveLength(1);
        });
    });
});
