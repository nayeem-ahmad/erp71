import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'node:crypto';

/** What one push says. `data` values must be strings — FCM's rule, not ours. */
export type PushMessage = {
    title: string;
    body: string;
    data?: Record<string, string>;
};

/** How one send came out, per registration token. */
export type SendOutcome = 'sent' | 'unregistered' | 'failed';

type ServiceAccount = {
    project_id: string;
    client_email: string;
    private_key: string;
};

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
/** Google issues an hour; renew a few minutes early so a send never races expiry. */
const RENEW_BEFORE_MS = 5 * 60 * 1000;

/**
 * Firebase Cloud Messaging over its HTTP v1 API, authenticated as a service
 * account.
 *
 * Signs its own OAuth assertion with `node:crypto` rather than pulling in
 * `google-auth-library` or `firebase-admin` for the one call this needs — the
 * same choice `FirebaseTokenService` made for verifying phone sign-ins.
 *
 * Configured by `FCM_SERVICE_ACCOUNT_JSON`: the service account's JSON key,
 * raw or base64. Absent, every send is a no-op and `enabled` is false, so a
 * deployment without push keeps working exactly as before.
 */
@Injectable()
export class FcmSender {
    private readonly logger = new Logger(FcmSender.name);
    private account: ServiceAccount | null | undefined;
    private accessToken: { value: string; expiresAt: number } | null = null;

    /** Replaced in specs; production goes through the global `fetch`. */
    fetchImpl: typeof fetch = (input, init) => fetch(input, init);

    get enabled(): boolean {
        return this.serviceAccount() !== null;
    }

    async send(token: string, message: PushMessage): Promise<SendOutcome> {
        const account = this.serviceAccount();
        if (!account) return 'failed';

        let response: Response;
        try {
            response = await this.fetchImpl(
                `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${await this.oauthToken(account)}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        message: {
                            token,
                            notification: { title: message.title, body: message.body },
                            data: message.data ?? {},
                            android: { priority: 'HIGH' },
                        },
                    }),
                },
            );
        } catch (error) {
            this.logger.warn(`FCM send failed: ${error}`);
            return 'failed';
        }

        if (response.ok) return 'sent';
        // NOT_FOUND / UNREGISTERED: the app was uninstalled or the token rotated.
        // INVALID_ARGUMENT on a token is the same for our purposes.
        if (response.status === 404 || response.status === 400) {
            const text = await response.text().catch(() => '');
            if (response.status === 404 || /UNREGISTERED|registration token/i.test(text)) {
                return 'unregistered';
            }
        }
        if (response.status === 401) this.accessToken = null;
        this.logger.warn(`FCM send refused: HTTP ${response.status}`);
        return 'failed';
    }

    private serviceAccount(): ServiceAccount | null {
        if (this.account !== undefined) return this.account;
        const raw = process.env.FCM_SERVICE_ACCOUNT_JSON?.trim();
        this.account = raw ? parseServiceAccount(raw) : null;
        if (raw && !this.account) {
            this.logger.error('FCM_SERVICE_ACCOUNT_JSON is set but is not a service-account key; push is off');
        }
        return this.account;
    }

    private async oauthToken(account: ServiceAccount): Promise<string> {
        const now = Date.now();
        if (this.accessToken && this.accessToken.expiresAt - RENEW_BEFORE_MS > now) {
            return this.accessToken.value;
        }

        const issuedAt = Math.floor(now / 1000);
        const assertion = signJwt(
            {
                iss: account.client_email,
                scope: FCM_SCOPE,
                aud: TOKEN_URL,
                iat: issuedAt,
                exp: issuedAt + 3600,
            },
            account.private_key,
        );
        const response = await this.fetchImpl(TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                assertion,
            }).toString(),
        });
        if (!response.ok) {
            throw new Error(`Google refused the FCM service account: HTTP ${response.status}`);
        }
        const json = (await response.json()) as { access_token: string; expires_in?: number };
        this.accessToken = {
            value: json.access_token,
            expiresAt: now + (json.expires_in ?? 3600) * 1000,
        };
        return json.access_token;
    }
}

export function parseServiceAccount(raw: string): ServiceAccount | null {
    const tryJson = (text: string) => {
        try {
            const parsed = JSON.parse(text);
            return parsed?.project_id && parsed?.client_email && parsed?.private_key ? (parsed as ServiceAccount) : null;
        } catch {
            return null;
        }
    };
    return tryJson(raw) ?? tryJson(Buffer.from(raw, 'base64').toString('utf8'));
}

function base64url(input: Buffer | string): string {
    return Buffer.from(input).toString('base64url');
}

/** RS256 JWT, the form Google's token endpoint takes as an assertion. */
export function signJwt(claims: Record<string, unknown>, privateKeyPem: string): string {
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = base64url(JSON.stringify(claims));
    const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKeyPem);
    return `${header}.${payload}.${base64url(signature)}`;
}
