import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { InvitationsService } from './invitations.service';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { UserRole } from '@erp71/shared-types';
import * as crypto from 'crypto';

const db = {
    tenant: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
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
            ],
        }).compile();
        service = mod.get(InvitationsService);
    });

    it('blocks CASHIER from inviting', async () => {
        await expect(
            service.invite('t1', 'u1', UserRole.CASHIER, 'new@example.com', UserRole.CASHIER),
        ).rejects.toThrow(ForbiddenException);
    });

    it('blocks ACCOUNTANT from inviting', async () => {
        await expect(
            service.invite('t1', 'u1', UserRole.ACCOUNTANT, 'new@example.com', UserRole.CASHIER),
        ).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException if user already a member', async () => {
        db.tenant.findUnique.mockResolvedValue({ id: 't1', name: 'Acme' });
        db.user.findUnique
            .mockResolvedValueOnce({ id: 'inviter', name: 'Owner', email: 'owner@example.com' })
            .mockResolvedValueOnce({ id: 'existing', email: 'member@example.com', tenantMembers: [{ tenant_id: 't1' }] });
        db.userInvitation.deleteMany.mockResolvedValue({ count: 0 });
        await expect(
            service.invite('t1', 'inviter', UserRole.OWNER, 'member@example.com', UserRole.CASHIER),
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
                role: UserRole.CASHIER,
                expires_at: new Date(Date.now() + 86400_000),
                created_at: new Date('2026-06-01'),
                invitedBy: { id: 'u1', name: 'Manager', email: 'manager@example.com' },
            },
        ]);

        const pending = await service.listPending('t1', UserRole.MANAGER);

        expect(pending).toHaveLength(1);
        expect(pending[0].email).toBe('cashier@example.com');
    });

    it('cancels a pending invitation', async () => {
        db.userInvitation.findFirst.mockResolvedValue({ id: 'inv1', tenant_id: 't1' });
        db.userInvitation.delete.mockResolvedValue({ id: 'inv1' });

        await service.cancelInvitation('t1', UserRole.OWNER, 'inv1');

        expect(db.userInvitation.delete).toHaveBeenCalledWith({ where: { id: 'inv1' } });
    });

    it('updates a team member role and syncs permissions', async () => {
        db.tenant.findUnique.mockResolvedValue({ owner_id: 'owner-1' });
        db.tenantUser.findUnique.mockResolvedValue({
            tenant_id: 't1',
            user_id: 'cashier-1',
            role: UserRole.CASHIER,
        });
        db.userStoreAccess.findMany.mockResolvedValue([{ store_id: 'store-1' }]);
        db.userStorePermission.deleteMany.mockResolvedValue({ count: 3 });
        db.userStorePermission.createMany.mockResolvedValue({ count: 5 });
        db.tenantUser.update.mockResolvedValue({
            tenant_id: 't1',
            user_id: 'cashier-1',
            role: UserRole.MANAGER,
        });

        const result = await service.updateMemberRole(
            't1',
            'owner-1',
            UserRole.OWNER,
            'cashier-1',
            UserRole.MANAGER,
        );

        expect(result).toEqual({ user_id: 'cashier-1', role: UserRole.MANAGER });
        expect(db.tenantUser.update).toHaveBeenCalled();
        expect(db.userStorePermission.deleteMany).toHaveBeenCalled();
        expect(db.userStorePermission.createMany).toHaveBeenCalled();
    });

    it('blocks changing your own role', async () => {
        await expect(
            service.updateMemberRole('t1', 'u1', UserRole.OWNER, 'u1', UserRole.MANAGER),
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
            service.updateMemberRole('t1', 'manager-1', UserRole.MANAGER, 'owner-1', UserRole.CASHIER),
        ).rejects.toThrow(ForbiddenException);
    });

    it('rejects OWNER role in invite', async () => {
        db.tenant.findUnique.mockResolvedValue({ id: 't1', name: 'Acme' });
        db.user.findUnique
            .mockResolvedValueOnce({ id: 'inviter', name: 'Owner', email: 'owner@example.com' })
            .mockResolvedValueOnce(null);

        await expect(
            service.invite('t1', 'inviter', UserRole.OWNER, 'new@example.com', UserRole.OWNER),
        ).rejects.toThrow(BadRequestException);
    });

    it('rejects accept when email does not match', async () => {
        const rawToken = 'mismatch-token';
        const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
        db.userInvitation.findUnique.mockResolvedValue({
            id: 'inv1', token_hash: hash, email: 'other@example.com',
            accepted_at: null, expires_at: new Date(Date.now() + 86400_000),
            tenant_id: 't1', role: UserRole.CASHIER, invited_by: 'owner',
        });
        db.user.findUnique.mockResolvedValue({ id: 'u2', email: 'wrong@example.com' });
        await expect(service.accept(rawToken, 'u2')).rejects.toThrow(BadRequestException);
    });
});
