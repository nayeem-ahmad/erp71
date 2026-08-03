import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DEFAULT_TASK_STATUSES, ProjectSettingsService } from './project-settings.service';
import { DatabaseService } from '../database/database.service';

describe('ProjectSettingsService', () => {
    let service: ProjectSettingsService;
    let db: any;

    const seeded = [
        { id: 's1', name: 'To Do', category: 'TODO', sort_order: 0, is_default: true },
        { id: 's2', name: 'In Progress', category: 'IN_PROGRESS', sort_order: 1, is_default: false },
        { id: 's4', name: 'Done', category: 'DONE', sort_order: 3, is_default: false },
    ];

    beforeEach(async () => {
        db = {
            projectTaskStatus: {
                findMany: jest.fn().mockResolvedValue(seeded),
                findFirst: jest.fn().mockResolvedValue(null),
                createMany: jest.fn().mockResolvedValue({ count: 4 }),
                create: jest.fn().mockResolvedValue({}),
                update: jest.fn().mockResolvedValue({}),
                updateMany: jest.fn().mockResolvedValue({}),
                delete: jest.fn().mockResolvedValue({}),
                count: jest.fn().mockResolvedValue(4),
            },
            projectType: {
                findMany: jest.fn().mockResolvedValue([]),
                findFirst: jest.fn().mockResolvedValue(null),
                create: jest.fn().mockResolvedValue({}),
                update: jest.fn().mockResolvedValue({}),
                delete: jest.fn().mockResolvedValue({}),
                count: jest.fn().mockResolvedValue(0),
            },
            project: { count: jest.fn().mockResolvedValue(0) },
            projectTask: { count: jest.fn().mockResolvedValue(0) },
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [ProjectSettingsService, { provide: DatabaseService, useValue: db }],
        }).compile();

        service = module.get(ProjectSettingsService);
    });

    describe('board columns', () => {
        it('seeds defaults on first use so a tenant is never left with no board', async () => {
            db.projectTaskStatus.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce(seeded);

            const columns = await service.listTaskStatuses('tenant-1');

            expect(db.projectTaskStatus.createMany).toHaveBeenCalledWith(
                expect.objectContaining({ skipDuplicates: true }),
            );
            expect(columns).toHaveLength(3);
        });

        it('seeds exactly one default column and one Done column', () => {
            expect(DEFAULT_TASK_STATUSES.filter((s) => s.is_default)).toHaveLength(1);
            expect(DEFAULT_TASK_STATUSES.filter((s) => s.category === 'DONE')).toHaveLength(1);
        });

        it('does not re-seed when columns already exist', async () => {
            await service.listTaskStatuses('tenant-1');
            expect(db.projectTaskStatus.createMany).not.toHaveBeenCalled();
        });

        it('falls back to the first column when none is flagged default', async () => {
            db.projectTaskStatus.findMany.mockResolvedValue([
                { id: 's2', name: 'In Progress', sort_order: 1, is_default: false },
                { id: 's1', name: 'To Do', sort_order: 0, is_default: false },
            ]);

            const status = await service.defaultTaskStatus('tenant-1');
            expect(status.id).toBe('s2');
        });

        it('refuses to deactivate a column that still holds tasks', async () => {
            db.projectTaskStatus.findFirst.mockResolvedValue(seeded[0]);
            db.projectTask.count.mockResolvedValue(4);

            await expect(
                service.updateTaskStatus('tenant-1', 's1', { isActive: false } as never),
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it('refuses to delete a column that still holds tasks', async () => {
            db.projectTaskStatus.findFirst.mockResolvedValue(seeded[0]);
            db.projectTask.count.mockResolvedValue(1);

            await expect(service.removeTaskStatus('tenant-1', 's1')).rejects.toBeInstanceOf(
                BadRequestException,
            );
            expect(db.projectTaskStatus.delete).not.toHaveBeenCalled();
        });

        it('clears the old default before setting a new one', async () => {
            db.projectTaskStatus.findFirst.mockResolvedValue(seeded[1]);

            await service.updateTaskStatus('tenant-1', 's2', { isDefault: true } as never);

            expect(db.projectTaskStatus.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({ data: { is_default: false } }),
            );
        });

        it('rejects a duplicate column name', async () => {
            db.projectTaskStatus.findFirst.mockResolvedValue({ id: 'existing' });

            await expect(
                service.createTaskStatus('tenant-1', { name: 'To Do', category: 'TODO' } as never),
            ).rejects.toBeInstanceOf(ConflictException);
        });

        it('scopes the column lookup to the tenant', async () => {
            await expect(
                service.updateTaskStatus('tenant-1', 'nope', { name: 'x' } as never),
            ).rejects.toBeInstanceOf(NotFoundException);
            expect(db.projectTaskStatus.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ tenant_id: 'tenant-1' }),
                }),
            );
        });
    });

    // Phase 3L: columns belong to a project. `project_id IS NULL` is the tenant
    // template a new project is seeded from, not a board anyone renders.
    describe('per-project columns', () => {
        it('reads the template when no project is named', async () => {
            db.projectTaskStatus.findMany.mockResolvedValue(seeded);

            await service.listTaskStatuses('tenant-1');

            expect(db.projectTaskStatus.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ project_id: null }),
                }),
            );
        });

        it('reads a project’s own columns when one is named', async () => {
            db.projectTaskStatus.findMany.mockResolvedValue(seeded);

            await service.listTaskStatuses('tenant-1', false, 'project-1');

            expect(db.projectTaskStatus.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ project_id: 'project-1' }),
                }),
            );
        });

        it('seeds a project from the template on first read', async () => {
            // Empty for the project, then the template, then the copies.
            db.projectTaskStatus.findMany
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce(seeded)
                .mockResolvedValueOnce(seeded);

            await service.listTaskStatuses('tenant-1', false, 'project-1');

            expect(db.projectTaskStatus.createMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.arrayContaining([
                        expect.objectContaining({ project_id: 'project-1', name: 'To Do' }),
                    ]),
                    // Two concurrent first-loads of a board must not double the
                    // columns.
                    skipDuplicates: true,
                }),
            );
        });

        it('creates a column against the project it was asked for', async () => {
            db.projectTaskStatus.findMany.mockResolvedValue(seeded);
            db.projectTaskStatus.findFirst.mockResolvedValue(null);

            await service.createTaskStatus(
                'tenant-1',
                { name: 'Blocked', category: 'TODO', wipLimit: 3 } as never,
                'project-1',
            );

            expect(db.projectTaskStatus.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ project_id: 'project-1', wip_limit: 3 }),
                }),
            );
        });

        // Two projects may each have a "Blocked". The clash check has to be
        // scoped or the second one is refused.
        it('checks the name clash within the project, not the tenant', async () => {
            db.projectTaskStatus.findMany.mockResolvedValue(seeded);
            db.projectTaskStatus.findFirst.mockResolvedValue(null);

            await service.createTaskStatus(
                'tenant-1',
                { name: 'Blocked', category: 'TODO' } as never,
                'project-1',
            );

            expect(db.projectTaskStatus.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        project_id: 'project-1',
                        name: 'Blocked',
                    }),
                }),
            );
        });

        it('clears the default within the board, not across the tenant', async () => {
            db.projectTaskStatus.findFirst.mockResolvedValue({
                ...seeded[1],
                project_id: 'project-1',
            });

            await service.updateTaskStatus('tenant-1', 's2', { isDefault: true } as never);

            expect(db.projectTaskStatus.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ project_id: 'project-1' }),
                }),
            );
        });

        it('stores a WIP limit and lets it be removed', async () => {
            db.projectTaskStatus.findFirst.mockResolvedValue(seeded[0]);

            await service.updateTaskStatus('tenant-1', 's1', { wipLimit: 5 } as never);
            expect(db.projectTaskStatus.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ wip_limit: 5 }) }),
            );

            await service.updateTaskStatus('tenant-1', 's1', { wipLimit: null } as never);
            expect(db.projectTaskStatus.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ wip_limit: null }) }),
            );
        });
    });

    describe('project types', () => {
        it('deactivates rather than deletes a type still used by projects', async () => {
            db.projectType.findFirst.mockResolvedValue({ id: 'type-1', name: 'Installation' });
            db.project.count.mockResolvedValue(3);

            const result = await service.removeProjectType('tenant-1', 'type-1');

            expect(result).toEqual({ success: true, deactivated: true, projects: 3 });
            expect(db.projectType.delete).not.toHaveBeenCalled();
            expect(db.projectType.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: { is_active: false } }),
            );
        });

        it('deletes an unused type outright', async () => {
            db.projectType.findFirst.mockResolvedValue({ id: 'type-1', name: 'Unused' });

            const result = await service.removeProjectType('tenant-1', 'type-1');

            expect(result).toEqual({ success: true, deactivated: false });
            expect(db.projectType.delete).toHaveBeenCalled();
        });

        it('rejects a duplicate type name', async () => {
            db.projectType.findFirst.mockResolvedValue({ id: 'existing' });

            await expect(
                service.createProjectType('tenant-1', { name: 'Installation' } as never),
            ).rejects.toBeInstanceOf(ConflictException);
        });
    });
});
