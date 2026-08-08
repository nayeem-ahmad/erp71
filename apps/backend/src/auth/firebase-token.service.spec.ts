import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { FirebaseTokenService } from './firebase-token.service';

const PROJECT_ID = 'erp71-709cf';
const KID = 'test-key-1';
const PHONE = '+8801712345678';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

function jwks(kid = KID, key: crypto.KeyObject = publicKey) {
    return { keys: [{ ...key.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' }] };
}

function b64(value: object | string) {
    return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
}

/** Builds a token that is valid unless a test deliberately breaks one field. */
function signToken(
    payload: Record<string, unknown> = {},
    header: Record<string, unknown> = {},
    signWith: crypto.KeyObject = privateKey,
) {
    const now = Math.floor(Date.now() / 1000);
    const fullHeader = { alg: 'RS256', kid: KID, typ: 'JWT', ...header };
    const fullPayload = {
        iss: `https://securetoken.google.com/${PROJECT_ID}`,
        aud: PROJECT_ID,
        sub: 'firebase-uid-1',
        user_id: 'firebase-uid-1',
        phone_number: PHONE,
        firebase: { identities: { phone: [PHONE] }, sign_in_provider: 'phone' },
        auth_time: now,
        iat: now,
        exp: now + 3600,
        ...payload,
    };
    const signingInput = `${b64(fullHeader)}.${b64(fullPayload)}`;
    const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), signWith);
    return `${signingInput}.${signature.toString('base64url')}`;
}

function mockJwksFetch(body: unknown = jwks(), init: { ok?: boolean; cacheControl?: string } = {}) {
    return jest.fn(async () => ({
        ok: init.ok ?? true,
        json: async () => body,
        headers: { get: (name: string) => (name === 'cache-control' ? init.cacheControl ?? 'max-age=3600' : null) },
    })) as unknown as typeof fetch;
}

describe('FirebaseTokenService', () => {
    let service: FirebaseTokenService;
    const originalFetch = global.fetch;
    const originalEnv = {
        projectId: process.env.FIREBASE_PROJECT_ID,
        apiKey: process.env.FIREBASE_API_KEY,
        authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    };

    beforeEach(() => {
        process.env.FIREBASE_PROJECT_ID = PROJECT_ID;
        process.env.FIREBASE_API_KEY = 'AIzaSyTestKey';
        delete process.env.FIREBASE_AUTH_DOMAIN;
        service = new FirebaseTokenService();
        global.fetch = mockJwksFetch();
    });

    afterEach(() => {
        global.fetch = originalFetch;
        for (const [name, value] of [
            ['FIREBASE_PROJECT_ID', originalEnv.projectId],
            ['FIREBASE_API_KEY', originalEnv.apiKey],
            ['FIREBASE_AUTH_DOMAIN', originalEnv.authDomain],
        ] as const) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
    });

    describe('configuration', () => {
        it('is disabled until both the project id and the web API key are set', () => {
            delete process.env.FIREBASE_API_KEY;
            expect(service.isEnabled()).toBe(false);
            expect(service.getWebConfig()).toBeNull();

            process.env.FIREBASE_API_KEY = 'AIzaSyTestKey';
            delete process.env.FIREBASE_PROJECT_ID;
            expect(service.isEnabled()).toBe(false);
        });

        it('derives the auth domain from the project id when it is not configured', () => {
            expect(service.getWebConfig()).toEqual({
                project_id: PROJECT_ID,
                api_key: 'AIzaSyTestKey',
                auth_domain: `${PROJECT_ID}.firebaseapp.com`,
            });
        });

        it('prefers an explicitly configured auth domain', () => {
            process.env.FIREBASE_AUTH_DOMAIN = 'auth.erp71.com';
            expect(service.getWebConfig()?.auth_domain).toBe('auth.erp71.com');
        });

        it('refuses to verify anything when unconfigured', async () => {
            delete process.env.FIREBASE_PROJECT_ID;
            await expect(service.verifyPhoneIdToken(signToken())).rejects.toBeInstanceOf(ServiceUnavailableException);
        });
    });

    describe('verifyPhoneIdToken', () => {
        it('returns the uid and verified number for a valid token', async () => {
            await expect(service.verifyPhoneIdToken(signToken())).resolves.toEqual({
                firebaseUid: 'firebase-uid-1',
                phoneNumber: PHONE,
            });
        });

        it('rejects a token from another Firebase project', async () => {
            // Every Firebase project's tokens are signed by the same Google key,
            // so issuer and audience are the only thing pinning this one to us.
            await expect(
                service.verifyPhoneIdToken(signToken({ iss: 'https://securetoken.google.com/someone-else' })),
            ).rejects.toBeInstanceOf(UnauthorizedException);
            await expect(
                service.verifyPhoneIdToken(signToken({ aud: 'someone-else' })),
            ).rejects.toBeInstanceOf(UnauthorizedException);
        });

        it('rejects a token signed by a key that is not Google\'s', async () => {
            const attacker = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
            await expect(
                service.verifyPhoneIdToken(signToken({}, {}, attacker.privateKey)),
            ).rejects.toBeInstanceOf(UnauthorizedException);
        });

        it('rejects unsigned and HMAC-swapped algorithms', async () => {
            await expect(service.verifyPhoneIdToken(signToken({}, { alg: 'none' }))).rejects.toBeInstanceOf(UnauthorizedException);
            await expect(service.verifyPhoneIdToken(signToken({}, { alg: 'HS256' }))).rejects.toBeInstanceOf(UnauthorizedException);
        });

        it('rejects an expired token and one issued in the future', async () => {
            const now = Math.floor(Date.now() / 1000);
            await expect(service.verifyPhoneIdToken(signToken({ exp: now - 3600 }))).rejects.toBeInstanceOf(UnauthorizedException);
            await expect(service.verifyPhoneIdToken(signToken({ iat: now + 3600 }))).rejects.toBeInstanceOf(UnauthorizedException);
            await expect(service.verifyPhoneIdToken(signToken({ auth_time: now + 3600 }))).rejects.toBeInstanceOf(UnauthorizedException);
            await expect(service.verifyPhoneIdToken(signToken({ auth_time: undefined }))).rejects.toBeInstanceOf(UnauthorizedException);
        });

        it('rejects a valid token from any provider other than phone', async () => {
            await expect(
                service.verifyPhoneIdToken(signToken({
                    firebase: { identities: {}, sign_in_provider: 'anonymous' },
                })),
            ).rejects.toBeInstanceOf(UnauthorizedException);
        });

        it('rejects a token whose phone number is missing or not E.164', async () => {
            await expect(service.verifyPhoneIdToken(signToken({ phone_number: undefined }))).rejects.toBeInstanceOf(UnauthorizedException);
            await expect(service.verifyPhoneIdToken(signToken({ phone_number: '01712345678' }))).rejects.toBeInstanceOf(UnauthorizedException);
        });

        it('rejects a malformed token without reaching for Google\'s keys', async () => {
            await expect(service.verifyPhoneIdToken('not.a.token')).rejects.toBeInstanceOf(UnauthorizedException);
            await expect(service.verifyPhoneIdToken('')).rejects.toBeInstanceOf(UnauthorizedException);
            expect(global.fetch).not.toHaveBeenCalled();
        });

        it('caches the key set across sign-ins and refreshes it for an unknown kid', async () => {
            await service.verifyPhoneIdToken(signToken());
            await service.verifyPhoneIdToken(signToken());
            expect(global.fetch).toHaveBeenCalledTimes(1);

            // A rotated-in key we have never seen forces exactly one refetch.
            await expect(service.verifyPhoneIdToken(signToken({}, { kid: 'rotated-key' }))).rejects.toBeInstanceOf(UnauthorizedException);
            expect(global.fetch).toHaveBeenCalledTimes(2);
        });

        it('reports a key server it cannot reach as unavailable, not as a bad token', async () => {
            global.fetch = mockJwksFetch(null, { ok: false });
            await expect(service.verifyPhoneIdToken(signToken())).rejects.toBeInstanceOf(ServiceUnavailableException);
        });
    });
});
