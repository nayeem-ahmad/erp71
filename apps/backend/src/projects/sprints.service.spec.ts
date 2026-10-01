import { Test, TestingModule } from '@nestjs/testing';
import {
    BadRequestException,
    ConflictException,
    NotFoundException,
    ServiceUnavailableException,
} from '@nestjs/common';
import { SprintsService } from './sprints.service';
import { BurndownRecorder } from './burndown-recorder.service';
import { SprintMembershipService } from './sprint-membership.service';
import { ProjectAccessService } from './project-access.service';
import { OWNER, staff, visibilityOr } from './project-access.test-support';
import { DatabaseService } from '../database/database.service';
import { AssetsService } from '../assets/assets.service';

describe('SprintsService', () => {
    let service: SprintsService;
    let db: any;
    let assets: { isEnabled: jest.Mock; uploadBuffer: jest.Mock; deleteFile: jest.Mock };
    let burndown: { computeCurrent: jest.Mock; record: jest.Mock };
    let membership: { moveTasks: jest.Mock; closeInPlace: jest.Mock };

    const sprint = (overrides: Record<string, unknown> = {}) => ({
        id: 'sprint-1',
        tenant_id: 'tenant-1',
        project_id: 'project-1',
        name: 'Sprint 1',
        goal: null,
        status: 'PLANNED',
        start_date: new Date('2026-08-02T00:00:00.000Z'),
        end_date: new Date('2026-08-13T00:00:00.000Z'),
        ...overrides,
    });

    beforeEach(async () => {
        burndown = {
            computeCurrent: jest.fn().mockResolvedValue({
                remaining_hours: 12,
                committed_hours: 40,
                task_count: 5,
                done_task_count: 2,
            }),
            record: jest.fn().mockResolvedValue(undefined),
        };
        membership = {
            moveTasks: jest.fn().mockResolvedValue({ moved: 0, leftSprintIds: [] }),
            closeInPlace: jest.fn().mockResolvedValue(0),
        };

        db = {
            project: { findFirst: jest.fn().mockResolvedValue({ id: 'project-1' }) },
            userStorePermission: { findFirst: jest.fn().mockResolvedValue(null) },
            sprint: {
                findFirst: jest.fn().mockResolvedValue(sprint()),
                findMany: jest.fn().mockResolvedValue([]),
                create: jest.fn().mockResolvedValue(sprint()),
                update: jest.fn().mockResolvedValue(sprint({ status: 'ACTIVE' })),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                delete: jest.fn().mockResolvedValue({}),
            },
            projectTask: {
                findMany: jest.fn().mockResolvedValue([]),
                updateMany: jest.fn().mockResolvedValue({ count: 0 }),
                groupBy: jest.fn().mockResolvedValue([]),
            },
            sprintBurndownPoint: { findMany: jest.fn().mockResolvedValue([]) },
            $transaction: jest.fn(async (run: (tx: unknown) => unknown) => run(db)),
        };

        assets = {
            isEnabled: jest.fn().mockReturnValue(true),
            uploadBuffer: jest
                .fn()
                .mockResolvedValue({ url: 'https://cdn/new.jpg', publicId: 't1/project-sprints/new', bytes: 10 }),
            deleteFile: jest.fn().mockResolvedValue(undefined),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SprintsService,
                ProjectAccessService,
                { provide: DatabaseService, useValue: db },
                { provide: BurndownRecorder, useValue: burndown },
                { provide: SprintMembershipService, useValue: membership },
                { provide: AssetsService, useValue: assets },
            ],
        }).compile();

        service = module.get(SprintsService);
    });

    describe('create', () => {
        it('refuses a sprint that ends before it starts', async () => {
            await expect(
                service.create('tenant-1', {
                    projectId: 'project-1',
                    name: 'Backwards',
                    startDate: '2026-08-10',
                    endDate: '2026-08-01',
                } as never),
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it('creates against the tenant, with no project to belong to', async () => {
            // A sprint is a tenant-wide time-box: there is no project to
            // validate, and none is written.
            await service.create('tenant-1', {
                name: 'Aug W1',
                startDate: '2026-08-01',
                endDate: '2026-08-10',
            } as never);

            expect(db.project.findFirst).not.toHaveBeenCalled();
            const data = db.sprint.create.mock.calls[0][0].data;
            expect(data).toMatchObject({ tenant_id: 'tenant-1', name: 'Aug W1' });
            expect(data).not.toHaveProperty('project_id');
        });
    });

    describe('start', () => {
        it('refuses to run two sprints in one TENANT at once', async () => {
            db.sprint.findFirst
                .mockResolvedValueOnce(sprint())
                .mockResolvedValueOnce({ id: 'sprint-other', name: 'Sprint 0' });

            await expect(service.start('tenant-1', 'sprint-1')).rejects.toBeInstanceOf(
                ConflictException,
            );
        });

        it('scopes the conflict check to the tenant, not to a project', async () => {
            // The rule moved with the column: a sprint no longer belongs to a
            // project, so scoping the check by one would let N sprints run.
            db.sprint.findFirst.mockResolvedValueOnce(sprint()).mockResolvedValueOnce(null);

            await service.start('tenant-1', 'sprint-1');

            const conflictQuery = db.sprint.findFirst.mock.calls[1][0].where;
            expect(conflictQuery).toMatchObject({ tenant_id: 'tenant-1', status: 'ACTIVE' });
            expect(conflictQuery).not.toHaveProperty('project_id');
        });

        it('records a STARTED point so the chart has somewhere to begin', async () => {
            db.sprint.findFirst.mockResolvedValueOnce(sprint()).mockResolvedValueOnce(null);

            await service.start('tenant-1', 'sprint-1');

            expect(burndown.record).toHaveBeenCalledWith('tenant-1', ['sprint-1'], 'STARTED');
        });

        it('will not restart a completed sprint', async () => {
            db.sprint.findFirst.mockResolvedValue(sprint({ status: 'COMPLETED' }));
            await expect(service.start('tenant-1', 'sprint-1')).rejects.toBeInstanceOf(
                BadRequestException,
            );
        });
    });

    describe('complete', () => {
        const active = sprint({ status: 'ACTIVE', name: 'Sprint 7' });
        const tasks = (rows: Array<[string, string]>) =>
            db.projectTask.findMany.mockResolvedValue(
                rows.map(([id, category]) => ({ id, status: { category } })),
            );

        beforeEach(() => {
            db.sprint.findFirst.mockImplementation(async (args: any) => {
                if (args?.where?.id === 'sprint-1') return active;
                if (args?.where?.id === 'sprint-next') return sprint({ id: 'sprint-next', name: 'Sprint 8', status: 'PLANNED' });
                return null;
            });
            db.sprint.create.mockResolvedValue({ id: 'sprint-new', name: 'Sprint 8', status: 'PLANNED' });
            db.sprint.update.mockResolvedValue({ id: 'sprint-new', name: 'Sprint 8', status: 'ACTIVE' });
            tasks([
                ['task-done', 'DONE'],
                ['task-a', 'TODO'],
                ['task-b', 'IN_PROGRESS'],
            ]);
        });

        it('records the final point while the work is still in the sprint', async () => {
            await service.complete('tenant-1', 'sprint-1');

            expect(burndown.record).toHaveBeenCalledWith('tenant-1', ['sprint-1'], 'COMPLETED');
            expect(burndown.record.mock.invocationCallOrder[0]).toBeLessThan(
                db.$transaction.mock.invocationCallOrder[0],
            );
        });

        it('with no body, returns unfinished tasks to the backlog — what it always did', async () => {
            const result = await service.complete('tenant-1', 'sprint-1');

            expect(membership.moveTasks).toHaveBeenCalledWith(
                db,
                'tenant-1',
                ['task-a', 'task-b'],
                null,
                'RETURNED_TO_BACKLOG',
                { at: expect.any(Date) },
            );
            expect(result).toMatchObject({ carried_over: 2, carried_to: null });
            expect(db.sprint.create).not.toHaveBeenCalled();
        });

        it('leaves Done tasks in the sprint, closing their history as DONE', async () => {
            await service.complete('tenant-1', 'sprint-1');

            expect(membership.closeInPlace).toHaveBeenCalledWith(
                db,
                'tenant-1',
                'sprint-1',
                ['task-done'],
                'DONE',
                expect.any(Date),
            );
        });

        it('reads the tasks to close by status category, not column name', async () => {
            await service.complete('tenant-1', 'sprint-1');

            expect(db.projectTask.findMany.mock.calls[0][0]).toMatchObject({
                where: { tenant_id: 'tenant-1', sprint_id: 'sprint-1', deleted_at: null },
                select: { id: true, status: { select: { category: true } } },
            });
        });

        it('carries unfinished work into a new sprint it creates', async () => {
            const result = await service.complete('tenant-1', 'sprint-1', {
                carryTo: { kind: 'new', name: '  Sprint 8 ', startDate: '2026-08-14', endDate: '2026-08-25' },
            } as never);

            expect(db.sprint.create.mock.calls[0][0].data).toMatchObject({
                tenant_id: 'tenant-1',
                name: 'Sprint 8',
                start_date: new Date('2026-08-14'),
                end_date: new Date('2026-08-25'),
            });
            expect(membership.moveTasks).toHaveBeenCalledWith(
                db,
                'tenant-1',
                ['task-a', 'task-b'],
                'sprint-new',
                'CARRIED_OVER',
                { at: expect.any(Date) },
            );
            expect(result.carried_to).toEqual({ id: 'sprint-new', name: 'Sprint 8' });
            // Not started unless asked.
            expect(db.sprint.update).not.toHaveBeenCalled();
            expect(burndown.record).not.toHaveBeenCalledWith('tenant-1', ['sprint-new'], 'STARTED');
        });

        it('starts the new sprint when asked, and gives it its first point', async () => {
            await service.complete('tenant-1', 'sprint-1', {
                carryTo: { kind: 'new', name: 'Sprint 8', startDate: '2026-08-14', endDate: '2026-08-25', start: true },
            } as never);

            expect(db.sprint.update).toHaveBeenCalledWith(
                expect.objectContaining({ where: { id: 'sprint-new' }, data: { status: 'ACTIVE' } }),
            );
            expect(burndown.record).toHaveBeenCalledWith('tenant-1', ['sprint-new'], 'STARTED');
        });

        it('refuses to start the new sprint while another one is running', async () => {
            db.sprint.findFirst.mockImplementation(async (args: any) => {
                if (args?.where?.id === 'sprint-1') return active;
                if (args?.where?.status === 'ACTIVE') return { name: 'Sprint 3' };
                return null;
            });

            await expect(
                service.complete('tenant-1', 'sprint-1', {
                    carryTo: { kind: 'new', name: 'Sprint 8', startDate: '2026-08-14', endDate: '2026-08-25', start: true },
                } as never),
            ).rejects.toBeInstanceOf(ConflictException);
        });

        it('refuses a new sprint that ends before it starts, before closing anything', async () => {
            await expect(
                service.complete('tenant-1', 'sprint-1', {
                    carryTo: { kind: 'new', name: 'Sprint 8', startDate: '2026-08-25', endDate: '2026-08-14' },
                } as never),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(db.$transaction).not.toHaveBeenCalled();
        });

        it('carries into an existing planned sprint', async () => {
            const result = await service.complete('tenant-1', 'sprint-1', {
                carryTo: { kind: 'sprint', sprintId: 'sprint-next' },
            } as never);

            expect(membership.moveTasks.mock.calls[0][3]).toBe('sprint-next');
            expect(membership.moveTasks.mock.calls[0][4]).toBe('CARRIED_OVER');
            expect(result.carried_to).toEqual({ id: 'sprint-next', name: 'Sprint 8' });
        });

        it.each([
            ['an active sprint', sprint({ id: 'sprint-x', status: 'ACTIVE' })],
            ['a completed sprint', sprint({ id: 'sprint-x', status: 'COMPLETED' })],
            ['no sprint at all', null],
        ])('refuses to carry into %s', async (_label, target) => {
            db.sprint.findFirst.mockImplementation(async (args: any) =>
                args?.where?.id === 'sprint-1' ? active : target,
            );

            await expect(
                service.complete('tenant-1', 'sprint-1', { carryTo: { kind: 'sprint', sprintId: 'sprint-x' } } as never),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(burndown.record).not.toHaveBeenCalled();
        });

        it('refuses to carry a sprint into itself', async () => {
            await expect(
                service.complete('tenant-1', 'sprint-1', { carryTo: { kind: 'sprint', sprintId: 'sprint-1' } } as never),
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it('creates no sprint when everything was finished, even if one was asked for', async () => {
            tasks([['task-done', 'DONE']]);

            const result = await service.complete('tenant-1', 'sprint-1', {
                carryTo: { kind: 'new', name: 'Sprint 8', startDate: '2026-08-14', endDate: '2026-08-25' },
            } as never);

            expect(db.sprint.create).not.toHaveBeenCalled();
            expect(result).toMatchObject({ carried_over: 0, carried_to: null });
        });

        it('refuses a sprint that is already complete', async () => {
            db.sprint.findFirst.mockResolvedValue(sprint({ status: 'COMPLETED' }));
            await expect(service.complete('tenant-1', 'sprint-1')).rejects.toBeInstanceOf(ConflictException);
        });

        it('loses a race to a second click with a 409, not a second run', async () => {
            db.sprint.updateMany.mockResolvedValue({ count: 0 });

            await expect(service.complete('tenant-1', 'sprint-1')).rejects.toBeInstanceOf(ConflictException);
            expect(db.sprint.updateMany.mock.calls[0][0].where).toMatchObject({
                id: 'sprint-1',
                tenant_id: 'tenant-1',
                status: { not: 'COMPLETED' },
            });
            expect(membership.moveTasks).not.toHaveBeenCalled();
        });
    });

    describe('burndown', () => {
        const point = (at: string, remaining: number, extra: Record<string, unknown> = {}) => ({
            recorded_at: new Date(at),
            remaining_hours: remaining,
            committed_hours: 40,
            task_count: 5,
            done_task_count: 1,
            cause: 'WORK_LOGGED',
            task: null,
            ...extra,
        });

        it('returns every stored point in order, with the task behind it', async () => {
            db.sprintBurndownPoint.findMany.mockResolvedValue([
                point('2026-08-02T03:00:00.000Z', 40, { cause: 'STARTED' }),
                point('2026-08-02T05:30:00.000Z', 37, {
                    task: { id: 't1', reference: 4, title: 'Fix login', project: { code: 'PRJ-0002' } },
                }),
                point('2026-08-02T09:10:00.000Z', 35),
            ]);

            const result = await service.burndown('tenant-1', 'sprint-1');

            expect(db.sprintBurndownPoint.findMany.mock.calls[0][0]).toMatchObject({
                where: { tenant_id: 'tenant-1', sprint_id: 'sprint-1' },
                orderBy: { recorded_at: 'asc' },
            });
            expect(result.points).toHaveLength(3);
            expect(result.points[1]).toEqual({
                at: '2026-08-02T05:30:00.000Z',
                remaining: 37,
                committed: 40,
                open: 4,
                cause: 'WORK_LOGGED',
                task: { id: 't1', code: 'PRJ-0002-4', title: 'Fix login' },
            });
        });

        it('anchors the ideal line to the committed hours at the first point', async () => {
            db.sprintBurndownPoint.findMany.mockResolvedValue([
                point('2026-08-02T03:00:00.000Z', 30, { committed_hours: 30 }),
            ]);

            const result = await service.burndown('tenant-1', 'sprint-1');

            expect(result.ideal[0]).toEqual({ date: '2026-08-02', value: 30, isWorkingDay: true });
            expect(result.ideal[result.ideal.length - 1].value).toBe(0);
        });

        it('appends the live totals while the sprint runs, when they moved since the last point', async () => {
            db.sprint.findFirst.mockResolvedValue(sprint({ status: 'ACTIVE' }));
            db.sprintBurndownPoint.findMany.mockResolvedValue([point('2026-08-02T03:00:00.000Z', 40)]);

            const result = await service.burndown('tenant-1', 'sprint-1');

            expect(result.points).toHaveLength(2);
            expect(result.points[1]).toMatchObject({ remaining: 12, committed: 40, open: 3, cause: null });
        });

        it('does not append a live point that repeats the last one', async () => {
            db.sprint.findFirst.mockResolvedValue(sprint({ status: 'ACTIVE' }));
            db.sprintBurndownPoint.findMany.mockResolvedValue([
                point('2026-08-02T03:00:00.000Z', 12, { done_task_count: 2 }),
            ]);

            const result = await service.burndown('tenant-1', 'sprint-1');
            expect(result.points).toHaveLength(1);
        });

        it('still returns an ideal line when no point has ever been written', async () => {
            const result = await service.burndown('tenant-1', 'sprint-1');
            expect(result.points).toEqual([]);
            expect(result.ideal.length).toBeGreaterThan(0);
            expect(result.ideal[0].value).toBe(40);
        });
    });

    it('takes its tasks out through the membership service before deleting a sprint', async () => {
        db.projectTask.findMany.mockResolvedValue([{ id: 'task-a' }]);

        await service.remove('tenant-1', 'sprint-1');

        expect(membership.moveTasks).toHaveBeenCalledWith(db, 'tenant-1', ['task-a'], null, 'REMOVED');
        expect(db.sprint.delete).toHaveBeenCalled();
    });

    describe('assignTasks', () => {
        it('assigns tasks from any project, scoped only by tenant', async () => {
            // The point of a tenant-level sprint. Previously this filtered on the
            // sprint's own project_id, which silently dropped tasks from every other
            // project in the request.
            await service.assignTasks(OWNER, 'sprint-1', { taskIds: ['task-a', 'task-b'] } as never);

            const where = db.projectTask.findMany.mock.calls[0][0].where;
            expect(where).toMatchObject({
                tenant_id: 'tenant-1',
                deleted_at: null,
                id: { in: ['task-a', 'task-b'] },
            });
            expect(where).not.toHaveProperty('project_id');
        });

        it('moves them through the membership service and reports how many moved', async () => {
            db.projectTask.findMany.mockResolvedValue([{ id: 'task-a' }, { id: 'task-b' }]);
            membership.moveTasks.mockResolvedValue({ moved: 1, leftSprintIds: ['sprint-0'] });

            const result = await service.assignTasks(OWNER, 'sprint-1', { taskIds: ['task-a', 'task-b'] } as never);

            expect(membership.moveTasks).toHaveBeenCalledWith(db, 'tenant-1', ['task-a', 'task-b'], 'sprint-1', 'REMOVED');
            expect(result).toEqual({ assigned: 1 });
        });

        it('records the sprint tasks join and any sprint they leave', async () => {
            membership.moveTasks.mockResolvedValue({ moved: 2, leftSprintIds: ['sprint-0'] });

            await service.assignTasks(OWNER, 'sprint-1', { taskIds: ['task-a', 'task-b'] } as never);

            expect(burndown.record).toHaveBeenCalledWith('tenant-1', ['sprint-0'], 'TASK_REMOVED');
            expect(burndown.record).toHaveBeenCalledWith('tenant-1', ['sprint-1'], 'TASK_ADDED');
        });

        it('will not pull a task from a project the viewer cannot reach into a sprint', async () => {
            await service.assignTasks(staff('user-7'), 'sprint-1', { taskIds: ['task-a'] } as never);

            // Filtered rather than refused: an id nobody can see simply does not
            // match, which is the same answer a made-up id gets.
            expect(db.projectTask.findMany.mock.calls[0][0].where).toMatchObject({
                AND: [{ project: { OR: visibilityOr('user-7') } }],
            });
        });

        it('refuses a completed sprint — its membership is history', async () => {
            db.sprint.findFirst.mockResolvedValue(sprint({ status: 'COMPLETED' }));
            await expect(
                service.assignTasks(OWNER, 'sprint-1', { taskIds: ['task-a'] } as never),
            ).rejects.toBeInstanceOf(BadRequestException);
        });
    });

    describe('removeTasks', () => {
        it('takes only tasks in this sprint back to the backlog', async () => {
            db.projectTask.findMany.mockResolvedValue([{ id: 'task-a' }]);
            membership.moveTasks.mockResolvedValue({ moved: 1, leftSprintIds: ['sprint-1'] });

            const result = await service.removeTasks(OWNER, 'sprint-1', { taskIds: ['task-a', 'task-z'] } as never);

            expect(db.projectTask.findMany.mock.calls[0][0].where).toMatchObject({ sprint_id: 'sprint-1' });
            expect(membership.moveTasks).toHaveBeenCalledWith(db, 'tenant-1', ['task-a'], null, 'REMOVED');
            expect(result).toEqual({ removed: 1 });
        });

        it('refuses a completed sprint', async () => {
            db.sprint.findFirst.mockResolvedValue(sprint({ status: 'COMPLETED' }));
            await expect(
                service.removeTasks(OWNER, 'sprint-1', { taskIds: ['task-a'] } as never),
            ).rejects.toBeInstanceOf(BadRequestException);
        });
    });

    describe('assignStories', () => {
        it('commits only open, unplanned tasks under the stories', async () => {
            db.projectTask.findMany.mockResolvedValue([{ id: 'task-a' }, { id: 'task-b' }, { id: 'task-c' }]);
            membership.moveTasks.mockResolvedValue({ moved: 3, leftSprintIds: [] });

            const result = await service.assignStories(OWNER, 'sprint-1', {
                storyIds: ['story-a', 'story-b'],
            } as never);

            expect(result).toEqual({ assigned: 3 });
            expect(db.projectTask.findMany.mock.calls[0][0].where).toMatchObject({
                tenant_id: 'tenant-1',
                user_story_id: { in: ['story-a', 'story-b'] },
                // A task already in another sprint stays there.
                sprint_id: null,
                deleted_at: null,
                status: { category: { not: 'DONE' } },
            });
            expect(membership.moveTasks.mock.calls[0][2]).toEqual(['task-a', 'task-b', 'task-c']);
            expect(membership.moveTasks.mock.calls[0][3]).toBe('sprint-1');
        });

        it('scopes the stories\' tasks to what the viewer can reach', async () => {
            await service.assignStories(staff('user-7'), 'sprint-1', { storyIds: ['story-a'] } as never);

            expect(db.projectTask.findMany.mock.calls[0][0].where).toMatchObject({
                AND: [{ project: { OR: visibilityOr('user-7') } }],
            });
        });

        it('refuses a sprint that does not exist', async () => {
            db.sprint.findFirst.mockResolvedValue(null);
            await expect(
                service.assignStories(OWNER, 'missing', { storyIds: ['story-a'] } as never),
            ).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe('update', () => {
        it('refuses a status change — that is what start and complete are for', async () => {
            await expect(
                service.update('tenant-1', 'sprint-1', { status: 'COMPLETED' } as never),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(db.sprint.update).not.toHaveBeenCalled();
        });
    });

    describe('background', () => {
        const withImage = () =>
            db.sprint.findFirst.mockResolvedValue(
                sprint({ background_image_url: 'https://cdn/old.jpg', background_image_key: 't1/project-sprints/old' }),
            );

        const pixel =
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

        it('renames without touching the background', async () => {
            withImage();

            await service.update('tenant-1', 'sprint-1', { name: 'Sprint 2' } as never);

            expect(db.sprint.update).toHaveBeenCalledWith({ where: { id: 'sprint-1' }, data: { name: 'Sprint 2' } });
            expect(assets.deleteFile).not.toHaveBeenCalled();
        });

        it('drops the image when a colour is picked, file and all', async () => {
            withImage();

            await service.update('tenant-1', 'sprint-1', { backgroundColor: 'BLUE' } as never);

            expect(db.sprint.update).toHaveBeenCalledWith({
                where: { id: 'sprint-1' },
                data: { background_color: 'BLUE', background_image_url: null, background_image_key: null },
            });
            expect(assets.deleteFile).toHaveBeenCalledWith('t1/project-sprints/old', 'image');
        });

        it('stores an uploaded image with its key, in the sprint folder', async () => {
            withImage();

            await service.setBackgroundImage('tenant-1', 'sprint-1', { imageBase64: pixel });

            expect(assets.uploadBuffer).toHaveBeenCalledWith(
                expect.any(Buffer),
                'tenant-1/project-sprints',
                'background',
                'image',
            );
            expect(db.sprint.update).toHaveBeenCalledWith({
                where: { id: 'sprint-1' },
                data: {
                    background_color: null,
                    background_image_url: 'https://cdn/new.jpg',
                    background_image_key: 't1/project-sprints/new',
                },
            });
            expect(assets.deleteFile).toHaveBeenCalledWith('t1/project-sprints/old', 'image');
        });

        it('says so plainly when storage is not configured', async () => {
            assets.isEnabled.mockReturnValue(false);

            await expect(
                service.setBackgroundImage('tenant-1', 'sprint-1', { imageBase64: pixel }),
            ).rejects.toBeInstanceOf(ServiceUnavailableException);
            expect(db.sprint.update).not.toHaveBeenCalled();
        });

        it('clearing takes all three columns and the file', async () => {
            withImage();

            await service.clearBackground('tenant-1', 'sprint-1');

            expect(db.sprint.update).toHaveBeenCalledWith({
                where: { id: 'sprint-1' },
                data: { background_color: null, background_image_url: null, background_image_key: null },
            });
            expect(assets.deleteFile).toHaveBeenCalledWith('t1/project-sprints/old', 'image');
        });

        it('never sends the storage key to the browser', async () => {
            withImage();
            db.sprint.update.mockResolvedValue(sprint({ background_image_key: 't1/project-sprints/new' }));

            const found = await service.findOne('tenant-1', 'sprint-1');
            const cleared = await service.clearBackground('tenant-1', 'sprint-1');

            expect(found).toMatchObject({ background_image_url: 'https://cdn/old.jpg' });
            expect(found).not.toHaveProperty('background_image_key');
            expect(cleared).not.toHaveProperty('background_image_key');
        });
    });
});
