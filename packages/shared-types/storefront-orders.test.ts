import { isStorefrontOrderStatus, storefrontOrderRef, STOREFRONT_ORDER_STATUSES } from './storefront-orders';

describe('storefrontOrderRef', () => {
    it('takes the upper-cased tail of the id, where cuids differ', () => {
        expect(storefrontOrderRef('clx1abc2def3ghi4jk5lmno6p')).toBe('K5LMNO6P');
    });

    it('returns a short id whole', () => {
        expect(storefrontOrderRef('abc')).toBe('ABC');
    });
});

describe('isStorefrontOrderStatus', () => {
    it('accepts every listed status', () => {
        for (const status of STOREFRONT_ORDER_STATUSES) {
            expect(isStorefrontOrderStatus(status)).toBe(true);
        }
    });

    it('rejects anything else', () => {
        expect(isStorefrontOrderStatus('pending')).toBe(false);
        expect(isStorefrontOrderStatus('REFUNDED')).toBe(false);
        expect(isStorefrontOrderStatus(undefined)).toBe(false);
    });
});
