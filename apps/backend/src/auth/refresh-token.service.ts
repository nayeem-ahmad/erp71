import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { DatabaseService } from '../database/database.service';
import { AuditRequestMeta } from '../audit/audit-route.util';

/**
 * Issues and rotates the long-lived half of a session.
 *
 * The access JWT is deliberately short-lived; this table is what lets the
 * frontend renew it silently instead of dropping someone at the login screen in
 * the middle of a task. Only the sha256 of each token is stored, so a dump of
 * the table hands the reader nothing usable.
 */

/** How long a refresh token stays valid. Overridable per deployment. */
const DEFAULT_TTL_DAYS = 30;

/**
 * A rotated token stays usable for this long after it was exchanged.
 *
 * Without it, two tabs that share one localStorage token and happen to renew at
 * the same moment would look exactly like a stolen-token replay, and the second
 * tab would log the user out — the very bug this whole change exists to fix.
 * The frontend de-dupes its own in-flight refreshes, so this only has to cover
 * a genuine cross-tab race, which is over in milliseconds.
 */
const REUSE_GRACE_MS = 60_000;

/** Keep the recorded user agent from growing unbounded from a hostile client. */
const MAX_USER_AGENT_LENGTH = 512;

export interface IssuedRefreshToken {
    /** The raw token. Only ever returned here — the table holds its hash. */
    token: string;
    expiresAt: Date;
}

export function hashRefreshToken(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
}

function refreshTtlDays(): number {
    const configured = Number(process.env.JWT_REFRESH_TTL_DAYS);
    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TTL_DAYS;
}

@Injectable()
export class RefreshTokenService {
    constructor(private db: DatabaseService) {}

    /** Mint a fresh session token for `userId`. */
    async issue(userId: string, meta: AuditRequestMeta = {}): Promise<IssuedRefreshToken> {
        const token = crypto.randomBytes(48).toString('base64url');
        const expiresAt = new Date(Date.now() + refreshTtlDays() * 24 * 60 * 60 * 1000);

        await this.db.refreshToken.create({
            data: {
                user_id: userId,
                token_hash: hashRefreshToken(token),
                expires_at: expiresAt,
                user_agent: meta.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
                ip: meta.ipAddress ?? null,
            },
        });

        this.pruneExpired(userId).catch(() => {});

        return { token, expiresAt };
    }

    /**
     * Exchange a token for its successor.
     *
     * Rotation is what makes a leaked token detectable: each one is good for a
     * single exchange, so a second use outside the race window means two
     * parties hold it. That revokes the whole family rather than silently
     * handing the attacker a rolling session.
     */
    async rotate(raw: string, meta: AuditRequestMeta = {}): Promise<{ userId: string } & IssuedRefreshToken> {
        if (!raw || typeof raw !== 'string') {
            throw new UnauthorizedException('Invalid refresh token');
        }

        const existing = await this.db.refreshToken.findUnique({
            where: { token_hash: hashRefreshToken(raw) },
        });

        if (!existing) throw new UnauthorizedException('Invalid refresh token');
        if (existing.revoked_at) throw new UnauthorizedException('Session revoked');
        if (existing.expires_at.getTime() <= Date.now()) {
            throw new UnauthorizedException('Session expired');
        }

        if (existing.used_at && Date.now() - existing.used_at.getTime() > REUSE_GRACE_MS) {
            await this.revokeAllForUser(existing.user_id);
            throw new UnauthorizedException('Session revoked');
        }

        const next = await this.issue(existing.user_id, meta);

        await this.db.refreshToken.update({
            where: { id: existing.id },
            data: {
                used_at: existing.used_at ?? new Date(),
                replaced_by: hashRefreshToken(next.token),
            },
        });

        return { userId: existing.user_id, ...next };
    }

    /** Sign one session out. Unknown tokens are ignored — logout is idempotent. */
    async revoke(raw: string | undefined | null): Promise<void> {
        if (!raw) return;
        await this.db.refreshToken.updateMany({
            where: { token_hash: hashRefreshToken(raw), revoked_at: null },
            data: { revoked_at: new Date() },
        });
    }

    /** Sign every session of a user out — logout, password change, replay. */
    async revokeAllForUser(userId: string): Promise<void> {
        await this.db.refreshToken.updateMany({
            where: { user_id: userId, revoked_at: null },
            data: { revoked_at: new Date() },
        });
    }

    /**
     * Drop this user's dead rows whenever they sign in. Cheap, bounded by one
     * person's own history, and it keeps the table from needing a cron job.
     */
    private async pruneExpired(userId: string): Promise<void> {
        await this.db.refreshToken.deleteMany({
            where: { user_id: userId, expires_at: { lt: new Date() } },
        });
    }
}
