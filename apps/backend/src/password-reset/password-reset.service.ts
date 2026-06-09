import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { AuditService } from '../audit/audit.service';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class PasswordResetService {
    constructor(
        private db: DatabaseService,
        private email: EmailService,
        private audit: AuditService,
    ) {}

    async requestReset(emailAddress: string): Promise<void> {
        const user = await this.db.user.findUnique({ where: { email: emailAddress } });
        // Always return success to avoid user enumeration
        if (!user) return;

        // Invalidate any existing tokens for this user
        await this.db.passwordResetToken.deleteMany({ where: { user_id: user.id, used_at: null } });

        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

        await this.db.passwordResetToken.create({
            data: { user_id: user.id, token_hash: tokenHash, expires_at: expiresAt },
        });

        // Fire-and-forget — don't block the HTTP response on SMTP delivery
        this.email.sendPasswordReset(user.email, rawToken);
        this.audit.log('PASSWORD_RESET_REQUESTED', 'User', { userId: user.id }, user.id).catch(() => {});
    }

    async resetPassword(rawToken: string, newPassword: string): Promise<void> {
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

        const record = await this.db.passwordResetToken.findUnique({ where: { token_hash: tokenHash } });

        if (!record || record.used_at || record.expires_at < new Date()) {
            throw new BadRequestException('Invalid or expired reset token');
        }

        const passwordHash = await bcrypt.hash(newPassword, 10);

        // Increment token_version to invalidate all active sessions (#68)
        await this.db.$transaction([
            this.db.user.update({
                where: { id: record.user_id },
                data: { passwordHash, token_version: { increment: 1 } },
            }),
            this.db.passwordResetToken.update({ where: { id: record.id }, data: { used_at: new Date() } }),
        ]);
        this.audit.log('PASSWORD_RESET_COMPLETED', 'User', { userId: record.user_id }, record.user_id).catch(() => {});
    }
}
