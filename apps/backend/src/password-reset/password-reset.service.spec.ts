import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PasswordResetService } from './password-reset.service';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { SmsService } from '../sms/sms.service';
import { AuditService } from '../audit/audit.service';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt', () => ({
    hash: jest.fn().mockResolvedValue('hashed-password'),
}));

const db = {
    user: { findUnique: jest.fn(), update: jest.fn() },
    referee: { findFirst: jest.fn() },
    passwordResetToken: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), deleteMany: jest.fn() },
    emailVerificationToken: { deleteMany: jest.fn() },
    refreshToken: { updateMany: jest.fn() },
    $transaction: jest.fn(),
};
const emailService = {
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
    sendRefereeLoginInvite: jest.fn().mockResolvedValue(undefined),
    getFrontendUrl: jest.fn().mockResolvedValue('https://app.erp71.com'),
};
const smsService = { sendSms: jest.fn().mockResolvedValue({ sent: true }) };
const auditService = {
    log: jest.fn().mockResolvedValue(undefined),
    logForUserTenants: jest.fn().mockResolvedValue(undefined),
};

describe('PasswordResetService', () => {
    let service: PasswordResetService;

    beforeEach(async () => {
        jest.clearAllMocks();
        db.$transaction.mockImplementation(async (fn: any) => {
            if (typeof fn === 'function') return fn(db);
            return Promise.all(fn);
        });
        db.emailVerificationToken.deleteMany.mockResolvedValue({ count: 0 });
        db.refreshToken.updateMany.mockResolvedValue({ count: 0 });
        const mod = await Test.createTestingModule({
            providers: [
                PasswordResetService,
                { provide: DatabaseService, useValue: db },
                { provide: EmailService, useValue: emailService },
                { provide: SmsService, useValue: smsService },
                { provide: AuditService, useValue: auditService },
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

    it('marks email verified when password is set via reset token', async () => {
        const hash = crypto.createHash('sha256').update('valid-token').digest('hex');
        db.passwordResetToken.findUnique.mockResolvedValue({
            id: 'tok1',
            user_id: 'u1',
            token_hash: hash,
            expires_at: new Date(Date.now() + 3600_000),
            used_at: null,
        });
        db.user.findUnique.mockResolvedValue({ email_verified_at: null });
        db.user.update.mockResolvedValue({});
        db.passwordResetToken.update.mockResolvedValue({});

        await service.resetPassword('valid-token', 'newpassword123');

        expect(db.user.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 'u1' },
                data: expect.objectContaining({ email_verified_at: expect.any(Date) }),
            }),
        );
        expect(db.emailVerificationToken.deleteMany).toHaveBeenCalledWith({
            where: { user_id: 'u1' },
        });
    });

    // --- Referral partner invites ------------------------------------------------

    /**
     * An invite is not a password reset with different copy. It is cold outreach to
     * someone who has never seen a screen, so it lives longer, travels by SMS as
     * well as email, and can recover itself once expired. These cover the three
     * places that distinction has to hold.
     */
    describe('referee invites', () => {
        const target = {
            email: 'rahman@example.com',
            name: 'Rahman Traders',
            referralCode: 'RAHMA1B2C3',
            phone: '01712345678',
        };

        const issuedToken = () => db.passwordResetToken.create.mock.calls[0][0].data;

        beforeEach(() => {
            db.user.findUnique.mockResolvedValue({
                id: 'u1',
                email: 'rahman@example.com',
                preferred_locale: 'bn',
            });
            db.passwordResetToken.deleteMany.mockResolvedValue({ count: 0 });
            db.passwordResetToken.create.mockResolvedValue({});
        });

        it('gives an invite three days rather than a reset\'s hour', async () => {
            await service.requestRefereeInvite(target);

            const ttlMs = issuedToken().expires_at.getTime() - Date.now();
            // A little slack for the clock between issuing and asserting.
            expect(ttlMs).toBeGreaterThan(71 * 3600_000);
            expect(ttlMs).toBeLessThanOrEqual(72 * 3600_000);
        });

        it('stamps the token as an invite so the reset page can tell them apart', async () => {
            await service.requestRefereeInvite(target);
            expect(issuedToken().purpose).toBe('REFEREE_INVITE');
        });

        /**
         * The token also travels by SMS, where a 64-character hex string plus a URL
         * blows past one segment on its own.
         */
        it('issues a token short enough to survive an SMS', async () => {
            await service.requestRefereeInvite(target);
            const rawToken = emailService.sendRefereeLoginInvite.mock.calls[0][2];
            expect(rawToken.length).toBeLessThanOrEqual(24);
            expect(rawToken).toMatch(/^[A-Z2-7]+$/);
        });

        it('sends the invite in the partner\'s own language', async () => {
            await service.requestRefereeInvite(target);
            expect(emailService.sendRefereeLoginInvite).toHaveBeenCalledWith(
                'rahman@example.com',
                'Rahman Traders',
                expect.any(String),
                'RAHMA1B2C3',
                expect.objectContaining({ locale: 'bn', expiryHours: 72 }),
            );
        });

        it('texts the same token to a partner who has a phone number', async () => {
            await service.requestRefereeInvite(target);
            // Fire-and-forget, so let the microtask queue drain.
            await new Promise((resolve) => setImmediate(resolve));

            const [phone, message] = smsService.sendSms.mock.calls[0];
            expect(phone).toBe('01712345678');
            expect(message).toContain(emailService.sendRefereeLoginInvite.mock.calls[0][2]);
        });

        it('sends no SMS when there is no phone number on file', async () => {
            await service.requestRefereeInvite({ ...target, phone: null });
            await new Promise((resolve) => setImmediate(resolve));
            expect(smsService.sendSms).not.toHaveBeenCalled();
        });

        /** A dead SMS gateway must not take the email down with it. */
        it('still emails when the SMS gateway throws', async () => {
            smsService.sendSms.mockRejectedValueOnce(new Error('gateway down'));
            await expect(service.requestRefereeInvite(target)).resolves.toBeUndefined();
            expect(emailService.sendRefereeLoginInvite).toHaveBeenCalled();
        });
    });

    describe('inspectToken', () => {
        const token = 'SOMEINVITETOKEN';
        const hash = crypto.createHash('sha256').update(token).digest('hex');

        it('reports an expired invite as resendable', async () => {
            db.passwordResetToken.findUnique.mockResolvedValue({
                token_hash: hash,
                purpose: 'REFEREE_INVITE',
                used_at: null,
                expires_at: new Date(Date.now() - 1000),
            });

            await expect(service.inspectToken(token)).resolves.toEqual({
                valid: false,
                expired: true,
                used: false,
                purpose: 'REFEREE_INVITE',
                canResend: true,
            });
        });

        /**
         * A used invite means the partner already has a password. Sending another is
         * not recovery — it is a password reset they did not ask for.
         */
        it('will not offer to resend an invite that was already used', async () => {
            db.passwordResetToken.findUnique.mockResolvedValue({
                token_hash: hash,
                purpose: 'REFEREE_INVITE',
                used_at: new Date(),
                expires_at: new Date(Date.now() + 1000),
            });

            await expect(service.inspectToken(token)).resolves.toMatchObject({ canResend: false });
        });

        it('never offers resend for an ordinary password reset', async () => {
            db.passwordResetToken.findUnique.mockResolvedValue({
                token_hash: hash,
                purpose: 'PASSWORD_RESET',
                used_at: null,
                expires_at: new Date(Date.now() - 1000),
            });

            await expect(service.inspectToken(token)).resolves.toMatchObject({ canResend: false });
        });

        it('reports an unknown token without saying why', async () => {
            db.passwordResetToken.findUnique.mockResolvedValue(null);
            await expect(service.inspectToken('nonsense')).resolves.toEqual({
                valid: false,
                expired: false,
                used: false,
                purpose: null,
                canResend: false,
            });
        });
    });

    describe('resendRefereeInvite', () => {
        const token = 'EXPIREDINVITE';
        const hash = crypto.createHash('sha256').update(token).digest('hex');

        beforeEach(() => {
            db.passwordResetToken.deleteMany.mockResolvedValue({ count: 0 });
            db.passwordResetToken.create.mockResolvedValue({});
        });

        /**
         * The replacement goes to the address on the referee record, never to
         * anything the caller supplies — a leaked stale link cannot redirect an
         * invite somewhere else.
         */
        it('re-issues to the address on the referee record', async () => {
            db.passwordResetToken.findUnique.mockResolvedValue({
                user_id: 'u1',
                purpose: 'REFEREE_INVITE',
                used_at: null,
            });
            db.referee.findFirst.mockResolvedValue({
                name: 'Rahman Traders',
                phone: '01712345678',
                referral_code: 'RAHMA1B2C3',
                user: { email: 'rahman@example.com' },
            });
            db.user.findUnique.mockResolvedValue({
                id: 'u1',
                email: 'rahman@example.com',
                preferred_locale: 'bn',
            });

            await expect(service.resendRefereeInvite(token)).resolves.toEqual({ resent: true });
            expect(emailService.sendRefereeLoginInvite.mock.calls[0][0]).toBe('rahman@example.com');
        });

        /**
         * `Referee.email` and the login account's address are the same on every
         * referee created through the admin UI, but editing the referee does not
         * move the User row. The invite has to reach the mailbox that can sign in.
         */
        it('sends to the login account, not a diverged Referee.email', async () => {
            db.passwordResetToken.findUnique.mockResolvedValue({
                user_id: 'u1',
                purpose: 'REFEREE_INVITE',
                used_at: null,
            });
            db.referee.findFirst.mockResolvedValue({
                name: 'Rahman Traders',
                phone: null,
                referral_code: 'RAHMA1B2C3',
                user: { email: 'login@example.com' },
            });
            db.user.findUnique.mockResolvedValue({
                id: 'u1',
                email: 'login@example.com',
                preferred_locale: 'en',
            });

            await service.resendRefereeInvite(token);

            expect(db.user.findUnique).toHaveBeenCalledWith(
                expect.objectContaining({ where: { email: 'login@example.com' } }),
            );
        });

        it('says the same thing for an unknown token as for an archived partner', async () => {
            db.passwordResetToken.findUnique.mockResolvedValue(null);
            await expect(service.resendRefereeInvite(token)).resolves.toEqual({ resent: false });

            db.passwordResetToken.findUnique.mockResolvedValue({
                user_id: 'u1',
                purpose: 'REFEREE_INVITE',
                used_at: null,
            });
            db.referee.findFirst.mockResolvedValue(null);
            await expect(service.resendRefereeInvite(token)).resolves.toEqual({ resent: false });
        });

        it('refuses to resend against a password-reset token', async () => {
            db.passwordResetToken.findUnique.mockResolvedValue({
                user_id: 'u1',
                purpose: 'PASSWORD_RESET',
                used_at: null,
            });

            await expect(service.resendRefereeInvite(token)).resolves.toEqual({ resent: false });
            expect(db.referee.findFirst).not.toHaveBeenCalled();
        });
    });
});
