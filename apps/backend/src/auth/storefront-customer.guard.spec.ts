import { UnauthorizedException } from '@nestjs/common';
import { StorefrontCustomerGuard } from './storefront-customer.guard';

describe('StorefrontCustomerGuard', () => {
    const guard = new StorefrontCustomerGuard();

    it('accepts a storefront-scoped token', () => {
        const user = { userId: 'user-1', scope: 'storefront', storefrontTenantId: 'tenant-1' };
        expect(guard.handleRequest(null, user, null, null)).toBe(user);
    });

    it('rejects an ERP app token', () => {
        const user = { userId: 'user-1', scope: 'app' };
        expect(() => guard.handleRequest(null, user, null, null)).toThrow(UnauthorizedException);
        expect(() => guard.handleRequest(null, user, null, null)).toThrow('Sign in to this store to continue');
    });

    it('rejects a legacy token with no scope claim', () => {
        expect(() => guard.handleRequest(null, { userId: 'user-1' }, null, null)).toThrow(UnauthorizedException);
    });

    it('rejects an unauthenticated request', () => {
        expect(() => guard.handleRequest(null, null, null, null)).toThrow(UnauthorizedException);
    });
});
