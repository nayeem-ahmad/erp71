import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { InvitationsService } from './invitations.service';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { PlanEntitlementsService } from '../subscription-plans/plan-entitlements.service';
import { StorePermission, UserRole } from '@erp71/shared-types';
import * as crypto from 'crypto';

jest.mock('../team/role-sync.util', () => ({
    syncMemberPermissionsFromRole: jest.fn().mockResolvedValue(1),
}));

import { syncMemberPermissionsFromRole } from '../team/role-sync.util';

const db = {
    tenant: { findUnique: jest.fn() },
    user: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    tenantRole: { findFirst: jest.fn() },
    userInvitation: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
        delete: jest.fn(),
    },
    tenantUser: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
    store: { findFirst: jest.fn() },
    userStoreAccess: { findMany: jest.fn(), create: jest.fn() },
    userStorePermission: { deleteMany: jest.fn(), createMany: jest.fn() },
    $transaction: jest.fn(),
};
const emailService = { sendInvitation: jest.fn().mockResolvedValue(undefined) };
const planEntitlements = { assertUserQuota: jest.fn().mockResolvedValue(undefined) };

describe('InvitationsService', () => {
    let service: InvitationsService;

    beforeEach(async () => {
        jest.clearAllMocks();
        db.$transaction.mockImplementation(async (fn: any) => fn(db));
        const mod = await Test.createTestingModule({
            providers: [
                InvitationsService,
                { provide: DatabaseService, useValue: db },
                { provide: EmailService, useValue: emailService },
                { provide: PlanEntitlementsService, useValue: planEntitlements },
            ],
        }).compile();
        service = mod.get(InvitationsService);
    });

    it('blocks CASHIER from inviting', async () => {
        await expect(
            service.invite('t1', 'u1', UserRole.CASHIER, 'new@example.com', 'role-cashier'),
        ).rejects.toThrow(ForbiddenException);
    });

    it('blocks ACCOUNTANT from inviting', async () => {
        await expect(
            service.invite('t1', 'u1', UserRole.ACCOUNTANT, 'new@example.com', 'role-cashier'),
        ).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException if user already a member', async () => {
        db.tenantRole.findFirst.mockResolvedValue({ id: 'role-cashier', name: 'Cashier' });
        db.tenant.findUnique.mockResolvedValue({ id: 't1', name: 'Acme' });
        db.user.findUnique
            .mockResolvedValueOnce({ id: 'inviter', name: 'Owner', email: 'owner@example.com' })
            .mockResolvedValueOnce({ id: 'existing', email: 'member@example.com', tenantMembers: [{ tenant_id: 't1' }] });
        db.userInvitation.deleteMany.mockResolvedValue({ count: 0 });
        await expect(
            service.invite('t1', 'inviter', UserRole.OWNER, 'member@example.com', 'role-cashier'),
        ).rejects.toThrow(ConflictException);
    });

    it('rejects expired invitation token', async () => {
        const rawToken = 'expired-token';
        const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
        db.userInvitation.findUnique.mockResolvedValue({
            token_hash: hash,
            email: 'a@b.com',
            accepted_at: null,
            expires_at: new Date(Date.now() - 1000),
            tenant: { name: 'Acme' },
            tenantRole: { name: 'Cashier' },
        });
        await expect(service.getInfo(rawToken)).rejects.toThrow(BadRequestException);
    });

    it('lists tenant members for OWNER', async () => {
        db.tenant.findUnique.mockResolvedValue({ owner_id: 'u1' });
        db.tenantUser.findMany.mockResolvedValue([
            {
                id: 'tm1',
                user_id: 'u1',
                role: UserRole.OWNER,
                user: { id: 'u1', email: 'owner@example.com', name: 'Owner', created_at: new Date('2026-01-01') },
            },
        ]);

        const members = await service.listMembers('t1', UserRole.OWNER);

        expect(members).toHaveLength(1);
        expect(members[0].email).toBe('owner@example.com');
        expect(members[0].is_owner).toBe(true);
    });

    it('lists pending invitations for MANAGER', async () => {
        db.userInvitation.findMany.mockResolvedValue([
            {
                id: 'inv1',
                email: 'cashier@example.com',
                tenant_role_id: 'role-cashier',
                expires_at: new Date(Date.now() + 86400_000),
                created_at: new Date('2026-06-01'),
                tenantRole: { id: 'role-cashier', name: 'Cashier' },
                invitedBy: { id: 'u1', name: 'Manager', email: 'manager@example.com' },
            },
        ]);

        const pending = await service.listPending('t1', UserRole.MANAGER);

        expect(pending).toHaveLength(1);
        expect(pending[0].email).toBe('cashier@example.com');
        expect(pending[0].roleName).toBe('Cashier');
        expect(pending[0].tenantRoleId).toBe('role-cashier');
    });

    it('cancels a pending invitation', async () => {
        db.userInvitation.findFirst.mockResolvedValue({ id: 'inv1', tenant_id: 't1' });
        db.userInvitation.delete.mockResolvedValue({ id: 'inv1' });

        await service.cancelInvitation('t1', UserRole.OWNER, 'inv1');

        expect(db.userInvitation.delete).toHaveBeenCalledWith({ where: { id: 'inv1' } });
    });

    it('updates a team member role and syncs permissions', async () => {
        db.tenantRole.findFirst.mockResolvedValue({ id: 'role-manager', name: 'Manager' });
        db.tenant.findUnique.mockResolvedValue({ owner_id: 'owner-1' });
        db.tenantUser.findUnique.mockResolvedValue({
            tenant_id: 't1',
            user_id: 'cashier-1',
            role: UserRole.CASHIER,
            tenant_role_id: 'role-cashier',
        });

        const result = await service.updateMemberRole(
            't1',
            'owner-1',
            UserRole.OWNER,
            'cashier-1',
            'role-manager',
        );

        expect(result).toEqual({ user_id: 'cashier-1', tenantRoleId: 'role-manager' });
        // Coarse role enum must move in lockstep with the granular tenant_role_id.
        expect(db.tenantUser.update).toHaveBeenCalledWith({
            where: { tenant_id_user_id: { tenant_id: 't1', user_id: 'cashier-1' } },
            data: { tenant_role_id: 'role-manager', role: UserRole.MANAGER },
        });
        expect(syncMemberPermissionsFromRole).toHaveBeenCalledWith(
            db,
            expect.objectContaining({
                tenantId: 't1',
                userIds: ['cashier-1'],
                tenantRoleId: 'role-manager',
                grantedBy: 'owner-1',
            }),
        );
    });

    it('blocks changing your own role', async () => {
        await expect(
            service.updateMemberRole('t1', 'u1', UserRole.OWNER, 'u1', 'role-manager'),
        ).rejects.toThrow(BadRequestException);
    });

    it('blocks changing workspace owner role', async () => {
        db.tenant.findUnique.mockResolvedValue({ owner_id: 'owner-1' });
        db.tenantUser.findUnique.mockResolvedValue({
            tenant_id: 't1',
            user_id: 'owner-1',
            role: UserRole.OWNER,
        });

        await expect(
            service.updateMemberRole('t1', 'manager-1', UserRole.MANAGER, 'owner-1', 'role-cashier'),
        ).rejects.toThrow(ForbiddenException);
    });

    it('rejects invalid tenant role in invite', async () => {
        db.tenantRole.findFirst.mockResolvedValue(null);
        await expect(
            service.invite('t1', 'inviter', UserRole.OWNER, 'new@example.com', 'missing-role'),
        ).rejects.toThrow(NotFoundException);
    });

    it('rejects accept when email does not match', async () => {
        const rawToken = 'mismatch-token';
        const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
        db.userInvitation.findUnique.mockResolvedValue({
            id: 'inv1',
            token_hash: hash,
            email: 'other@example.com',
            accepted_at: null,
            expires_at: new Date(Date.now() + 86400_000),
            tenant_id: 't1',
            tenant_role_id: 'role-cashier',
            invited_by: 'owner',
            tenantRole: { permissions: [{ permission: StorePermission.CREATE_SALE }] },
        });
        db.user.findUnique.mockResolvedValue({ id: 'u2', email: 'wrong@example.com' });
        await expect(service.accept(rawToken, 'u2')).rejects.toThrow(BadRequestException);
    });

    it('getInfo reports whether the invited email already has an account', async () => {
        const rawToken = 'info-token';
        const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
        db.userInvitation.findUnique.mockResolvedValue({
            token_hash: hash,
            email: 'invitee@example.com',
            accepted_at: null,
            expires_at: new Date(Date.now() + 86400_000),
            tenant: { name: 'Acme' },
            tenantRole: { name: 'Cashier' },
        });

        db.user.findUnique.mockResolvedValueOnce(null);
        await expect(service.getInfo(rawToken)).resolves.toMatchObject({ hasAccount: false });

        db.user.findUnique.mockResolvedValueOnce({ id: 'u9' });
        await expect(service.getInfo(rawToken)).resolves.toMatchObject({ hasAccount: true });
    });

    it('acceptWithSignup creates the invited user and grants membership', async () => {
        const rawToken = 'signup-token';
        const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
        db.userInvitation.findUnique.mockResolvedValue({
            id: 'inv1',
            token_hash: hash,
            email: 'newbie@example.com',
            accepted_at: null,
            expires_at: new Date(Date.now() + 86400_000),
            tenant_id: 't1',
            tenant_role_id: 'role-manager',
            invited_by: 'owner',
            tenantRole: { name: 'Manager', permissions: [{ permission: StorePermission.CREATE_SALE }] },
        });
        db.user.findUnique.mockResolvedValue(null); // no existing account
        db.user.findFirst.mockResolvedValue(null); // mobile not taken
        db.user.create.mockResolvedValue({ id: 'new-user' });
        db.store.findFirst.mockResolvedValue({ id: 'store-1' });

        await service.acceptWithSignup(rawToken, 'New Bie', '01712345678', 'supersecret');

        expect(db.user.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ email: 'newbie@example.com', mobile: '+8801712345678' }),
            }),
        );
        // The coarse role enum must reflect the invited role (Manager), not a hardcoded CASHIER.
        expect(db.tenantUser.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ user_id: 'new-user', tenant_id: 't1', role: UserRole.MANAGER }),
            }),
        );
        expect(db.userInvitation.update).toHaveBeenCalledWith({
            where: { id: 'inv1' },
            data: { accepted_at: expect.any(Date) },
        });
    });

    it('acceptWithSignup rejects when an account already exists for the email', async () => {
        const rawToken = 'dupe-token';
        const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
        db.userInvitation.findUnique.mockResolvedValue({
            id: 'inv1',
            token_hash: hash,
            email: 'exists@example.com',
            accepted_at: null,
            expires_at: new Date(Date.now() + 86400_000),
            tenant_id: 't1',
            tenant_role_id: 'role-cashier',
            invited_by: 'owner',
            tenantRole: { permissions: [] },
        });
        db.user.findUnique.mockResolvedValue({ id: 'existing', email: 'exists@example.com' });

        await expect(
            service.acceptWithSignup(rawToken, 'Dupe', '01712345678', 'supersecret'),
        ).rejects.toThrow(ConflictException);
        expect(db.user.create).not.toHaveBeenCalled();
    });
});