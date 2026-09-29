import { Test, TestingModule } from '@nestjs/testing';
import {
    BadRequestException,
    ConflictException,
    NotFoundException,
    ServiceUnavailableException,
} from '@nestjs/common';
import { SprintsService } from './sprints.service';
import { SprintSnapshotService } from './sprint-snapshot.service';
import { ProjectAccessService } from './project-access.service';
import { OWNER, staff, visibilityOr } from './project-access.test-support';
import { DatabaseService } from '../database/database.service';
import { AssetsService } from '../assets/assets.service';

describe('SprintsService', () => {
    let service: SprintsService;
    let db: any;
    let assets: { isEnabled: jest.Mock; uploadBuffer: jest.Mock; deleteFile: jest.Mock };
    let snapshots: { snapshotToday: jest.Mock; computeCurrent: jest.Mock; rebuild: jest.Mock; refresh: jest.Mock };

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
        snapshots = {
            snapshotToday: jest.fn().mockResolvedValue({}),
            computeCurrent: jest.fn().mockResolvedValue({
                remaining_hours: 12,
                committed_hours: 40,
                completed_hours: 28,
                task_count: 5,
                done_task_count: 2,
            }),
            rebuild: jest.fn().mockResolvedValue({ written: 3, skipped: 1 }),
            refresh: jest.fn().mockResolvedValue(undefined),
        };

        db = {
            project: { findFirst: jest.fn().mockResolvedValue({ id: 'project-1' }) },
            userStorePermission: { findFirst: jest.fn().mockResolvedValue(null) },
            sprint: {
                findFirst: jest.fn().mockResolvedValue(sprint()),
                findMany: jest.fn().mockResolvedValue([]),
                create: jest.fn().mockResolvedValue(sprint()),
                update: jest.fn().mockResolvedValue(sprint({ status: 'ACTIVE' })),
                delete: jest.fn().mockResolvedValue({}),
            },
            projectTask: {
                findMany: jest.fn().mockResolvedValue([]),
                updateMany: jest.fn().mockResolvedValue({ count: 0 }),
                groupBy: jest.fn().mockResolvedValue([]),
            },
            sprintSnapshot: { findMany: jest.fn().mockResolvedValue([]) },
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
                { provide: SprintSnapshotService, useValue: snapshots },
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

        it('snapshots immediately so day one has a point to anchor the ideal line', async () => {
            db.sprint.findFirst.mockResolvedValueOnce(sprint()).mockResolvedValueOnce(null);

            await service.start('tenant-1', 'sprint-1');

            expect(snapshots.snapshotToday).toHaveBeenCalledWith('tenant-1', 'sprint-1');
        });

        it('will not restart a completed sprint', async () => {
            db.sprint.findFirst.mockResolvedValue(sprint({ status: 'COMPLETED' }));
            await expect(service.start('tenant-1', 'sprint-1')).rejects.toBeInstanceOf(
                BadRequestException,
            );
        });
    });

    describe('complete', () => {
        it('takes a final snapshot before returning tasks to the backlog', async () => {
            db.projectTask.findMany.mockResolvedValue([{ id: 'task-a' }, { id: 'task-b' }]);

            const result = await service.complete('tenant-1', 'sprint-1');

            expect(snapshots.snapshotToday).toHaveBeenCalled();
            expect(result.carried_over).toBe(2);
        });

        it('carries unfinished tasks back with their hours intact', async () => {
            db.projectTask.findMany.mockResolvedValue([{ id: 'task-a' }]);

            await service.complete('tenant-1', 'sprint-1');

            const update = db.projectTask.updateMany.mock.calls[0][0];
            expect(update.data).toEqual({ sprint_id: null });
            // Nothing resets remaining hours — the work did not evaporate
            // because the sprint ended.
            expect(update.data).not.toHaveProperty('remaining_hours');
        });

        it('only carries tasks that are not in a Done column', async () => {
            await service.complete('tenant-1', 'sprint-1');

            expect(db.projectTask.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        status: { category: { not: 'DONE' } },
                    }),
                }),
            );
        });
    });

    describe('burndown', () => {
        it('turns stored snapshots into a dated series', async () => {
            db.sprintSnapshot.findMany.mockResolvedValue([
                {
                    snapshot_date: new Date('2026-08-02T00:00:00.000Z'),
                    remaining_hours: 40,
                    committed_hours: 40,
                },
                {
                    snapshot_date: new Date('2026-08-03T00:00:00.000Z'),
                    remaining_hours: 34,
                    committed_hours: 40,
                    task_count: 6,
                    done_task_count: 2,
                },
            ]);

            const result = await service.burndown('tenant-1', 'sprint-1');

            expect(result.series[0]).toMatchObject({ date: '2026-08-02', actual: 40, ideal: 40 });
            expect(result.series[1]).toMatchObject({ date: '2026-08-03', actual: 34, open: 4 });
            // A day without a snapshot says nothing about open tasks either.
            expect(result.series[2]).toMatchObject({ date: '2026-08-04', open: null });
            expect(result.current.remaining_hours).toBe(12);
        });

        describe('while the sprint runs', () => {
            beforeEach(() => {
                jest.useFakeTimers().setSystemTime(new Date('2026-08-04T06:00:00.000Z'));
                db.sprint.findFirst.mockResolvedValue(sprint({ status: 'ACTIVE' }));
            });
            afterEach(() => jest.useRealTimers());

            it("plots today from the live figures, not the stored row", async () => {
                const result = await service.burndown('tenant-1', 'sprint-1');

                const today = result.series.find((p: any) => p.date === '2026-08-04');
                expect(today).toMatchObject({ actual: 12, committed: 40, open: 3 });
            });

            it('fills past days that have no point from the log', async () => {
                await service.burndown('tenant-1', 'sprint-1');

                expect(snapshots.rebuild).toHaveBeenCalledWith('tenant-1', 'sprint-1');
                expect(db.sprintSnapshot.findMany).toHaveBeenCalledTimes(2);
            });

            it('does not rebuild when every past day already has a point', async () => {
                db.sprintSnapshot.findMany.mockResolvedValue(
                    ['2026-08-02', '2026-08-03'].map((day) => ({
                        snapshot_date: new Date(`${day}T00:00:00.000Z`),
                        remaining_hours: 40,
                        committed_hours: 40,
                        task_count: 5,
                        done_task_count: 0,
                    })),
                );

                await service.burndown('tenant-1', 'sprint-1');

                expect(snapshots.rebuild).not.toHaveBeenCalled();
            });
        });

        it('still returns a series when no snapshot has ever been written', async () => {
            const result = await service.burndown('tenant-1', 'sprint-1');
            expect(result.series.length).toBeGreaterThan(0);
            expect(result.series.every((p: any) => p.actual === null)).toBe(true);
        });
    });

    it('detaches tasks before deleting a sprint so none are orphaned', async () => {
        await service.remove('tenant-1', 'sprint-1');

        expect(db.projectTask.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({ data: { sprint_id: null } }),
        );
        expect(db.sprint.delete).toHaveBeenCalled();
    });

    it('assigns tasks from any project, scoped only by tenant', async () => {
        // The point of a tenant-level sprint. Previously this filtered on the
        // sprint's own project_id, which silently dropped tasks from every other
        // project in the request.
        await service.assignTasks(OWNER, 'sprint-1', { taskIds: ['task-a', 'task-b'] } as never);

        const where = db.projectTask.updateMany.mock.calls[0][0].where;
        expect(where).toMatchObject({
            tenant_id: 'tenant-1',
            deleted_at: null,
            id: { in: ['task-a', 'task-b'] },
        });
        expect(where).not.toHaveProperty('project_id');
    });

    it('re-records the burndown of the sprint tasks join and any sprint they leave', async () => {
        db.projectTask.findMany.mockResolvedValue([{ sprint_id: 'sprint-0' }, { sprint_id: null }]);

        await service.assignTasks(OWNER, 'sprint-1', { taskIds: ['task-a', 'task-b'] } as never);

        expect(snapshots.refresh).toHaveBeenCalledWith('tenant-1', ['sprint-1', 'sprint-0', null]);
    });

    it('will not pull a task from a project the viewer cannot reach into a sprint', async () => {
        await service.assignTasks(staff('user-7'), 'sprint-1', { taskIds: ['task-a'] } as never);

        // Filtered rather than refused: an id nobody can see simply does not
        // match, which is the same answer a made-up id gets.
        expect(db.projectTask.updateMany.mock.calls[0][0].where).toMatchObject({
            AND: [{ project: { OR: visibilityOr('user-7') } }],
        });
    });
    describe('assignStories', () => {
        it('commits only open, unplanned tasks under the stories', async () => {
            db.projectTask.updateMany.mockResolvedValue({ count: 3 });

            const result = await service.assignStories(OWNER, 'sprint-1', {
                storyIds: ['story-a', 'story-b'],
            } as never);

            expect(result).toEqual({ assigned: 3 });
            const call = db.projectTask.updateMany.mock.calls[0][0];
            expect(call.where).toMatchObject({
                tenant_id: 'tenant-1',
                user_story_id: { in: ['story-a', 'story-b'] },
                // A task already in another sprint stays there.
                sprint_id: null,
                deleted_at: null,
                status: { category: { not: 'DONE' } },
            });
            expect(call.data).toEqual({ sprint_id: 'sprint-1' });
        });

        it('scopes the stories\' tasks to what the viewer can reach', async () => {
            await service.assignStories(staff('user-7'), 'sprint-1', { storyIds: ['story-a'] } as never);

            expect(db.projectTask.updateMany.mock.calls[0][0].where).toMatchObject({
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
