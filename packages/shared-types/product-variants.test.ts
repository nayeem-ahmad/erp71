import {
    compareOptionValues,
    normaliseOptionNames,
    normaliseOptionValues,
    splitVariantName,
    suggestVariantFamilies,
    validateVariantFamily,
    variantLabel,
} from './product-variants';

describe('normaliseOptionNames', () => {
    it('trims, drops blanks and keeps a repeated name once', () => {
        expect(normaliseOptionNames([' Size ', '', 'size', 'Color'])).toEqual(['Size', 'Color']);
    });
});

describe('normaliseOptionValues', () => {
    it('matches keys case-insensitively and keeps only the family axes', () => {
        expect(normaliseOptionValues(['Size', 'Color'], { size: ' M ', COLOR: 'Red', Fit: 'Slim' })).toEqual({
            Size: 'M',
            Color: 'Red',
        });
    });

    it('reads a missing value as blank', () => {
        expect(normaliseOptionValues(['Size'], null)).toEqual({ Size: '' });
    });
});

describe('variantLabel', () => {
    it('joins values in axis order', () => {
        expect(variantLabel(['Size', 'Color'], { Color: 'Red', Size: 'M' })).toBe('M / Red');
    });
});

describe('validateVariantFamily', () => {
    it('accepts distinct combinations', () => {
        const result = validateVariantFamily(['Size'], [
            { productId: 'a', optionValues: { Size: 'S' } },
            { productId: 'b', optionValues: { size: 'M' } },
        ]);
        expect(result).toEqual({
            ok: true,
            optionNames: ['Size'],
            members: [
                { productId: 'a', optionValues: { Size: 'S' } },
                { productId: 'b', optionValues: { Size: 'M' } },
            ],
        });
    });

    it('rejects two members with the same combination, whatever the case', () => {
        const result = validateVariantFamily(['Size'], [
            { productId: 'a', optionValues: { Size: 'm' } },
            { productId: 'b', optionValues: { Size: 'M' } },
        ]);
        expect(result.ok).toBe(false);
    });

    it('rejects a member missing a value', () => {
        const result = validateVariantFamily(['Size', 'Color'], [{ productId: 'a', optionValues: { Size: 'S' } }]);
        expect(result).toEqual({ ok: false, error: 'Every variant needs a Color.' });
    });

    it('rejects no options, too many options and a repeated product', () => {
        expect(validateVariantFamily([], [{ productId: 'a', optionValues: {} }]).ok).toBe(false);
        expect(validateVariantFamily(['A', 'B', 'C', 'D'], [{ productId: 'a', optionValues: {} }]).ok).toBe(false);
        expect(
            validateVariantFamily(['Size'], [
                { productId: 'a', optionValues: { Size: 'S' } },
                { productId: 'a', optionValues: { Size: 'M' } },
            ]).ok,
        ).toBe(false);
    });
});

describe('compareOptionValues', () => {
    it('orders sizes by size, numbers by value, the rest alphabetically', () => {
        expect(['XL', 'M', 'S', 'L'].sort(compareOptionValues)).toEqual(['S', 'M', 'L', 'XL']);
        expect(['42', '38', '40'].sort(compareOptionValues)).toEqual(['38', '40', '42']);
        expect(['Red', 'blue', 'Green'].sort(compareOptionValues)).toEqual(['blue', 'Green', 'Red']);
    });
});

describe('splitVariantName', () => {
    it('reads a trailing size', () => {
        expect(splitVariantName('L01 Contoured L.S. Belt OAC S')).toEqual({
            base: 'L01 Contoured L.S. Belt OAC',
            value: 'S',
            axis: 'Size',
        });
        expect(splitVariantName('Knee Cap - XXL')).toEqual({ base: 'Knee Cap', value: 'XXL', axis: 'Size' });
    });

    it('reads a bracketed size or colour', () => {
        expect(splitVariantName('T-Shirt (red)')).toEqual({ base: 'T-Shirt', value: 'Red', axis: 'Color' });
        expect(splitVariantName('Wrist Brace [M]')).toEqual({ base: 'Wrist Brace', value: 'M', axis: 'Size' });
    });

    it('does not read a unit or a strength as a size', () => {
        expect(splitVariantName('Pepsi 1 L')).toBeNull();
        expect(splitVariantName('Napa 500')).toBeNull();
        expect(splitVariantName('Salisalic Acid 40%')).toBeNull();
        expect(splitVariantName('XL')).toBeNull();
    });
});

describe('suggestVariantFamilies', () => {
    it('groups names that differ only by a trailing size, in size order', () => {
        const suggestions = suggestVariantFamilies([
            { id: '3', name: 'Belt OAC L' },
            { id: '1', name: 'Belt OAC S' },
            { id: '2', name: 'Belt OAC M' },
            { id: '4', name: 'Napa 500' },
            { id: '5', name: 'Cap Red' },
        ]);
        expect(suggestions).toHaveLength(1);
        expect(suggestions[0].name).toBe('Belt OAC');
        expect(suggestions[0].optionName).toBe('Size');
        expect(suggestions[0].members.map((m) => m.product.id)).toEqual(['1', '2', '3']);
    });

    it('leaves out a second product with the same value', () => {
        const suggestions = suggestVariantFamilies([
            { id: '1', name: 'Belt OAC L' },
            { id: '2', name: 'Belt OAC L' },
            { id: '3', name: 'belt oac M' },
        ]);
        expect(suggestions[0].members.map((m) => m.product.id)).toEqual(['3', '1']);
    });
});
