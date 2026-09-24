import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ProjectEpicsService } from './project-epics.service';
import { ProjectAccessService } from './project-access.service';
import { OWNER, accessDbMock, staff, visibilityOr } from './project-access.test-support';
import { DatabaseService } from '../database/database.service';

describe('ProjectEpicsService', () => {
    let service: ProjectEpicsService;
    let db: any;

    const epic = (overrides: Record<string, unknown> = {}) => ({
        id: 'epic-1',
        tenant_id: 'tenant-1',
        project_id: 'project-1',
        reference: 1,
        code: 'OTB-E1',
        title: 'Online payments',
        description: null,
        status: 'OPEN',
        priority: 'MEDIUM',
        color: 'BLUE',
        sort_order: 0,
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
            projectEpic: {
                findFirst: jest.fn().mockResolvedValue(epic()),
                findMany: jest.fn().mockResolvedValue([epic()]),
                create: jest.fn().mockImplementation(({ data }: any) => ({ id: 'epic-new', ...data })),
                update: jest.fn().mockResolvedValue(epic()),
                delete: jest.fn().mockResolvedValue({}),
            },
            projectUserStory: {
                findMany: jest.fn().mockResolvedValue([]),
                updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
            projectTask: {
                findMany: jest.fn().mockResolvedValue([]),
            },
            $transaction: jest.fn().mockResolvedValue([]),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ProjectEpicsService,
                ProjectAccessService,
                { provide: DatabaseService, useValue: db },
            ],
        }).compile();

        service = module.get(ProjectEpicsService);
    });

    describe('create', () => {
        it('numbers the first epic OTB-E1, so it cannot be mistaken for story OTB-1', async () => {
            db.projectEpic.findFirst.mockResolvedValue(null);
            db.projectEpic.findMany.mockResolvedValue([]);

            const created: any = await service.create(OWNER, {
                projectId: 'project-1',
                title: 'Online payments',
            } as never);

            expect(created).toMatchObject({
                reference: 1,
                code: 'OTB-E1',
                status: 'OPEN',
                color: 'BLUE',
                sort_order: 0,
                start_date: null,
            });
        });

        it('skips past a default ID somebody already typed by hand', async () => {
            db.projectEpic.findFirst.mockResolvedValue({ reference: 1, sort_order: 0 });
            db.projectEpic.findMany.mockResolvedValue([{ code: 'OTB-E2' }]);

            const created: any = await service.create(OWNER, {
                projectId: 'project-1',
                title: 'Reporting',
            } as never);

            expect(created.reference).toBe(2);
            expect(created.code).toBe('OTB-E3');
        });

        it('refuses a typed ID another epic in the project already has', async () => {
            db.projectEpic.findFirst
                .mockResolvedValueOnce(null) // sort order
                .mockResolvedValueOnce({ id: 'epic-2' }); // ID clash check

            await expect(
                service.create(OWNER, { projectId: 'project-1', title: 'X', code: 'otb-e1' } as never),
            ).rejects.toBeInstanceOf(ConflictException);
            expect(db.projectEpic.create).not.toHaveBeenCalled();
        });

        it('will not write an epic onto a project the viewer cannot see', async () => {
            db.project.findFirst.mockResolvedValue(null);

            await expect(
                service.create(staff('user-7'), { projectId: 'project-1', title: 'X' } as never),
            ).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe('list', () => {
        it('rolls up stories, points and the tasks under those stories per epic', async () => {
            db.projectEpic.findMany.mockResolvedValue([epic(), epic({ id: 'epic-2' })]);
            db.projectUserStory.findMany.mockResolvedValue([
                { id: 's1', epic_id: 'epic-1', status: 'DONE', story_points: 3 },
                { id: 's2', epic_id: 'epic-1', status: 'READY', story_points: 5 },
                { id: 's3', epic_id: 'epic-1', status: 'BACKLOG', story_points: null },
            ]);
            db.projectTask.findMany.mockResolvedValue([
                { user_story_id: 's1', status: { category: 'DONE' } },
                { user_story_id: 's2', status: { category: 'TODO' } },
            ]);

            const rows: any = await service.list(OWNER, { projectId: 'project-1' } as never);

            expect(db.projectTask.findMany).toHaveBeenCalledTimes(1);
            expect(rows[0].progress).toEqual({
                storyCount: 3,
                doneStoryCount: 1,
                storyPoints: 8,
                doneStoryPoints: 3,
                taskCount: 2,
                doneTaskCount: 1,
                percentComplete: 33,
            });
            expect(rows[1].progress).toMatchObject({ storyCount: 0, percentComplete: 0 });
        });

        it('skips the task query when no epic has stories yet', async () => {
            await service.list(OWNER, {} as never);
            expect(db.projectTask.findMany).not.toHaveBeenCalled();
        });

        it('keeps a private project’s epics out of a cross-project list', async () => {
            await service.list(staff('user-7'), {} as never);

            expect(db.projectEpic.findMany.mock.calls[0][0].where).toMatchObject({
                AND: [{ project: { OR: visibilityOr('user-7') } }],
            });
        });
    });

    describe('update', () => {
        it('clears the description and a date with empty strings', async () => {
            await service.update(OWNER, 'epic-1', { description: '', targetDate: '' } as never);

            expect(db.projectEpic.update.mock.calls[0][0].data).toEqual({
                description: null,
                target_date: null,
            });
        });

        it('refuses an empty epic ID', async () => {
            await expect(service.update(OWNER, 'epic-1', { code: '  ' } as never)).rejects.toThrow(
                'Epic ID cannot be empty',
            );
        });

        it('reports an epic on an invisible project as missing', async () => {
            db.projectEpic.findFirst.mockResolvedValue(null);
            await expect(service.update(OWNER, 'epic-1', { title: 'X' } as never)).rejects.toBeInstanceOf(
                NotFoundException,
            );
        });
    });

    describe('remove', () => {
        it('detaches the stories rather than deleting them', async () => {
            await service.remove(OWNER, 'epic-1');

            expect(db.projectUserStory.updateMany).toHaveBeenCalledWith({
                where: { tenant_id: 'tenant-1', epic_id: 'epic-1' },
                data: { epic_id: null },
            });
            expect(db.projectEpic.delete).toHaveBeenCalledWith({ where: { id: 'epic-1' } });
        });
    });

    describe('importRows', () => {
        it('creates epics under the project named by code, keeping IDs the file gives', async () => {
            db.projectEpic.findFirst.mockResolvedValue(null);
            db.projectEpic.findMany.mockResolvedValue([]);

            const result = await service.importRows(
                OWNER,
                [
                    { project: 'otb', code: 'JIRA-E7', title: 'Payments', color: 'purple' },
                    { project: 'OTB', title: 'Reporting', targetDate: '2026-12-31' },
                    { project: 'NOPE', title: 'Lost' },
                ],
                'skip',
            );

            expect(result).toMatchObject({ created: 2 });
            expect(result.errors[0]).toContain('no project matches "NOPE"');
            const created = db.projectEpic.create.mock.calls.map((call: any) => call[0].data);
            expect(created[0]).toMatchObject({ code: 'JIRA-E7', color: 'PURPLE' });
            expect(created[1]).toMatchObject({ code: 'OTB-E1', title: 'Reporting' });
            expect(created[1].target_date).toEqual(new Date('2026-12-31'));
        });
    });

    describe('findOne', () => {
        it('returns the epic with its stories in backlog order', async () => {
            db.projectUserStory.findMany
                .mockResolvedValueOnce([{ id: 's1', code: 'OTB-1', title: 'bKash' }])
                .mockResolvedValueOnce([]);

            const result: any = await service.findOne(OWNER, 'epic-1');

            expect(result.id).toBe('epic-1');
            expect(result.stories).toHaveLength(1);
            expect(db.projectUserStory.findMany.mock.calls[0][0].where).toEqual({
                tenant_id: 'tenant-1',
                epic_id: 'epic-1',
            });
        });
    });
});
