import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TeamService } from './team.service';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { InvitationsService } from '../invitations/invitations.service';
import { StorePermission, UserRole } from '@erp71/shared-types';
import { TenantContext } from '../database/tenant.decorator';

jest.mock('./role-sync.util', () => ({
    syncMemberPermissionsFromRole: jest.fn().mockResolvedValue(2),
}));

import { syncMemberPermissionsFromRole } from './role-sync.util';

const db = {
    tenantUser: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), delete: jest.fn(), count: jest.fn() },
    tenantRole: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    tenantRolePermission: { findMany: jest.fn(), createMany: jest.fn(), deleteMany: jest.fn() },
    userStoreAccess: { findMany: jest.fn(), findUnique: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
    userStorePermission: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        groupBy: jest.fn(),
        createMany: jest.fn(),
        deleteMany: jest.fn(),
    },
    store: { findFirst: jest.fn(), findMany: jest.fn() },
    user: { findUnique: jest.fn() },
    userInvitation: { findMany: jest.fn(), deleteMany: jest.fn() },
    $transaction: jest.fn(),
};
const audit = { log: jest.fn().mockResolvedValue(undefined) };
const invitations = { invite: jest.fn().mockResolvedValue(undefined) };

const owner: TenantContext = { tenantId: 't1', userId: 'owner', userRole: UserRole.OWNER, storeId: 's1' };
const cashier: TenantContext = { tenantId: 't1', userId: 'cash', userRole: UserRole.CASHIER, storeId: 's1' };

describe('TeamService', () => {
    let service: TeamService;

    beforeEach(async () => {
        jest.clearAllMocks();
        db.$transaction.mockImplementation(async (arg: any) =>
            typeof arg === 'function' ? arg(db) : Promise.all(arg),
        );
        const mod = await Test.createTestingModule({
            providers: [
                TeamService,
                { provide: DatabaseService, useValue: db },
                { provide: AuditService, useValue: audit },
                { provide: InvitationsService, useValue: invitations },
            ],
        }).compile();
        service = mod.get(TeamService);
    });

    it('lets OWNER list members without a permission grant', async () => {
        db.tenantUser.findMany.mockResolvedValue([]);
        db.tenantUser.count.mockResolvedValue(0);
        db.userStoreAccess.findMany.mockResolvedValue([]);
        db.userStorePermission.groupBy.mockResolvedValue([]);
        await expect(service.listMembers(owner)).resolves.toEqual(
            expect.objectContaining({ items: [], total: 0 }),
        );
        expect(db.userStorePermission.findFirst).not.toHaveBeenCalled();
    });

    it('blocks a CASHIER without MANAGE_USERS from listing members', async () => {
        db.userStorePermission.findFirst.mockResolvedValue(null);
        await expect(service.listMembers(cashier)).rejects.toThrow(ForbiddenException);
    });

    it('allows a CASHIER who has the MANAGE_USERS grant on the active branch', async () => {
        db.userStorePermission.findFirst.mockResolvedValue({ id: 'g1' });
        db.tenantUser.findMany.mockResolvedValue([]);
        db.tenantUser.count.mockResolvedValue(0);
        db.userStoreAccess.findMany.mockResolvedValue([]);
        db.userStorePermission.groupBy.mockResolvedValue([]);
        await expect(service.listMembers(cashier)).resolves.toEqual(
            expect.objectContaining({ items: [], total: 0 }),
        );
        expect(db.userStorePermission.findFirst).toHaveBeenCalledWith({
            where: { user_id: 'cash', store_id: 's1', permission: StorePermission.MANAGE_USERS },
            select: { id: true },
        });
    });

    it('refuses to demote the last owner', async () => {
        db.tenantUser.findUnique.mockResolvedValue({ role: UserRole.OWNER, user_id: 'other' });
        db.tenantUser.count.mockResolvedValue(1);
        await expect(
            service.updateRole(owner, 'other', UserRole.MANAGER, false),
        ).rejects.toThrow(BadRequestException);
    });

    it('refuses to change your own role', async () => {
        db.tenantUser.findUnique.mockResolvedValue({ role: UserRole.OWNER, user_id: 'owner' });
        await expect(
            service.updateRole(owner, 'owner', UserRole.MANAGER, false),
        ).rejects.toThrow(BadRequestException);
    });

    it('requires branch access before setting permissions', async () => {
        db.tenantUser.findUnique.mockResolvedValue({ role: UserRole.CASHIER, user_id: 'u2' });
        db.userStoreAccess.findUnique.mockResolvedValue(null);
        await expect(
            service.setStorePermissions(owner, 'u2', 's1', [StorePermission.CREATE_SALE]),
        ).rejects.toThrow(BadRequestException);
    });

    it('replaces permissions for a branch the user can access', async () => {
        db.tenantUser.findUnique.mockResolvedValue({ role: UserRole.CASHIER, user_id: 'u2' });
        db.userStoreAccess.findUnique.mockResolvedValue({ id: 'a1', tenant_id: 't1' });
        await service.setStorePermissions(owner, 'u2', 's1', [
            StorePermission.CREATE_SALE,
            StorePermission.CREATE_SALE, // duplicate is collapsed
            StorePermission.VIEW_LEDGER,
        ]);
        expect(db.userStorePermission.deleteMany).toHaveBeenCalledWith({
            where: { tenant_id: 't1', user_id: 'u2', store_id: 's1' },
        });
        const createArg = db.userStorePermission.createMany.mock.calls[0][0];
        expect(createArg.data).toHaveLength(2);
    });

    it('lets OWNER list roles with permissions and member counts', async () => {
        db.tenantRole.findMany.mockResolvedValue([
            {
                id: 'role-1',
                name: 'Manager',
                description: 'System manager role',
                is_system: true,
                permissions: [{ permission: StorePermission.MANAGE_USERS }],
                _count: { members: 3 },
            },
        ]);

        await expect(service.listRoles(owner)).resolves.toEqual([
            {
                id: 'role-1',
                name: 'Manager',
                description: 'System manager role',
                is_system: true,
                permissions: [StorePermission.MANAGE_USERS],
                member_count: 3,
            },
        ]);
    });

    it('blocks non-OWNER from createRole', async () => {
        await expect(
            service.createRole(cashier, {
                name: 'Custom',
                permissions: [StorePermission.CREATE_SALE],
            }),
        ).rejects.toThrow(ForbiddenException);
        expect(db.tenantRole.create).not.toHaveBeenCalled();
    });

    it('createRole rejects duplicate name and Owner name', async () => {
        db.tenantRole.findMany.mockResolvedValue([{ name: 'Cashier' }]);
        await expect(
            service.createRole(owner, {
                name: 'cashier',
                permissions: [StorePermission.CREATE_SALE],
            }),
        ).rejects.toThrow(BadRequestException);

        db.tenantRole.findMany.mockResolvedValue([]);
        await expect(
            service.createRole(owner, {
                name: 'Owner',
                permissions: [StorePermission.CREATE_SALE],
            }),
        ).rejects.toThrow(BadRequestException);
    });

    it('updateRoleTemplate triggers sync when permissions change', async () => {
        db.tenantRole.findFirst.mockResolvedValue({
            id: 'role-1',
            name: 'Custom',
            tenant_id: 't1',
            permissions: [{ permission: StorePermission.CREATE_SALE }],
        });
        db.tenantUser.findMany.mockResolvedValue([{ user_id: 'u1' }, { user_id: 'u2' }]);

        await service.updateRoleTemplate(owner, 'role-1', {
            permissions: [StorePermission.VIEW_LEDGER, StorePermission.CREATE_SALE],
        });

        expect(db.tenantRolePermission.deleteMany).toHaveBeenCalledWith({
            where: { tenant_role_id: 'role-1' },
        });
        expect(syncMemberPermissionsFromRole).toHaveBeenCalledWith(
            db,
            expect.objectContaining({
                tenantId: 't1',
                userIds: ['u1', 'u2'],
                tenantRoleId: 'role-1',
                grantedBy: 'owner',
            }),
        );
        expect(audit.log).toHaveBeenCalledWith(
            'team.role_permissions_synced',
            'TenantRole',
            expect.any(Object),
            'role-1',
            expect.objectContaining({ syncedCount: 2 }),
        );
    });

    it('deleteRole blocks when members are assigned', async () => {
        db.tenantRole.findFirst.mockResolvedValue({
            id: 'role-1',
            name: 'Custom',
            tenant_id: 't1',
            permissions: [],
        });
        db.tenantUser.count.mockResolvedValue(2);

        await expect(service.deleteRole(owner, 'role-1')).rejects.toThrow(BadRequestException);
        expect(db.tenantRole.delete).not.toHaveBeenCalled();
    });
});
