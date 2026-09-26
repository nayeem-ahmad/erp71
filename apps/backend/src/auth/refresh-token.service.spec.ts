import { UnauthorizedException } from '@nestjs/common';
import { RefreshTokenService, hashRefreshToken } from './refresh-token.service';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function makeDb() {
    return {
        refreshToken: {
            create: jest.fn(async () => ({})),
            findUnique: jest.fn(),
            update: jest.fn(async () => ({})),
            updateMany: jest.fn(async () => ({ count: 0 })),
            deleteMany: jest.fn(async () => ({ count: 0 })),
        },
    };
}

function storedToken(overrides: Record<string, any> = {}) {
    return {
        id: 'row-1',
        user_id: 'user-1',
        token_hash: hashRefreshToken('raw-token'),
        family_id: 'family-1',
        used_at: null,
        replaced_by: null,
        revoked_at: null,
        created_at: new Date(Date.now() - HOUR),
        expires_at: new Date(Date.now() + 29 * DAY),
        ...overrides,
    };
}

/** Days between now and `date`, rounded, for asserting on a token's lifetime. */
function daysFromNow(date: Date): number {
    return Math.round((date.getTime() - Date.now()) / DAY);
}

describe('RefreshTokenService', () => {
    let db: ReturnType<typeof makeDb>;
    let service: RefreshTokenService;

    beforeEach(() => {
        db = makeDb();
        service = new RefreshTokenService(db as any);
    });

    describe('issue', () => {
        it('stores only the hash, never the token it hands back', async () => {
            const { token } = await service.issue('user-1');

            const written = db.refreshToken.create.mock.calls[0][0].data;
            expect(written.token_hash).toBe(hashRefreshToken(token));
            expect(JSON.stringify(written)).not.toContain(token);
        });

        it('gives each session its own token', async () => {
            const first = await service.issue('user-1');
            const second = await service.issue('user-1');

            expect(first.token).not.toBe(second.token);
        });

        it('truncates a hostile user agent instead of storing it whole', async () => {
            await service.issue('user-1', { userAgent: 'x'.repeat(5000) });

            expect(db.refreshToken.create.mock.calls[0][0].data.user_agent).toHaveLength(512);
        });

        it('starts a new family per sign-in, and joins one when asked', async () => {
            const first = await service.issue('user-1');
            const second = await service.issue('user-1');
            const joined = await service.issue('user-1', {}, { familyId: first.familyId });

            expect(first.familyId).not.toBe(second.familyId);
            expect(joined.familyId).toBe(first.familyId);
            expect(db.refreshToken.create.mock.calls[2][0].data.family_id).toBe(first.familyId);
        });

        it('lasts a month by default and a day when "Remember me" was left unchecked', async () => {
            const remembered = await service.issue('user-1', {}, { rememberMe: true });
            const unset = await service.issue('user-1');
            const notRemembered = await service.issue('user-1', {}, { rememberMe: false });

            expect(daysFromNow(remembered.expiresAt)).toBe(30);
            // Absent means remembered — signup, invitations and the demo never ask.
            expect(daysFromNow(unset.expiresAt)).toBe(30);
            expect(daysFromNow(notRemembered.expiresAt)).toBe(1);
        });
    });

    describe('rotate', () => {
        it('exchanges a live token for a new one and chains the old row to it', async () => {
            db.refreshToken.findUnique.mockResolvedValue(storedToken());

            const result = await service.rotate('raw-token');

            expect(result.userId).toBe('user-1');
            expect(result.token).not.toBe('raw-token');

            const update = db.refreshToken.update.mock.calls[0][0];
            expect(update.where).toEqual({ id: 'row-1' });
            expect(update.data.used_at).toBeInstanceOf(Date);
            expect(update.data.replaced_by).toBe(hashRefreshToken(result.token));
        });

        it('keeps the successor in the same family', async () => {
            db.refreshToken.findUnique.mockResolvedValue(storedToken());

            const result = await service.rotate('raw-token');

            expect(result.familyId).toBe('family-1');
            expect(db.refreshToken.create.mock.calls[0][0].data.family_id).toBe('family-1');
        });

        it('adopts a pre-migration row into a family of its own', async () => {
            db.refreshToken.findUnique.mockResolvedValue(storedToken({ family_id: null }));

            const result = await service.rotate('raw-token');

            // Its own row id — it has no siblings to group with, so a replay of it
            // can revoke nothing but itself.
            expect(result.familyId).toBe('row-1');
            expect(db.refreshToken.update.mock.calls[0][0].data.family_id).toBe('row-1');
        });

        it('renews an unremembered session without turning it into a remembered one', async () => {
            const createdAt = new Date(Date.now() - 2 * HOUR);
            db.refreshToken.findUnique.mockResolvedValue(
                storedToken({ created_at: createdAt, expires_at: new Date(createdAt.getTime() + DAY) }),
            );

            const result = await service.rotate('raw-token');

            // Sliding, so the clock restarts — but on the day the user asked for,
            // not the month a remembered session gets.
            expect(daysFromNow(result.expiresAt)).toBe(1);
        });

        it('renews a remembered session for another full month', async () => {
            db.refreshToken.findUnique.mockResolvedValue(
                storedToken({
                    created_at: new Date(Date.now() - 20 * DAY),
                    expires_at: new Date(Date.now() + 10 * DAY),
                }),
            );

            const result = await service.rotate('raw-token');

            expect(daysFromNow(result.expiresAt)).toBe(30);
        });

        it.each([
            ['an unknown token', null],
            ['a revoked token', storedToken({ revoked_at: new Date() })],
            ['an expired token', storedToken({ expires_at: new Date(Date.now() - HOUR) })],
        ])('refuses %s', async (_label, row) => {
            db.refreshToken.findUnique.mockResolvedValue(row);

            await expect(service.rotate('raw-token')).rejects.toBeInstanceOf(UnauthorizedException);
            expect(db.refreshToken.create).not.toHaveBeenCalled();
        });

        it('refuses an empty token without touching the database', async () => {
            await expect(service.rotate('')).rejects.toBeInstanceOf(UnauthorizedException);
            expect(db.refreshToken.findUnique).not.toHaveBeenCalled();
        });

        it('lets a second tab through when both renew at the same moment', async () => {
            db.refreshToken.findUnique.mockResolvedValue(
                storedToken({ used_at: new Date(Date.now() - 2_000) }),
            );

            const result = await service.rotate('raw-token');

            expect(result.userId).toBe('user-1');
            expect(db.refreshToken.updateMany).not.toHaveBeenCalled();
        });

        it('keeps the original used_at when replaying inside the grace window', async () => {
            const firstUse = new Date(Date.now() - 2_000);
            db.refreshToken.findUnique.mockResolvedValue(storedToken({ used_at: firstUse }));

            await service.rotate('raw-token');

            expect(db.refreshToken.update.mock.calls[0][0].data.used_at).toBe(firstUse);
        });

        it('ends the replayed session when a long-spent token comes back', async () => {
            db.refreshToken.findUnique.mockResolvedValue(
                storedToken({ used_at: new Date(Date.now() - 10 * 60_000) }),
            );

            await expect(service.rotate('raw-token')).rejects.toBeInstanceOf(UnauthorizedException);

            expect(db.refreshToken.updateMany).toHaveBeenCalledWith({
                where: { family_id: 'family-1', revoked_at: null },
                data: { revoked_at: expect.any(Date) },
            });
            expect(db.refreshToken.create).not.toHaveBeenCalled();
        });

        it('leaves the user signed in on their other devices', async () => {
            db.refreshToken.findUnique.mockResolvedValue(
                storedToken({ used_at: new Date(Date.now() - 10 * 60_000) }),
            );

            await expect(service.rotate('raw-token')).rejects.toBeInstanceOf(UnauthorizedException);

            // The regression this whole change exists to stop: a stale token in
            // one browser used to revoke by `user_id` and empty every device.
            const revocations = db.refreshToken.updateMany.mock.calls.map((call: any) => call[0].where);
            expect(revocations).not.toContainEqual(
                expect.objectContaining({ user_id: 'user-1' }),
            );
        });
    });

    describe('revoke', () => {
        it('marks the matching row revoked', async () => {
            await service.revoke('raw-token');

            expect(db.refreshToken.updateMany).toHaveBeenCalledWith({
                where: { token_hash: hashRefreshToken('raw-token'), revoked_at: null },
                data: { revoked_at: expect.any(Date) },
            });
        });

        it('is a no-op when there is no token to revoke', async () => {
            await service.revoke(undefined);
            await service.revoke(null);

            expect(db.refreshToken.updateMany).not.toHaveBeenCalled();
        });
    });

    describe('revokeSession', () => {
        it('ends the whole session the token belongs to and says whose it was', async () => {
            db.refreshToken.findUnique.mockResolvedValue(storedToken());

            await expect(service.revokeSession('raw-token')).resolves.toEqual({ userId: 'user-1' });

            expect(db.refreshToken.findUnique).toHaveBeenCalledWith({
                where: { token_hash: hashRefreshToken('raw-token') },
                select: { id: true, user_id: true, family_id: true },
            });
            expect(db.refreshToken.updateMany).toHaveBeenCalledWith({
                where: { family_id: 'family-1', revoked_at: null },
                data: { revoked_at: expect.any(Date) },
            });
        });

        it('leaves the user signed in on their other devices', async () => {
            db.refreshToken.findUnique.mockResolvedValue(storedToken());

            await service.revokeSession('raw-token');

            const revocations = db.refreshToken.updateMany.mock.calls.map((call: any) => call[0].where);
            expect(revocations).not.toContainEqual(expect.objectContaining({ user_id: 'user-1' }));
        });

        it('revokes just the token when it predates session families', async () => {
            db.refreshToken.findUnique.mockResolvedValue(storedToken({ family_id: null }));

            await service.revokeSession('raw-token');

            expect(db.refreshToken.updateMany).toHaveBeenCalledTimes(1);
            expect(db.refreshToken.updateMany).toHaveBeenCalledWith({
                where: { token_hash: hashRefreshToken('raw-token'), revoked_at: null },
                data: { revoked_at: expect.any(Date) },
            });
        });

        it('is a no-op for a token it does not know, or none at all', async () => {
            db.refreshToken.findUnique.mockResolvedValue(null);

            await expect(service.revokeSession('unknown')).resolves.toBeNull();
            await expect(service.revokeSession(undefined)).resolves.toBeNull();
            await expect(service.revokeSession(null)).resolves.toBeNull();

            expect(db.refreshToken.updateMany).not.toHaveBeenCalled();
        });
    });
});
