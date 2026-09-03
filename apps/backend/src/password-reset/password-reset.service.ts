import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PasswordResetPurpose } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { SmsService } from '../sms/sms.service';
import { AuditService } from '../audit/audit.service';
import { renderRefereeInviteSms, resolveEmailLocale } from '../email/templates/referee-invite';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';

/**
 * A reset is issued to someone sitting at the login screen who just clicked
 * "forgot password". An hour is generous for that.
 */
const RESET_TTL_MS = 60 * 60 * 1000;

/**
 * An invite is cold outreach. The partner reads it that evening, or the next
 * morning, or after someone tells them to go look — and until now it was dead by
 * then, with an admin the only way back in. Three days is the span in which a real
 * person acts on an email they were not waiting for.
 */
const INVITE_TTL_MS = 72 * 60 * 60 * 1000;
export const INVITE_TTL_HOURS = INVITE_TTL_MS / (60 * 60 * 1000);

/**
 * Invite tokens are shorter than reset tokens because they also travel by SMS,
 * where a 64-character hex string plus a URL blows past a single segment on its
 * own. 20 base32 characters is 100 bits — for a single-use token that dies in 72
 * hours and sits behind a throttled endpoint, the margin is not close.
 */
const INVITE_TOKEN_BYTES = 13; // 13 bytes → 21 base32 chars after padding is stripped
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Token(bytes: Buffer): string {
    let bits = 0;
    let value = 0;
    let out = '';
    for (const byte of bytes) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            out += BASE32[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
    return out;
}

export interface RefereeInviteTarget {
    email: string;
    name: string;
    referralCode: string;
    phone?: string | null;
}

@Injectable()
export class PasswordResetService {
    private readonly logger = new Logger(PasswordResetService.name);

    constructor(
        private db: DatabaseService,
        private email: EmailService,
        private sms: SmsService,
        private audit: AuditService,
    ) {}

    private hash(rawToken: string): string {
        return crypto.createHash('sha256').update(rawToken).digest('hex');
    }

    async requestReset(emailAddress: string): Promise<void> {
        const user = await this.db.user.findUnique({ where: { email: emailAddress } });
        // Always return success to avoid user enumeration
        if (!user) return;

        // Invalidate any existing tokens for this user
        await this.db.passwordResetToken.deleteMany({ where: { user_id: user.id, used_at: null } });

        const rawToken = crypto.randomBytes(32).toString('hex');

        await this.db.passwordResetToken.create({
            data: {
                user_id: user.id,
                token_hash: this.hash(rawToken),
                purpose: PasswordResetPurpose.PASSWORD_RESET,
                expires_at: new Date(Date.now() + RESET_TTL_MS),
            },
        });

        // Fire-and-forget — don't block the HTTP response on SMTP delivery
        this.email.sendPasswordReset(user.email, rawToken);
        this.audit
            .logForUserTenants('PASSWORD_RESET_REQUESTED', 'User', { userId: user.id }, user.id)
            .catch(() => {});
    }

    async resetPassword(rawToken: string, newPassword: string): Promise<void> {
        const record = await this.db.passwordResetToken.findUnique({
            where: { token_hash: this.hash(rawToken) },
        });

        if (!record || record.used_at || record.expires_at < new Date()) {
            throw new BadRequestException('Invalid or expired reset token');
        }

        const passwordHash = await bcrypt.hash(newPassword, 10);

        // Increment token_version to invalidate all active sessions (#68) — both
        // surfaces, since the storefront customer login accepts the same password.
        // Using the emailed reset link proves inbox ownership — mark verified if not already.
        await this.db.$transaction(async (tx) => {
            const user = await tx.user.findUnique({
                where: { id: record.user_id },
                select: { email_verified_at: true },
            });
            await tx.user.update({
                where: { id: record.user_id },
                data: {
                    passwordHash,
                    token_version: { increment: 1 },
                    storefront_token_version: { increment: 1 },
                    applicant_token_version: { increment: 1 },
                    ...(!user?.email_verified_at && { email_verified_at: new Date() }),
                },
            });
            await tx.passwordResetToken.update({ where: { id: record.id }, data: { used_at: new Date() } });
            // Refresh tokens are checked against their own row, not `token_version`,
            // so the bump above would otherwise leave every session able to mint
            // itself a fresh access token straight after the reset.
            await tx.refreshToken.updateMany({
                where: { user_id: record.user_id, revoked_at: null },
                data: { revoked_at: new Date() },
            });
            if (!user?.email_verified_at) {
                await tx.emailVerificationToken.deleteMany({ where: { user_id: record.user_id } });
            }
        });
        this.audit
            .logForUserTenants('PASSWORD_RESET_COMPLETED', 'User', { userId: record.user_id }, record.user_id)
            .catch(() => {});
    }

    /**
     * Issue a partner invite and deliver it by every channel we have.
     *
     * Email and SMS carry the same single-use token: two chances at one door, not
     * two doors. A partner recruiting shops door-to-door is a phone-first user who
     * may not open email for days, and `Referee.phone` has been collected since the
     * model existed without anything ever being sent to it.
     *
     * SMS is fire-and-forget and platform-billed (no `tenantId`), so a missing SMS
     * gateway key never blocks the email.
     */
    async requestRefereeInvite(target: RefereeInviteTarget): Promise<void> {
        const user = await this.db.user.findUnique({
            where: { email: target.email },
            select: { id: true, email: true, preferred_locale: true },
        });
        if (!user) return;

        await this.db.passwordResetToken.deleteMany({ where: { user_id: user.id, used_at: null } });

        const rawToken = base32Token(crypto.randomBytes(INVITE_TOKEN_BYTES));

        await this.db.passwordResetToken.create({
            data: {
                user_id: user.id,
                token_hash: this.hash(rawToken),
                purpose: PasswordResetPurpose.REFEREE_INVITE,
                expires_at: new Date(Date.now() + INVITE_TTL_MS),
            },
        });

        this.email
            .sendRefereeLoginInvite(user.email, target.name, rawToken, target.referralCode, {
                locale: user.preferred_locale,
                expiryHours: INVITE_TTL_HOURS,
            })
            .catch((err) => this.logger.warn(`Referee invite email to ${user.email} failed: ${err}`));

        if (target.phone?.trim()) {
            void this.sendInviteSms(target.phone.trim(), target.name, rawToken, user.preferred_locale);
        }

        this.audit
            .logForUserTenants('REFEREE_LOGIN_INVITE_SENT', 'Referee', { userId: user.id }, user.id, {
                email: user.email,
                sms: !!target.phone?.trim(),
            })
            .catch(() => {});
    }

    private async sendInviteSms(
        phone: string,
        name: string,
        rawToken: string,
        locale: string | null,
    ): Promise<void> {
        try {
            const frontendUrl = await this.email.getFrontendUrl();
            const message = renderRefereeInviteSms(resolveEmailLocale(locale), {
                name,
                setupLink: `${frontendUrl}/reset-password?token=${rawToken}`,
            });
            await this.sms.sendSms(phone, message, { purpose: 'Referral partner invite' });
        } catch (err) {
            this.logger.warn(`Referee invite SMS to ${phone} failed: ${err}`);
        }
    }

    /**
     * What a token is and whether it still works, for the page the link lands on.
     *
     * The token is itself the secret, so describing the row it names leaks nothing
     * that its holder does not already have. Returning this lets `/reset-password`
     * render the right thing on load — an expired *invite* can offer to resend
     * itself — instead of finding out only after the user has typed a password
     * twice and pressed submit.
     */
    async inspectToken(rawToken: string): Promise<{
        valid: boolean;
        expired: boolean;
        used: boolean;
        purpose: PasswordResetPurpose | null;
        /** Only an unexpired, unused invite can be resent from the page. */
        canResend: boolean;
    }> {
        const record = await this.db.passwordResetToken.findUnique({
            where: { token_hash: this.hash(rawToken) },
            select: { purpose: true, used_at: true, expires_at: true },
        });

        if (!record) {
            return { valid: false, expired: false, used: false, purpose: null, canResend: false };
        }

        const used = !!record.used_at;
        const expired = record.expires_at < new Date();
        return {
            valid: !used && !expired,
            expired,
            used,
            purpose: record.purpose,
            // A used invite means the partner already has a password; sending another
            // is not recovery, it is a password reset they did not ask for.
            canResend: record.purpose === PasswordResetPurpose.REFEREE_INVITE && !used,
        };
    }

    /**
     * Re-issue an invite from an expired one, without an admin in the loop.
     *
     * The expired token is the proof: only the person the invite was sent to has
     * it. The new one goes to the address on the referee record, never to anything
     * the caller supplies, so a leaked stale link cannot be used to redirect an
     * invite somewhere else.
     *
     * Returns `{ resent: false }` rather than throwing for every failure mode, so
     * the endpoint says the same thing whether the token is unknown, already used,
     * or belongs to a partner who has since been archived.
     */
    async resendRefereeInvite(rawToken: string): Promise<{ resent: boolean }> {
        const record = await this.db.passwordResetToken.findUnique({
            where: { token_hash: this.hash(rawToken) },
            select: { user_id: true, purpose: true, used_at: true },
        });

        if (!record || record.purpose !== PasswordResetPurpose.REFEREE_INVITE || record.used_at) {
            return { resent: false };
        }

        const referee = await this.db.referee.findFirst({
            where: { user_id: record.user_id, is_active: true, deleted_at: null },
            select: { name: true, phone: true, referral_code: true, user: { select: { email: true } } },
        });
        if (!referee?.user) return { resent: false };

        // The login account's address, not `Referee.email`. The two are the same on
        // every referee created through the admin UI, but an admin who edits the
        // referee's email does not move the User row with it — and the invite has to
        // reach the mailbox that can actually sign in.
        await this.requestRefereeInvite({
            email: referee.user.email,
            name: referee.name,
            referralCode: referee.referral_code,
            phone: referee.phone,
        });
        return { resent: true };
    }
}
