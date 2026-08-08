import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'node:crypto';

/** Google's public signing keys for the ID tokens issued to browser clients. */
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
/** Google still mints tokens under both spellings of its issuer. */
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
/** Google Identity Services only ever signs ID tokens with RS256. */
const ALLOWED_ALG = 'RS256';
/** Tolerance for clock drift between this server and Google, in seconds. */
const CLOCK_SKEW_SECONDS = 60;
/** Used when Google's Cache-Control header is missing or unparseable. */
const DEFAULT_JWKS_TTL_MS = 60 * 60 * 1000;
/** Floor on the cache lifetime so a tiny max-age can't turn every login into a fetch. */
const MIN_JWKS_TTL_MS = 60 * 1000;

export type GoogleProfile = {
    /** Google's stable per-account subject id — survives the user renaming their address. */
    googleId: string;
    email: string;
    name: string | null;
    picture: string | null;
};

type JwksCache = {
    keys: Map<string, crypto.KeyObject>;
    expiresAt: number;
};

function decodeSegment(segment: string): any {
    try {
        return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    } catch {
        throw new UnauthorizedException('Google sign-in failed. Please try again.');
    }
}

/**
 * Verifies the ID tokens produced by Google Identity Services on the client.
 *
 * Deliberately hand-rolled against `node:crypto` rather than pulling in
 * `google-auth-library`: that package drags ~800 transitive dependencies into
 * the backend for one JWKS lookup and one RS256 verification.
 */
@Injectable()
export class GoogleTokenService {
    private jwks: JwksCache | null = null;
    /** De-dupes concurrent refreshes so a burst of logins triggers one fetch. */
    private inFlightJwks: Promise<JwksCache> | null = null;

    /**
     * Every OAuth client id allowed to mint tokens for this backend. A list
     * (comma-separated) so the web app and, later, the mobile apps — which each
     * get their own client id but share one Google project — can sign in here.
     */
    getClientIds(): string[] {
        return (process.env.GOOGLE_CLIENT_ID ?? '')
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean);
    }

    /** The client id handed to the browser so it can render the Google button. */
    getPrimaryClientId(): string | null {
        return this.getClientIds()[0] ?? null;
    }

    isEnabled(): boolean {
        return this.getClientIds().length > 0;
    }

    async verifyIdToken(idToken: string): Promise<GoogleProfile> {
        const clientIds = this.getClientIds();
        if (clientIds.length === 0) {
            throw new ServiceUnavailableException('Google sign-in is not configured on this server.');
        }

        const segments = (idToken ?? '').split('.');
        if (segments.length !== 3 || segments.some((segment) => !segment)) {
            throw new UnauthorizedException('Google sign-in failed. Please try again.');
        }

        const header = decodeSegment(segments[0]);
        // Pinning the algorithm is what stops an attacker swapping RS256 for
        // `none` (unsigned) or HS256 (signed with the public key as an HMAC key).
        if (header?.alg !== ALLOWED_ALG || typeof header?.kid !== 'string') {
            throw new UnauthorizedException('Google sign-in failed. Please try again.');
        }

        const key = await this.resolveSigningKey(header.kid);
        const signature = Buffer.from(segments[2], 'base64url');
        const signedContent = Buffer.from(`${segments[0]}.${segments[1]}`, 'utf8');
        const signatureValid = crypto.verify('RSA-SHA256', signedContent, key, signature);
        if (!signatureValid) {
            throw new UnauthorizedException('Google sign-in failed. Please try again.');
        }

        const payload = decodeSegment(segments[1]);
        const now = Math.floor(Date.now() / 1000);

        if (!GOOGLE_ISSUERS.has(payload?.iss)) {
            throw new UnauthorizedException('Google sign-in failed. Please try again.');
        }
        // Without the audience check any Google account holder could replay a
        // token minted for someone else's app and sign in here as that user.
        if (!clientIds.includes(payload?.aud)) {
            throw new UnauthorizedException('Google sign-in failed. Please try again.');
        }
        if (typeof payload?.exp !== 'number' || payload.exp + CLOCK_SKEW_SECONDS < now) {
            throw new UnauthorizedException('Your Google sign-in expired. Please try again.');
        }
        if (typeof payload?.iat === 'number' && payload.iat - CLOCK_SKEW_SECONDS > now) {
            throw new UnauthorizedException('Google sign-in failed. Please try again.');
        }
        if (typeof payload?.sub !== 'string' || !payload.sub) {
            throw new UnauthorizedException('Google sign-in failed. Please try again.');
        }

        const email = typeof payload?.email === 'string' ? payload.email.trim().toLowerCase() : '';
        if (!email) {
            throw new UnauthorizedException('Your Google account has no email address to sign in with.');
        }
        // An unverified address is one the Google account holder never proved they
        // own, so honouring it would let them claim an existing ERP71 account.
        if (payload?.email_verified !== true && payload?.email_verified !== 'true') {
            throw new UnauthorizedException('Your Google email address is not verified.');
        }

        return {
            googleId: payload.sub,
            email,
            name: typeof payload?.name === 'string' && payload.name.trim() ? payload.name.trim() : null,
            picture: typeof payload?.picture === 'string' && payload.picture.trim() ? payload.picture.trim() : null,
        };
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
            throw new UnauthorizedException('Google sign-in failed. Please try again.');
        }
        return key;
    }

    private async fetchJwks(): Promise<JwksCache> {
        if (this.inFlightJwks) return this.inFlightJwks;

        this.inFlightJwks = (async () => {
            let response: Response;
            try {
                response = await fetch(GOOGLE_JWKS_URL);
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
