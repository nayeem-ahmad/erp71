import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectSettingsService } from './project-settings.service';
import { ProjectAccessService } from './project-access.service';
import { OWNER, staff } from './project-access.test-support';
import { DatabaseService } from '../database/database.service';

/**
 * Phase 2 widened a project member from "a workspace user" to "a workspace user
 * OR an employee with no login", and changed project deletion so it no longer
 * takes a shared sprint's task rows down with it.
 */
describe('ProjectsService — members and deletion', () => {
    let service: ProjectsService;
    let db: any;

    beforeEach(async () => {
        db = {
            project: {
                findFirst: jest.fn().mockResolvedValue({ id: 'project-1' }),
                update: jest.fn().mockResolvedValue({}),
                count: jest.fn().mockResolvedValue(0),
            },
            projectTask: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
            projectMember: { upsert: jest.fn().mockResolvedValue({}), deleteMany: jest.fn().mockResolvedValue({}) },
            tenantUser: {
                findFirst: jest.fn().mockResolvedValue({ id: 'tu-1' }),
                findMany: jest.fn().mockResolvedValue([]),
            },
            userStorePermission: { findFirst: jest.fn().mockResolvedValue(null) },
            employee: {
                findFirst: jest.fn().mockResolvedValue({ id: 'emp-1' }),
                findMany: jest.fn().mockResolvedValue([]),
            },
            $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ProjectsService,
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

    describe('addMember', () => {
        it('adds a workspace user', async () => {
            await service.addMember(OWNER, 'project-1', { userId: 'user-1' } as never);

            expect(db.projectMember.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    create: expect.objectContaining({ user_id: 'user-1', project_id: 'project-1' }),
                }),
            );
        });

        it('adds an employee who has no login at all', async () => {
            await service.addMember(OWNER, 'project-1', { employeeId: 'emp-1' } as never);

            // Never looks for a tenantUser row — that is the point: this person
            // has no account to find.
            expect(db.tenantUser.findFirst).not.toHaveBeenCalled();
            expect(db.projectMember.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    create: expect.objectContaining({ employee_id: 'emp-1' }),
                }),
            );
        });

        it.each([
            ['neither', {}],
            ['both', { userId: 'user-1', employeeId: 'emp-1' }],
        ])('refuses %s — the row would belong to nobody or to two people', async (_label, dto) => {
            await expect(
                service.addMember(OWNER, 'project-1', dto as never),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(db.projectMember.upsert).not.toHaveBeenCalled();
        });

        // The two rejections used to share one message, so an empty request
        // told people to un-pick a second person they had never picked.
        it('tells an empty request to pick somebody, not to pick fewer people', async () => {
            await expect(service.addMember(OWNER, 'project-1', {} as never)).rejects.toThrow(
                /pick the person/i,
            );
        });

        it('refuses an employee from another tenant', async () => {
            db.employee.findFirst.mockResolvedValue(null);

            await expect(
                service.addMember(OWNER, 'project-1', { employeeId: 'emp-x' } as never),
            ).rejects.toBeInstanceOf(BadRequestException);
        });
    });

    describe('listMemberCandidates', () => {
        // The picker is gated on MANAGE_PROJECTS through this method; the two
        // directories it replaced needed MANAGE_USERS and VIEW_HR, which a
        // project manager has no reason to hold — so the picker came up empty
        // for exactly the people who manage projects.
        it('returns users under their user id, not their membership row id', async () => {
            db.tenantUser.findMany.mockResolvedValue([
                { user_id: 'user-1', user: { id: 'user-1', name: 'Rakib', email: 'rakib@x.com' } },
            ]);

            const [candidate] = await service.listMemberCandidates('tenant-1');

            expect(candidate).toMatchObject({ key: 'user:user-1', userId: 'user-1', name: 'Rakib' });
        });

        it('falls back to the email when a user has no name set', async () => {
            db.tenantUser.findMany.mockResolvedValue([
                { user_id: 'user-1', user: { id: 'user-1', name: null, email: 'rakib@x.com' } },
            ]);

            const [candidate] = await service.listMemberCandidates('tenant-1');

            expect(candidate.name).toBe('rakib@x.com');
        });

        it('offers an employee with no login, flagged as such', async () => {
            db.employee.findMany.mockResolvedValue([
                { id: 'emp-2', name: 'Imran', employee_code: 'EMP-002', user_id: null },
            ]);

            const [candidate] = await service.listMemberCandidates('tenant-1');

            expect(candidate).toMatchObject({ key: 'employee:emp-2', employeeId: 'emp-2', noLogin: true });
        });

        it('lists a linked employee once, as the user, so they keep their permissions', async () => {
            db.tenantUser.findMany.mockResolvedValue([
                { user_id: 'user-1', user: { id: 'user-1', name: 'Rakib', email: 'rakib@x.com' } },
            ]);
            db.employee.findMany.mockResolvedValue([
                { id: 'emp-1', name: 'Rakib', employee_code: 'EMP-001', user_id: 'user-1' },
                { id: 'emp-2', name: 'Imran', employee_code: 'EMP-002', user_id: null },
            ]);

            const candidates = await service.listMemberCandidates('tenant-1');

            expect(candidates.map((c) => c.key)).toEqual(['user:user-1', 'employee:emp-2']);
        });

        it('leaves out anyone who has left — only ACTIVE, undeleted employees', async () => {
            await service.listMemberCandidates('tenant-1');

            expect(db.employee.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ deleted_at: null, status: 'ACTIVE' }),
                }),
            );
        });
    });

    describe('removeMember', () => {
        it('keys on the member row, since an employee member has no user id', async () => {
            await service.removeMember(OWNER, 'project-1', 'member-1');

            const where = db.projectMember.deleteMany.mock.calls[0][0].where;
            expect(where).toMatchObject({ id: 'member-1', project_id: 'project-1' });
            expect(where).not.toHaveProperty('user_id');
        });
    });

    describe('remove', () => {
        it('detaches the project’s tasks from any sprint before soft-deleting', async () => {
            // Sprints are tenant-level and shared now, so leaving a deleted
            // project's tasks attached would inflate a live sprint's committed
            // hours with work nobody is doing.
            await service.remove(OWNER, 'project-1');

            expect(db.projectTask.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ project_id: 'project-1', sprint_id: { not: null } }),
                    data: { sprint_id: null },
                }),
            );
            expect(db.project.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: { deleted_at: expect.any(Date) } }),
            );
        });

        it('does both in one transaction, so a half-deleted project cannot exist', async () => {
            await service.remove(OWNER, 'project-1');
            expect(db.$transaction).toHaveBeenCalled();
        });

        it('is a soft delete — the tasks and their logged time survive', async () => {
            await service.remove(OWNER, 'project-1');
            expect(db.projectTask.updateMany).not.toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ deleted_at: expect.anything() }) }),
            );
        });
    });
});
