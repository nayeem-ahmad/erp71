import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ProjectStoriesService } from './project-stories.service';
import { ProjectAccessService } from './project-access.service';
import {
    OWNER,
    accessDbMock,
    attachEmployeeLookup,
    narrow,
    ownTaskOr,
    staff,
    visibilityOr,
} from './project-access.test-support';
import { DatabaseService } from '../database/database.service';

describe('ProjectStoriesService', () => {
    let service: ProjectStoriesService;
    let db: any;

    const story = (overrides: Record<string, unknown> = {}) => ({
        id: 'story-1',
        tenant_id: 'tenant-1',
        project_id: 'project-1',
        reference: 1,
        title: 'Shopper pays with bKash',
        as_a: 'shopper',
        i_want: 'to pay with bKash',
        so_that: 'I do not have to carry cash',
        acceptance_criteria: null,
        status: 'BACKLOG',
        priority: 'MEDIUM',
        story_points: 5,
        sort_order: 0,
        ...overrides,
    });

    const task = (overrides: Record<string, unknown> = {}) => ({
        id: 'task-1',
        user_story_id: 'story-1',
        status: { category: 'TODO' },
        ...overrides,
    });

    beforeEach(async () => {
        db = {
            ...accessDbMock(),
            project: { findFirst: jest.fn().mockResolvedValue({ id: 'project-1' }) },
            projectUserStory: {
                findFirst: jest.fn().mockResolvedValue(story()),
                findMany: jest.fn().mockResolvedValue([story()]),
                create: jest.fn().mockImplementation(({ data }: any) => ({ id: 'story-new', ...data })),
                update: jest.fn().mockResolvedValue(story()),
                delete: jest.fn().mockResolvedValue({}),
            },
            projectTask: {
                findMany: jest.fn().mockResolvedValue([]),
                updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
            $transaction: jest.fn().mockResolvedValue([]),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ProjectStoriesService,
                ProjectAccessService,
                { provide: DatabaseService, useValue: db },
            ],
        }).compile();

        service = module.get(ProjectStoriesService);
    });

    describe('create', () => {
        it('numbers the first story of a project US-1', async () => {
            db.projectUserStory.findFirst.mockResolvedValue(null);

            const created: any = await service.create(OWNER, {
                projectId: 'project-1',
                title: 'Shopper pays with bKash',
            } as never);

            expect(created.reference).toBe(1);
            expect(created.sort_order).toBe(0);
        });

        it('continues from the highest reference rather than the story count', async () => {
            // Deleting US-2 must not hand its number to the next story written:
            // two different stories called US-2 make every older note wrong.
            db.projectUserStory.findFirst.mockResolvedValue({ reference: 7, sort_order: 3 });

            const created: any = await service.create(OWNER, {
                projectId: 'project-1',
                title: 'Refunds',
            } as never);

            expect(created.reference).toBe(8);
            expect(created.sort_order).toBe(4);
        });

        it('retries the reference when two stories are written at once', async () => {
            db.projectUserStory.findFirst.mockResolvedValue({ reference: 2, sort_order: 0 });
            db.projectUserStory.create
                .mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }))
                .mockResolvedValueOnce(story({ reference: 3 }));

            const created: any = await service.create(OWNER, {
                projectId: 'project-1',
                title: 'Refunds',
            } as never);

            expect(db.projectUserStory.create).toHaveBeenCalledTimes(2);
            expect(created.reference).toBe(3);
        });

        it('stores the narrative trimmed, and a blank half as nothing at all', async () => {
            db.projectUserStory.findFirst.mockResolvedValue(null);

            await service.create(OWNER, {
                projectId: 'project-1',
                title: '  Shopper pays with bKash  ',
                asA: ' shopper ',
                soThat: '   ',
            } as never);

            const data = db.projectUserStory.create.mock.calls[0][0].data;
            expect(data).toMatchObject({
                title: 'Shopper pays with bKash',
                as_a: 'shopper',
                so_that: null,
                status: 'BACKLOG',
            });
        });

        it('refuses a project the viewer cannot open', async () => {
            db.project.findFirst.mockResolvedValue(null);

            await expect(
                service.create(staff('user-7'), {
                    projectId: 'project-1',
                    title: 'Refunds',
                } as never),
            ).rejects.toBeInstanceOf(NotFoundException);
            expect(db.projectUserStory.create).not.toHaveBeenCalled();
        });
    });

    describe('list', () => {
        it('counts the tasks under each story without a query per story', async () => {
            db.projectUserStory.findMany.mockResolvedValue([story(), story({ id: 'story-2' })]);
            db.projectTask.findMany.mockResolvedValue([
                task(),
                task({ id: 'task-2', status: { category: 'DONE' } }),
                task({ id: 'task-3', user_story_id: 'story-2', status: { category: 'DONE' } }),
            ]);

            const rows: any = await service.list(OWNER, { projectId: 'project-1' } as never);

            expect(db.projectTask.findMany).toHaveBeenCalledTimes(1);
            expect(rows[0].progress).toEqual({
                taskCount: 2,
                doneTaskCount: 1,
                percentComplete: 50,
            });
            expect(rows[1].progress).toEqual({
                taskCount: 1,
                doneTaskCount: 1,
                percentComplete: 100,
            });
        });

        it('reports a story nobody has broken down yet as 0%, not as complete', async () => {
            const rows: any = await service.list(OWNER, { projectId: 'project-1' } as never);
            expect(rows[0].progress).toEqual({
                taskCount: 0,
                doneTaskCount: 0,
                percentComplete: 0,
            });
        });

        it('keeps a private project’s stories out of a cross-project list', async () => {
            await service.list(staff('user-7'), {} as never);

            expect(db.projectUserStory.findMany.mock.calls[0][0].where).toMatchObject({
                AND: [{ project: { OR: visibilityOr('user-7') } }],
            });
        });

        it('searches the title and the want together, without losing the visibility filter', async () => {
            await service.list(staff('user-7'), { search: 'bKash' } as never);

            const where = db.projectUserStory.findMany.mock.calls[0][0].where;
            // Merged, not spread: the search owns `OR`, and a second `OR` key on
            // the same object would silently replace it.
            expect(where.OR).toHaveLength(2);
            expect(where.AND).toEqual([{ project: { OR: visibilityOr('user-7') } }]);
        });

        it('drops the stories of a deleted project', async () => {
            await service.list(OWNER, {} as never);

            expect(db.projectUserStory.findMany.mock.calls[0][0].where).toMatchObject({
                project: { deleted_at: null },
            });
        });

        it('counts only the tasks a narrow viewer may see', async () => {
            attachEmployeeLookup(db);

            await service.list(narrow('user-9'), { projectId: 'project-1' } as never);

            expect(db.projectTask.findMany.mock.calls[0][0].where.AND).toEqual(
                expect.arrayContaining([{ OR: ownTaskOr('user-9') }]),
            );
        });
    });

    describe('remove', () => {
        it('detaches the tasks instead of deleting the work with the story', async () => {
            await service.remove(OWNER, 'story-1');

            expect(db.projectTask.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ user_story_id: 'story-1' }),
                    data: { user_story_id: null },
                }),
            );
            expect(db.projectUserStory.delete).toHaveBeenCalledWith({ where: { id: 'story-1' } });
        });

        it('reports a story on an unreachable project as missing', async () => {
            db.projectUserStory.findFirst.mockResolvedValue(null);

            await expect(service.remove(staff('user-7'), 'story-1')).rejects.toBeInstanceOf(
                NotFoundException,
            );
            expect(db.projectUserStory.delete).not.toHaveBeenCalled();
        });
    });

    describe('update', () => {
        it('leaves out every field the request did not mention', async () => {
            await service.update(OWNER, 'story-1', { status: 'READY' } as never);

            expect(db.projectUserStory.update.mock.calls[0][0].data).toEqual({ status: 'READY' });
        });

        it('clears the points on an explicit null and keeps a zero as a zero', async () => {
            await service.update(OWNER, 'story-1', { storyPoints: null } as never);
            expect(db.projectUserStory.update.mock.calls[0][0].data).toEqual({ story_points: null });

            await service.update(OWNER, 'story-1', { storyPoints: 0 } as never);
            expect(db.projectUserStory.update.mock.calls[1][0].data).toEqual({ story_points: 0 });
        });

        it('cannot move a story to another project', async () => {
            await service.update(OWNER, 'story-1', {
                projectId: 'project-2',
                title: 'Refunds',
            } as never);

            const data = db.projectUserStory.update.mock.calls[0][0].data;
            expect(data).not.toHaveProperty('project_id');
        });
    });

    describe('findOne', () => {
        it('returns the story with the tasks under it', async () => {
            db.projectTask.findMany.mockResolvedValue([task()]);

            const result: any = await service.findOne(OWNER, 'story-1');

            expect(result.id).toBe('story-1');
            expect(result.tasks).toHaveLength(1);
            expect(db.projectTask.findMany.mock.calls[0][0].where).toMatchObject({
                user_story_id: 'story-1',
                deleted_at: null,
            });
        });
    });
});
