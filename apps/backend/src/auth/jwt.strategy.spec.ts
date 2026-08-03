import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

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
        strategy = new JwtStrategy(db);
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
