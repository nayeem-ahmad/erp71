import { findVariant, initialSelection, optionValues, selectValue, valueState, type PickerVariant } from './variant-picker';

const OPTIONS = ['Size', 'Color'];
const variants: PickerVariant[] = [
    { id: 's-red', option_values: { Size: 'S', Color: 'Red' }, in_stock: true },
    { id: 'm-red', option_values: { Size: 'M', Color: 'Red' }, in_stock: false },
    { id: 'l-blue', option_values: { Size: 'L', Color: 'Blue' }, in_stock: true },
    { id: 'm-blue', option_values: { Size: 'M', Color: 'Blue' }, in_stock: true },
];

describe('optionValues', () => {
    it('lists each option once, sizes in size order', () => {
        expect(optionValues(OPTIONS, variants)).toEqual({ Size: ['S', 'M', 'L'], Color: ['Blue', 'Red'] });
    });
});

describe('findVariant', () => {
    it('finds the variant once every option is chosen', () => {
        expect(findVariant(OPTIONS, variants, { Size: 'M', Color: 'Blue' })?.id).toBe('m-blue');
        expect(findVariant(OPTIONS, variants, { Size: 'M' })).toBeUndefined();
    });
});

describe('valueState', () => {
    it('tells in stock, sold out and never made apart', () => {
        const selection = { Color: 'Red' };
        expect(valueState(variants, selection, 'Size', 'S')).toBe('available');
        expect(valueState(variants, selection, 'Size', 'M')).toBe('soldOut');
        expect(valueState(variants, selection, 'Size', 'L')).toBe('unavailable');
    });

    it('ignores the option being looked at', () => {
        expect(valueState(variants, { Size: 'S' }, 'Size', 'L')).toBe('available');
    });
});

describe('selectValue', () => {
    it('keeps a selection that still exists', () => {
        expect(selectValue(OPTIONS, variants, { Color: 'Blue' }, 'Size', 'M')).toEqual({ Color: 'Blue', Size: 'M' });
    });

    it('moves a clashing choice to the nearest variant, in stock first', () => {
        expect(selectValue(OPTIONS, variants, { Size: 'L' }, 'Color', 'Red')).toEqual({ Size: 'S', Color: 'Red' });
    });
});

describe('initialSelection', () => {
    it('chooses only the options with one value', () => {
        expect(
            initialSelection(['Size', 'Fit'], [
                { id: 'a', option_values: { Size: 'S', Fit: 'Slim' }, in_stock: true },
                { id: 'b', option_values: { Size: 'M', Fit: 'Slim' }, in_stock: true },
            ]),
        ).toEqual({ Fit: 'Slim' });
    });
});
