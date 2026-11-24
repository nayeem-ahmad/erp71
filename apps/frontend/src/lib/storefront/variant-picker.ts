import { compareOptionValues } from '@erp71/shared-types';

/**
 * The storefront's option picker, as pure functions: which values each option
 * offers, which of them can still be bought given what the shopper has already
 * picked, and which variant a full selection names.
 */

export type PickerVariant = {
    id: string;
    option_values: Record<string, string>;
    in_stock: boolean;
};

/** The shopper's choice so far, by option name. A missing key is "not chosen yet". */
export type VariantSelection = Record<string, string>;

/** Each option's distinct values, sizes in size order. */
export function optionValues(optionNames: readonly string[], variants: readonly PickerVariant[]): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const name of optionNames) {
        const seen = new Set<string>();
        for (const variant of variants) {
            const value = variant.option_values[name];
            if (value) seen.add(value);
        }
        out[name] = [...seen].sort(compareOptionValues);
    }
    return out;
}

function matches(variant: PickerVariant, selection: VariantSelection, skip?: string): boolean {
    return Object.entries(selection).every(([name, value]) => name === skip || !value || variant.option_values[name] === value);
}

/** The variant every option of the selection names, once all are chosen. */
export function findVariant<T extends PickerVariant>(
    optionNames: readonly string[],
    variants: readonly T[],
    selection: VariantSelection,
): T | undefined {
    if (optionNames.some((name) => !selection[name])) return undefined;
    return variants.find((variant) => optionNames.every((name) => variant.option_values[name] === selection[name]));
}

export type ValueState = 'available' | 'soldOut' | 'unavailable';

/**
 * Whether picking `value` for `option` leads anywhere, given the shopper's
 * other choices: to something in stock, only to sold-out variants, or to no
 * variant at all (that size was never made in that colour).
 */
export function valueState(
    variants: readonly PickerVariant[],
    selection: VariantSelection,
    option: string,
    value: string,
): ValueState {
    const candidates = variants.filter(
        (variant) => variant.option_values[option] === value && matches(variant, selection, option),
    );
    if (candidates.length === 0) return 'unavailable';
    return candidates.some((variant) => variant.in_stock) ? 'available' : 'soldOut';
}

/**
 * The selection after the shopper picks `value` for `option`. When that
 * clashes with an earlier choice — Red is only made in S and M, and they had
 * L — the other options move to the nearest variant that has the new value,
 * preferring one in stock, rather than leaving a combination that does not
 * exist.
 */
export function selectValue(
    optionNames: readonly string[],
    variants: readonly PickerVariant[],
    selection: VariantSelection,
    option: string,
    value: string,
): VariantSelection {
    const next = { ...selection, [option]: value };
    if (variants.some((variant) => matches(variant, next))) return next;

    const withValue = variants.filter((variant) => variant.option_values[option] === value);
    const fallback = withValue.find((variant) => variant.in_stock) ?? withValue[0];
    if (!fallback) return next;
    const moved: VariantSelection = {};
    for (const name of optionNames) {
        if (name === option || selection[name]) moved[name] = fallback.option_values[name];
    }
    return moved;
}

/**
 * Where the picker starts: options that offer a single value are chosen
 * already — there is nothing to ask — and everything else waits for the
 * shopper, so nobody adds a size they never picked.
 */
export function initialSelection(optionNames: readonly string[], variants: readonly PickerVariant[]): VariantSelection {
    const values = optionValues(optionNames, variants);
    const out: VariantSelection = {};
    for (const name of optionNames) {
        if (values[name].length === 1) out[name] = values[name][0];
    }
    return out;
}
