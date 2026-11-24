import { checkVariantChoice, emptyVariantChoice, joinDefaults, newGroupDefaults, takenLabels } from './variant-choice';
import type { ProductFamily } from './api';

const belt: ProductFamily = {
    id: 'fam-1',
    name: 'Belt OAC',
    description: null,
    image_url: null,
    images_gallery: [],
    option_names: ['Size'],
    is_featured: false,
    members: [
        { id: 'p-s', name: 'Belt OAC S', sku: null, price: 500, image_url: null, option_values: { Size: 'S' }, stock_quantity: 1 },
        { id: 'p-m', name: 'Belt OAC M', sku: null, price: 500, image_url: null, option_values: { Size: 'M' }, stock_quantity: 0 },
    ],
};

describe('variant choice', () => {
    it('sends nothing for "not a variant"', () => {
        expect(checkVariantChoice(emptyVariantChoice(), [belt])).toEqual({ ok: true });
    });

    it('joins a group with a size it does not have', () => {
        const choice = { ...emptyVariantChoice(), mode: 'existing' as const, familyId: 'fam-1', values: { Size: 'L' } };
        expect(checkVariantChoice(choice, [belt], 'p-l')).toEqual({
            ok: true,
            variant: { familyId: 'fam-1', optionValues: { Size: 'L' } },
        });
    });

    it('refuses a size the group already has, but not the product keeping its own', () => {
        const choice = { ...emptyVariantChoice(), mode: 'existing' as const, familyId: 'fam-1', values: { Size: 'm' } };
        expect(checkVariantChoice(choice, [belt], 'p-new')).toMatchObject({ ok: false, field: 'values' });
        expect(checkVariantChoice(choice, [belt], 'p-m')).toMatchObject({ ok: true });
    });

    it('asks for a group, and for a new group a name', () => {
        expect(checkVariantChoice({ ...emptyVariantChoice(), mode: 'existing' }, [belt])).toMatchObject({ ok: false, field: 'group' });
        expect(checkVariantChoice({ ...emptyVariantChoice(), mode: 'new', values: { Size: 'S' } }, [])).toMatchObject({ ok: false, field: 'name' });
    });

    it('starts a new group from the product name', () => {
        const defaults = newGroupDefaults('Knee Cap XL');
        expect(defaults).toEqual({ newName: 'Knee Cap', optionsText: 'Size', values: { Size: 'XL' } });
        expect(checkVariantChoice({ ...emptyVariantChoice(), mode: 'new', ...defaults }, [])).toEqual({
            ok: true,
            variant: { newFamilyName: 'Knee Cap', optionNames: ['Size'], optionValues: { Size: 'XL' } },
        });
    });

    it("reads a product's size when joining, and lists the group's other sizes", () => {
        expect(joinDefaults('Belt OAC XL', belt)).toEqual({ Size: 'XL' });
        expect(joinDefaults('Belt OAC Red', belt)).toEqual({});
        expect(takenLabels(belt, 'p-m')).toEqual(['S']);
    });
});
