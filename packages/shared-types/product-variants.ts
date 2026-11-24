/**
 * Product variants: the storefront's view of "one product in several sizes or
 * colours".
 *
 * Each size or colour stays a `Product` of its own — its own SKU, price, stock,
 * cost and barcode — because sales, purchases, stock and every report work one
 * SKU at a time and must keep doing so. A `ProductFamily` only tells the
 * storefront which products to show as one card, and on what axes (Size,
 * Color) a shopper chooses between them. Each member carries its own values on
 * those axes in `Product.option_values`, e.g. `{ "Size": "M", "Color": "Red" }`.
 *
 * Everything here is pure, so the backend's validation, the admin's grouping
 * dialog and the storefront's picker read the same rules.
 */

/** A member's values on its family's option axes, keyed by option name. */
export type VariantOptionValues = Record<string, string>;

/** Size and Color, and at most one more: past three axes a picker stops helping. */
export const MAX_VARIANT_OPTIONS = 3;

/** Long enough for "Extra Large" or "Sky Blue", short enough to fit a chip. */
export const MAX_VARIANT_VALUE_LENGTH = 40;

export const MAX_VARIANT_OPTION_NAME_LENGTH = 30;

function collapse(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

/**
 * Option names as a family stores them: trimmed, blanks dropped, and a
 * repeated name (in any letter case) kept once — "Size" and "size" are the
 * same axis, and two of them would ask the shopper the same question twice.
 */
export function normaliseOptionNames(names: readonly string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of names) {
        const name = collapse(String(raw ?? ''));
        if (!name) continue;
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(name);
    }
    return out;
}

/**
 * A member's values restricted to its family's axes, in the family's order,
 * trimmed. Keys are matched case-insensitively, so `{ size: 'M' }` reads as
 * Size. Values for axes the family does not have are dropped.
 */
export function normaliseOptionValues(
    optionNames: readonly string[],
    values: Record<string, unknown> | null | undefined,
): VariantOptionValues {
    const source = values && typeof values === 'object' ? values : {};
    const byLowerKey = new Map<string, unknown>();
    for (const [key, value] of Object.entries(source)) {
        byLowerKey.set(key.trim().toLowerCase(), value);
    }
    const out: VariantOptionValues = {};
    for (const name of optionNames) {
        const raw = byLowerKey.get(name.toLowerCase());
        out[name] = raw === null || raw === undefined ? '' : collapse(String(raw));
    }
    return out;
}

/** "M / Red" — the variant as a shopper reads it, in the family's axis order. */
export function variantLabel(optionNames: readonly string[], values: VariantOptionValues | null | undefined): string {
    if (!values) return '';
    return optionNames
        .map((name) => values[name])
        .filter((value): value is string => !!value)
        .join(' / ');
}

/**
 * The identity of a combination within its family. Case-insensitive, so "m"
 * and "M" are the same size and a family cannot hold both.
 */
export function variantKey(optionNames: readonly string[], values: VariantOptionValues): string {
    return optionNames.map((name) => (values[name] ?? '').toLowerCase()).join('\u0000');
}

export type VariantMemberInput = { productId: string; optionValues: Record<string, unknown> | null | undefined };

export type ValidatedVariantMember = { productId: string; optionValues: VariantOptionValues };

/**
 * Checks a family's axes and members together and returns them normalised, or
 * the first problem as a sentence staff can act on.
 */
export function validateVariantFamily(
    optionNamesInput: readonly string[],
    members: readonly VariantMemberInput[],
): { ok: true; optionNames: string[]; members: ValidatedVariantMember[] } | { ok: false; error: string } {
    const optionNames = normaliseOptionNames(optionNamesInput);
    if (optionNames.length === 0) {
        return { ok: false, error: 'Give the variants at least one option, such as Size or Color.' };
    }
    if (optionNames.length > MAX_VARIANT_OPTIONS) {
        return { ok: false, error: `A product can have at most ${MAX_VARIANT_OPTIONS} options.` };
    }
    const longName = optionNames.find((name) => name.length > MAX_VARIANT_OPTION_NAME_LENGTH);
    if (longName) {
        return { ok: false, error: `Option name "${longName}" is too long.` };
    }
    if (members.length === 0) {
        return { ok: false, error: 'Pick at least one product.' };
    }

    const seenProducts = new Set<string>();
    const seenCombinations = new Map<string, string>();
    const out: ValidatedVariantMember[] = [];
    for (const member of members) {
        if (!member.productId) return { ok: false, error: 'Every variant needs a product.' };
        if (seenProducts.has(member.productId)) {
            return { ok: false, error: 'The same product is listed twice.' };
        }
        seenProducts.add(member.productId);

        const optionValues = normaliseOptionValues(optionNames, member.optionValues);
        for (const name of optionNames) {
            const value = optionValues[name];
            if (!value) return { ok: false, error: `Every variant needs a ${name}.` };
            if (value.length > MAX_VARIANT_VALUE_LENGTH) {
                return { ok: false, error: `${name} "${value}" is too long.` };
            }
        }

        const key = variantKey(optionNames, optionValues);
        if (seenCombinations.has(key)) {
            return {
                ok: false,
                error: `Two products are both "${variantLabel(optionNames, optionValues)}". Each variant needs its own combination.`,
            };
        }
        seenCombinations.set(key, member.productId);
        out.push({ productId: member.productId, optionValues });
    }
    return { ok: true, optionNames, members: out };
}

// ─── Ordering ──────────────────────────────────────────────────────────────

const SIZE_ORDER = [
    'XXXS', '3XS', 'XXS', '2XS', 'XS', 'S', 'SMALL', 'M', 'MEDIUM', 'L', 'LARGE',
    'XL', 'EXTRA LARGE', 'XXL', '2XL', 'XXXL', '3XL', '4XL', '5XL', '6XL',
];
const SIZE_RANK = new Map(SIZE_ORDER.map((size, index) => [size, index]));

/**
 * Size-aware ordering for option values: S before M before XL, 38 before 40,
 * everything else alphabetically. Used to lay out the chips on the storefront,
 * where "L, M, S, XL" in alphabetical order would read as a mistake.
 */
export function compareOptionValues(a: string, b: string): number {
    const rankA = SIZE_RANK.get(a.trim().toUpperCase());
    const rankB = SIZE_RANK.get(b.trim().toUpperCase());
    if (rankA !== undefined && rankB !== undefined) return rankA - rankB;
    if (rankA !== undefined) return -1;
    if (rankB !== undefined) return 1;

    const numA = Number(a);
    const numB = Number(b);
    const aIsNum = a.trim() !== '' && Number.isFinite(numA);
    const bIsNum = b.trim() !== '' && Number.isFinite(numB);
    if (aIsNum && bIsNum) return numA - numB;
    if (aIsNum) return -1;
    if (bIsNum) return 1;
    return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}

// ─── Suggestions from product names ────────────────────────────────────────

export type VariantAxisGuess = 'Size' | 'Color';

const SIZE_TOKENS = new Set(SIZE_ORDER.filter((size) => !size.includes(' ')).concat(['FREE']));

const COLOR_TOKENS = new Set([
    'BLACK', 'WHITE', 'RED', 'BLUE', 'GREEN', 'YELLOW', 'GREY', 'GRAY', 'PINK', 'PURPLE',
    'ORANGE', 'BROWN', 'NAVY', 'MAROON', 'BEIGE', 'SILVER', 'GOLD', 'GOLDEN', 'CREAM', 'OLIVE',
    'TEAL', 'VIOLET', 'MAGENTA', 'KHAKI', 'TAN', 'IVORY', 'CHARCOAL',
]);

/** Separators that may sit between a product's base name and its size: "Belt - XL", "Belt (XL)". */
const TRAILING_SEPARATORS = /[\s\-–—,/|:]+$/;

/**
 * The trailing size or colour of a product name, if it has one: "Belt OAC XL"
 * → base "Belt OAC", Size "XL". "T-Shirt (Red)" → base "T-Shirt", Color "Red".
 *
 * Deliberately narrow. A trailing letter right after a number is read as a
 * unit, not a size ("Pepsi 1 L" is a litre, not a Large), and bare numbers are
 * never read as sizes at all ("Napa 500" is a strength a shop may well want to
 * keep as separate products). Staff confirm every suggestion, so a miss costs
 * a manual grouping, while a false hit would put noise in front of them.
 */
export function splitVariantName(name: string): { base: string; value: string; axis: VariantAxisGuess } | null {
    const trimmed = collapse(name);
    const bracketed = trimmed.match(/^(.*?)[\s\-–—,]*[([]\s*([^()[\]]+?)\s*[)\]]$/);
    let base: string;
    let token: string;
    if (bracketed) {
        base = bracketed[1];
        token = bracketed[2];
    } else {
        const lastSpace = trimmed.lastIndexOf(' ');
        if (lastSpace <= 0) return null;
        base = trimmed.slice(0, lastSpace);
        token = trimmed.slice(lastSpace + 1);
    }

    base = base.replace(TRAILING_SEPARATORS, '').trim();
    if (!base) return null;

    const upper = token.toUpperCase().replace(/[.\-]/g, '');
    let axis: VariantAxisGuess | null = null;
    if (SIZE_TOKENS.has(upper)) axis = 'Size';
    else if (COLOR_TOKENS.has(upper)) axis = 'Color';
    if (!axis) return null;

    // "1 L", "500 ML"-style: the token is a unit of the number before it.
    if (axis === 'Size' && !bracketed && /\d$/.test(base)) return null;

    const value = axis === 'Size' ? upper : token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    return { base, value, axis };
}

export type VariantFamilySuggestion<T> = {
    /** The shared name, as the first member spells it. */
    name: string;
    optionName: VariantAxisGuess;
    members: Array<{ product: T; value: string }>;
};

/**
 * Groups of products whose names differ only by a trailing size or colour —
 * "Belt OAC S", "Belt OAC M", "Belt OAC L" — as candidates to show as one
 * product on the storefront. Each group has at least two members and no two
 * with the same value: a second "Belt OAC M" is a duplicate product, not a
 * variant, and is left out for staff to deal with.
 */
export function suggestVariantFamilies<T extends { id: string; name: string }>(
    products: readonly T[],
): VariantFamilySuggestion<T>[] {
    const groups = new Map<string, VariantFamilySuggestion<T> & { values: Set<string> }>();
    for (const product of products) {
        const split = splitVariantName(product.name);
        if (!split) continue;
        const key = `${split.axis}\u0000${split.base.toLowerCase()}`;
        let group = groups.get(key);
        if (!group) {
            group = { name: split.base, optionName: split.axis, members: [], values: new Set() };
            groups.set(key, group);
        }
        const valueKey = split.value.toLowerCase();
        if (group.values.has(valueKey)) continue;
        group.values.add(valueKey);
        group.members.push({ product, value: split.value });
    }

    return [...groups.values()]
        .filter((group) => group.members.length >= 2)
        .map(({ name, optionName, members }) => ({
            name,
            optionName,
            members: [...members].sort((a, b) => compareOptionValues(a.value, b.value)),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

// ─── Generating variants ───────────────────────────────────────────────────

/** Past this many combinations the generator refuses: it is a typo, not a size run. */
export const MAX_VARIANT_COMBINATIONS = 100;

/**
 * Every combination of the given values, in axis order: Size [S, M] × Color
 * [Red, Blue] → S/Red, S/Blue, M/Red, M/Blue. Blank and repeated values are
 * dropped; an axis with no values yields nothing.
 */
export function variantCombinations(
    optionNames: readonly string[],
    valuesByOption: Record<string, readonly string[]>,
): VariantOptionValues[] {
    let combos: VariantOptionValues[] = [{}];
    for (const name of optionNames) {
        const values = normaliseOptionNames(valuesByOption[name] ?? []);
        if (values.length === 0) return [];
        const next: VariantOptionValues[] = [];
        for (const combo of combos) {
            for (const value of values) next.push({ ...combo, [name]: value });
        }
        combos = next;
    }
    return optionNames.length === 0 ? [] : combos;
}

/**
 * A generated variant's product name: the family's name and its values,
 * "Belt OAC XL" or "T-Shirt M Red" — the same shape staff already use, which
 * the suggestions read back.
 */
export function variantProductName(baseName: string, optionNames: readonly string[], values: VariantOptionValues): string {
    return collapse([baseName, ...optionNames.map((name) => values[name] ?? '')].join(' '));
}

/**
 * A generated variant's SKU: the base SKU and the values, upper-cased, letters
 * and digits only — "P00970" → "P00970-XL", "TS" → "TS-M-RED". Null when the
 * base has no SKU, rather than inventing one.
 */
export function variantSku(baseSku: string | null | undefined, optionNames: readonly string[], values: VariantOptionValues): string | null {
    const base = (baseSku ?? '').trim();
    if (!base) return null;
    const parts = optionNames
        .map((name) => (values[name] ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ''))
        .filter(Boolean);
    return [base, ...parts].join('-');
}
