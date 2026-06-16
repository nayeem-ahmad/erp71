import { resolvePrice } from './price-list-resolver';

describe('resolvePrice', () => {
    it('returns base price when no overrides', () => {
        expect(resolvePrice(100)).toEqual({ sellingPrice: 100, compareAtPrice: null });
    });

    it('uses explicit selling price', () => {
        expect(resolvePrice(100, { selling_price: 80 })).toEqual({
            sellingPrice: 80,
            compareAtPrice: 100,
        });
    });

    it('applies percentage item discount', () => {
        expect(resolvePrice(100, { discount_type: 'PERCENTAGE', discount_value: 10 })).toEqual({
            sellingPrice: 90,
            compareAtPrice: 100,
        });
    });

    it('applies fixed amount item discount', () => {
        expect(resolvePrice(100, { discount_type: 'FIXED_AMOUNT', discount_value: 15 })).toEqual({
            sellingPrice: 85,
            compareAtPrice: 100,
        });
    });

    it('applies overall discount after item discount', () => {
        expect(
            resolvePrice(
                100,
                { discount_type: 'PERCENTAGE', discount_value: 10 },
                { overall_discount_type: 'PERCENTAGE', overall_discount_value: 10 },
            ),
        ).toEqual({
            sellingPrice: 81,
            compareAtPrice: 100,
        });
    });

    it('skips overall discount when explicit selling price is set', () => {
        expect(
            resolvePrice(
                100,
                { selling_price: 95 },
                { overall_discount_type: 'PERCENTAGE', overall_discount_value: 50 },
            ),
        ).toEqual({
            sellingPrice: 95,
            compareAtPrice: 100,
        });
    });

    it('floors price at zero', () => {
        expect(resolvePrice(10, { discount_type: 'FIXED_AMOUNT', discount_value: 50 })).toEqual({
            sellingPrice: 0,
            compareAtPrice: 10,
        });
    });
});