import { Test, TestingModule } from '@nestjs/testing';
import { TenantRecordScope } from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';
import { ProjectAccessService } from './project-access.service';
import { OWNER, narrow, staff } from './project-access.test-support';
import { ProjectsStaffingService } from './projects.staffing.service';

describe('ProjectsStaffingService', () => {
    let service: ProjectsStaffingService;
    let db: any;
    let access: any;

    const project = (over: Record<string, unknown> = {}) => ({
        id: 'p1',
        code: 'P1',
        name: 'Shop',
        short_name: null,
        status: 'ACTIVE',
        manager_id: null,
        manager: null,
        ...over,
    });

    beforeEach(async () => {
        db = {
            project: { findMany: jest.fn().mockResolvedValue([]) },
            projectMember: { findMany: jest.fn().mockResolvedValue([]) },
            projectTaskStatus: { findMany: jest.fn().mockResolvedValue([{ id: 'todo' }]) },
            projectTask: { groupBy: jest.fn().mockResolvedValue([]) },
            user: { findMany: jest.fn().mockResolvedValue([]) },
            employee: { findMany: jest.fn().mockResolvedValue([]) },
        };
        access = {
            projectFilter: jest.fn().mockResolvedValue({}),
            ownRecordsOnly: jest.fn().mockReturnValue(false),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ProjectsStaffingService,
                { provide: DatabaseService, useValue: db },
                { provide: ProjectAccessService, useValue: access },
            ],
        }).compile();
        service = module.get(ProjectsStaffingService);
    });

    it('asks projectFilter and only loads those projects', async () => {
        const filter = { visibility: 'PUBLIC' };
        access.projectFilter.mockResolvedValue(filter);
        await service.get(staff('u2'), {});
        expect(access.projectFilter).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u2' }));
        expect(db.project.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ status: { in: ['ACTIVE', 'ON_HOLD'] } }),
        }));
        expect(db.project.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ AND: expect.arrayContaining([filter]) }),
        }));
    });

    it('does not return a private project the filter excluded', async () => {
        const filter = { visibility: 'PUBLIC' };
        access.projectFilter.mockResolvedValue(filter);
        db.project.findMany.mockResolvedValue([
            { id: 'public-1', code: 'P1', name: 'Shop', short_name: null, status: 'ACTIVE', manager_id: null },
        ]);
        const out = await service.get(staff('u2'), {});
        expect(out.projects.map((p) => p.id)).toEqual(['public-1']);
        expect(db.project.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ AND: expect.arrayContaining([filter]) }),
        }));
    });

    it('drops teammates and unassigned when the viewer is OWN', async () => {
        const narrowStaff = narrow('user-staff');
        access.ownRecordsOnly.mockImplementation(
            (viewer: { recordScope?: TenantRecordScope }) => viewer.recordScope === TenantRecordScope.OWN,
        );
        db.project.findMany.mockResolvedValue([project()]);
        db.projectMember.findMany.mockResolvedValue([
            {
                project_id: 'p1',
                user_id: 'user-staff',
                employee_id: null,
                role: 'MEMBER',
                user: { id: 'user-staff', name: 'Staff', email: 'staff@x.com' },
                employee: null,
            },
            {
                project_id: 'p1',
                user_id: 'teammate',
                employee_id: null,
                role: 'MEMBER',
                user: { id: 'teammate', name: 'Teammate', email: 'tm@x.com' },
                employee: null,
            },
        ]);
        db.projectTask.groupBy.mockImplementation(async ({ by }: { by: string[] }) => {
            if (by.includes('assignee_id')) {
                return [
                    {
                        project_id: 'p1',
                        assignee_id: 'user-staff',
                        _sum: { remaining_hours: 3 },
                        _count: { _all: 1 },
                    },
                ];
            }
            if (by.includes('assignee_employee_id')) return [];
            return [{ project_id: 'p1', _sum: { remaining_hours: 8 }, _count: { _all: 2 } }];
        });

        const out = await service.get(narrowStaff, {});
        expect(out.people.map((p) => p.key)).toEqual(['user:user-staff']);
        expect(out.summary.unassignedRemainingHours).toBe(0);
        expect(out.summary.people).toBe(1);
    });

    it('includes a manager who has no member row', async () => {
        db.project.findMany.mockResolvedValue([
            project({
                manager_id: 'boss',
                manager: { id: 'boss', name: 'Boss', email: 'boss@x.com' },
            }),
        ]);
        db.projectMember.findMany.mockResolvedValue([]);
        const out = await service.get(OWNER, {});
        expect(out.people.some((p) => p.key === 'user:boss')).toBe(true);
    });

    it('does not paint Unassigned as manager when manager_id is null', async () => {
        db.project.findMany.mockResolvedValue([project({ manager_id: null, manager: null })]);
        const out = await service.get(OWNER, {});
        expect(out.people.find((p) => p.kind === 'unassigned')).toBeUndefined();
        expect(out.people).toEqual([]);
    });

    it('keeps COMPLETED when status is ALL', async () => {
        await service.get(OWNER, { status: 'ALL' });
        expect(db.project.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                status: { in: ['DRAFT', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'] },
            }),
        }));
    });

    it('looks up hours-only assignees so merge can name them', async () => {
        db.project.findMany.mockResolvedValue([project()]);
        db.projectMember.findMany.mockResolvedValue([]);
        db.projectTask.groupBy.mockImplementation(async ({ by }: { by: string[] }) => {
            if (by.includes('assignee_id')) {
                return [
                    {
                        project_id: 'p1',
                        assignee_id: 'ghost',
                        _sum: { remaining_hours: 4 },
                        _count: { _all: 1 },
                    },
                ];
            }
            return [];
        });
        db.user.findMany.mockResolvedValue([{ id: 'ghost', name: 'Amina', email: 'a@x.com' }]);

        const out = await service.get(OWNER, {});
        const amina = out.people.find((p) => p.key === 'user:ghost');
        expect(amina?.name).toBe('Amina');
        expect(amina?.cells['p1'].assignedNotOnTeam).toBe(true);
        expect(db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ id: { in: ['ghost'] } }),
        }));
    });

    it('coerces a null remaining sum to 0', async () => {
        db.project.findMany.mockResolvedValue([project()]);
        db.projectMember.findMany.mockResolvedValue([
            {
                project_id: 'p1',
                user_id: 'u1',
                employee_id: null,
                role: 'MEMBER',
                user: { id: 'u1', name: 'Karim', email: 'k@x.com' },
                employee: null,
            },
        ]);
        db.projectTask.groupBy.mockImplementation(async ({ by }: { by: string[] }) => {
            if (by.includes('assignee_id')) {
                return [
                    {
                        project_id: 'p1',
                        assignee_id: 'u1',
                        _sum: { remaining_hours: null },
                        _count: { _all: 1 },
                    },
                ];
            }
            return [];
        });

        const out = await service.get(OWNER, {});
        expect(out.people.find((p) => p.key === 'user:u1')!.cells['p1'].remainingHours).toBe(0);
    });

    it('sums remaining hours on open tasks of the loaded projects', async () => {
        db.project.findMany.mockResolvedValue([project()]);
        db.projectTaskStatus.findMany.mockResolvedValue([{ id: 'todo' }, { id: 'doing' }]);
        await service.get(OWNER, {});
        expect(db.projectTaskStatus.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                tenant_id: 'tenant-1',
                category: { not: 'DONE' },
            }),
        }));
        expect(db.projectTask.groupBy).toHaveBeenCalledWith(expect.objectContaining({
            by: ['project_id', 'assignee_id'],
            where: expect.objectContaining({
                project_id: { in: ['p1'] },
                status_id: { in: ['todo', 'doing'] },
                deleted_at: null,
                assignee_id: { not: null },
            }),
        }));
        expect(db.projectTask.groupBy).toHaveBeenCalledWith(expect.objectContaining({
            by: ['project_id', 'assignee_employee_id'],
            where: expect.objectContaining({ assignee_employee_id: { not: null } }),
        }));
        expect(db.projectTask.groupBy).toHaveBeenCalledWith(expect.objectContaining({
            by: ['project_id'],
            where: expect.objectContaining({ assignee_id: null, assignee_employee_id: null }),
        }));
    });
});
