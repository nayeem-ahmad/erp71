import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../database/database.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import {
    PlatformWorkspaceService,
    PLATFORM_WORKSPACE_KEY,
    PLATFORM_WORKSPACE_NAME,
} from './platform-workspace.service';

describe('PlatformWorkspaceService', () => {
    let service: PlatformWorkspaceService;

    const db = {
        tenant: {
            findFirst: jest.fn(),
            create: jest.fn(),
        },
        tenantUser: {
            upsert: jest.fn(),
            createMany: jest.fn(),
            findMany: jest.fn(),
        },
        user: {
            findMany: jest.fn(),
        },
        store: {
            upsert: jest.fn(),
        },
        userStoreAccess: {
            createMany: jest.fn(),
        },
        userStorePermission: {
            createMany: jest.fn(),
        },
        $transaction: jest.fn(),
    };

    const platformSettings = { isFeatureEnabled: jest.fn() };

    const workspace = { id: 'ws-1', name: PLATFORM_WORKSPACE_NAME, timezone: 'Asia/Dhaka' };

    beforeEach(async () => {
        jest.clearAllMocks();
        platformSettings.isFeatureEnabled.mockResolvedValue(true);
        db.user.findMany.mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }]);
        db.tenantUser.createMany.mockResolvedValue({ count: 2 });
        db.tenantUser.findMany.mockResolvedValue([]);
        db.store.upsert.mockResolvedValue({ id: 'store-1' });
        db.$transaction.mockImplementation((fn: (tx: typeof db) => unknown) => fn(db));

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PlatformWorkspaceService,
                { provide: DatabaseService, useValue: db },
                { provide: PlatformSettingsService, useValue: platformSettings },
            ],
        }).compile();

        service = module.get(PlatformWorkspaceService);
    });

    describe('resolveForAdmin', () => {
        it('provisions the workspace on first use and seeds it with every platform admin', async () => {
            db.tenant.findFirst.mockResolvedValue(null);
            db.tenant.create.mockResolvedValue(workspace);

            await expect(service.resolveForAdmin('admin-1')).resolves.toEqual(workspace);

            expect(db.tenant.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        name: PLATFORM_WORKSPACE_NAME,
                        owner_id: 'admin-1',
                        platform_workspace_key: PLATFORM_WORKSPACE_KEY,
                    }),
                }),
            );
            expect(db.tenantUser.createMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: [
                        { tenant_id: 'ws-1', user_id: 'admin-1', role: 'OWNER' },
                        { tenant_id: 'ws-1', user_id: 'admin-2', role: 'OWNER' },
                    ],
                    skipDuplicates: true,
                }),
            );
        });

        it('reuses the existing workspace rather than creating a second one', async () => {
            db.tenant.findFirst.mockResolvedValue(workspace);

            await expect(service.resolveForAdmin('admin-2')).resolves.toEqual(workspace);

            expect(db.tenant.create).not.toHaveBeenCalled();
        });

        // Two admins opening the module at the same moment both see no workspace
        // and both try to create one. The partial unique index means the loser's
        // insert throws; it has to end up in the winner's workspace, not error.
        it('falls back to the row a concurrent caller won the race with', async () => {
            db.tenant.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(workspace);
            db.tenant.create.mockRejectedValue(new Error('duplicate key'));

            await expect(service.resolveForAdmin('admin-1')).resolves.toEqual(workspace);
        });

        it('rethrows when the create failed for a reason other than losing the race', async () => {
            db.tenant.findFirst.mockResolvedValue(null);
            db.tenant.create.mockRejectedValue(new Error('connection reset'));

            await expect(service.resolveForAdmin('admin-1')).rejects.toThrow('connection reset');
        });

        // The key is unique across all rows, so a workspace someone soft-deleted
        // by hand keeps holding it and blocks every future create. Saying which
        // row and what to do beats re-throwing a bare constraint violation.
        it('names the soft-deleted workspace still holding the unique key', async () => {
            db.tenant.findFirst
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce({ id: 'ws-gone' });
            db.tenant.create.mockRejectedValue(new Error('Unique constraint failed'));

            // One invocation, both assertions: a second call would run down the
            // same `mockResolvedValueOnce` queue and take a different path.
            const error = await service.resolveForAdmin('admin-1').catch((e) => e);

            expect(error).toBeInstanceOf(ConflictException);
            expect(error.message).toContain('ws-gone');
        });

        it('makes the caller an OWNER member without disturbing an existing row', async () => {
            db.tenant.findFirst.mockResolvedValue(workspace);

            await service.resolveForAdmin('admin-3');

            expect(db.tenantUser.upsert).toHaveBeenCalledWith({
                where: { tenant_id_user_id: { tenant_id: 'ws-1', user_id: 'admin-3' } },
                create: { tenant_id: 'ws-1', user_id: 'admin-3', role: 'OWNER' },
                update: {},
            });
        });

        it('refuses when the platform switch is off, and provisions nothing', async () => {
            platformSettings.isFeatureEnabled.mockResolvedValue(false);

            await expect(service.resolveForAdmin('admin-1')).rejects.toThrow(ForbiddenException);
            expect(db.tenant.findFirst).not.toHaveBeenCalled();
            expect(db.tenant.create).not.toHaveBeenCalled();
        });
    });

    describe('find', () => {
        it('only ever matches a live workspace, never a deleted one', async () => {
            db.tenant.findFirst.mockResolvedValue(null);

            await service.find();

            expect(db.tenant.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { platform_workspace_key: PLATFORM_WORKSPACE_KEY, deleted_at: null },
                }),
            );
        });
    });

    describe('membership sync', () => {
        it('pulls in admins promoted since the workspace was created', async () => {
            db.tenant.findFirst.mockResolvedValue(workspace);
            db.user.findMany.mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-9' }]);

            await service.resolveForAdmin('admin-1');

            expect(db.tenantUser.createMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: [
                        { tenant_id: 'ws-1', user_id: 'admin-1', role: 'OWNER' },
                        { tenant_id: 'ws-1', user_id: 'admin-9', role: 'OWNER' },
                    ],
                    skipDuplicates: true,
                }),
            );
        });

        it('writes nothing when the admin roster comes back empty', async () => {
            db.tenant.findFirst.mockResolvedValue(workspace);
            db.user.findMany.mockResolvedValue([]);

            await service.resolveForAdmin('admin-1');

            expect(db.tenantUser.createMany).not.toHaveBeenCalled();
            // The caller still gets their own membership, so the pages they just
            // opened work even when the roster query finds nobody.
            expect(db.tenantUser.upsert).toHaveBeenCalled();
        });
    });

    // Every permission in the product is granted per store, and a workspace with
    // no store has nothing to grant it against: an invited Project User was
    // joined with no permissions at all. Owners never needed one, because
    // `StorePermissionGuard` lets OWNER through before it looks for a store.
    describe('store for invited members', () => {
        const projectUser = {
            user_id: 'pu-1',
            roles: [
                {
                    tenantRole: {
                        permissions: [{ permission: 'VIEW_PROJECTS' }, { permission: 'LOG_PROJECT_TIME' }],
                    },
                },
                { tenantRole: { permissions: [{ permission: 'VIEW_PROJECTS' }] } },
            ],
        };

        it('gives the workspace one store, reusing it on every later call', async () => {
            db.tenant.findFirst.mockResolvedValue(workspace);

            await service.resolveForAdmin('admin-1');

            expect(db.store.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { tenant_id_name: { tenant_id: 'ws-1', name: PLATFORM_WORKSPACE_NAME } },
                    update: {},
                    create: { tenant_id: 'ws-1', name: PLATFORM_WORKSPACE_NAME },
                }),
            );
        });

        it('only looks at non-owner members who have no access to that store', async () => {
            db.tenant.findFirst.mockResolvedValue(workspace);

            await service.resolveForAdmin('admin-1');

            expect(db.tenantUser.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        tenant_id: 'ws-1',
                        role: { not: 'OWNER' },
                        user: { storeAccess: { none: { store_id: 'store-1' } } },
                    },
                }),
            );
        });

        it('backfills a member joined before the store existed with the union of their roles', async () => {
            db.tenant.findFirst.mockResolvedValue(workspace);
            db.tenantUser.findMany.mockResolvedValue([projectUser]);

            await service.resolveForAdmin('admin-1');

            expect(db.userStoreAccess.createMany).toHaveBeenCalledWith({
                data: [{ user_id: 'pu-1', store_id: 'store-1', tenant_id: 'ws-1', access_level: 'STORE_ONLY' }],
                skipDuplicates: true,
            });
            expect(db.userStorePermission.createMany).toHaveBeenCalledWith({
                data: ['VIEW_PROJECTS', 'LOG_PROJECT_TIME'].map((permission) => ({
                    user_id: 'pu-1',
                    store_id: 'store-1',
                    tenant_id: 'ws-1',
                    permission,
                    granted_by: 'admin-1',
                })),
                skipDuplicates: true,
            });
        });

        it('writes no access when every member already has it', async () => {
            db.tenant.findFirst.mockResolvedValue(workspace);

            await service.resolveForAdmin('admin-1');

            expect(db.userStoreAccess.createMany).not.toHaveBeenCalled();
            expect(db.userStorePermission.createMany).not.toHaveBeenCalled();
        });
    });
});
