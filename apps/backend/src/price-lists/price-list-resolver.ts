import { PriceListDiscountType } from '@prisma/client';

export interface PriceListItemInput {
    selling_price?: number | null;
    discount_type?: PriceListDiscountType | null;
    discount_value?: number | null;
}

export interface PriceListInput {
    overall_discount_type?: PriceListDiscountType | null;
    overall_discount_value?: number | null;
}

export interface ResolvedPrice {
    sellingPrice: number;
    compareAtPrice: number | null;
}

function toNumber(value: unknown): number {
    return Number(value ?? 0);
}

function applyDiscount(
    price: number,
    type: PriceListDiscountType,
    value: number,
): number {
    if (type === 'PERCENTAGE') {
        return Math.max(0, price * (1 - value / 100));
    }
    return Math.max(0, price - value);
}

export function resolvePrice(
    basePrice: number,
    item?: PriceListItemInput | null,
    list?: PriceListInput | null,
): ResolvedPrice {
    const base = toNumber(basePrice);

    if (item?.selling_price != null) {
        const selling = toNumber(item.selling_price);
        return {
            sellingPrice: selling,
            compareAtPrice: selling < base ? base : null,
        };
    }

    let price = base;

    if (item?.discount_type && item.discount_value != null) {
        price = applyDiscount(price, item.discount_type, toNumber(item.discount_value));
    }

    if (list?.overall_discount_type && list.overall_discount_value != null) {
        price = applyDiscount(price, list.overall_discount_type, toNumber(list.overall_discount_value));
    }

    return {
        sellingPrice: price,
        compareAtPrice: price < base ? base : null,
    };
}

export function resolvePricesForProducts<
    T extends { id: string; price: number | { toString(): string } },
>(
    products: T[],
    itemsByProductId: Map<string, PriceListItemInput>,
    list?: PriceListInput | null,
): Map<string, ResolvedPrice> {
    const result = new Map<string, ResolvedPrice>();

    for (const product of products) {
        const basePrice = toNumber(product.price);
        const item = itemsByProductId.get(product.id);
        result.set(product.id, resolvePrice(basePrice, item, list));
    }

    return result;
}