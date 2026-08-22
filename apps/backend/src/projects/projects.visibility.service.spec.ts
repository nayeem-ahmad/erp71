import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectSettingsService } from './project-settings.service';
import { ProjectAccessService } from './project-access.service';
import { OWNER, staff, visibilityOr } from './project-access.test-support';
import { DatabaseService } from '../database/database.service';

/** Public/private projects, from the project list's side. */
describe('ProjectsService — visibility', () => {
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

    describe('list', () => {
        it('shows an ordinary user public projects plus the private ones they are on', async () => {
            await service.list(staff('user-7'), {} as never);

            expect(db.project.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        AND: [{ OR: visibilityOr('user-7') }],
                    }),
                }),
            );
        });

        it('counts what it lists, so pagination cannot promise a page it will not render', async () => {
            await service.list(staff('user-7'), {} as never);

            const [{ where: listWhere }] = db.project.findMany.mock.calls.at(-1);
            const [{ where: countWhere }] = db.project.count.mock.calls.at(-1);
            expect(countWhere).toEqual(listWhere);
        });

        it('keeps a search filter and the visibility filter both in force', async () => {
            await service.list(staff('user-7'), { search: 'roof' } as never);

            const [{ where }] = db.project.findMany.mock.calls.at(-1);
            // The search owns `OR`; visibility rides in `AND`. Collapsing them
            // into one `OR` would make a search a way to find private projects.
            expect(where.OR).toHaveLength(4);
            expect(where.AND).toEqual([{ OR: visibilityOr('user-7') }]);
        });

        it('adds no clause for the owner', async () => {
            await service.list(OWNER, {} as never);

            const [{ where }] = db.project.findMany.mock.calls.at(-1);
            expect(where.AND).toBeUndefined();
        });

        it('still honours an explicit visibility filter from the query', async () => {
            await service.list(OWNER, { visibility: 'PRIVATE' } as never);

            const [{ where }] = db.project.findMany.mock.calls.at(-1);
            expect(where.visibility).toBe('PRIVATE');
        });
    });

    describe('findOne', () => {
        it('reports a private project the viewer is not on as missing', async () => {
            db.project.findFirst.mockResolvedValue(null);

            await expect(service.findOne(staff('user-7'), 'project-1')).rejects.toBeInstanceOf(
                NotFoundException,
            );
        });
    });

    describe('create', () => {
        it('defaults to public', async () => {
            await service.create(OWNER, { name: 'Reroof the shop' } as never);

            expect(db.project.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ visibility: 'PUBLIC' }),
                }),
            );
            expect(db.projectMember.upsert).not.toHaveBeenCalled();
        });

        it('puts the manager and the creator on the team when it starts private', async () => {
            db.project.create.mockResolvedValue(
                project({ visibility: 'PRIVATE', manager_id: 'user-manager' }),
            );

            await service.create(OWNER, {
                name: 'Buy-out talks',
                visibility: 'PRIVATE',
                managerId: 'user-manager',
            } as never);

            const seeded = db.projectMember.upsert.mock.calls.map(
                (call: any[]) => call[0].create.user_id,
            );
            expect(seeded).toEqual(['user-manager', OWNER.userId]);
        });
    });

    describe('update', () => {
        it('pins the manager onto the team when a public project turns private', async () => {
            db.project.findFirst.mockResolvedValue(
                project({ visibility: 'PUBLIC', manager_id: 'user-old' }),
            );
            db.project.update.mockResolvedValue(
                project({ visibility: 'PRIVATE', manager_id: 'user-new' }),
            );

            await service.update(OWNER, 'project-1', { visibility: 'PRIVATE' } as never);

            const seeded = db.projectMember.upsert.mock.calls.map(
                (call: any[]) => call[0].create.user_id,
            );
            // Both managers: the outgoing one may still be mid-handover, and
            // the incoming one has to be able to open what they now own.
            expect(seeded).toEqual(['user-new', 'user-old', OWNER.userId]);
        });

        it('does not re-seed a project that was already private', async () => {
            db.project.findFirst.mockResolvedValue(project({ visibility: 'PRIVATE' }));
            db.project.update.mockResolvedValue(project({ visibility: 'PRIVATE' }));

            await service.update(OWNER, 'project-1', { name: 'Renamed' } as never);

            expect(db.projectMember.upsert).not.toHaveBeenCalled();
        });

        it('refuses to edit a project the viewer cannot see', async () => {
            db.project.findFirst.mockResolvedValue(null);

            await expect(
                service.update(staff('user-7'), 'project-1', { name: 'Renamed' } as never),
            ).rejects.toBeInstanceOf(NotFoundException);
            expect(db.project.update).not.toHaveBeenCalled();
        });
    });
});
