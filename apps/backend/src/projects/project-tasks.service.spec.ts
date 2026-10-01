import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProjectTasksService } from './project-tasks.service';
import { ProjectSettingsService } from './project-settings.service';
import { RemainingHoursService } from './remaining-hours.service';
import { ProjectActivityService } from './project-activity.service';
import { ProjectAccessService } from './project-access.service';
import { BoardColumnsService } from './board-columns.service';
import { BurndownRecorder } from './burndown-recorder.service';
import { SprintMembershipService } from './sprint-membership.service';
import { OWNER, narrow, ownTaskOr, staff, visibilityOr } from './project-access.test-support';
import { DatabaseService } from '../database/database.service';

describe('ProjectTasksService', () => {
    let service: ProjectTasksService;
    let db: any;
    let remaining: { write: jest.Mock; history: jest.Mock };
    let activity: { record: jest.Mock; watch: jest.Mock; notifyWatchers: jest.Mock };
    let settings: { defaultTaskStatus: jest.Mock; listTaskStatuses: jest.Mock };
    let boardColumns: { bindProject: jest.Mock };
    let burndown: { record: jest.Mock };
    let membership: { moveTasks: jest.Mock };

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
        settings = {
            defaultTaskStatus: jest.fn().mockResolvedValue(todo),
            listTaskStatuses: jest.fn().mockResolvedValue([todo, doing, done]),
        };
        boardColumns = { bindProject: jest.fn().mockResolvedValue(undefined) };
        burndown = { record: jest.fn().mockResolvedValue(undefined) };
        membership = { moveTasks: jest.fn().mockResolvedValue({ moved: 1, leftSprintIds: [] }) };

        db = {
            project: {
                findFirst: jest.fn().mockResolvedValue({ id: 'project-1' }),
                findMany: jest.fn().mockResolvedValue([]),
            },
            projectTask: {
                findFirst: jest.fn().mockResolvedValue(task()),
                findMany: jest.fn().mockResolvedValue([]),
                count: jest.fn().mockResolvedValue(0),
                create: jest.fn().mockResolvedValue({ id: 'task-new' }),
                update: jest.fn().mockResolvedValue({}),
                updateMany: jest.fn().mockResolvedValue({ count: 0 }),
                groupBy: jest.fn().mockResolvedValue([]),
            },
            projectTaskStatus: { findFirst: jest.fn().mockResolvedValue(todo) },
            user: {
                findFirst: jest.fn().mockResolvedValue({ name: 'Karim', email: 'k@x.com' }),
                findMany: jest.fn().mockResolvedValue([]),
            },
            employee: {
                findFirst: jest.fn().mockResolvedValue({ name: 'Rahim Uddin' }),
                findMany: jest.fn().mockResolvedValue([]),
            },
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
                updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
            // The rows that carry a copy of the task's project, which a move
            // re-points. Read-only everywhere else in this spec.
            projectTimer: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
            projectTaskRemainingLog: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
            projectTaskActivity: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
            projectComment: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
            projectAttachment: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
            boardTask: { findMany: jest.fn().mockResolvedValue([]) },
            sprint: { findFirst: jest.fn().mockResolvedValue({ id: 'sprint-1', project_id: 'project-1' }) },
            projectUserStory: {
                findFirst: jest.fn().mockResolvedValue({ id: 'story-1', project_id: 'project-1' }),
                findMany: jest.fn().mockResolvedValue([]),
                update: jest.fn().mockResolvedValue({}),
            },
            userStorePermission: { findFirst: jest.fn().mockResolvedValue(null) },
            // Both forms: the interactive callback move() uses, and the array of
            // promises reorderChecklist() batches.
            $transaction: jest.fn(async (arg: any) =>
                typeof arg === 'function' ? arg(db) : Promise.all(arg),
            ),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ProjectTasksService,
                // The real access service against the same mock db: a stub here
                // would let a filter regression through unnoticed.
                ProjectAccessService,
                { provide: DatabaseService, useValue: db },
                { provide: RemainingHoursService, useValue: remaining },
                { provide: ProjectActivityService, useValue: activity },
                { provide: ProjectSettingsService, useValue: settings },
                { provide: BoardColumnsService, useValue: boardColumns },
                { provide: BurndownRecorder, useValue: burndown },
                { provide: SprintMembershipService, useValue: membership },
            ],
        }).compile();

        service = module.get(ProjectTasksService);
    });

    describe('create', () => {
        it('opens the remaining log at the estimate when none is given', async () => {
            await service.create(OWNER, {
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
            await service.create(OWNER, {
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
            await service.create(OWNER, {
                projectId: 'project-1',
                title: 'Call the client',
            } as never);

            expect(remaining.write).not.toHaveBeenCalled();
        });

        it('files the task under a user story of its own project', async () => {
            await service.create(OWNER, {
                projectId: 'project-1',
                title: 'Wire up the bKash callback',
                userStoryId: 'story-1',
            } as never);

            expect(db.projectTask.create.mock.calls[0][0].data).toMatchObject({
                user_story_id: 'story-1',
            });
        });

        it('refuses a user story belonging to another project', async () => {
            // Not merely wrong: the card would be counted into a backlog nobody
            // looking at this project's board can see.
            db.projectUserStory.findFirst.mockResolvedValue({
                id: 'story-1',
                project_id: 'project-other',
            });

            await expect(
                service.create(OWNER, {
                    projectId: 'project-1',
                    title: 'Wire up the bKash callback',
                    userStoryId: 'story-1',
                } as never),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(db.projectTask.create).not.toHaveBeenCalled();
        });

        it('refuses a story that does not exist', async () => {
            db.projectUserStory.findFirst.mockResolvedValue(null);

            await expect(
                service.create(OWNER, {
                    projectId: 'project-1',
                    title: 'Wire up the bKash callback',
                    userStoryId: 'story-gone',
                } as never),
            ).rejects.toBeInstanceOf(NotFoundException);
        });

        it('refuses a subtask of a subtask', async () => {
            db.projectTask.findFirst.mockResolvedValue(task({ parent_task_id: 'task-parent' }));

            await expect(
                service.create(OWNER, {
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

            await service.create(OWNER, {
                projectId: 'project-1',
                title: 'Borrowed into a shared sprint',
                sprintId: 'sprint-9',
            } as never);

            // Joined through the membership service, so the history opens too.
            expect(membership.moveTasks).toHaveBeenCalledWith(db, 'tenant-1', ['task-new'], 'sprint-9', 'REMOVED');
            expect(db.projectTask.create.mock.calls[0][0].data).not.toHaveProperty('sprint_id');
        });

        it('records the new task joining its sprint', async () => {
            await service.create(OWNER, { projectId: 'project-1', title: 'New', sprintId: 'sprint-1' } as never);
            expect(burndown.record).toHaveBeenCalledWith('tenant-1', ['sprint-1'], 'TASK_ADDED', 'task-new');
        });

        it('opens no sprint history for a task created in the backlog', async () => {
            await service.create(OWNER, { projectId: 'project-1', title: 'Backlog' } as never);
            expect(membership.moveTasks).not.toHaveBeenCalled();
        });

        it('still refuses a sprint from another tenant', async () => {
            db.sprint.findFirst.mockResolvedValue(null);

            await expect(
                service.create(OWNER, {
                    projectId: 'project-1',
                    title: 'Foreign sprint',
                    sprintId: 'sprint-x',
                } as never),
            ).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe('update', () => {
        it("moves its story along when a task's column changes", async () => {
            db.projectTask.findFirst.mockResolvedValue(task({ user_story_id: 'story-1' }));
            db.projectTaskStatus.findFirst.mockResolvedValue(done);
            db.projectUserStory.findMany.mockResolvedValue([{ id: 'story-1', status: 'READY' }]);
            db.projectTask.findMany.mockResolvedValue([{ user_story_id: 'story-1', status: done }]);

            await service.update(OWNER, 'task-1', { statusId: done.id } as never);

            expect(db.projectUserStory.update).toHaveBeenCalledWith({
                where: { id: 'story-1' },
                data: { status: 'DONE' },
            });
        });

        it('burns remaining to zero when a task reaches a Done column', async () => {
            db.projectTaskStatus.findFirst.mockResolvedValue(done);

            await service.update(OWNER, 'task-1', { statusId: done.id } as never);

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

            await service.update(OWNER, 'task-1', { statusId: doing.id } as never);

            // 8h estimated, 3h already logged → 5h genuinely left.
            expect(remaining.write).toHaveBeenCalledWith(
                expect.objectContaining({ newHours: 5, source: 'TASK_REOPENED' }),
            );
        });

        it('lets an explicit re-estimate win over the status-derived write', async () => {
            db.projectTaskStatus.findFirst.mockResolvedValue(done);

            await service.update(OWNER, 'task-1', {
                statusId: done.id,
                remainingHours: 4,
            } as never);

            expect(remaining.write).toHaveBeenCalledTimes(1);
            expect(remaining.write).toHaveBeenCalledWith(
                expect.objectContaining({ newHours: 4, source: 'RE_ESTIMATED' }),
            );
        });

        describe('estimating a task that has no remaining hours yet', () => {
            it('opens remaining at the estimate when nothing is logged', async () => {
                db.projectTask.findFirst.mockResolvedValue(task({ estimate_hours: null, remaining_hours: null }));
                db.projectTimeEntry.aggregate.mockResolvedValue({ _sum: { hours: null } });

                await service.update(OWNER, 'task-1', { estimateHours: 6 } as never);

                expect(remaining.write).toHaveBeenCalledWith(
                    expect.objectContaining({ previousHours: null, newHours: 6, source: 'RE_ESTIMATED' }),
                );
            });

            it('takes off hours already logged, as a reopen does', async () => {
                db.projectTask.findFirst.mockResolvedValue(task({ estimate_hours: null, remaining_hours: null }));

                await service.update(OWNER, 'task-1', { estimateHours: 8 } as never);

                // 3h logged in the fixture.
                expect(remaining.write).toHaveBeenCalledWith(expect.objectContaining({ newHours: 5 }));
            });

            it('opens a done task at zero', async () => {
                db.projectTask.findFirst.mockResolvedValue(
                    task({ status: done, status_id: done.id, estimate_hours: null, remaining_hours: null }),
                );

                await service.update(OWNER, 'task-1', { estimateHours: 8 } as never);

                expect(remaining.write).toHaveBeenCalledWith(expect.objectContaining({ newHours: 0 }));
            });

            it('leaves a task that already has remaining hours alone', async () => {
                await service.update(OWNER, 'task-1', { estimateHours: 20 } as never);
                expect(remaining.write).not.toHaveBeenCalled();
            });
        });

        it('does not touch remaining hours for an ordinary edit', async () => {
            await service.update(OWNER, 'task-1', { title: 'Renamed' } as never);
            expect(remaining.write).not.toHaveBeenCalled();
        });

        it('moves untouched remaining along with a changed estimate', async () => {
            db.projectTask.findFirst.mockResolvedValue(task({ estimate_hours: 8, remaining_hours: 8 }));

            await service.update(OWNER, 'task-1', { estimateHours: 12 } as never);

            expect(remaining.write).toHaveBeenCalledWith(
                expect.objectContaining({ previousHours: 8, newHours: 12, source: 'RE_ESTIMATED' }),
            );
        });

        it('leaves a remaining that has drifted from the estimate alone', async () => {
            // 8h estimate, 5h remaining — time was logged or someone re-estimated.
            await service.update(OWNER, 'task-1', { estimateHours: 12 } as never);
            expect(remaining.write).not.toHaveBeenCalled();
        });

        it('does not revive remaining on a done task when its estimate changes', async () => {
            db.projectTask.findFirst.mockResolvedValue(
                task({ status: done, status_id: done.id, estimate_hours: 8, remaining_hours: 8 }),
            );

            await service.update(OWNER, 'task-1', { estimateHours: 12 } as never);
            expect(remaining.write).not.toHaveBeenCalled();
        });

        it('carries the re-estimate note onto the log row', async () => {
            await service.update(OWNER, 'task-1', {
                remainingHours: 12,
                remainingNote: 'client added two more rooms',
            } as never);

            expect(remaining.write).toHaveBeenCalledWith(
                expect.objectContaining({ note: 'client added two more rooms' }),
            );
        });

        it('moves a task under a story, and an empty string takes it back out', async () => {
            await service.update(OWNER, 'task-1', { userStoryId: 'story-1' } as never);
            expect(db.projectTask.update.mock.calls[0][0].data).toMatchObject({
                user_story_id: 'story-1',
            });

            await service.update(OWNER, 'task-1', { userStoryId: '' } as never);
            expect(db.projectTask.update.mock.calls[1][0].data).toMatchObject({
                user_story_id: null,
            });
        });

        it('checks a reassigned story against the task’s project, not the request', async () => {
            db.projectUserStory.findFirst.mockResolvedValue({
                id: 'story-1',
                project_id: 'project-other',
            });

            await expect(
                service.update(OWNER, 'task-1', { userStoryId: 'story-1' } as never),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(db.projectTask.update).not.toHaveBeenCalled();
        });
    });

    describe('moving to another project', () => {
        // The project the task is moving to has columns of its own — none of
        // their ids is one the task has ever held.
        const target = {
            todo: { id: 'p2-todo', name: 'To Do', category: 'TODO', sort_order: 0, is_default: true },
            doing: { id: 'p2-doing', name: 'In Progress', category: 'IN_PROGRESS', sort_order: 1, is_default: false },
            review: { id: 'p2-review', name: 'In Review', category: 'IN_PROGRESS', sort_order: 2, is_default: false },
            done: { id: 'p2-done', name: 'Done', category: 'DONE', sort_order: 3, is_default: false },
        };

        const named = {
            todo: { id: 'status-todo', name: 'To Do', category: 'TODO' },
            review: { id: 'status-review', name: 'In Review', category: 'IN_PROGRESS' },
            blocked: { id: 'status-blocked', name: 'Blocked', category: 'IN_PROGRESS' },
            done: { id: 'status-done', name: 'Done', category: 'DONE' },
        };

        /** ERP-12, in the To Do column of its current project. */
        const moving = (overrides: Record<string, unknown> = {}) =>
            task({ reference: 12, title: 'Wire the panel', status: named.todo, status_id: named.todo.id, ...overrides });

        /**
         * One `findFirst` answers three questions here, told apart by what they
         * sort on: the task itself, the highest key in the new project, and the
         * last card of the column it lands in.
         */
        const lookups = (current: Record<string, unknown>, lastReference = 4, lastSortOrder = 2) =>
            db.projectTask.findFirst.mockImplementation(async (args: any) => {
                if (args?.orderBy?.reference) return { reference: lastReference };
                if (args?.orderBy?.sort_order) return { sort_order: lastSortOrder };
                return current;
            });

        const subtasksOf = (rows: Record<string, unknown>[]) =>
            db.projectTask.findMany.mockImplementation(async (args: any) =>
                args?.where?.parent_task_id ? rows : [],
            );

        const updateOf = (id: string) =>
            db.projectTask.update.mock.calls.find((call: any[]) => call[0].where.id === id)?.[0].data;

        const moveTo = (dto: Record<string, unknown> = {}, viewer = OWNER) =>
            service.update(viewer, 'task-1', { projectId: 'project-2', ...dto } as never);

        beforeEach(() => {
            lookups(moving());
            settings.listTaskStatuses.mockResolvedValue(Object.values(target));
            db.project.findFirst.mockResolvedValue({ id: 'project-2' });
            db.project.findMany.mockResolvedValue([
                { id: 'project-1', code: 'ERP', name: 'ERP71' },
                { id: 'project-2', code: 'CRM', name: 'Retail CRM' },
            ]);
        });

        it('files it at the end of the new project: next key, bottom of its column and of the backlog', async () => {
            await moveTo();

            expect(updateOf('task-1')).toMatchObject({
                project_id: 'project-2',
                reference: 5,
                backlog_order: 5,
                sort_order: 3,
            });
        });

        it('lands in the column of the same name on the new board', async () => {
            lookups(moving({ status: named.review, status_id: named.review.id }));

            await moveTo();

            // "In Progress" is the first column of the same category; the name wins.
            expect(updateOf('task-1')).toMatchObject({ status_id: target.review.id });
        });

        it('falls back to the default column when nothing on the new board fits', async () => {
            lookups(moving({ status: named.blocked, status_id: named.blocked.id }));
            settings.listTaskStatuses.mockResolvedValue([target.todo, target.done]);

            await moveTo();

            expect(updateOf('task-1')).toMatchObject({ status_id: target.todo.id });
        });

        it('keeps a finished task finished', async () => {
            const finishedAt = new Date('2026-09-20T10:00:00Z');
            lookups(moving({ status: named.done, status_id: named.done.id, completed_at: finishedAt, remaining_hours: 0 }));

            await moveTo();

            expect(updateOf('task-1')).toMatchObject({ status_id: target.done.id, completed_at: finishedAt });
            expect(remaining.write).not.toHaveBeenCalled();
        });

        it('reopens a done task on a board with no done column, burning from the new project', async () => {
            lookups(moving({ status: named.done, status_id: named.done.id, completed_at: new Date(), remaining_hours: 0 }));
            settings.listTaskStatuses.mockResolvedValue([target.todo, target.doing]);

            await moveTo();

            expect(updateOf('task-1')).toMatchObject({ status_id: target.todo.id, completed_at: null });
            expect(remaining.write).toHaveBeenCalledWith(
                expect.objectContaining({ projectId: 'project-2', source: 'TASK_REOPENED' }),
            );
        });

        it('leaves its user story and milestone, which belong to the old project', async () => {
            lookups(moving({ user_story_id: 'story-1', milestone_id: 'milestone-1' }));

            await moveTo();

            expect(updateOf('task-1')).toMatchObject({ user_story_id: null, milestone_id: null });
        });

        it('recomputes the status of the story it leaves', async () => {
            lookups(moving({ user_story_id: 'story-1' }));
            // What story-1 still holds once this task is gone: one finished task.
            db.projectTask.findMany.mockImplementation(async (args: any) =>
                args?.where?.user_story_id ? [{ user_story_id: 'story-1', status: { category: 'DONE' } }] : [],
            );
            db.projectUserStory.findMany.mockResolvedValue([{ id: 'story-1', status: 'IN_PROGRESS' }]);

            await moveTo();

            expect(db.projectUserStory.update).toHaveBeenCalledWith({
                where: { id: 'story-1' },
                data: { status: 'DONE' },
            });
        });

        it('checks a story sent with the move against the new project', async () => {
            db.projectUserStory.findFirst.mockResolvedValue({ id: 'story-9', project_id: 'project-2' });

            await moveTo({ userStoryId: 'story-9' });

            expect(updateOf('task-1')).toMatchObject({ project_id: 'project-2', user_story_id: 'story-9' });
        });

        it('refuses a project the viewer cannot see, before writing anything', async () => {
            db.project.findFirst.mockResolvedValue(null);

            await expect(moveTo({}, staff())).rejects.toBeInstanceOf(NotFoundException);
            expect(db.projectTask.update).not.toHaveBeenCalled();
        });

        it('refuses to move a subtask away from its parent', async () => {
            lookups(moving({ parent_task_id: 'task-0' }));

            await expect(moveTo()).rejects.toBeInstanceOf(BadRequestException);
            expect(db.projectTask.update).not.toHaveBeenCalled();
        });

        it('takes its subtasks along, each renumbered behind it', async () => {
            subtasksOf([
                { id: 'sub-1', reference: 13, status: named.review },
                { id: 'sub-2', reference: 14, status: named.todo },
            ]);

            await moveTo();

            expect(updateOf('sub-1')).toMatchObject({
                project_id: 'project-2',
                reference: 6,
                backlog_order: 6,
                status_id: target.review.id,
                user_story_id: null,
                milestone_id: null,
            });
            expect(updateOf('sub-2')).toMatchObject({
                project_id: 'project-2',
                reference: 7,
                status_id: target.todo.id,
            });
        });

        it('reopens a finished subtask the way it reopens its parent, when the new board has no done column', async () => {
            settings.listTaskStatuses.mockResolvedValue([target.todo, target.doing]);
            subtasksOf([
                {
                    id: 'sub-1',
                    reference: 13,
                    sprint_id: 'sprint-1',
                    estimate_hours: 4,
                    remaining_hours: 0,
                    status: named.done,
                },
            ]);

            await moveTo();

            expect(updateOf('sub-1')).toMatchObject({ status_id: target.todo.id, completed_at: null });
            // 4h estimated, 3h already logged → 1h left.
            expect(remaining.write).toHaveBeenCalledWith(
                expect.objectContaining({
                    taskId: 'sub-1',
                    projectId: 'project-2',
                    previousHours: 0,
                    newHours: 1,
                    source: 'TASK_REOPENED',
                }),
            );
        });

        it.each([
            ['projectTimeEntry', 'the hours logged on it'],
            ['projectTimer', 'a clock running on it'],
            ['projectTaskRemainingLog', 'its remaining-hours history'],
            ['projectTaskActivity', 'its feed'],
            ['projectComment', 'its comments'],
            ['projectAttachment', 'its attachments'],
        ])('carries %s along — %s', async (table) => {
            subtasksOf([{ id: 'sub-1', reference: 13, status: named.todo }]);

            await moveTo();

            expect(db[table].updateMany).toHaveBeenCalledWith({
                where: { tenant_id: 'tenant-1', task_id: { in: ['task-1', 'sub-1'] } },
                data: { project_id: 'project-2' },
            });
        });

        it("binds the new project's columns on every board the card is on", async () => {
            db.boardTask.findMany.mockResolvedValue([{ board_id: 'board-1' }, { board_id: 'board-2' }]);

            await moveTo();

            expect(boardColumns.bindProject).toHaveBeenCalledTimes(2);
            expect(boardColumns.bindProject).toHaveBeenCalledWith('tenant-1', 'board-1', 'project-2');
            expect(boardColumns.bindProject).toHaveBeenCalledWith('tenant-1', 'board-2', 'project-2');
        });

        it('records the move with both keys, and tells the watchers', async () => {
            await moveTo();

            expect(activity.record).toHaveBeenCalledWith({
                tenantId: 'tenant-1',
                taskId: 'task-1',
                projectId: 'project-2',
                actorId: 'user-1',
                type: 'PROJECT_CHANGED',
                data: { from: 'ERP-12', to: 'CRM-5', fromProject: 'ERP71', toProject: 'Retail CRM' },
            });
            expect(activity.notifyWatchers).toHaveBeenCalledWith(
                expect.objectContaining({
                    taskId: 'task-1',
                    body: 'Moved to Retail CRM as CRM-5',
                    link: '/projects/project-2',
                }),
            );
        });

        it('says nothing about the column when the new board has one of the same name', async () => {
            await moveTo();

            expect(activity.record).not.toHaveBeenCalledWith(
                expect.objectContaining({ type: 'STATUS_CHANGED' }),
            );
        });

        it('records the column change when the task lands in a differently named one', async () => {
            lookups(moving({ status: named.blocked, status_id: named.blocked.id }));
            settings.listTaskStatuses.mockResolvedValue([target.todo, target.done]);

            await moveTo();

            expect(activity.record).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'STATUS_CHANGED',
                    projectId: 'project-2',
                    data: { from: 'Blocked', to: 'To Do' },
                }),
            );
        });

        it('treats the project it is already in as no move at all', async () => {
            await service.update(OWNER, 'task-1', { projectId: 'project-1', title: 'Renamed' } as never);

            expect(updateOf('task-1')).not.toHaveProperty('reference');
            expect(updateOf('task-1')).not.toHaveProperty('project_id');
            expect(activity.record).not.toHaveBeenCalledWith(
                expect.objectContaining({ type: 'PROJECT_CHANGED' }),
            );
        });
    });

    describe('move', () => {
        it('renumbers the target column so ordering stays stable integers', async () => {
            db.projectTask.findMany.mockResolvedValue([{ id: 'task-a' }, { id: 'task-b' }]);

            await service.move(OWNER, 'task-1', {
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

            await service.move(OWNER, 'task-1', {
                statusId: todo.id,
                sortOrder: 99,
            } as never);

            const orders = db.projectTask.update.mock.calls.map((c: any[]) => c[0].where.id);
            expect(orders).toEqual(['task-a', 'task-1']);
        });

        it('burns to zero when a card is dragged into a Done column', async () => {
            db.projectTaskStatus.findFirst.mockResolvedValue(done);

            await service.move(OWNER, 'task-1', {
                statusId: done.id,
                sortOrder: 0,
            } as never);

            expect(remaining.write).toHaveBeenCalledWith(
                expect.objectContaining({ newHours: 0, source: 'TASK_COMPLETED' }),
            );
        });

        it('sends a card back to the backlog when asked to clear its sprint', async () => {
            await service.move(OWNER, 'task-1', {
                statusId: todo.id,
                sortOrder: 0,
                clearSprint: true,
            } as never);

            // Inside the move's transaction (the mock runs it against `db`).
            expect(membership.moveTasks).toHaveBeenCalledWith(db, 'tenant-1', ['task-1'], null, 'REMOVED');
            const moved = db.projectTask.update.mock.calls.find(
                (c: any[]) => c[0].where.id === 'task-1',
            );
            expect(moved[0].data).not.toHaveProperty('sprint_id');
        });

        it('moves a card dragged into another sprint lane through the membership service', async () => {
            await service.move(OWNER, 'task-1', { statusId: todo.id, sortOrder: 0, sprintId: 'sprint-2' } as never);
            expect(membership.moveTasks).toHaveBeenCalledWith(db, 'tenant-1', ['task-1'], 'sprint-2', 'REMOVED');
        });

        it('records the task leaving one sprint and joining the other', async () => {
            await service.move(OWNER, 'task-1', {
                statusId: todo.id,
                sortOrder: 0,
                sprintId: 'sprint-2',
            } as never);

            expect(burndown.record).toHaveBeenCalledWith('tenant-1', ['sprint-1'], 'TASK_REMOVED', 'task-1');
            expect(burndown.record).toHaveBeenCalledWith('tenant-1', ['sprint-2'], 'TASK_ADDED', 'task-1');
        });

        it('re-records the burndown on Done even when there were no hours to burn', async () => {
            // Nothing for the remaining log to write, yet the open-task count moved.
            db.projectTask.findFirst.mockResolvedValue(task({ remaining_hours: 0 }));
            db.projectTaskStatus.findFirst.mockResolvedValue(done);

            await service.move(OWNER, 'task-1', { statusId: done.id, sortOrder: 0 } as never);

            expect(burndown.record).toHaveBeenCalledWith('tenant-1', ['sprint-1', 'sprint-1'], 'STATUS_CHANGED', 'task-1');
        });
    });

    describe('burndown points', () => {
        it('re-records the sprint when a task is marked Done through an edit', async () => {
            db.projectTaskStatus.findFirst.mockResolvedValue(done);

            await service.update(OWNER, 'task-1', { statusId: done.id } as never);

            expect(burndown.record).toHaveBeenCalledWith('tenant-1', ['sprint-1', 'sprint-1'], 'STATUS_CHANGED', 'task-1');
        });

        it('takes a deleted task out of its sprint, closing its history', async () => {
            await service.remove(OWNER, 'task-1');
            expect(membership.moveTasks).toHaveBeenCalledWith(db, 'tenant-1', ['task-1'], null, 'REMOVED');
        });

        it('moves a task between sprints through the membership service on an edit', async () => {
            await service.update(OWNER, 'task-1', { sprintId: 'sprint-2' } as never);

            expect(membership.moveTasks).toHaveBeenCalledWith(db, 'tenant-1', ['task-1'], 'sprint-2', 'REMOVED');
            expect(db.projectTask.update.mock.calls[0][0].data).not.toHaveProperty('sprint_id');
            expect(burndown.record).toHaveBeenCalledWith('tenant-1', ['sprint-1'], 'TASK_REMOVED', 'task-1');
            expect(burndown.record).toHaveBeenCalledWith('tenant-1', ['sprint-2'], 'TASK_ADDED', 'task-1');
        });

        it('leaves membership alone when an edit names the sprint the task is already in', async () => {
            await service.update(OWNER, 'task-1', { sprintId: 'sprint-1', title: 'Renamed' } as never);
            expect(membership.moveTasks).not.toHaveBeenCalled();
        });

        it('re-records the sprint a deleted task was in', async () => {
            await service.remove(OWNER, 'task-1');

            expect(burndown.record).toHaveBeenCalledWith('tenant-1', ['sprint-1'], 'TASK_REMOVED', 'task-1');
        });
    });

    describe('labels', () => {
        it('replaces the whole set: clears first, then writes what was sent', async () => {
            db.projectLabel.count.mockResolvedValue(2);

            await service.update(OWNER, 'task-1', {
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
            await service.update(OWNER, 'task-1', { labelIds: [] } as never);

            expect(db.projectTaskLabel.deleteMany).toHaveBeenCalled();
            expect(db.projectTaskLabel.createMany).not.toHaveBeenCalled();
        });

        it('leaves the labels alone when the field is absent', async () => {
            // PATCH semantics: undefined means "do not touch", which must not be
            // confused with the empty array that means "remove them all".
            await service.update(OWNER, 'task-1', { title: 'Renamed' } as never);

            expect(db.projectTaskLabel.deleteMany).not.toHaveBeenCalled();
        });

        // The join table carries a tenant_id but nothing validates it on write,
        // so an unchecked id would let one tenant tag with another's label.
        it('refuses a label id that is not this tenant’s', async () => {
            db.projectLabel.count.mockResolvedValue(1);

            await expect(
                service.update(OWNER, 'task-1', {
                    labelIds: ['label-a', 'label-from-another-tenant'],
                } as never),
            ).rejects.toBeInstanceOf(BadRequestException);

            expect(db.projectTaskLabel.createMany).not.toHaveBeenCalled();
        });

        it('scopes the label check to the tenant', async () => {
            db.projectLabel.count.mockResolvedValue(1);
            await service.update(OWNER, 'task-1', {
                labelIds: ['label-a'],
            } as never);

            expect(db.projectLabel.count).toHaveBeenCalledWith({
                where: { tenant_id: 'tenant-1', id: { in: ['label-a'] } },
            });
        });

        it('de-duplicates a repeated id rather than violating the primary key', async () => {
            db.projectLabel.count.mockResolvedValue(1);

            await service.update(OWNER, 'task-1', {
                labelIds: ['label-a', 'label-a'],
            } as never);

            expect(db.projectTaskLabel.createMany).toHaveBeenCalledWith({
                data: [{ tenant_id: 'tenant-1', task_id: 'task-1', label_id: 'label-a' }],
            });
        });

        it('tags a task on create', async () => {
            db.projectLabel.count.mockResolvedValue(1);

            await service.create(OWNER, {
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
            await service.update(OWNER, 'task-1', {
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
            await service.update(OWNER, 'task-1', { dueDate: '' } as never);

            expect(db.projectTask.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ due_date: null }) }),
            );
        });

        it('leaves a date alone when the field is absent', async () => {
            await service.update(OWNER, 'task-1', { title: 'Renamed' } as never);

            const data = db.projectTask.update.mock.calls.at(-1)[0].data;
            expect(data).not.toHaveProperty('due_date');
            expect(data).not.toHaveProperty('start_date');
        });
    });

    describe('activity', () => {
        it('records the creation and subscribes the creator', async () => {
            await service.create(OWNER, {
                projectId: 'project-1',
                title: 'Wire the panel',
            } as never);

            expect(activity.record).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'CREATED', actorId: 'user-1' }),
            );
            expect(activity.watch).toHaveBeenCalledWith('tenant-1', 'task-new', 'user-1');
        });

        it('subscribes whoever the new task lands on', async () => {
            await service.create(OWNER, {
                projectId: 'project-1',
                title: 'Wire the panel',
                assigneeId: 'user-2',
            } as never);

            expect(activity.watch).toHaveBeenCalledWith('tenant-1', 'task-new', 'user-2');
        });

        it('records a rename with both sides', async () => {
            db.projectTask.findFirst.mockResolvedValue(task({ title: 'Old name' }));

            await service.update(OWNER, 'task-1', { title: 'New name' } as never);

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

            await service.update(OWNER, 'task-1', { title: 'Same' } as never);

            expect(activity.record).not.toHaveBeenCalled();
        });

        it('records a status change with the column names, not their ids', async () => {
            db.projectTaskStatus.findFirst.mockResolvedValue({
                id: doing.id,
                name: 'In Progress',
                category: doing.category,
            });

            await service.update(OWNER, 'task-1', { statusId: doing.id } as never);

            expect(activity.record).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'STATUS_CHANGED' }),
            );
        });

        it('records an assignment and notifies, naming the new holder', async () => {
            await service.update(OWNER, 'task-1', {
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

            await service.update(OWNER, 'task-1', { assigneeId: '' } as never);

            expect(activity.record).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'ASSIGNED', data: { to: null } }),
            );
        });

        it('records a re-estimate with both numbers', async () => {
            await service.update(OWNER, 'task-1', { remainingHours: 2 } as never);

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

            await service.move(OWNER, 'task-1', {
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
            await service.move(OWNER, 'task-1', {
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
                service.create(OWNER, {
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
                service.create(OWNER, {
                    projectId: 'project-1',
                    title: 'Fine',
                    statusId: todo.id,
                } as never),
            ).resolves.toBeDefined();
        });

        it('stores a cover colour', async () => {
            await service.update(OWNER, 'task-1', { coverColor: 'BLUE' } as never);

            expect(db.projectTask.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ cover_color: 'BLUE' }),
                }),
            );
        });

        it('removes a cover with an empty string, the PATCH-clearing convention', async () => {
            await service.update(OWNER, 'task-1', { coverColor: '' } as never);

            expect(db.projectTask.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ cover_color: null }),
                }),
            );
        });

        it('leaves the cover alone when the field is absent', async () => {
            await service.update(OWNER, 'task-1', { title: 'Renamed' } as never);

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
            await service.reorderChecklist(OWNER, 'task-1', ['item-c', 'item-a', 'item-b']);

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
            await service.reorderChecklist(OWNER, 'task-1', ['item-c', 'item-a', 'item-b']);

            expect(db.$transaction).toHaveBeenCalledTimes(1);
            expect(db.$transaction.mock.calls[0][0]).toHaveLength(3);
        });

        // A partial order would renumber some items and leave the rest on their
        // old positions — two items sharing a sort_order, and `checklistItems`
        // only orders by sort_order, so the list would shuffle on every read.
        it('rejects an order that omits an item, without writing anything', async () => {
            await expect(
                service.reorderChecklist(OWNER, 'task-1', ['item-c', 'item-a']),
            ).rejects.toBeInstanceOf(BadRequestException);

            expect(db.projectTaskChecklistItem.update).not.toHaveBeenCalled();
            expect(db.$transaction).not.toHaveBeenCalled();
        });

        it('rejects an order that repeats an item', async () => {
            await expect(
                service.reorderChecklist(OWNER, 'task-1', ['item-a', 'item-a', 'item-b']),
            ).rejects.toBeInstanceOf(BadRequestException);

            expect(db.projectTaskChecklistItem.update).not.toHaveBeenCalled();
        });

        it('rejects an id that is not on this task', async () => {
            await expect(
                service.reorderChecklist(OWNER, 'task-1', [
                    'item-a',
                    'item-b',
                    'item-from-another-task',
                ]),
            ).rejects.toBeInstanceOf(BadRequestException);

            expect(db.projectTaskChecklistItem.update).not.toHaveBeenCalled();
        });

        it('scopes the item lookup to the tenant and the task', async () => {
            await service.reorderChecklist(OWNER, 'task-1', ['item-a', 'item-b', 'item-c']);

            expect(db.projectTaskChecklistItem.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ tenant_id: 'tenant-1', task_id: 'task-1' }),
                }),
            );
        });

        it('refuses a task from another tenant', async () => {
            db.projectTask.findFirst.mockResolvedValue(null);
            await expect(
                service.reorderChecklist(staff('user-9', 'tenant-2'), 'task-1', ['item-a']),
            ).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe('sprint history on the card', () => {
        it('lists every sprint the task was in, oldest first, as sprintHistory', async () => {
            db.projectTask.findFirst.mockResolvedValue({
                ...task(),
                sprintMemberships: [
                    {
                        added_at: new Date('2026-08-02T03:00:00.000Z'),
                        removed_at: new Date('2026-08-13T18:00:00.000Z'),
                        outcome: 'CARRIED_OVER',
                        sprint: { id: 'sprint-7', name: 'Sprint 7', status: 'COMPLETED' },
                    },
                    {
                        added_at: new Date('2026-08-13T18:00:00.000Z'),
                        removed_at: null,
                        outcome: null,
                        sprint: { id: 'sprint-8', name: 'Sprint 8', status: 'ACTIVE' },
                    },
                ],
            });

            const result: any = await service.findOne(OWNER, 'task-1');

            expect(db.projectTask.findFirst.mock.calls.at(-1)[0].include.sprintMemberships).toMatchObject({
                orderBy: { added_at: 'asc' },
            });
            expect(result.sprintHistory.map((row: any) => row.sprint.name)).toEqual(['Sprint 7', 'Sprint 8']);
            expect(result.sprintHistory[0].outcome).toBe('CARRIED_OVER');
            expect(result).not.toHaveProperty('sprintMemberships');
        });
    });

    describe('list filters', () => {
        const whereOf = () => db.projectTask.findMany.mock.calls.at(-1)[0].where;

        it('narrows to tasks nobody holds — both columns, not just the user one', async () => {
            await service.list(OWNER, { unassigned: 'true' } as never);

            expect(whereOf()).toMatchObject({ assignee_id: null, assignee_employee_id: null });
        });

        it('leaves the assignee columns alone unless the flag is really set', async () => {
            await service.list(OWNER, { unassigned: 'false' } as never);

            expect(whereOf()).not.toHaveProperty('assignee_id');
            expect(whereOf()).not.toHaveProperty('assignee_employee_id');
        });

        it('lets "unassigned" win over an assignee sent alongside it', async () => {
            // The two together describe no task at all. Answering with the more
            // specific of the two beats returning an empty list nobody asked for.
            await service.list(OWNER, {
                assigneeId: 'user-9',
                unassigned: 'true',
            } as never);

            expect(whereOf().assignee_id).toBeNull();
        });

        describe('by sprint', () => {
            it('takes the tasks in the sprint now, and those whose stay in it ended other than by removal', async () => {
                await service.list(OWNER, { sprintId: 'sprint-7' } as never);

                expect(whereOf()).not.toHaveProperty('sprint_id');
                expect(whereOf().AND).toContainEqual({
                    OR: [
                        { sprint_id: 'sprint-7' },
                        {
                            sprintMemberships: {
                                some: {
                                    sprint_id: 'sprint-7',
                                    removed_at: { not: null },
                                    outcome: { in: ['DONE', 'CARRIED_OVER', 'RETURNED_TO_BACKLOG'] },
                                },
                            },
                        },
                    ],
                });
            });

            it("gives each task its latest stay in that sprint, with where a carried task went", async () => {
                // The list also draws each row's remaining sparkline from a raw query.
                db.$queryRaw = jest.fn().mockResolvedValue([]);
                db.projectTask.findMany.mockResolvedValue([
                    {
                        id: 'task-1',
                        sprintMemberships: [
                            {
                                outcome: 'CARRIED_OVER',
                                removed_at: new Date('2026-08-13T18:00:00.000Z'),
                                remaining_at_close: 5,
                                carried_to: { id: 'sprint-8', name: 'Sprint 8' },
                            },
                        ],
                    },
                    { id: 'task-2', sprintMemberships: [] },
                ]);

                const result = await service.list(OWNER, { sprintId: 'sprint-7' } as never);

                const include = db.projectTask.findMany.mock.calls.at(-1)[0].include;
                expect(include.sprintMemberships).toMatchObject({
                    where: { sprint_id: 'sprint-7' },
                    orderBy: { added_at: 'desc' },
                    take: 1,
                });
                expect(result.items[0]).toMatchObject({
                    sprintMembership: {
                        outcome: 'CARRIED_OVER',
                        remaining_at_close: 5,
                        carried_to: { id: 'sprint-8', name: 'Sprint 8' },
                    },
                });
                expect(result.items[0]).not.toHaveProperty('sprintMemberships');
                expect(result.items[1].sprintMembership).toBeNull();
            });

            it('asks for no history when no sprint is named', async () => {
                await service.list(OWNER, {} as never);
                expect(db.projectTask.findMany.mock.calls.at(-1)[0].include).not.toHaveProperty('sprintMemberships');
            });
        });

        it('filters on priority', async () => {
            await service.list(OWNER, { priority: 'URGENT' } as never);

            expect(whereOf()).toMatchObject({ priority: 'URGENT' });
        });

        it('filters to the tasks under one story', async () => {
            await service.list(OWNER, { userStoryId: 'story-1' } as never);

            expect(whereOf()).toMatchObject({ user_story_id: 'story-1' });
        });

        it('narrows to what the backlog grooming missed', async () => {
            await service.list(OWNER, { noUserStory: 'true' } as never);

            expect(whereOf().user_story_id).toBeNull();
        });

        it('lets "no story" win over a story id sent alongside it', async () => {
            await service.list(OWNER, {
                userStoryId: 'story-1',
                noUserStory: 'true',
            } as never);

            expect(whereOf().user_story_id).toBeNull();
        });

        it('measures a created-day range in the workspace zone, not the server’s', async () => {
            await service.list(
                { ...OWNER, timezone: 'Asia/Dhaka' },
                { createdFrom: '2026-08-19', createdTo: '2026-08-19' } as never,
            );

            expect(whereOf().created_at).toEqual({
                gte: new Date('2026-08-18T18:00:00.000Z'),
                lte: new Date('2026-08-19T17:59:59.999Z'),
            });
        });

        it('adds no created filter when neither bound is given', async () => {
            await service.list(OWNER, {} as never);

            expect(whereOf()).not.toHaveProperty('created_at');
        });
    });

    describe('listAssignees', () => {
        it('names both kinds of holder under one key space', async () => {
            db.projectTask.groupBy
                .mockResolvedValueOnce([{ assignee_id: 'user-9' }])
                .mockResolvedValueOnce([{ assignee_employee_id: 'emp-3' }]);
            db.user.findMany.mockResolvedValue([
                { id: 'user-9', name: 'Karim', email: 'karim@acme.test' },
            ]);
            db.employee.findMany.mockResolvedValue([
                { id: 'emp-3', name: 'Rahim Uddin', employee_code: 'EMP-003' },
            ]);

            expect(await service.listAssignees(OWNER)).toEqual([
                {
                    key: 'user:user-9',
                    userId: 'user-9',
                    name: 'Karim',
                    hint: 'karim@acme.test',
                    noLogin: false,
                },
                {
                    key: 'employee:emp-3',
                    employeeId: 'emp-3',
                    name: 'Rahim Uddin',
                    hint: 'EMP-003',
                    noLogin: true,
                },
            ]);
        });

        it('falls back to the email for a user who never set a name', async () => {
            db.projectTask.groupBy
                .mockResolvedValueOnce([{ assignee_id: 'user-9' }])
                .mockResolvedValueOnce([]);
            db.user.findMany.mockResolvedValue([
                { id: 'user-9', name: null, email: 'karim@acme.test' },
            ]);

            expect(await service.listAssignees(OWNER)).toEqual([
                expect.objectContaining({ name: 'karim@acme.test' }),
            ]);
        });

        it('looks nobody up when no task is assigned', async () => {
            expect(await service.listAssignees(OWNER)).toEqual([]);
            expect(db.user.findMany).not.toHaveBeenCalled();
            expect(db.employee.findMany).not.toHaveBeenCalled();
        });

        it('offers only holders inside projects the viewer can reach', async () => {
            // Otherwise the filter itself would name who is working on a private
            // project — the list it filters is already scoped, this must match.
            await service.listAssignees(staff('user-7'));

            for (const [args] of db.projectTask.groupBy.mock.calls) {
                expect(args.where).toMatchObject({
                    AND: [{ project: { OR: visibilityOr('user-7') } }],
                });
            }
        });
    });

    describe('project visibility', () => {
        it('filters the cross-project task list to projects the viewer can reach', async () => {
            await service.list(staff('user-7'), {} as never);

            expect(db.projectTask.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        AND: [{ project: { OR: visibilityOr('user-7') } }],
                    }),
                }),
            );
        });

        it('adds no filter at all for the owner', async () => {
            await service.list(OWNER, {} as never);

            const [{ where }] = db.projectTask.findMany.mock.calls.at(-1);
            expect(where.AND).toBeUndefined();
        });

        it('reports a task in an unreachable project as missing, not forbidden', async () => {
            // What the filtered query returns for a private project the viewer
            // is not on — indistinguishable from an id that never existed.
            db.projectTask.findFirst.mockResolvedValue(null);

            await expect(service.findOne(staff('user-7'), 'task-1')).rejects.toBeInstanceOf(
                NotFoundException,
            );
            expect(db.projectTask.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        AND: [{ project: { OR: visibilityOr('user-7') } }],
                    }),
                }),
            );
        });

        it('refuses to create a task in a project the viewer cannot reach', async () => {
            db.project.findFirst.mockResolvedValue(null);

            await expect(
                service.create(staff('user-7'), {
                    projectId: 'project-1',
                    title: 'Sneak in',
                } as never),
            ).rejects.toBeInstanceOf(NotFoundException);
            expect(db.projectTask.create).not.toHaveBeenCalled();
        });
    });

    describe('importRows', () => {
        beforeEach(() => {
            db.project.findMany = jest.fn().mockResolvedValue([
                { id: 'project-1', code: 'ACME', short_name: 'ACM', name: 'Acme rebuild' },
            ]);
            db.projectTaskStatus.findMany = jest
                .fn()
                .mockResolvedValue([
                    { id: 'status-doing', name: 'In progress', project_id: 'project-1' },
                ]);
            db.tenantUser = {
                findMany: jest.fn().mockResolvedValue([
                    { user: { id: 'user-9', name: 'Karim', email: 'karim@acme.test' } },
                ]),
            };
            // `create` re-reads whatever status id it is handed. Echoing the id
            // back is what lets the assertions below see the column the import
            // resolved, rather than the module-level default.
            db.projectTaskStatus.findFirst.mockImplementation(async (args: any) => ({
                id: args.where.id,
                name: 'In progress',
                category: 'IN_PROGRESS',
                project_id: 'project-1',
            }));
            // `findFirst` serves two callers here: the duplicate check, which
            // asks for `select: { id }`, and the read-back at the end of
            // `create`, which asks with `include`. Answering "no such task" to
            // the first and the created task to the second is what makes these
            // rows creates.
            db.projectTask.findFirst.mockImplementation(async (args: any) =>
                args?.select ? null : task(),
            );
        });

        const run = (rows: Record<string, unknown>[], mode: 'skip' | 'upsert' = 'skip') =>
            service.importRows(OWNER, rows, mode);

        it('resolves a project code, a column name and an email into ids', async () => {
            const result = await run([
                {
                    project: 'acme',
                    title: 'Wire the till',
                    status: 'in progress',
                    priority: 'high',
                    assignee: 'karim@acme.test',
                    dueDate: '2026-09-30',
                    estimateHours: '4.5',
                },
            ]);

            expect(result).toMatchObject({ created: 1, updated: 0, skipped: 0, errors: [] });
            expect(db.projectTask.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        project_id: 'project-1',
                        title: 'Wire the till',
                        status_id: 'status-doing',
                        priority: 'HIGH',
                        assignee_id: 'user-9',
                        estimate_hours: 4.5,
                    }),
                }),
            );
        });

        it('fails only the row whose project is unknown', async () => {
            const result = await run([
                { project: 'nope', title: 'Orphan' },
                { project: 'ACME', title: 'Fine' },
            ]);

            expect(result.created).toBe(1);
            expect(result.errors).toEqual(['Row 2: no project matches "nope"']);
        });

        it('reports a missing required cell rather than writing a blank task', async () => {
            const result = await run([{ project: 'ACME', title: '  ' }]);

            expect(result.created).toBe(0);
            expect(result.errors).toEqual([
                'Row 2: missing required field(s): title',
            ]);
            expect(db.projectTask.create).not.toHaveBeenCalled();
        });

        it('skips a title the project already carries, and updates it in upsert mode', async () => {
            db.projectTask.findFirst.mockResolvedValue(task());
            db.projectTask.findMany.mockResolvedValue([]);

            const skipped = await run([{ project: 'ACME', title: 'Wire the till' }]);
            expect(skipped).toMatchObject({ created: 0, skipped: 1 });
            expect(db.projectTask.create).not.toHaveBeenCalled();

            const upserted = await run([{ project: 'ACME', title: 'Wire the till' }], 'upsert');
            expect(upserted).toMatchObject({ created: 0, updated: 1 });
            expect(db.projectTask.update).toHaveBeenCalled();
        });

        /**
         * The database cannot catch this one: in `skip` mode the first row was
         * never written, so there is nothing for `findDuplicate` to find.
         */
        it('folds two rows of one file describing the same task', async () => {
            const result = await run([
                { project: 'ACME', title: 'Wire the till' },
                { project: 'acme', title: 'wire the till' },
            ]);

            expect(result).toMatchObject({ created: 1, skipped: 1 });
            expect(result.duplicates).toEqual([
                'Row 3: same title on the same project as row 2 — skipped',
            ]);
        });

        it('leaves a project the viewer cannot open out of the lookup entirely', async () => {
            db.project.findMany.mockResolvedValue([]);

            const result = await run([{ project: 'ACME', title: 'Wire the till' }]);

            expect(result.created).toBe(0);
            expect(result.errors).toEqual(['Row 2: no project matches "ACME"']);
        });
    });

    it('scopes every task lookup to the tenant', async () => {
        db.projectTask.findFirst.mockResolvedValue(null);
        await expect(service.findOne(OWNER, 'task-1')).rejects.toBeInstanceOf(NotFoundException);
        expect(db.projectTask.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ tenant_id: 'tenant-1' }),
            }),
        );
    });

    /**
     * What the task card shows beyond a list row. These ride on the one read
     * the card already makes, so opening it still costs three requests.
     */
    describe('findOne, for the task card', () => {
        const include = () => db.projectTask.findFirst.mock.calls[0][0].include;

        it('says whether the viewer watches the task, from their own watcher row only', async () => {
            db.projectTask.findFirst.mockResolvedValue(task({ watchers: [{ user_id: 'user-1' }] }));

            const result = await service.findOne(OWNER, 'task-1');

            expect(include().watchers).toEqual({
                where: { user_id: 'user-1' },
                select: { user_id: true },
            });
            expect(result.viewer_watching).toBe(true);
            // Folded into the flag, not returned: a `watchers` array holding
            // one person would read as the whole list.
            expect(result).not.toHaveProperty('watchers');
        });

        it('reads a task nobody watches as not watched', async () => {
            db.projectTask.findFirst.mockResolvedValue(task({ watchers: [] }));

            const result = await service.findOne(OWNER, 'task-1');

            expect(result.viewer_watching).toBe(false);
        });

        it('carries the creator, the epic behind the story, and the tab counts', async () => {
            db.projectTask.findFirst.mockResolvedValue(task({ watchers: [] }));

            await service.findOne(OWNER, 'task-1');

            expect(include().creator).toEqual({ select: { id: true, name: true, email: true } });
            expect(include().userStory.select.epic).toEqual({
                select: { id: true, code: true, title: true },
            });
            expect(include()._count.select).toEqual(
                expect.objectContaining({ attachments: true, watchers: true, comments: true }),
            );
        });
    });
    describe('bulkRemove', () => {
        it('takes the deleted tasks out of their sprints, closing their history', async () => {
            db.projectTask.findMany.mockResolvedValue([
                { id: 'task-1', user_story_id: null, sprint_id: 'sprint-1' },
                { id: 'task-2', user_story_id: null, sprint_id: null },
            ]);
            db.projectTask.updateMany.mockResolvedValue({ count: 2 });

            await service.bulkRemove(OWNER, ['task-1', 'task-2']);

            expect(membership.moveTasks).toHaveBeenCalledWith(db, 'tenant-1', ['task-1'], null, 'REMOVED');
            expect(burndown.record).toHaveBeenCalledWith('tenant-1', ['sprint-1', null], 'TASK_REMOVED');
        });

        it('soft-deletes the whole selection in one query', async () => {
            // One `updateMany`, not one `update` per id: the page used to fan
            // out a DELETE per row and spend its whole rate-limit budget.
            db.projectTask.updateMany.mockResolvedValue({ count: 3 });

            const result = await service.bulkRemove(OWNER, ['task-1', 'task-2', 'task-3']);

            expect(db.projectTask.updateMany).toHaveBeenCalledTimes(1);
            const [{ where, data }] = db.projectTask.updateMany.mock.calls.at(-1);
            expect(where).toMatchObject({
                id: { in: ['task-1', 'task-2', 'task-3'] },
                tenant_id: 'tenant-1',
                deleted_at: null,
            });
            expect(data.deleted_at).toBeInstanceOf(Date);
            expect(result).toEqual({ success: true, deleted: 3, skipped: 0 });
        });

        it('dedupes repeated ids so the skipped count stays honest', async () => {
            db.projectTask.updateMany.mockResolvedValue({ count: 2 });

            const result = await service.bulkRemove(OWNER, ['task-1', 'task-1', 'task-2']);

            const [{ where }] = db.projectTask.updateMany.mock.calls.at(-1);
            expect(where.id.in).toEqual(['task-1', 'task-2']);
            // Without the dedupe this would report one task skipped that the
            // caller never asked about twice over.
            expect(result).toEqual({ success: true, deleted: 2, skipped: 0 });
        });

        it('skips what the viewer cannot reach rather than failing the batch', async () => {
            // Two of the three are a teammate's; the visibility filter drops
            // them, and the one they do own still gets deleted.
            db.projectTask.updateMany.mockResolvedValue({ count: 1 });

            const result = await service.bulkRemove(narrow('user-7'), [
                'task-1',
                'task-2',
                'task-3',
            ]);

            const [{ where }] = db.projectTask.updateMany.mock.calls.at(-1);
            expect(where.AND).toEqual([
                { project: { OR: visibilityOr('user-7') } },
                { OR: ownTaskOr('user-7') },
            ]);
            expect(result).toEqual({ success: true, deleted: 1, skipped: 2 });
        });
    });

    /**
     * Record scope. Visibility decides which projects reach the list; this
     * decides whose rows are in it. The Tasks page's assignee filter is the
     * viewer's to clear, so the scope has to live in the `where` rather than in
     * the query string.
     */
    describe('own records only', () => {
        it('narrows the cross-project list to the viewer own tasks', async () => {
            await service.list(narrow('user-7'), {} as never);

            const [{ where }] = db.projectTask.findMany.mock.calls.at(-1);
            expect(where.AND).toEqual([
                { project: { OR: visibilityOr('user-7') } },
                { OR: ownTaskOr('user-7') },
            ]);
        });

        it('keeps the scope when the viewer clears the assignee filter', async () => {
            // The filter the page sends is additive; dropping it does not widen
            // the query, which is the regression this whole axis exists for.
            await service.list(narrow('user-7'), { assigneeId: undefined } as never);

            const [{ where }] = db.projectTask.findMany.mock.calls.at(-1);
            expect(where.AND).toContainEqual({ OR: ownTaskOr('user-7') });
        });

        it('narrows the assignee filter options too, so it offers only themselves', async () => {
            await service.listAssignees(narrow('user-7'));

            for (const call of db.projectTask.groupBy.mock.calls) {
                expect(call[0].where.AND).toContainEqual({ OR: ownTaskOr('user-7') });
            }
        });

        it('reports a teammate task as missing rather than forbidden', async () => {
            db.projectTask.findFirst.mockResolvedValue(null);

            await expect(service.findOne(narrow('user-7'), 'task-1')).rejects.toBeInstanceOf(
                NotFoundException,
            );
            const [{ where }] = db.projectTask.findFirst.mock.calls.at(-1);
            expect(where.AND).toContainEqual({ OR: ownTaskOr('user-7') });
        });

        it('refuses to edit a teammate task', async () => {
            // The write gate is the same lookup as the read, so a task they
            // cannot see is a task they cannot PATCH by id either.
            db.projectTask.findFirst.mockResolvedValue(null);

            await expect(
                service.update(narrow('user-7'), 'task-1', { title: 'Mine now' } as never),
            ).rejects.toBeInstanceOf(NotFoundException);
            expect(db.projectTask.update).not.toHaveBeenCalled();
        });

        it('leaves a wide viewer exactly as they were', async () => {
            await service.list(staff('user-7'), {} as never);

            const [{ where }] = db.projectTask.findMany.mock.calls.at(-1);
            expect(where.AND).toEqual([{ project: { OR: visibilityOr('user-7') } }]);
        });
    });
});
