import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ActivityType, ProjectActivityService } from './project-activity.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DatabaseService } from '../database/database.service';

describe('ProjectActivityService', () => {
    let service: ProjectActivityService;
    let db: any;
    let notifications: { create: jest.Mock };

    const record = {
        tenantId: 'tenant-1',
        taskId: 'task-1',
        projectId: 'project-1',
        type: ActivityType.STATUS_CHANGED,
        actorId: 'user-1',
    };

    beforeEach(async () => {
        notifications = { create: jest.fn().mockResolvedValue({}) };

        db = {
            projectTaskActivity: {
                create: jest.fn().mockResolvedValue({ id: 'activity-1' }),
                findMany: jest.fn().mockResolvedValue([]),
            },
            projectTaskWatcher: {
                findMany: jest.fn().mockResolvedValue([]),
                findFirst: jest.fn().mockResolvedValue({ task_id: 'task-1' }),
                upsert: jest.fn().mockResolvedValue({}),
                delete: jest.fn().mockResolvedValue({}),
            },
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ProjectActivityService,
                { provide: DatabaseService, useValue: db },
                { provide: NotificationsService, useValue: notifications },
            ],
        }).compile();

        service = module.get(ProjectActivityService);

        // The service logs rather than throws; keep the expected warnings out of
        // the test output so a real one still stands out.
        jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
    });

    describe('record', () => {
        it('writes the row with its before/after payload', async () => {
            await service.record({ ...record, data: { from: 'To do', to: 'Doing' } });

            expect(db.projectTaskActivity.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    tenant_id: 'tenant-1',
                    task_id: 'task-1',
                    project_id: 'project-1',
                    type: 'STATUS_CHANGED',
                    data: { from: 'To do', to: 'Doing' },
                    actor_id: 'user-1',
                }),
            });
        });

        // The feed describes work that already happened. Failing the move that
        // succeeded, over an unwritten audit row, is the wrong trade.
        it('never throws when the write fails', async () => {
            db.projectTaskActivity.create.mockRejectedValue(new Error('db down'));

            await expect(service.record(record)).resolves.toBeNull();
        });
    });

    describe('watch', () => {
        it('is idempotent, so the implicit paths can call it freely', async () => {
            await service.watch('tenant-1', 'task-1', 'user-1');

            expect(db.projectTaskWatcher.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { task_id_user_id: { task_id: 'task-1', user_id: 'user-1' } },
                    update: {},
                }),
            );
        });

        it('does nothing without a user', async () => {
            await service.watch('tenant-1', 'task-1', '');
            expect(db.projectTaskWatcher.upsert).not.toHaveBeenCalled();
        });

        it('swallows a failure rather than failing the task write that called it', async () => {
            db.projectTaskWatcher.upsert.mockRejectedValue(new Error('db down'));
            await expect(service.watch('tenant-1', 'task-1', 'user-1')).resolves.toBeNull();
        });

        it('404s when unwatching something you were not watching', async () => {
            db.projectTaskWatcher.findFirst.mockResolvedValue(null);

            await expect(
                service.unwatch('tenant-1', 'task-1', 'user-1'),
            ).rejects.toBeInstanceOf(NotFoundException);
        });

        it('scopes the unwatch lookup to the tenant', async () => {
            await service.unwatch('tenant-1', 'task-1', 'user-1');

            expect(db.projectTaskWatcher.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ tenant_id: 'tenant-1' }),
                }),
            );
        });
    });

    describe('notifyWatchers', () => {
        it('notifies every watcher', async () => {
            db.projectTaskWatcher.findMany.mockResolvedValue([
                { user_id: 'user-2' },
                { user_id: 'user-3' },
            ]);

            const sent = await service.notifyWatchers({
                tenantId: 'tenant-1',
                taskId: 'task-1',
                actorId: 'user-1',
                title: 'Wire the meter',
                body: 'Moved to Doing',
            });

            expect(sent).toBe(2);
            expect(notifications.create).toHaveBeenCalledWith(
                'tenant-1',
                'user-2',
                'PROJECT_TASK',
                'Wire the meter',
                'Moved to Doing',
                undefined,
            );
        });

        // Being told about your own action is how a notification bell stops
        // being read.
        it('never notifies whoever caused it', async () => {
            db.projectTaskWatcher.findMany.mockResolvedValue([
                { user_id: 'user-1' },
                { user_id: 'user-2' },
            ]);

            const sent = await service.notifyWatchers({
                tenantId: 'tenant-1',
                taskId: 'task-1',
                actorId: 'user-1',
                title: 'Wire the meter',
                body: 'Moved to Doing',
            });

            expect(sent).toBe(1);
            expect(notifications.create).toHaveBeenCalledTimes(1);
            expect(notifications.create).not.toHaveBeenCalledWith(
                expect.anything(),
                'user-1',
                expect.anything(),
                expect.anything(),
                expect.anything(),
                expect.anything(),
            );
        });

        it('swallows a failed fan-out rather than failing the operation', async () => {
            db.projectTaskWatcher.findMany.mockRejectedValue(new Error('db down'));

            await expect(
                service.notifyWatchers({
                    tenantId: 'tenant-1',
                    taskId: 'task-1',
                    title: 'Wire the meter',
                    body: 'Moved',
                }),
            ).resolves.toBe(0);
        });
    });

    it('lists the feed newest first, scoped to the tenant and task', async () => {
        await service.list('tenant-1', 'task-1');

        expect(db.projectTaskActivity.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { tenant_id: 'tenant-1', task_id: 'task-1' },
                orderBy: { created_at: 'desc' },
            }),
        );
    });
});
