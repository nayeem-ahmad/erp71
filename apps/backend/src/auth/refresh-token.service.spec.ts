import { UnauthorizedException } from '@nestjs/common';
import { RefreshTokenService, hashRefreshToken } from './refresh-token.service';

const HOUR = 60 * 60 * 1000;

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
        used_at: null,
        replaced_by: null,
        revoked_at: null,
        expires_at: new Date(Date.now() + 24 * HOUR),
        ...overrides,
    };
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

        it('revokes every session when a long-spent token comes back', async () => {
            db.refreshToken.findUnique.mockResolvedValue(
                storedToken({ used_at: new Date(Date.now() - 10 * 60_000) }),
            );

            await expect(service.rotate('raw-token')).rejects.toBeInstanceOf(UnauthorizedException);

            expect(db.refreshToken.updateMany).toHaveBeenCalledWith({
                where: { user_id: 'user-1', revoked_at: null },
                data: { revoked_at: expect.any(Date) },
            });
            expect(db.refreshToken.create).not.toHaveBeenCalled();
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
});
