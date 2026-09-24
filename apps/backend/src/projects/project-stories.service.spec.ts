import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
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
        code: 'OTB-1',
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
            project: {
                findFirst: jest.fn().mockResolvedValue({ id: 'project-1' }),
                findUnique: jest.fn().mockResolvedValue({ code: 'OTB' }),
                findMany: jest.fn().mockResolvedValue([
                    { id: 'project-1', code: 'OTB', short_name: null, name: 'Online till' },
                ]),
            },
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
            projectEpic: {
                findFirst: jest.fn().mockResolvedValue({ project_id: 'project-1' }),
                findMany: jest.fn().mockResolvedValue([
                    { id: 'epic-1', project_id: 'project-1', code: 'OTB-E1', title: 'Online payments' },
                ]),
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
        it('numbers the first story of a project OTB-1, after the project code', async () => {
            db.projectUserStory.findFirst.mockResolvedValue(null);
            db.projectUserStory.findMany.mockResolvedValue([]);

            const created: any = await service.create(OWNER, {
                projectId: 'project-1',
                title: 'Shopper pays with bKash',
            } as never);

            expect(created.reference).toBe(1);
            expect(created.code).toBe('OTB-1');
            expect(created.sort_order).toBe(0);
        });

        it('skips past a default ID somebody already typed by hand', async () => {
            db.projectUserStory.findFirst.mockResolvedValue({ reference: 4, sort_order: 0 });
            db.projectUserStory.findMany.mockResolvedValue([{ code: 'OTB-5' }, { code: 'otb-6' }]);

            const created: any = await service.create(OWNER, {
                projectId: 'project-1',
                title: 'Refunds',
            } as never);

            expect(created.reference).toBe(5);
            expect(created.code).toBe('OTB-7');
        });

        it('keeps a typed ID as written', async () => {
            db.projectUserStory.findFirst
                .mockResolvedValueOnce(null) // sort order
                .mockResolvedValueOnce(null) // ID clash check
                .mockResolvedValueOnce(null); // reference

            const created: any = await service.create(OWNER, {
                projectId: 'project-1',
                title: 'Refunds',
                code: ' LEGACY-42 ',
            } as never);

            expect(created.code).toBe('LEGACY-42');
        });

        it('refuses a typed ID another story in the project already has', async () => {
            db.projectUserStory.findFirst
                .mockResolvedValueOnce(null) // sort order
                .mockResolvedValueOnce({ id: 'story-2' }); // ID clash check

            await expect(
                service.create(OWNER, { projectId: 'project-1', title: 'Refunds', code: 'otb-1' } as never),
            ).rejects.toBeInstanceOf(ConflictException);
            expect(db.projectUserStory.create).not.toHaveBeenCalled();
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

        it('searches the ID, the title and the want together, without losing the visibility filter', async () => {
            await service.list(staff('user-7'), { search: 'bKash' } as never);

            const where = db.projectUserStory.findMany.mock.calls[0][0].where;
            // Merged, not spread: the search owns `OR`, and a second `OR` key on
            // the same object would silently replace it.
            expect(where.OR).toHaveLength(3);
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

        it('narrows to one priority when asked, and to none when not', async () => {
            await service.list(OWNER, { priority: 'URGENT' } as never);
            expect(db.projectUserStory.findMany.mock.calls[0][0].where).toMatchObject({
                priority: 'URGENT',
            });

            await service.list(OWNER, {} as never);
            // Absent rather than undefined: a `priority: undefined` key reaches
            // Prisma as a filter on nothing and is easy to read as intentional.
            expect(db.projectUserStory.findMany.mock.calls[1][0].where).not.toHaveProperty('priority');
        });

        it('groups a cross-project list by project, keeping each backlog in its own order', async () => {
            await service.list(OWNER, {} as never);

            // Without the project key first this interleaves every project's
            // US-1, then every project's US-2 — `sort_order` is only meaningful
            // within one backlog.
            expect(db.projectUserStory.findMany.mock.calls[0][0].orderBy).toEqual([
                { project: { code: 'asc' } },
                { sort_order: 'asc' },
                { reference: 'asc' },
            ]);
        });

        it('leaves one project’s backlog in the order somebody arranged it', async () => {
            await service.list(OWNER, { projectId: 'project-1' } as never);

            expect(db.projectUserStory.findMany.mock.calls[0][0].orderBy).toEqual([
                { sort_order: 'asc' },
                { reference: 'asc' },
            ]);
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

        it('renames the story ID when it is free', async () => {
            db.projectUserStory.findFirst
                .mockResolvedValueOnce(story()) // assertStory
                .mockResolvedValueOnce(null); // ID clash check

            await service.update(OWNER, 'story-1', { code: 'OTB-100' } as never);

            expect(db.projectUserStory.update.mock.calls[0][0].data).toEqual({ code: 'OTB-100' });
        });

        it('refuses a story ID another story in the project already has', async () => {
            db.projectUserStory.findFirst
                .mockResolvedValueOnce(story()) // assertStory
                .mockResolvedValueOnce({ id: 'story-2' }); // ID clash check

            await expect(
                service.update(OWNER, 'story-1', { code: 'OTB-2' } as never),
            ).rejects.toBeInstanceOf(ConflictException);
            expect(db.projectUserStory.update).not.toHaveBeenCalled();
        });
    });

    describe('importRows', () => {
        it('creates stories under the project named by code, keeping IDs the file gives', async () => {
            db.projectUserStory.findFirst.mockResolvedValue(null);
            db.projectUserStory.findMany.mockResolvedValue([]);

            const result = await service.importRows(
                OWNER,
                [
                    { project: 'otb', code: 'JIRA-12', title: 'Refunds', priority: 'high', storyPoints: '3' },
                    { project: 'OTB', title: 'Receipts' },
                ],
                'skip',
            );

            expect(result).toMatchObject({ created: 2, skipped: 0, errors: [] });
            const created = db.projectUserStory.create.mock.calls.map((call: any) => call[0].data);
            expect(created[0]).toMatchObject({ code: 'JIRA-12', priority: 'HIGH', story_points: 3 });
            expect(created[1]).toMatchObject({ code: 'OTB-1', title: 'Receipts' });
        });

        it('reports a row naming an unknown project, and a bad status, without stopping', async () => {
            const result = await service.importRows(
                OWNER,
                [
                    { project: 'NOPE', title: 'Refunds' },
                    { project: 'OTB', title: 'Refunds', status: 'finished' },
                ],
                'skip',
            );

            expect(result.created).toBe(0);
            expect(result.errors).toHaveLength(2);
            expect(result.errors[0]).toContain('no project matches "NOPE"');
            expect(result.errors[1]).toContain('Status must be one of');
        });

        it('skips a row whose story ID already exists, unless asked to update', async () => {
            db.projectUserStory.findFirst.mockResolvedValue(story());

            const skipped = await service.importRows(
                OWNER,
                [{ project: 'OTB', code: 'OTB-1', title: 'Renamed' }],
                'skip',
            );
            expect(skipped).toMatchObject({ created: 0, skipped: 1 });

            const updated = await service.importRows(
                OWNER,
                [{ project: 'OTB', code: 'OTB-1', title: 'Renamed' }],
                'upsert',
            );
            expect(updated).toMatchObject({ updated: 1 });
            expect(db.projectUserStory.update.mock.calls[0][0].data).toEqual({ title: 'Renamed' });
        });
    });

    describe('epics', () => {
        it('files a new story under an epic in the same project', async () => {
            db.projectUserStory.findFirst.mockResolvedValue(null);
            db.projectUserStory.findMany.mockResolvedValue([]);

            const created: any = await service.create(OWNER, {
                projectId: 'project-1',
                title: 'Pay with bKash',
                epicId: 'epic-1',
            } as never);

            expect(created.epic_id).toBe('epic-1');
        });

        it('refuses an epic from another project', async () => {
            db.projectEpic.findFirst.mockResolvedValue({ project_id: 'project-2' });

            await expect(
                service.update(OWNER, 'story-1', { epicId: 'epic-9' } as never),
            ).rejects.toThrow('different project');
            expect(db.projectUserStory.update).not.toHaveBeenCalled();
        });

        it('takes a story out of its epic with an empty string', async () => {
            await service.update(OWNER, 'story-1', { epicId: '' } as never);

            expect(db.projectEpic.findFirst).not.toHaveBeenCalled();
            expect(db.projectUserStory.update.mock.calls[0][0].data).toEqual({ epic_id: null });
        });

        it('filters the list to one epic, or to stories under none', async () => {
            await service.list(OWNER, { epicId: 'epic-1' } as never);
            expect(db.projectUserStory.findMany.mock.calls[0][0].where).toMatchObject({ epic_id: 'epic-1' });

            await service.list(OWNER, { noEpic: 'true' } as never);
            expect(db.projectUserStory.findMany.mock.calls[1][0].where).toMatchObject({ epic_id: null });
        });

        it('imports the epic column by ID or title, within the row’s project', async () => {
            db.projectUserStory.findFirst.mockResolvedValue(null);
            db.projectUserStory.findMany.mockResolvedValue([]);

            const result = await service.importRows(
                OWNER,
                [
                    { project: 'OTB', title: 'Pay with bKash', epic: 'otb-e1' },
                    { project: 'OTB', title: 'Pay with Nagad', epic: 'online payments' },
                    { project: 'OTB', title: 'Pay with cash', epic: 'Nope' },
                ],
                'skip',
            );

            expect(result.created).toBe(2);
            expect(result.errors[0]).toContain('no epic in that project matches "Nope"');
            const created = db.projectUserStory.create.mock.calls.map((call: any) => call[0].data);
            expect(created.map((row: any) => row.epic_id)).toEqual(['epic-1', 'epic-1']);
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
