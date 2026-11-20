import { SprintMembershipService } from './sprint-membership.service';
import { BurndownRecorder } from './burndown-recorder.service';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectSettingsService } from './project-settings.service';
import { ProjectAccessService } from './project-access.service';
import { OWNER } from './project-access.test-support';
import { DatabaseService } from '../database/database.service';

/** A budget split by category on Financials is not the project form's to change. */
describe('ProjectsService — budget split by category', () => {
    let service: ProjectsService;
    let db: any;

    const project = (overrides: Record<string, unknown> = {}) => ({
        id: 'project-1',
        visibility: 'PUBLIC',
        manager_id: 'user-1',
        ...overrides,
    });

    beforeEach(async () => {
        db = {
            project: {
                findFirst: jest.fn().mockResolvedValue(project()),
                findMany: jest.fn().mockResolvedValue([]),
                count: jest.fn().mockResolvedValue(0),
                create: jest.fn().mockResolvedValue(project()),
                update: jest.fn().mockResolvedValue(project()),
            },
            projectMember: { upsert: jest.fn().mockResolvedValue({}) },
            projectTask: { findMany: jest.fn().mockResolvedValue([]) },
            projectTimeEntry: { aggregate: jest.fn().mockResolvedValue({ _sum: { hours: 0 } }) },
            userStorePermission: { findFirst: jest.fn().mockResolvedValue(null) },
            projectBudgetLine: {
                aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null }, _count: { _all: 0 } }),
            },
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ProjectsService,
                SprintMembershipService,
                { provide: BurndownRecorder, useValue: { record: jest.fn() } },
                ProjectAccessService,
                { provide: DatabaseService, useValue: db },
                {
                    provide: ProjectSettingsService,
                    useValue: { seedProjectColumns: jest.fn().mockResolvedValue(undefined) },
                },
            ],
        }).compile();
        service = module.get(ProjectsService);
    });

    const split = (total: number) =>
        db.projectBudgetLine.aggregate.mockResolvedValue({ _sum: { amount: total }, _count: { _all: 2 } });

    it('sets the budget as before while it is not split', async () => {
        await service.update(OWNER, 'project-1', { budgetAmount: 5000 } as never);

        expect(db.project.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ budget_amount: 5000 }),
        }));
    });

    it('takes back the same figure the lines add up to — the form always sends it', async () => {
        split(7500.5);

        await service.update(OWNER, 'project-1', { name: 'Renamed', budgetAmount: 7500.5 } as never);

        expect(db.project.update).toHaveBeenCalled();
    });

    it('refuses a different figure, or clearing it, while the budget is split', async () => {
        split(7500.5);

        await expect(service.update(OWNER, 'project-1', { budgetAmount: 9000 } as never)).rejects.toThrow(BadRequestException);
        await expect(service.update(OWNER, 'project-1', { budgetAmount: null } as never)).rejects.toThrow(BadRequestException);
        expect(db.project.update).not.toHaveBeenCalled();
    });

    it('does not look at the split when the budget is not being changed', async () => {
        split(7500.5);

        await service.update(OWNER, 'project-1', { name: 'Renamed' } as never);

        expect(db.projectBudgetLine.aggregate).not.toHaveBeenCalled();
        expect(db.project.update).toHaveBeenCalled();
    });
});
