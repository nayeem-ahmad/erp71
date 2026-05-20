import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PasswordResetService } from './password-reset.service';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import * as crypto from 'crypto';

const db = {
    user: { findUnique: jest.fn(), update: jest.fn() },
    passwordResetToken: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), deleteMany: jest.fn() },
    $transaction: jest.fn(),
};
const emailService = { sendPasswordReset: jest.fn().mockResolvedValue(undefined) };

describe('PasswordResetService', () => {
    let service: PasswordResetService;

    beforeEach(async () => {
        jest.clearAllMocks();
        db.$transaction.mockImplementation((ops: any[]) => Promise.all(ops));
        const mod = await Test.createTestingModule({
            providers: [
                PasswordResetService,
                { provide: DatabaseService, useValue: db },
                { provide: EmailService, useValue: emailService },
            ],
        }).compile();
        service = mod.get(PasswordResetService);
    });

    it('silently succeeds for unknown email (prevents enumeration)', async () => {
        db.user.findUnique.mockResolvedValue(null);
        await expect(service.requestReset('unknown@example.com')).resolves.toBeUndefined();
        expect(emailService.sendPasswordReset).not.toHaveBeenCalled();
    });

    it('creates token and sends email for known user', async () => {
        db.user.findUnique.mockResolvedValue({ id: 'u1', email: 'user@example.com' });
        db.passwordResetToken.deleteMany.mockResolvedValue({ count: 0 });
        db.passwordResetToken.create.mockResolvedValue({});
        await service.requestReset('user@example.com');
        expect(emailService.sendPasswordReset).toHaveBeenCalledWith('user@example.com', expect.any(String));
    });

    it('rejects expired token', async () => {
        const hash = crypto.createHash('sha256').update('some-token').digest('hex');
        db.passwordResetToken.findUnique.mockResolvedValue({
            id: 'tok1',
            user_id: 'u1',
            token_hash: hash,
            expires_at: new Date(Date.now() - 1000),
            used_at: null,
        });
        await expect(service.resetPassword('some-token', 'newpassword123')).rejects.toThrow(BadRequestException);
    });

    it('rejects already-used token', async () => {
        const hash = crypto.createHash('sha256').update('used-token').digest('hex');
        db.passwordResetToken.findUnique.mockResolvedValue({
            id: 'tok1',
            user_id: 'u1',
            token_hash: hash,
            expires_at: new Date(Date.now() + 3600_000),
            used_at: new Date(),
        });
        await expect(service.resetPassword('used-token', 'newpassword123')).rejects.toThrow(BadRequestException);
    });
});
