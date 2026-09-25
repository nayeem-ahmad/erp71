import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ProjectBacklogService } from './project-backlog.service';
import { ProjectAccessService } from './project-access.service';
import { OWNER, accessDbMock } from './project-access.test-support';
import { DatabaseService } from '../database/database.service';

describe('ProjectBacklogService', () => {
    let service: ProjectBacklogService;
    let db: any;

    beforeEach(async () => {
        db = {
            ...accessDbMock(),
            project: {
                findFirst: jest.fn().mockResolvedValue({ id: 'project-1', code: 'OTB', name: 'Online till' }),
            },
            projectEpic: { findMany: jest.fn().mockResolvedValue([{ id: 'epic-1' }]) },
            projectUserStory: {
                findMany: jest.fn().mockResolvedValue([{ id: 'story-1', status: 'READY' }]),
                update: jest.fn().mockResolvedValue({}),
            },
            projectTask: {
                findMany: jest.fn().mockResolvedValue([
                    {
                        id: 'task-1',
                        reference: 7,
                        user_story_id: 'story-1',
                        estimate_hours: '4.50',
                        remaining_hours: null,
                        status: { category: 'IN_PROGRESS' },
                    },
                ]),
            },
            projectTimeEntry: {
                groupBy: jest.fn().mockResolvedValue([{ task_id: 'task-1', _sum: { hours: '2.25' } }]),
            },
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [ProjectBacklogService, ProjectAccessService, { provide: DatabaseService, useValue: db }],
        }).compile();

        service = module.get(ProjectBacklogService);
    });

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

    it('leaves subtasks and deleted tasks out, and scopes every read to the tenant', async () => {
        await service.get(OWNER, 'project-1');

        const taskWhere = JSON.stringify(db.projectTask.findMany.mock.calls.at(-1)[0].where);
        expect(taskWhere).toContain('"parent_task_id":null');
        expect(taskWhere).toContain('"deleted_at":null');
        expect(taskWhere).toContain('"tenant_id":"tenant-1"');
        expect(db.projectEpic.findMany.mock.calls[0][0].where).toEqual({
            tenant_id: 'tenant-1',
            project_id: 'project-1',
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
