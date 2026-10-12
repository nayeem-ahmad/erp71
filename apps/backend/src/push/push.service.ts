import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { hashRefreshToken } from '../auth/refresh-token.service';
import { FcmSender, type PushMessage } from './fcm-sender';

export type RegisterDeviceInput = {
    token: string;
    platform: string;
    appVersion?: string;
    refreshToken: string;
};

/**
 * Which phones a person gets pushes on, and sending to them.
 *
 * A device belongs to the sign-in session it registered under, not merely to
 * the person: pushes go only to devices whose session family still holds a
 * live refresh token. Every way a session ends — this phone's sign-out,
 * "sign out everywhere", a password change, a replayed refresh token — revokes
 * refresh tokens, so every one of them also stops that phone's pushes, and
 * none of those paths has to know devices exist.
 */
@Injectable()
export class PushService {
    private readonly logger = new Logger(PushService.name);

    constructor(
        private readonly db: DatabaseService,
        private readonly fcm: FcmSender,
    ) {}

    get enabled(): boolean {
        return this.fcm.enabled;
    }

    /**
     * Records this phone's push token against the session it is signed in
     * with. The refresh token proves which session that is: the phone holds
     * it, and it already lets the holder mint sessions, so naming it grants
     * nothing new. A token another account registered moves to this one —
     * the phone changed hands, or someone else signed in on it.
     */
    async register(userId: string, input: RegisterDeviceInput) {
        const session = await this.db.refreshToken.findUnique({
            where: { token_hash: hashRefreshToken(input.refreshToken) },
            select: { id: true, user_id: true, family_id: true, revoked_at: true, expires_at: true },
        });
        if (!session || session.user_id !== userId || session.revoked_at || session.expires_at <= new Date()) {
            throw new BadRequestException('Sign in again to turn on notifications on this phone.');
        }
        // A token from before families existed is its own family, the way
        // RefreshTokenService reads it; its first rotation stamps the same id.
        const familyId = session.family_id ?? session.id;
        const data = {
            user_id: userId,
            session_family_id: familyId,
            platform: input.platform,
            app_version: input.appVersion ?? null,
            last_seen_at: new Date(),
        };
        await this.db.deviceToken.upsert({
            where: { token: input.token },
            create: { token: input.token, ...data },
            update: data,
        });
    }

    /** Only the owner can remove their own device; an unknown token is a no-op. */
    async unregister(userId: string, token: string) {
        await this.db.deviceToken.deleteMany({ where: { token, user_id: userId } });
    }

    /**
     * Sends [message] to every live device of [userIds]. Never throws: a push
     * is a courtesy on top of a notification row that is already written.
     * Returns how many phones it reached.
     */
    async sendToUsers(userIds: string[], message: PushMessage): Promise<number> {
        if (!this.fcm.enabled || userIds.length === 0) return 0;
        try {
            const devices = await this.liveDevices([...new Set(userIds)]);
            const outcomes = await Promise.all(
                devices.map(async (device) => ({ device, outcome: await this.fcm.send(device.token, message) })),
            );
            const gone = outcomes.filter((o) => o.outcome === 'unregistered').map((o) => o.device.id);
            if (gone.length > 0) {
                await this.db.deviceToken.deleteMany({ where: { id: { in: gone } } });
            }
            return outcomes.filter((o) => o.outcome === 'sent').length;
        } catch (error) {
            this.logger.warn(`Push to ${userIds.length} user(s) failed: ${error}`);
            return 0;
        }
    }

    /** Devices whose session is still live. Rows of ended sessions are dropped. */
    private async liveDevices(userIds: string[]) {
        const devices = await this.db.deviceToken.findMany({
            where: { user_id: { in: userIds } },
            select: { id: true, token: true, session_family_id: true },
        });
        if (devices.length === 0) return [];

        const families = [...new Set(devices.map((d) => d.session_family_id))];
        const live = await this.db.refreshToken.findMany({
            where: {
                revoked_at: null,
                expires_at: { gt: new Date() },
                // A pre-family token is matched by its own id.
                OR: [{ family_id: { in: families } }, { id: { in: families }, family_id: null }],
            },
            select: { id: true, family_id: true },
        });
        const liveFamilies = new Set(live.map((row) => row.family_id ?? row.id));

        const dead = devices.filter((d) => !liveFamilies.has(d.session_family_id)).map((d) => d.id);
        if (dead.length > 0) {
            await this.db.deviceToken.deleteMany({ where: { id: { in: dead } } });
        }
        return devices.filter((d) => liveFamilies.has(d.session_family_id));
    }

    /**
     * What the phone needs to start Firebase without a bundled config file:
     * the client half of the Firebase project, none of it secret. Null fields
     * mean that platform is not set up, and the app simply asks for no token.
     */
    clientConfig() {
        const value = (name: string) => process.env[name]?.trim() || null;
        const projectId = value('FIREBASE_PROJECT_ID');
        const apiKey = value('FIREBASE_API_KEY');
        const senderId = value('FCM_SENDER_ID');
        const configured = this.enabled && projectId && apiKey && senderId;
        return {
            enabled: Boolean(configured),
            project_id: projectId,
            api_key: apiKey,
            sender_id: senderId,
            android_app_id: configured ? value('FCM_ANDROID_APP_ID') : null,
            ios_app_id: configured ? value('FCM_IOS_APP_ID') : null,
        };
    }
}
