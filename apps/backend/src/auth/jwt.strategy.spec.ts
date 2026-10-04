import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { AuthCacheService } from '../database/auth-cache.service';

describe('JwtStrategy', () => {
    let db: any;
    let strategy: JwtStrategy;

    const user = {
        id: 'user-1',
        email: 'alice@example.com',
        token_version: 4,
        storefront_token_version: 2,
        is_platform_admin: false,
    };

    beforeEach(() => {
        db = { user: { findUnique: jest.fn().mockResolvedValue(user) } };
        // Off, so each case below sees the row its own mock returns.
        strategy = new JwtStrategy(db, new AuthCacheService({ ttlMs: 0 }));
    });

    /**
     * The row is cached across requests. The property that matters is that a
     * sign-out, a password change or a demotion still bites on the very next
     * request: each of those writes calls `invalidateUser` after it commits.
     */
    describe('with the cross-request cache on', () => {
        let cache: AuthCacheService;

        beforeEach(() => {
            cache = new AuthCacheService({ ttlMs: 30_000 });
            strategy = new JwtStrategy(db, cache);
        });

        it('checks a second request against the cached row instead of reading it again', async () => {
            await strategy.validate({ sub: 'user-1', tv: 4 });
            await strategy.validate({ sub: 'user-1', tv: 4 });

            expect(db.user.findUnique).toHaveBeenCalledTimes(1);
        });

        it('rejects the old token on the next request after sign-out invalidates', async () => {
            await expect(strategy.validate({ sub: 'user-1', tv: 4 })).resolves.toBeDefined();

            // `AuthService.logout` bumps token_version, then invalidates.
            db.user.findUnique.mockResolvedValue({ ...user, token_version: 5 });
            cache.invalidateUser('user-1');

            await expect(strategy.validate({ sub: 'user-1', tv: 4 })).rejects.toThrow('Session invalidated');
        });

        it('stops treating a demoted platform admin as one on the next request', async () => {
            db.user.findUnique.mockResolvedValue({ ...user, is_platform_admin: true });
            await expect(strategy.validate({ sub: 'user-1', tv: 4 })).resolves.toMatchObject({
                isPlatformAdmin: true,
            });

            db.user.findUnique.mockResolvedValue({ ...user, is_platform_admin: false });
            cache.invalidateUser('user-1');

            await expect(strategy.validate({ sub: 'user-1', tv: 4 })).resolves.toMatchObject({
                isPlatformAdmin: false,
            });
        });

        it('rejects a deleted account on the next request', async () => {
            await strategy.validate({ sub: 'user-1', tv: 4 });

            db.user.findUnique.mockResolvedValue(null);
            cache.invalidateUser('user-1');

            await expect(strategy.validate({ sub: 'user-1', tv: 4 })).rejects.toThrow(UnauthorizedException);
        });

        it('does not remember an unknown user, so an account created later is found', async () => {
            db.user.findUnique.mockResolvedValueOnce(null);
            await expect(strategy.validate({ sub: 'user-1', tv: 4 })).rejects.toThrow(UnauthorizedException);

            await expect(strategy.validate({ sub: 'user-1', tv: 4 })).resolves.toBeDefined();
        });
    });

    it('rejects an unknown user', async () => {
        db.user.findUnique.mockResolvedValue(null);
        await expect(strategy.validate({ sub: 'nope' })).rejects.toThrow(UnauthorizedException);
    });

    describe('app tokens', () => {
        it('accepts a matching token_version', async () => {
            const result = await strategy.validate({ sub: 'user-1', tv: 4, scope: 'app' });
            expect(result).toMatchObject({ userId: 'user-1', scope: 'app', storefrontTenantId: null });
        });

        it('rejects a stale token_version', async () => {
            await expect(strategy.validate({ sub: 'user-1', tv: 3, scope: 'app' })).rejects.toThrow(
                'Session invalidated',
            );
        });

        it('treats a token with no scope claim as an app token', async () => {
            const result = await strategy.validate({ sub: 'user-1', tv: 4 });
            expect(result.scope).toBe('app');
        });

        it('ignores storefront_token_version', async () => {
            // stv drifting must not lock an app session out.
            db.user.findUnique.mockResolvedValue({ ...user, storefront_token_version: 99 });
            await expect(strategy.validate({ sub: 'user-1', tv: 4 })).resolves.toBeDefined();
        });
    });

    describe('storefront tokens', () => {
        it('accepts a matching storefront_token_version and carries the tenant claim', async () => {
            const result = await strategy.validate({
                sub: 'user-1',
                stv: 2,
                scope: 'storefront',
                tid: 'tenant-1',
            });
            expect(result).toMatchObject({ scope: 'storefront', storefrontTenantId: 'tenant-1' });
        });

        it('rejects a stale storefront_token_version', async () => {
            await expect(
                strategy.validate({ sub: 'user-1', stv: 1, scope: 'storefront' }),
            ).rejects.toThrow('Session invalidated');
        });

        it('is unaffected by an app logout bumping token_version', async () => {
            db.user.findUnique.mockResolvedValue({ ...user, token_version: 99 });
            await expect(
                strategy.validate({ sub: 'user-1', stv: 2, scope: 'storefront', tid: 'tenant-1' }),
            ).resolves.toBeDefined();
        });
    });
});
