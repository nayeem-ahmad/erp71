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

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long a "Remember me" session stays valid. Overridable per deployment. */
const DEFAULT_TTL_DAYS = 30;

/**
 * How long a session lasts when "Remember me" was left unchecked.
 *
 * The checkbox used to decide which *browser storage* held the tokens —
 * sessionStorage when unchecked — which made the session die with the tab and
 * left a second tab looking signed out. Storage is now shared across tabs
 * unconditionally, so the checkbox means what its label says instead: how long
 * the sign-in lasts. A day is long enough to cover a shift and short enough to
 * be a meaningful difference from a month.
 */
const DEFAULT_SESSION_TTL_DAYS = 1;

/**
 * A rotated token stays usable for this long after it was exchanged.
 *
 * Without it, two tabs that share one localStorage token and happen to renew at
 * the same moment would look exactly like a stolen-token replay. The frontend
 * de-dupes its own in-flight refreshes and holds a cross-tab Web Lock while it
 * renews, so this only has to cover the window between one tab writing the new
 * token and another reading it, which is over in milliseconds.
 */
const REUSE_GRACE_MS = 60_000;

/** Keep the recorded user agent from growing unbounded from a hostile client. */
const MAX_USER_AGENT_LENGTH = 512;

export interface IssuedRefreshToken {
    /** The raw token. Only ever returned here — the table holds its hash. */
    token: string;
    expiresAt: Date;
    /** The session this token belongs to. Rotation carries it forward. */
    familyId: string;
}

export interface IssueOptions {
    /**
     * Carry an existing session's family forward. Omitted for a fresh sign-in,
     * which starts a family of its own.
     */
    familyId?: string;
    /**
     * Exactly how long this token may live. `rotate` passes the predecessor's
     * own span so a renewal neither extends nor shortens the kind of session the
     * user asked for; a fresh sign-in leaves it out and lets `rememberMe` decide.
     */
    ttlMs?: number;
    /** The "Remember me" choice at sign-in. Ignored when `ttlMs` is given. */
    rememberMe?: boolean;
}

export function hashRefreshToken(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
}

function refreshTtlDays(): number {
    const configured = Number(process.env.JWT_REFRESH_TTL_DAYS);
    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TTL_DAYS;
}

function sessionTtlDays(): number {
    const configured = Number(process.env.JWT_SESSION_REFRESH_TTL_DAYS);
    if (Number.isFinite(configured) && configured > 0) return configured;
    // Never longer than a remembered session: a deployment that shortens the
    // remembered TTL below a day should not leave the unremembered one ahead of it.
    return Math.min(DEFAULT_SESSION_TTL_DAYS, refreshTtlDays());
}

@Injectable()
export class RefreshTokenService {
    constructor(private db: DatabaseService) {}

    /** Mint a fresh session token for `userId`. */
    async issue(
        userId: string,
        meta: AuditRequestMeta = {},
        options: IssueOptions = {},
    ): Promise<IssuedRefreshToken> {
        const token = crypto.randomBytes(48).toString('base64url');
        const familyId = options.familyId ?? crypto.randomUUID();
        const ttlMs = options.ttlMs
            ?? (options.rememberMe === false ? sessionTtlDays() : refreshTtlDays()) * DAY_MS;
        const expiresAt = new Date(Date.now() + ttlMs);

        await this.db.refreshToken.create({
            data: {
                user_id: userId,
                token_hash: hashRefreshToken(token),
                family_id: familyId,
                expires_at: expiresAt,
                user_agent: meta.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
                ip: meta.ipAddress ?? null,
            },
        });

        this.pruneExpired(userId).catch(() => {});

        return { token, expiresAt, familyId };
    }

    /**
     * Exchange a token for its successor.
     *
     * Rotation is what makes a leaked token detectable: each one is good for a
     * single exchange, so a second use outside the race window means two
     * parties hold it.
     *
     * What that costs is the point of `family_id`. Revoking every session the
     * user had was the textbook response, but it was reachable by accident —
     * two browser contexts holding a copy of the same token renew on their own
     * schedules, and whichever renewed second was read as an attacker. So the
     * replay ends the *session* the token belongs to and leaves the other
     * devices signed in. An attacker still loses the session they stole, and the
     * owner's next request on the same family asks them to sign in again.
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

        // A token issued before `family_id` existed has none, and is its own
        // family — it can revoke nothing but itself. See the column's comment.
        const familyId = existing.family_id ?? existing.id;

        if (existing.used_at && Date.now() - existing.used_at.getTime() > REUSE_GRACE_MS) {
            await this.revokeFamily(familyId);
            throw new UnauthorizedException('Session revoked');
        }

        const next = await this.issue(existing.user_id, meta, {
            familyId,
            ttlMs: inheritedTtlMs(existing),
        });

        await this.db.refreshToken.update({
            where: { id: existing.id },
            data: {
                used_at: existing.used_at ?? new Date(),
                replaced_by: hashRefreshToken(next.token),
                // Backfills the family on the first rotation of a pre-migration
                // token, so the session it belongs to is groupable from here on.
                family_id: familyId,
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

    /**
     * Sign one device out: every token of the session the presented one
     * belongs to, so an earlier copy still inside its reuse grace cannot
     * outlive the sign-out. Unknown tokens are ignored — sign-out is
     * idempotent. Returns whose session it was, for the audit trail.
     */
    async revokeSession(raw: string | undefined | null): Promise<{ userId: string } | null> {
        if (!raw || typeof raw !== 'string') return null;

        const existing = await this.db.refreshToken.findUnique({
            where: { token_hash: hashRefreshToken(raw) },
            select: { id: true, user_id: true, family_id: true },
        });
        if (!existing) return null;

        if (existing.family_id) {
            await this.revokeFamily(existing.family_id);
        } else {
            // Issued before families existed and never rotated: it is the
            // whole session.
            await this.revoke(raw);
        }
        return { userId: existing.user_id };
    }

    /**
     * End one sign-in wherever it is in its rotation chain — the replay
     * response, and what a per-device sign-out would want.
     */
    async revokeFamily(familyId: string): Promise<void> {
        await this.db.refreshToken.updateMany({
            where: { family_id: familyId, revoked_at: null },
            data: { revoked_at: new Date() },
        });
    }

    /** Sign every session of a user out — logout, password change, reset. */
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

/**
 * How long the successor of `existing` should live: the same span its
 * predecessor was given, measured again from now.
 *
 * This is what carries the "Remember me" choice down a rotation chain without
 * storing it. Renewal stays sliding — someone using the product daily is not
 * signed out on the thirtieth day — while a session that was never meant to be
 * remembered keeps its shorter leash however many times it renews. Capped at the
 * remembered TTL so a row written under an older, longer setting cannot
 * outlive the current one.
 */
function inheritedTtlMs(existing: { expires_at: Date; created_at: Date }): number {
    const ceiling = refreshTtlDays() * DAY_MS;
    const span = existing.expires_at.getTime() - existing.created_at.getTime();
    if (!Number.isFinite(span) || span <= 0) return ceiling;
    return Math.min(span, ceiling);
}
