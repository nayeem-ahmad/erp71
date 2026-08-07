import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { GoogleTokenService } from './google-token.service';

const CLIENT_ID = 'erp71-web.apps.googleusercontent.com';
const KID = 'test-key-1';

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
        iss: 'https://accounts.google.com',
        aud: CLIENT_ID,
        sub: 'google-sub-1',
        email: 'Owner@Example.com',
        email_verified: true,
        name: 'Nayeem Ahmad',
        picture: 'https://lh3.googleusercontent.com/a/photo',
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

describe('GoogleTokenService', () => {
    let service: GoogleTokenService;
    const originalFetch = global.fetch;
    const originalClientId = process.env.GOOGLE_CLIENT_ID;

    beforeEach(() => {
        process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
        service = new GoogleTokenService();
        global.fetch = mockJwksFetch();
    });

    afterEach(() => {
        global.fetch = originalFetch;
        if (originalClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
        else process.env.GOOGLE_CLIENT_ID = originalClientId;
    });

    describe('configuration', () => {
        it('is disabled when no client id is set', () => {
            delete process.env.GOOGLE_CLIENT_ID;
            expect(service.isEnabled()).toBe(false);
            expect(service.getPrimaryClientId()).toBeNull();
        });

        it('accepts a comma-separated list and hands the browser the first one', () => {
            process.env.GOOGLE_CLIENT_ID = ` ${CLIENT_ID} , erp71-android.apps.googleusercontent.com `;
            expect(service.getClientIds()).toEqual([CLIENT_ID, 'erp71-android.apps.googleusercontent.com']);
            expect(service.getPrimaryClientId()).toBe(CLIENT_ID);
        });

        it('refuses to verify anything when unconfigured', async () => {
            delete process.env.GOOGLE_CLIENT_ID;
            await expect(service.verifyIdToken(signToken())).rejects.toBeInstanceOf(ServiceUnavailableException);
        });
    });

    describe('verifyIdToken', () => {
        it('returns the profile for a valid token, lowercasing the email', async () => {
            await expect(service.verifyIdToken(signToken())).resolves.toEqual({
                googleId: 'google-sub-1',
                email: 'owner@example.com',
                name: 'Nayeem Ahmad',
                picture: 'https://lh3.googleusercontent.com/a/photo',
            });
        });

        it('accepts a token from any configured client id', async () => {
            process.env.GOOGLE_CLIENT_ID = `${CLIENT_ID},erp71-android.apps.googleusercontent.com`;
            await expect(
                service.verifyIdToken(signToken({ aud: 'erp71-android.apps.googleusercontent.com' })),
            ).resolves.toMatchObject({ googleId: 'google-sub-1' });
        });

        it('rejects a token minted for a different app', async () => {
            await expect(service.verifyIdToken(signToken({ aud: 'someone-else.apps.googleusercontent.com' })))
                .rejects.toBeInstanceOf(UnauthorizedException);
        });

        it('rejects a token from an issuer that is not Google', async () => {
            await expect(service.verifyIdToken(signToken({ iss: 'https://evil.example.com' })))
                .rejects.toBeInstanceOf(UnauthorizedException);
        });

        it('accepts the bare-hostname issuer Google also uses', async () => {
            await expect(service.verifyIdToken(signToken({ iss: 'accounts.google.com' })))
                .resolves.toMatchObject({ googleId: 'google-sub-1' });
        });

        it('rejects an expired token', async () => {
            const past = Math.floor(Date.now() / 1000) - 7200;
            await expect(service.verifyIdToken(signToken({ iat: past, exp: past + 3600 })))
                .rejects.toBeInstanceOf(UnauthorizedException);
        });

        it('rejects a token signed by a key that is not Google\'s', async () => {
            const attacker = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
            await expect(service.verifyIdToken(signToken({}, {}, attacker.privateKey)))
                .rejects.toBeInstanceOf(UnauthorizedException);
        });

        it('rejects a tampered payload', async () => {
            const [header, , signature] = signToken().split('.');
            const forged = b64({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 'x', email: 'victim@example.com', email_verified: true, exp: Math.floor(Date.now() / 1000) + 3600 });
            await expect(service.verifyIdToken(`${header}.${forged}.${signature}`))
                .rejects.toBeInstanceOf(UnauthorizedException);
        });

        it('rejects an unsigned "alg: none" token', async () => {
            const now = Math.floor(Date.now() / 1000);
            const header = b64({ alg: 'none', kid: KID });
            const payload = b64({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 's', email: 'a@b.com', email_verified: true, exp: now + 3600 });
            await expect(service.verifyIdToken(`${header}.${payload}.sig`))
                .rejects.toBeInstanceOf(UnauthorizedException);
        });

        it('rejects an HS256 token forged with the public key as the HMAC secret', async () => {
            const now = Math.floor(Date.now() / 1000);
            const header = b64({ alg: 'HS256', kid: KID });
            const payload = b64({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 's', email: 'a@b.com', email_verified: true, exp: now + 3600 });
            const pem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
            const mac = crypto.createHmac('sha256', pem).update(`${header}.${payload}`).digest('base64url');
            await expect(service.verifyIdToken(`${header}.${payload}.${mac}`))
                .rejects.toBeInstanceOf(UnauthorizedException);
        });

        it('rejects a token whose email Google has not verified', async () => {
            await expect(service.verifyIdToken(signToken({ email_verified: false })))
                .rejects.toBeInstanceOf(UnauthorizedException);
        });

        it('rejects a malformed token', async () => {
            await expect(service.verifyIdToken('not-a-jwt')).rejects.toBeInstanceOf(UnauthorizedException);
            await expect(service.verifyIdToken('a..c')).rejects.toBeInstanceOf(UnauthorizedException);
        });

        it('reports a Google outage as unavailable rather than bad credentials', async () => {
            global.fetch = mockJwksFetch({}, { ok: false });
            await expect(service.verifyIdToken(signToken())).rejects.toBeInstanceOf(ServiceUnavailableException);
        });
    });

    describe('JWKS caching', () => {
        it('fetches Google\'s keys once across repeated sign-ins', async () => {
            const fetchMock = mockJwksFetch();
            global.fetch = fetchMock;

            await service.verifyIdToken(signToken());
            await service.verifyIdToken(signToken());
            await service.verifyIdToken(signToken());

            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it('de-dupes concurrent refreshes into a single fetch', async () => {
            const fetchMock = mockJwksFetch();
            global.fetch = fetchMock;

            await Promise.all([
                service.verifyIdToken(signToken()),
                service.verifyIdToken(signToken()),
                service.verifyIdToken(signToken()),
            ]);

            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it('re-fetches when Google signs with a key id it has not seen', async () => {
            const rotated = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
            const fetchMock = jest
                .fn()
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => jwks(),
                    headers: { get: () => 'max-age=3600' },
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({
                        keys: [{ ...rotated.publicKey.export({ format: 'jwk' }), kid: 'test-key-2', use: 'sig', alg: 'RS256' }],
                    }),
                    headers: { get: () => 'max-age=3600' },
                });
            global.fetch = fetchMock as unknown as typeof fetch;

            await service.verifyIdToken(signToken());
            await expect(
                service.verifyIdToken(signToken({}, { kid: 'test-key-2' }, rotated.privateKey)),
            ).resolves.toMatchObject({ googleId: 'google-sub-1' });
            expect(fetchMock).toHaveBeenCalledTimes(2);
        });
    });
});
