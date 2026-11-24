import {
    compareOptionValues,
    normaliseOptionNames,
    normaliseOptionValues,
    splitVariantName,
    validateVariantFamily,
    variantLabel,
} from '@erp71/shared-types';
import type { ProductFamily } from '@/lib/api';

/**
 * One product's choice of storefront variant group, as the product form and
 * the products list's "Set variant group" both ask it: none, a group that
 * exists, or a new one. Kept as plain data so the two screens validate and
 * send it the same way.
 */
export type VariantChoice = {
    mode: 'none' | 'existing' | 'new';
    familyId: string;
    newName: string;
    /** Comma-separated, as typed: "Size, Color". */
    optionsText: string;
    /** This product's values, keyed by option name. */
    values: Record<string, string>;
};

/** What the products API takes as `variant`. */
export type VariantAssignmentPayload = {
    familyId?: string;
    newFamilyName?: string;
    optionNames?: string[];
    optionValues: Record<string, string>;
};

export function emptyVariantChoice(): VariantChoice {
    return { mode: 'none', familyId: '', newName: '', optionsText: 'Size', values: {} };
}

/**
 * Starting a new group from a product's name: "Belt OAC XL" suggests a group
 * called "Belt OAC" on Size, with this product as XL.
 */
export function newGroupDefaults(productName: string): Pick<VariantChoice, 'newName' | 'optionsText' | 'values'> {
    const split = splitVariantName(productName);
    if (split) return { newName: split.base, optionsText: split.axis, values: { [split.axis]: split.value } };
    return { newName: productName.trim(), optionsText: 'Size', values: {} };
}

/**
 * Joining a group from a product's name: when the name ends in a size or
 * colour the group uses, that is this product's value.
 */
export function joinDefaults(productName: string, family: Pick<ProductFamily, 'option_names'>): Record<string, string> {
    const split = splitVariantName(productName);
    if (!split) return {};
    const option = family.option_names.find((name) => name.toLowerCase() === split.axis.toLowerCase());
    return option ? { [option]: split.value } : {};
}

export function choiceOptionNames(choice: VariantChoice, families: readonly ProductFamily[]): string[] {
    if (choice.mode === 'existing') return families.find((family) => family.id === choice.familyId)?.option_names ?? [];
    if (choice.mode === 'new') return normaliseOptionNames(choice.optionsText.split(','));
    return [];
}

/** The other members' combinations, sizes in size order, for "Already in the group: S, M, L". */
export function takenLabels(family: ProductFamily, productId?: string): string[] {
    return family.members
        .filter((member) => member.id !== productId)
        .map((member) => variantLabel(family.option_names, normaliseOptionValues(family.option_names, member.option_values)))
        .filter(Boolean)
        .sort(compareOptionValues);
}

/**
 * The choice checked against the group it names, and turned into the API's
 * `variant` — or the sentence to show beside the field. `none` sends nothing.
 */
export function checkVariantChoice(
    choice: VariantChoice,
    families: readonly ProductFamily[],
    productId?: string,
): { ok: true; variant?: VariantAssignmentPayload } | { ok: false; error: string; field: 'group' | 'name' | 'values' } {
    if (choice.mode === 'none') return { ok: true };
    const self = productId ?? '__this_product__';

    if (choice.mode === 'existing') {
        const family = families.find((row) => row.id === choice.familyId);
        if (!family) return { ok: false, error: 'Pick a group.', field: 'group' };
        const others = family.members
            .filter((member) => member.id !== productId)
            .map((member) => ({ productId: member.id, optionValues: member.option_values }));
        const result = validateVariantFamily(family.option_names, [...others, { productId: self, optionValues: choice.values }]);
        if ('error' in result) return { ok: false, error: result.error, field: 'values' };
        return {
            ok: true,
            variant: { familyId: family.id, optionValues: result.members[result.members.length - 1].optionValues },
        };
    }

    const name = choice.newName.trim();
    if (!name) return { ok: false, error: 'Give the group a name.', field: 'name' };
    const result = validateVariantFamily(choice.optionsText.split(','), [{ productId: self, optionValues: choice.values }]);
    if ('error' in result) return { ok: false, error: result.error, field: 'values' };
    return {
        ok: true,
        variant: { newFamilyName: name, optionNames: result.optionNames, optionValues: result.members[0].optionValues },
    };
}
