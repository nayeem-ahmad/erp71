import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ProjectAccessService, ProjectViewer } from './project-access.service';
import { DatabaseService } from '../database/database.service';

/**
 * Public/private projects. The rule under test: a PUBLIC project is visible to
 * everyone in the tenant who can open the module at all; a PRIVATE one is
 * visible to its members, its manager, the OWNER, and holders of
 * VIEW_ALL_PROJECTS.
 */
describe('ProjectAccessService', () => {
    let service: ProjectAccessService;
    let db: any;

    const owner: ProjectViewer = {
        tenantId: 'tenant-1',
        userId: 'user-owner',
        userRole: 'OWNER',
        storeId: 'store-1',
    };
    const staff: ProjectViewer = {
        tenantId: 'tenant-1',
        userId: 'user-staff',
        userRole: 'STAFF',
        storeId: 'store-1',
    };

    beforeEach(async () => {
        db = {
            project: { findFirst: jest.fn().mockResolvedValue({ id: 'project-1', visibility: 'PUBLIC' }) },
            projectTask: { findFirst: jest.fn().mockResolvedValue({ project_id: 'project-1' }) },
            projectMember: { upsert: jest.fn().mockResolvedValue({}) },
            userStorePermission: { findFirst: jest.fn().mockResolvedValue(null) },
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [ProjectAccessService, { provide: DatabaseService, useValue: db }],
        }).compile();
        service = module.get(ProjectAccessService);
    });

    describe('who sees everything', () => {
        it('lets the workspace owner through without a permission lookup', async () => {
            await expect(service.seesEveryProject(owner)).resolves.toBe(true);
            // Same shortcut StorePermissionGuard takes: OWNER holds everything,
            // so there is nothing to look up.
            expect(db.userStorePermission.findFirst).not.toHaveBeenCalled();
        });

        it('lets a VIEW_ALL_PROJECTS grant through', async () => {
            db.userStorePermission.findFirst.mockResolvedValue({ id: 'grant-1' });

            await expect(service.seesEveryProject(staff)).resolves.toBe(true);
            expect(db.userStorePermission.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        user_id: 'user-staff',
                        store_id: 'store-1',
                        permission: 'VIEW_ALL_PROJECTS',
                    }),
                }),
            );
        });

        it('holds an ordinary user to the visibility rule', async () => {
            await expect(service.seesEveryProject(staff)).resolves.toBe(false);
        });

        it('treats a user with no store context as ordinary rather than privileged', async () => {
            // A grant is per-store, so with no store there is no grant to find.
            await expect(
                service.seesEveryProject({ ...staff, storeId: undefined }),
            ).resolves.toBe(false);
        });
    });

    describe('projectFilter', () => {
        it('adds no clause at all for someone who sees everything', async () => {
            await expect(service.projectFilter(owner)).resolves.toEqual({});
        });

        it('admits public projects, the manager, and members — and nobody else', async () => {
            await expect(service.projectFilter(staff)).resolves.toEqual({
                OR: [
                    { visibility: 'PUBLIC' },
                    { manager_id: 'user-staff' },
                    { members: { some: { user_id: 'user-staff' } } },
                ],
            });
        });

        it('does not admit the creator', async () => {
            // Deliberate: taking someone off a project they set up has to
            // actually take them off it.
            const filter = (await service.projectFilter(staff)) as { OR: Record<string, unknown>[] };
            expect(filter.OR.some((clause) => 'created_by' in clause)).toBe(false);
        });

        it('nests the same clause under `project` for rows that point at one', async () => {
            await expect(service.relatedFilter(staff)).resolves.toEqual({
                AND: [
                    {
                        project: {
                            OR: [
                                { visibility: 'PUBLIC' },
                                { manager_id: 'user-staff' },
                                { members: { some: { user_id: 'user-staff' } } },
                            ],
                        },
                    },
                ],
            });
        });
    });

    describe('merge', () => {
        it('keeps a caller OR and a visibility OR from clobbering each other', () => {
            const where = { tenant_id: 'tenant-1', OR: [{ name: { contains: 'roof' } }] };
            const merged = ProjectAccessService.merge(where, { OR: [{ visibility: 'PUBLIC' }] });

            // The search stays where it was; visibility rides in an AND beside
            // it, so a search cannot quietly widen what a user can see.
            expect(merged.OR).toEqual([{ name: { contains: 'roof' } }]);
            expect(merged.AND).toEqual([{ OR: [{ visibility: 'PUBLIC' }] }]);
        });

        it('appends to an AND the caller already had', () => {
            const merged = ProjectAccessService.merge(
                { AND: [{ status: 'ACTIVE' }] },
                { OR: [{ visibility: 'PUBLIC' }] },
            );
            expect(merged.AND).toEqual([{ status: 'ACTIVE' }, { OR: [{ visibility: 'PUBLIC' }] }]);
        });

        it('splices a nested-AND fragment in rather than burying it a level deeper', () => {
            const merged = ProjectAccessService.merge(
                { tenant_id: 'tenant-1' },
                { AND: [{ project: { OR: [{ visibility: 'PUBLIC' }] } }] },
            );
            // Same shape a project-table filter produces, so a reader does not
            // have to know which of the two filters a clause came from.
            expect(merged.AND).toEqual([{ project: { OR: [{ visibility: 'PUBLIC' }] } }]);
        });

        it('leaves the where untouched when there is nothing to filter', () => {
            const where = { tenant_id: 'tenant-1' };
            expect(ProjectAccessService.merge(where, {})).toBe(where);
        });
    });

    describe('assertProjectVisible', () => {
        it('applies the filter to the lookup itself', async () => {
            await service.assertProjectVisible(staff, 'project-1');

            expect(db.project.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        id: 'project-1',
                        tenant_id: 'tenant-1',
                        deleted_at: null,
                        OR: expect.any(Array),
                    }),
                }),
            );
        });

        it('reports a project it cannot see as missing, not forbidden', async () => {
            db.project.findFirst.mockResolvedValue(null);

            // NotFound rather than Forbidden on purpose: "you may not see this"
            // confirms the project exists, which is the one thing a private
            // project must not do.
            await expect(service.assertProjectVisible(staff, 'project-1')).rejects.toBeInstanceOf(
                NotFoundException,
            );
        });

        it('reports a task in an unreachable project as missing too', async () => {
            db.projectTask.findFirst.mockResolvedValue(null);

            await expect(service.assertTaskVisible(staff, 'task-1')).rejects.toBeInstanceOf(
                NotFoundException,
            );
        });
    });

    describe('seedPrivateMembers', () => {
        it('writes one row per distinct user and skips the blanks', async () => {
            await service.seedPrivateMembers('tenant-1', 'project-1', [
                'user-a',
                'user-a',
                null,
                undefined,
                'user-b',
            ]);

            expect(db.projectMember.upsert).toHaveBeenCalledTimes(2);
            expect(db.projectMember.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    create: expect.objectContaining({ user_id: 'user-a', role: 'MANAGER' }),
                    update: {},
                }),
            );
        });

        it('never rewrites a row that already exists', async () => {
            await service.seedPrivateMembers('tenant-1', 'project-1', ['user-a']);

            // The point is that a row exists, not what it says — someone
            // demoted to VIEWER must not be silently promoted back.
            const [call] = db.projectMember.upsert.mock.calls;
            expect(call[0].update).toEqual({});
        });
    });
});
