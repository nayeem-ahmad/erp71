import { createHash, randomBytes } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { JOB_NAMES, JOB_REGISTRY } from '../system-health/jobs/job-names';
import { Meet71SsoService, s256 } from './meet71-sso.service';

type SsoRow = {
    id: string;
    code_hash: string;
    user_id: string;
    email: string;
    display_name: string;
    return_url: string;
    code_challenge: string;
    code_challenge_method: string;
    expires_at: Date;
    used_at: Date | null;
    created_at: Date;
};

const RETURN_URL = 'https://meet.erp71.com/api/auth/erp71/callback';
const MEMBERSHIP = {
    allowed: true as const,
    email: 'user@erp71.com',
    displayName: 'User',
    isAdmin: false,
    canCreateRoom: false,
    inviteQuota: 0,
    invitesUsed: 0,
    invitesRemaining: 0,
};

function fakeDb() {
    const codes: SsoRow[] = [];
    return {
        codes,
        meet71SsoCode: {
            create: jest.fn(async ({ data }: { data: Omit<SsoRow, 'id' | 'used_at' | 'created_at'> }) => {
                const row: SsoRow = {
                    id: `sso-${codes.length + 1}`,
                    used_at: null,
                    created_at: new Date(),
                    ...data,
                };
                codes.push(row);
                return row;
            }),
            deleteMany: jest.fn(async () => ({ count: 0 })),
        },
        $queryRaw: jest.fn(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
            const [codeHash, returnUrl, challenge] = values as [string, string, string];
            const now = new Date();
            const match = codes.find(
                (row) =>
                    row.code_hash === codeHash &&
                    row.used_at === null &&
                    row.expires_at > now &&
                    row.return_url === returnUrl &&
                    row.code_challenge === challenge,
            );
            if (!match) return [];
            match.used_at = now;
            return [{ ...match }];
        }),
    };
}

function makeService(db = fakeDb()) {
    const membership = {
        upsertOnSignIn: jest.fn().mockResolvedValue(MEMBERSHIP),
        evaluate: jest.fn(),
        matches: jest.fn(),
    };
    const jobTracker = { track: jest.fn((_name: string, fn: () => Promise<unknown>) => fn()) };
    const service = new Meet71SsoService(db as never, membership as never, jobTracker as never);
    return { service, db, membership, jobTracker };
}

async function mintWithPkce(
    service: Meet71SsoService,
    overrides: Partial<{ returnUrl: string; verifier: string }> = {},
) {
    const verifier = overrides.verifier ?? randomBytes(32).toString('base64url');
    const codeChallenge = s256(verifier);
    const minted = await service.mint({
        userId: 'user-1',
        email: 'user@erp71.com',
        displayName: 'User',
        returnUrl: overrides.returnUrl ?? RETURN_URL,
        codeChallenge,
        codeChallengeMethod: 'S256',
    });
    return { ...minted, verifier, codeChallenge };
}

describe('Meet71SsoService', () => {
    it('mint stores sha256 hex of the code, never the code', async () => {
        const { service, db } = makeService();
        const { code, codeChallenge } = await mintWithPkce(service);

        expect(code).toMatch(/^[0-9a-f]{64}$/);
        expect(db.meet71SsoCode.create).toHaveBeenCalledTimes(1);
        const stored = db.meet71SsoCode.create.mock.calls[0][0].data;
        expect(stored.code_hash).toBe(createHash('sha256').update(code).digest('hex'));
        expect(stored.code_hash).not.toBe(code);
        expect(stored).not.toHaveProperty('code');
        expect(Object.values(stored)).not.toContain(code);
        expect(stored.code_challenge).toBe(codeChallenge);
        expect(stored.return_url).toBe(RETURN_URL);
        expect(stored.expires_at.getTime()).toBeGreaterThan(Date.now() + 50_000);
        expect(stored.expires_at.getTime()).toBeLessThanOrEqual(Date.now() + 60_000);
    });

    it('exchange succeeds once and second call is MEET71_INVALID_CODE', async () => {
        const { service, membership } = makeService();
        const { code, verifier } = await mintWithPkce(service);

        await expect(service.exchange({ code, codeVerifier: verifier, returnUrl: RETURN_URL })).resolves.toEqual(
            MEMBERSHIP,
        );
        expect(membership.upsertOnSignIn).toHaveBeenCalledWith('user@erp71.com', 'User');

        await expect(service.exchange({ code, codeVerifier: verifier, returnUrl: RETURN_URL })).rejects.toMatchObject({
            response: { code: 'MEET71_INVALID_CODE', message: 'Invalid code' },
        });
        expect(membership.upsertOnSignIn).toHaveBeenCalledTimes(1);
    });

    it('exchange with wrong verifier is MEET71_INVALID_CODE and does not set used_at', async () => {
        const { service, db, membership } = makeService();
        const { code } = await mintWithPkce(service);
        const wrongVerifier = randomBytes(32).toString('base64url');

        await expect(
            service.exchange({ code, codeVerifier: wrongVerifier, returnUrl: RETURN_URL }),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
            service.exchange({ code, codeVerifier: wrongVerifier, returnUrl: RETURN_URL }),
        ).rejects.toMatchObject({
            response: { code: 'MEET71_INVALID_CODE', message: 'Invalid code' },
        });

        expect(db.codes[0].used_at).toBeNull();
        expect(membership.upsertOnSignIn).not.toHaveBeenCalled();
        const sql = db.$queryRaw.mock.calls[0][0].join(' ');
        expect(sql).toMatch(/code_challenge/);
        expect(sql).not.toMatch(/sha256\s*\(/i);
    });

    it('exchange with mismatched returnUrl is MEET71_INVALID_CODE', async () => {
        const { service, db, membership } = makeService();
        const { code, verifier } = await mintWithPkce(service);

        await expect(
            service.exchange({
                code,
                codeVerifier: verifier,
                returnUrl: 'https://evil.com/api/auth/erp71/callback',
            }),
        ).rejects.toMatchObject({
            response: { code: 'MEET71_INVALID_CODE', message: 'Invalid code' },
        });
        expect(db.codes[0].used_at).toBeNull();
        expect(membership.upsertOnSignIn).not.toHaveBeenCalled();
    });

    it('s256 matches mint challenge encoding (base64url, not hex)', () => {
        const verifier = randomBytes(32).toString('base64url');
        const hashed = createHash('sha256').update(verifier);
        expect(s256(verifier)).toBe(hashed.copy().digest('base64url'));
        expect(s256(verifier)).not.toBe(hashed.copy().digest('hex'));
        expect(s256(verifier)).not.toMatch(/[+/=]/);
    });

    it('JOB_REGISTRY includes meet71.sso-sweep at */5 * * * *', () => {
        expect(JOB_NAMES.MEET71_SSO_SWEEP).toBe('meet71.sso-sweep');
        expect(JOB_REGISTRY).toEqual(
            expect.arrayContaining([
                {
                    name: 'meet71.sso-sweep',
                    label: 'Meet71: sweep expired SSO codes',
                    schedule: '*/5 * * * *',
                    maxIntervalMs: 15 * 60 * 1000,
                },
            ]),
        );
    });
});
