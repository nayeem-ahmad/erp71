import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { InvitationsService } from './invitations.service';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { UserRole } from '@retail-saas/shared-types';
import * as crypto from 'crypto';

const db = {
    tenant: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    userInvitation: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), deleteMany: jest.fn() },
    tenantUser: { create: jest.fn() },
    store: { findFirst: jest.fn() },
    userStoreAccess: { create: jest.fn() },
    userStorePermission: { createMany: jest.fn() },
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
