import {
    compareOptionValues,
    normaliseOptionValues,
    variantLabel,
    type VariantOptionValues,
} from '@erp71/shared-types';

/** A product as the storefront queries read it. */
export type CatalogProductRow = {
    id: string;
    name: string;
    sku?: string | null;
    price: unknown;
    compare_at_price: unknown;
    image_url: string | null;
    is_featured?: boolean;
    group?: { name: string } | null;
    stocks: { quantity: number }[];
    option_values?: unknown;
    family?: CatalogFamilyRow | null;
};

export type CatalogFamilyRow = {
    id: string;
    name: string;
    image_url: string | null;
    is_featured: boolean;
    option_names: string[];
};

export type ResolvedPrices = Map<string, { sellingPrice: number; compareAtPrice: number | null }>;

export type StorefrontVariant = {
    id: string;
    name: string;
    sku: string | null;
    /** "M / Red" */
    label: string;
    option_values: VariantOptionValues;
    selling_price: number;
    compare_at_price: number | null;
    image_url: string | null;
    stock_quantity: number;
};

/**
 * One card on the shop page: a product sold on its own, or a family of
 * variants shown as one product. A family card's `id` is the family's — a
 * shopper adds one of its `variants` to the cart, never the card itself.
 */
export type StorefrontCard = {
    id: string;
    name: string;
    selling_price: number;
    compare_at_price: number | null;
    image_url: string | null;
    group_name: string;
    stock_quantity: number;
    is_featured: boolean;
    /** Present on a family card only. */
    family_id?: string;
    option_names?: string[];
    /** True when the variants do not all cost the same, so the card reads "From ৳X". */
    price_varies?: boolean;
    variants?: StorefrontVariant[];
};

const UNCATEGORIZED = 'Uncategorized';

function toNumberOrNull(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function stockOf(row: CatalogProductRow): number {
    return row.stocks.reduce((sum, stock) => sum + stock.quantity, 0);
}

function priceOf(row: CatalogProductRow, resolved: ResolvedPrices) {
    const hit = resolved.get(row.id);
    return {
        selling: hit?.sellingPrice ?? Number(row.price),
        compareAt: hit?.compareAtPrice ?? toNumberOrNull(row.compare_at_price),
    };
}

/**
 * Variants in the order a shopper expects to read them: by each axis in the
 * family's order, sizes by size (S, M, L, XL) rather than alphabetically.
 */
export function sortVariants<T extends { option_values: VariantOptionValues; name: string }>(
    optionNames: readonly string[],
    variants: T[],
): T[] {
    return [...variants].sort((a, b) => {
        for (const name of optionNames) {
            const order = compareOptionValues(a.option_values[name] ?? '', b.option_values[name] ?? '');
            if (order !== 0) return order;
        }
        return a.name.localeCompare(b.name);
    });
}

export function toStorefrontVariant(
    row: CatalogProductRow,
    optionNames: readonly string[],
    resolved: ResolvedPrices,
): StorefrontVariant {
    const option_values = normaliseOptionValues(optionNames, row.option_values as Record<string, unknown> | null);
    const price = priceOf(row, resolved);
    return {
        id: row.id,
        name: row.name,
        sku: row.sku ?? null,
        label: variantLabel(optionNames, option_values),
        option_values,
        selling_price: price.selling,
        compare_at_price: price.compareAt,
        image_url: row.image_url,
        stock_quantity: stockOf(row),
    };
}

/**
 * The shop page's cards from its product rows: each product in a family folds
 * into one card for the family, everything else is a card of its own.
 *
 * A product sold on its own is listed only while it is in stock, as the shop
 * has always done. A family is listed while any of its variants is, and then
 * carries its sold-out variants too, so the picker can show "XL" greyed out
 * rather than pretend the size was never made. Its price is the cheapest
 * variant a shopper can actually buy.
 */
export function buildStorefrontCards(rows: readonly CatalogProductRow[], resolved: ResolvedPrices): StorefrontCard[] {
    const cards: StorefrontCard[] = [];
    const families = new Map<string, { family: CatalogFamilyRow; rows: CatalogProductRow[] }>();

    for (const row of rows) {
        if (row.family) {
            const entry = families.get(row.family.id) ?? { family: row.family, rows: [] };
            entry.rows.push(row);
            families.set(row.family.id, entry);
            continue;
        }
        const stock = stockOf(row);
        if (stock <= 0) continue;
        const price = priceOf(row, resolved);
        cards.push({
            id: row.id,
            name: row.name,
            selling_price: price.selling,
            compare_at_price: price.compareAt,
            image_url: row.image_url,
            group_name: row.group?.name || UNCATEGORIZED,
            stock_quantity: stock,
            is_featured: !!row.is_featured,
        });
    }

    for (const { family, rows: members } of families.values()) {
        const variants = sortVariants(
            family.option_names,
            members.map((row) => toStorefrontVariant(row, family.option_names, resolved)),
        );
        const buyable = variants.filter((variant) => variant.stock_quantity > 0);
        if (buyable.length === 0) continue;

        const cheapest = buyable.reduce((min, variant) => (variant.selling_price < min.selling_price ? variant : min));
        const prices = new Set(variants.map((variant) => variant.selling_price));
        cards.push({
            id: family.id,
            name: family.name,
            selling_price: cheapest.selling_price,
            compare_at_price: cheapest.compare_at_price,
            image_url: family.image_url ?? variants.find((variant) => variant.image_url)?.image_url ?? null,
            group_name: members.find((row) => row.group?.name)?.group?.name || UNCATEGORIZED,
            stock_quantity: buyable.reduce((sum, variant) => sum + variant.stock_quantity, 0),
            is_featured: family.is_featured || members.some((row) => row.is_featured),
            family_id: family.id,
            option_names: family.option_names,
            price_varies: prices.size > 1,
            variants,
        });
    }

    return cards.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * How many listings a category has, counting a family once however many of
 * its variants are in stock — the number on the category tile should match
 * the cards a shopper finds behind it.
 */
export function countListings(products: readonly { id: string; family_id: string | null }[]): number {
    return new Set(products.map((product) => product.family_id ?? product.id)).size;
}
