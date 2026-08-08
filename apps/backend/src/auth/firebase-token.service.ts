import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { isValidE164Mobile } from '@erp71/shared-types';

/**
 * Google's public signing keys for Firebase ID tokens. The JWK spelling of the
 * same key set the x509 endpoint serves, so it imports with `format: 'jwk'`
 * exactly like the Google Identity Services keys next door.
 */
const FIREBASE_JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
/** Firebase signs every ID token with RS256. */
const ALLOWED_ALG = 'RS256';
/** Tolerance for clock drift between this server and Google, in seconds. */
const CLOCK_SKEW_SECONDS = 60;
/** Used when Google's Cache-Control header is missing or unparseable. */
const DEFAULT_JWKS_TTL_MS = 60 * 60 * 1000;
/** Floor on the cache lifetime so a tiny max-age can't turn every login into a fetch. */
const MIN_JWKS_TTL_MS = 60 * 1000;

export type FirebasePhoneProfile = {
    /** Firebase's stable uid for this identity — survives the user changing SIM. */
    firebaseUid: string;
    /** The verified number, in E.164, exactly as Firebase minted it. */
    phoneNumber: string;
};

export type FirebaseWebConfig = {
    project_id: string;
    api_key: string;
    auth_domain: string;
};

type JwksCache = {
    keys: Map<string, crypto.KeyObject>;
    expiresAt: number;
};

/** One message for every rejection, so a probe can't map out which check failed. */
const REJECTED = 'Mobile sign-in failed. Please request a new code and try again.';

function decodeSegment(segment: string): any {
    try {
        return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    } catch {
        throw new UnauthorizedException(REJECTED);
    }
}

/**
 * Verifies the ID tokens Firebase Authentication hands the browser after a
 * phone-number (SMS one-time code) sign-in.
 *
 * Hand-rolled against `node:crypto` for the same reason as
 * `GoogleTokenService`: `firebase-admin` is a very large dependency, and it
 * would additionally need a service-account key on the server. Verifying an ID
 * token needs neither — only Google's public keys and the project id.
 */
@Injectable()
export class FirebaseTokenService {
    private jwks: JwksCache | null = null;
    /** De-dupes concurrent refreshes so a burst of logins triggers one fetch. */
    private inFlightJwks: Promise<JwksCache> | null = null;

    /** The Firebase project whose tokens this backend accepts. */
    getProjectId(): string | null {
        return process.env.FIREBASE_PROJECT_ID?.trim() || null;
    }

    /**
     * The browser needs the Firebase web API key to talk to Firebase Auth. It is
     * a public identifier, not a secret — Firebase's own docs say so, and access
     * is controlled by the authorised-domains list in the console.
     */
    getApiKey(): string | null {
        return process.env.FIREBASE_API_KEY?.trim() || null;
    }

    /**
     * The domain that hosts the reCAPTCHA/verification iframe. Defaults to the
     * `<project>.firebaseapp.com` Firebase provisions automatically, so a normal
     * setup only has to configure two variables.
     */
    getAuthDomain(): string | null {
        const configured = process.env.FIREBASE_AUTH_DOMAIN?.trim();
        if (configured) return configured;
        const projectId = this.getProjectId();
        return projectId ? `${projectId}.firebaseapp.com` : null;
    }

    isEnabled(): boolean {
        return !!this.getProjectId() && !!this.getApiKey();
    }

    /** The public config the frontend needs to initialize the Firebase SDK. */
    getWebConfig(): FirebaseWebConfig | null {
        const project_id = this.getProjectId();
        const api_key = this.getApiKey();
        const auth_domain = this.getAuthDomain();
        if (!project_id || !api_key || !auth_domain) return null;
        return { project_id, api_key, auth_domain };
    }

    async verifyPhoneIdToken(idToken: string): Promise<FirebasePhoneProfile> {
        const projectId = this.getProjectId();
        if (!projectId) {
            throw new ServiceUnavailableException('Mobile sign-in is not configured on this server.');
        }

        const segments = (idToken ?? '').split('.');
        if (segments.length !== 3 || segments.some((segment) => !segment)) {
            throw new UnauthorizedException(REJECTED);
        }

        const header = decodeSegment(segments[0]);
        // Pinning the algorithm is what stops an attacker swapping RS256 for
        // `none` (unsigned) or HS256 (signed with the public key as an HMAC key).
        if (header?.alg !== ALLOWED_ALG || typeof header?.kid !== 'string') {
            throw new UnauthorizedException(REJECTED);
        }

        const key = await this.resolveSigningKey(header.kid);
        const signature = Buffer.from(segments[2], 'base64url');
        const signedContent = Buffer.from(`${segments[0]}.${segments[1]}`, 'utf8');
        if (!crypto.verify('RSA-SHA256', signedContent, key, signature)) {
            throw new UnauthorizedException(REJECTED);
        }

        const payload = decodeSegment(segments[1]);
        const now = Math.floor(Date.now() / 1000);

        // Issuer and audience together pin the token to *this* Firebase project.
        // Without them, a token minted by any other Firebase project on the
        // planet — all signed by the same Google key — would verify here.
        if (payload?.iss !== `https://securetoken.google.com/${projectId}`) {
            throw new UnauthorizedException(REJECTED);
        }
        if (payload?.aud !== projectId) {
            throw new UnauthorizedException(REJECTED);
        }
        if (typeof payload?.exp !== 'number' || payload.exp + CLOCK_SKEW_SECONDS < now) {
            throw new UnauthorizedException('Your mobile sign-in expired. Please request a new code.');
        }
        if (typeof payload?.iat === 'number' && payload.iat - CLOCK_SKEW_SECONDS > now) {
            throw new UnauthorizedException(REJECTED);
        }
        // A token issued before the sign-in happened is not a token from this
        // sign-in. Firebase always sets `auth_time`; a missing one is a forgery.
        if (typeof payload?.auth_time !== 'number' || payload.auth_time - CLOCK_SKEW_SECONDS > now) {
            throw new UnauthorizedException(REJECTED);
        }
        if (typeof payload?.sub !== 'string' || !payload.sub) {
            throw new UnauthorizedException(REJECTED);
        }

        // This endpoint signs people in *as a phone number*. A token from any
        // other Firebase provider (anonymous, email/password, a federated
        // identity) carries no proof of the number and must not be accepted,
        // even though it is a perfectly valid token for this project.
        if (payload?.firebase?.sign_in_provider !== 'phone') {
            throw new UnauthorizedException('Please sign in with your mobile number.');
        }

        const phoneNumber = typeof payload?.phone_number === 'string' ? payload.phone_number.trim() : '';
        if (!isValidE164Mobile(phoneNumber)) {
            throw new UnauthorizedException(REJECTED);
        }

        return { firebaseUid: payload.sub, phoneNumber };
    }

    private async resolveSigningKey(kid: string): Promise<crypto.KeyObject> {
        const cached = this.jwks;
        if (cached && cached.expiresAt > Date.now()) {
            const key = cached.keys.get(kid);
            if (key) return key;
        }

        // Either the cache is stale or Google rotated in a key we've never seen.
        const refreshed = await this.fetchJwks();
        const key = refreshed.keys.get(kid);
        if (!key) {
            throw new UnauthorizedException(REJECTED);
        }
        return key;
    }

    private async fetchJwks(): Promise<JwksCache> {
        if (this.inFlightJwks) return this.inFlightJwks;

        this.inFlightJwks = (async () => {
            let response: Response;
            try {
                response = await fetch(FIREBASE_JWKS_URL);
            } catch {
                throw new ServiceUnavailableException('Could not reach Google to verify your sign-in.');
            }
            if (!response.ok) {
                throw new ServiceUnavailableException('Could not reach Google to verify your sign-in.');
            }

            const body = (await response.json()) as { keys?: any[] };
            const keys = new Map<string, crypto.KeyObject>();
            for (const jwk of body?.keys ?? []) {
                if (jwk?.kty !== 'RSA' || typeof jwk?.kid !== 'string') continue;
                try {
                    keys.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' }));
                } catch {
                    // A key we can't import is a key we can't verify with — skip it
                    // rather than failing over the whole (otherwise usable) set.
                }
            }
            if (keys.size === 0) {
                throw new ServiceUnavailableException('Could not reach Google to verify your sign-in.');
            }

            const cache: JwksCache = {
                keys,
                expiresAt: Date.now() + this.parseCacheTtlMs(response.headers.get('cache-control')),
            };
            this.jwks = cache;
            return cache;
        })().finally(() => {
            this.inFlightJwks = null;
        });

        return this.inFlightJwks;
    }

    private parseCacheTtlMs(cacheControl: string | null): number {
        const maxAge = /max-age=(\d+)/i.exec(cacheControl ?? '');
        if (!maxAge) return DEFAULT_JWKS_TTL_MS;
        return Math.max(MIN_JWKS_TTL_MS, Number(maxAge[1]) * 1000);
    }
}
