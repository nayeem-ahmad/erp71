import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectSettingsService } from './project-settings.service';
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
            tenantUser: { findFirst: jest.fn().mockResolvedValue({ id: 'tu-1' }) },
            employee: { findFirst: jest.fn().mockResolvedValue({ id: 'emp-1' }) },
            $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ProjectsService,
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
            await service.addMember('tenant-1', 'project-1', { userId: 'user-1' } as never);

            expect(db.projectMember.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    create: expect.objectContaining({ user_id: 'user-1', project_id: 'project-1' }),
                }),
            );
        });

        it('adds an employee who has no login at all', async () => {
            await service.addMember('tenant-1', 'project-1', { employeeId: 'emp-1' } as never);

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
                service.addMember('tenant-1', 'project-1', dto as never),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(db.projectMember.upsert).not.toHaveBeenCalled();
        });

        it('refuses an employee from another tenant', async () => {
            db.employee.findFirst.mockResolvedValue(null);

            await expect(
                service.addMember('tenant-1', 'project-1', { employeeId: 'emp-x' } as never),
            ).rejects.toBeInstanceOf(BadRequestException);
        });
    });

    describe('removeMember', () => {
        it('keys on the member row, since an employee member has no user id', async () => {
            await service.removeMember('tenant-1', 'project-1', 'member-1');

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
            await service.remove('tenant-1', 'project-1');

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
            await service.remove('tenant-1', 'project-1');
            expect(db.$transaction).toHaveBeenCalled();
        });

        it('is a soft delete — the tasks and their logged time survive', async () => {
            await service.remove('tenant-1', 'project-1');
            expect(db.projectTask.updateMany).not.toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ deleted_at: expect.anything() }) }),
            );
        });
    });
});
