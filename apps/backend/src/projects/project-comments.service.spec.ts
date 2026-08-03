import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProjectCommentsService } from './project-comments.service';
import { ProjectActivityService } from './project-activity.service';
import { DatabaseService } from '../database/database.service';

describe('ProjectCommentsService', () => {
    let service: ProjectCommentsService;
    let db: any;
    let activity: { notifyWatchers: jest.Mock; watch: jest.Mock };

    beforeEach(async () => {
        activity = {
            notifyWatchers: jest.fn().mockResolvedValue(0),
            watch: jest.fn().mockResolvedValue(null),
        };

        db = {
            projectTask: {
                findFirst: jest.fn().mockResolvedValue({
                    id: 'task-1',
                    project_id: 'project-1',
                    title: 'Wire the meter',
                }),
            },
            projectComment: {
                findMany: jest.fn().mockResolvedValue([]),
                findFirst: jest.fn().mockResolvedValue({ id: 'comment-1', user_id: 'user-1' }),
                create: jest.fn().mockResolvedValue({ id: 'comment-new', body: 'Looks done' }),
                update: jest.fn().mockResolvedValue({}),
                delete: jest.fn().mockResolvedValue({}),
            },
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ProjectCommentsService,
                { provide: DatabaseService, useValue: db },
                { provide: ProjectActivityService, useValue: activity },
            ],
        }).compile();

        service = module.get(ProjectCommentsService);
    });

    describe('create', () => {
        it('stores the comment against the task and its project', async () => {
            await service.create('tenant-1', 'user-1', 'task-1', { body: '  Looks done  ' } as never);

            expect(db.projectComment.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        tenant_id: 'tenant-1',
                        task_id: 'task-1',
                        project_id: 'project-1',
                        user_id: 'user-1',
                        // Trimmed — trailing whitespace is not part of what was said.
                        body: 'Looks done',
                    }),
                }),
            );
        });

        it('notifies the watchers, naming the commenter as the actor', async () => {
            await service.create('tenant-1', 'user-1', 'task-1', { body: 'Looks done' } as never);

            expect(activity.notifyWatchers).toHaveBeenCalledWith(
                expect.objectContaining({ taskId: 'task-1', actorId: 'user-1' }),
            );
        });

        // Otherwise the author is in the watcher set by the time the fan-out
        // reads it, and gets notified about their own comment.
        it('notifies before subscribing the author', async () => {
            const order: string[] = [];
            activity.notifyWatchers.mockImplementation(async () => order.push('notify'));
            activity.watch.mockImplementation(async () => order.push('watch'));

            await service.create('tenant-1', 'user-1', 'task-1', { body: 'Looks done' } as never);

            expect(order).toEqual(['notify', 'watch']);
        });

        it('subscribes the author so they hear the replies', async () => {
            await service.create('tenant-1', 'user-1', 'task-1', { body: 'Looks done' } as never);
            expect(activity.watch).toHaveBeenCalledWith('tenant-1', 'task-1', 'user-1');
        });

        it('refuses a task from another tenant', async () => {
            db.projectTask.findFirst.mockResolvedValue(null);

            await expect(
                service.create('tenant-2', 'user-1', 'task-1', { body: 'Looks done' } as never),
            ).rejects.toBeInstanceOf(NotFoundException);
            expect(db.projectComment.create).not.toHaveBeenCalled();
        });
    });

    describe('update and remove', () => {
        it('edits your own comment', async () => {
            await service.update('tenant-1', 'user-1', 'comment-1', { body: 'Revised' } as never);

            expect(db.projectComment.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: { body: 'Revised' } }),
            );
        });

        // The feed is an audit trail; nobody rewrites anybody else's line in it.
        it('refuses to edit someone else’s comment', async () => {
            db.projectComment.findFirst.mockResolvedValue({
                id: 'comment-1',
                user_id: 'someone-else',
            });

            await expect(
                service.update('tenant-1', 'user-1', 'comment-1', { body: 'Revised' } as never),
            ).rejects.toBeInstanceOf(ForbiddenException);
            expect(db.projectComment.update).not.toHaveBeenCalled();
        });

        it('refuses to delete someone else’s comment', async () => {
            db.projectComment.findFirst.mockResolvedValue({
                id: 'comment-1',
                user_id: 'someone-else',
            });

            await expect(
                service.remove('tenant-1', 'user-1', 'comment-1'),
            ).rejects.toBeInstanceOf(ForbiddenException);
            expect(db.projectComment.delete).not.toHaveBeenCalled();
        });

        it('scopes the comment lookup to the tenant', async () => {
            await service.remove('tenant-1', 'user-1', 'comment-1');

            expect(db.projectComment.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ tenant_id: 'tenant-1' }),
                }),
            );
        });

        it('404s on a comment that does not exist', async () => {
            db.projectComment.findFirst.mockResolvedValue(null);

            await expect(
                service.remove('tenant-1', 'user-1', 'missing'),
            ).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    it('lists newest first, scoped to the task', async () => {
        await service.list('tenant-1', 'task-1');

        expect(db.projectComment.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { tenant_id: 'tenant-1', task_id: 'task-1' },
                orderBy: { created_at: 'desc' },
            }),
        );
    });
});
