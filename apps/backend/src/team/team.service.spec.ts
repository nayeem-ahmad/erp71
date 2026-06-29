import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TeamService } from './team.service';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { InvitationsService } from '../invitations/invitations.service';
import { StorePermission, UserRole } from '@erp71/shared-types';
import { TenantContext } from '../database/tenant.decorator';

const db = {
    tenantUser: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), delete: jest.fn(), count: jest.fn() },
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
});
