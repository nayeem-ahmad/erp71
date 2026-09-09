import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TeamService } from './team.service';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { InvitationsService } from '../invitations/invitations.service';
import { StorePermission, UserRole } from '@erp71/shared-types';
import { TenantContext } from '../database/tenant.decorator';

jest.mock('./role-sync.util', () => ({
    syncMemberPermissionsFromRoles: jest.fn().mockResolvedValue(2),
    setMemberRoles: jest.fn().mockResolvedValue(undefined),
}));

import { setMemberRoles, syncMemberPermissionsFromRoles } from './role-sync.util';

const db = {
    tenantUser: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), delete: jest.fn(), count: jest.fn() },
    tenantUserRole: { findMany: jest.fn(), count: jest.fn() },
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
const audit = {
    log: jest.fn().mockResolvedValue(undefined),
    logForUserTenants: jest.fn().mockResolvedValue(undefined),
};
const invitations = { invite: jest.fn().mockResolvedValue(undefined) };

const owner: TenantContext = { tenantId: 't1', userId: 'owner', userRole: UserRole.OWNER, storeId: 's1', timezone: 'Asia/Dhaka' };
const cashier: TenantContext = { tenantId: 't1', userId: 'cash', userRole: UserRole.CASHIER, storeId: 's1', timezone: 'Asia/Dhaka' };

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

    it('refuses to change an owner member role', async () => {
        db.tenantUser.findUnique.mockResolvedValue({ role: UserRole.OWNER, user_id: 'other', tenant_role_id: null, roles: [] });
        await expect(service.updateRoles(owner, 'other', ['role-manager'])).rejects.toThrow(BadRequestException);
    });

    it('refuses to change your own role', async () => {
        db.tenantUser.findUnique.mockResolvedValue({ role: UserRole.OWNER, user_id: 'owner', tenant_role_id: null, roles: [] });
        await expect(service.updateRoles(owner, 'owner', ['role-manager'])).rejects.toThrow(BadRequestException);
    });

    it('reports a member who predates multi-role as holding their primary role', async () => {
        // Between a deploy and the template sync running, a member has a
        // tenant_role_id and no join rows; reporting no roles would read as a
        // member who lost theirs.
        db.tenantUser.findUnique.mockResolvedValue({
            role: UserRole.CASHIER,
            user_id: 'u2',
            tenant_role_id: 'role-cashier',
            tenantRole: { id: 'role-cashier', name: 'Cashier', permissions: [] },
            roles: [],
        });
        db.user.findUnique.mockResolvedValue({ id: 'u2', email: 'u2@example.com', name: 'Two' });
        db.store.findMany.mockResolvedValue([]);
        db.userStoreAccess.findMany.mockResolvedValue([]);
        db.userStorePermission.findMany.mockResolvedValue([]);

        await expect(service.getMember(owner, 'u2')).resolves.toEqual(
            expect.objectContaining({ roleNames: ['Cashier'], tenantRoleIds: ['role-cashier'] }),
        );
    });

    it('rejects an empty role set', async () => {
        db.tenantUser.findUnique.mockResolvedValue({
            role: UserRole.CASHIER,
            user_id: 'u2',
            tenant_role_id: 'role-cashier',
            tenantRole: { permissions: [] },
            roles: [],
        });
        await expect(service.updateRoles(owner, 'u2', [])).rejects.toThrow(BadRequestException);
        expect(db.tenantUser.update).not.toHaveBeenCalled();
    });

    it('updates member tenant role and syncs permissions', async () => {
        db.tenantUser.findUnique.mockResolvedValue({
            role: UserRole.CASHIER,
            user_id: 'u2',
            tenant_role_id: 'role-cashier',
            tenantRole: { permissions: [] },
            roles: [],
        });
        db.tenantRole.findFirst.mockResolvedValue({
            id: 'role-manager',
            name: 'Manager',
            tenant_id: 't1',
            permissions: [{ permission: StorePermission.MANAGE_USERS }],
        });

        await service.updateRoles(owner, 'u2', ['role-manager']);

        // Coarse role enum must move in lockstep with tenant_role_id so the session,
        // auth gates, and platform-admin Edit Tenant view reflect the new role.
        expect(db.tenantUser.update).toHaveBeenCalledWith({
            where: { tenant_id_user_id: { tenant_id: 't1', user_id: 'u2' } },
            data: { tenant_role_id: 'role-manager', role: UserRole.MANAGER },
        });
        expect(setMemberRoles).toHaveBeenCalledWith(
            db,
            expect.objectContaining({
                tenantId: 't1',
                userId: 'u2',
                tenantRoleIds: ['role-manager'],
                grantedBy: 'owner',
            }),
        );
    });

    it('assigns several roles at once, taking the strongest coarse role', async () => {
        db.tenantUser.findUnique.mockResolvedValue({
            role: UserRole.CASHIER,
            user_id: 'u2',
            tenant_role_id: 'role-sales-user',
            tenantRole: { permissions: [] },
            roles: [],
        });
        db.tenantRole.findFirst.mockImplementation(async ({ where }: any) =>
            ({
                'role-sales-user': { id: 'role-sales-user', name: 'Sales User', tenant_id: 't1', permissions: [] },
                'role-accounting-mgr': {
                    id: 'role-accounting-mgr',
                    name: 'Accounting Manager',
                    tenant_id: 't1',
                    permissions: [],
                },
            })[where.id as string],
        );

        await service.updateRoles(owner, 'u2', ['role-sales-user', 'role-accounting-mgr']);

        // Primary role stays the first of the set; the enum takes the strongest, which
        // Accounting Manager carries.
        expect(db.tenantUser.update).toHaveBeenCalledWith({
            where: { tenant_id_user_id: { tenant_id: 't1', user_id: 'u2' } },
            data: { tenant_role_id: 'role-sales-user', role: UserRole.ACCOUNTANT },
        });
        expect(setMemberRoles).toHaveBeenCalledWith(
            db,
            expect.objectContaining({ tenantRoleIds: ['role-sales-user', 'role-accounting-mgr'] }),
        );
    });

    it('requires branch access before setting permissions', async () => {
        db.tenantUser.findUnique.mockResolvedValue({
            role: UserRole.CASHIER,
            user_id: 'u2',
            tenantRole: { permissions: [] },
            roles: [],
        });
        db.userStoreAccess.findUnique.mockResolvedValue(null);
        await expect(
            service.setStorePermissions(owner, 'u2', 's1', [StorePermission.CREATE_SALE]),
        ).rejects.toThrow(BadRequestException);
    });

    it('replaces permissions for a branch the user can access', async () => {
        db.tenantUser.findUnique.mockResolvedValue({
            role: UserRole.CASHIER,
            user_id: 'u2',
            tenantRole: { permissions: [] },
            roles: [],
        });
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
                template_key: null,
                permissions: [{ permission: StorePermission.MANAGE_USERS }],
                _count: { memberRoles: 3 },
            },
        ]);

        await expect(service.listRoles(owner)).resolves.toEqual([
            {
                id: 'role-1',
                name: 'Manager',
                description: 'System manager role',
                is_system: true,
                template_key: null,
                module: null,
                level: null,
                permissions: [StorePermission.MANAGE_USERS],
                member_count: 3,
            },
        ]);
    });

    it('reports a seeded role\'s module and level from its template, not its stored name', async () => {
        db.tenantRole.findMany.mockResolvedValue([
            {
                id: 'role-2',
                // Renamed by the owner — the module must still come from template_key.
                name: 'Shop Floor Lead',
                description: null,
                is_system: true,
                template_key: 'sales_manager',
                permissions: [{ permission: StorePermission.CREATE_SALE }],
                _count: { memberRoles: 1 },
            },
        ]);

        await expect(service.listRoles(owner)).resolves.toEqual([
            expect.objectContaining({ module: 'Sales', level: 'MANAGER', template_key: 'sales_manager' }),
        ]);
    });

    it('lets a member with MANAGE_USERS read the role list so they can assign one', async () => {
        db.userStorePermission.findFirst.mockResolvedValue({ id: 'g1' });
        db.tenantRole.findMany.mockResolvedValue([]);
        await expect(service.listRoles(cashier)).resolves.toEqual([]);
    });

    it('blocks a member without MANAGE_USERS from reading the role list', async () => {
        db.userStorePermission.findFirst.mockResolvedValue(null);
        await expect(service.listRoles(cashier)).rejects.toThrow(ForbiddenException);
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
        // Everyone holding the role, read through the join table — including members
        // whose primary role is something else.
        db.tenantUserRole.findMany.mockResolvedValue([
            { tenantUser: { user_id: 'u1' } },
            { tenantUser: { user_id: 'u2' } },
        ]);

        await service.updateRoleTemplate(owner, 'role-1', {
            permissions: [StorePermission.VIEW_LEDGER, StorePermission.CREATE_SALE],
        });

        expect(db.tenantRolePermission.deleteMany).toHaveBeenCalledWith({
            where: { tenant_role_id: 'role-1' },
        });
        expect(syncMemberPermissionsFromRoles).toHaveBeenCalledWith(
            db,
            expect.objectContaining({
                tenantId: 't1',
                userIds: ['u1', 'u2'],
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
        db.tenantUserRole.count.mockResolvedValue(2);

        await expect(service.deleteRole(owner, 'role-1')).rejects.toThrow(BadRequestException);
        expect(db.tenantRole.delete).not.toHaveBeenCalled();
    });
});
