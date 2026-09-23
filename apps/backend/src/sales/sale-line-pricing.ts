/**
 * How the entry form's per-line "Disc %" and its whole-bill adjustments turn
 * into what a sale actually stores.
 *
 * A line discount is folded into the unit price. `SaleItem` has no discount
 * column, and every consumer of `price_at_sale` — the Mushak 6.3 and 6.2
 * rebuilt from it, the credit note a return pays back, the rate history the
 * next sale is priced from, margin and COGS reports — wants the price the
 * goods actually went out at. Storing the list price beside a discount would
 * mean teaching each of them to subtract it; storing the net price means none
 * of them has to change and none of them can forget to.
 *
 * The net price is rounded to the paisa because that is all the column holds.
 * The entry form rounds identically (`netUnitPrice` in the frontend's
 * `useNewSaleCart`), so the line total the cashier sees is the one posted.
 */

/** Money to the paisa, the way both ends of the sale entry round it. */
export function roundMoney(value: number): number {
    return Math.round(value * 100) / 100;
}

/** Unit price after a per-line percentage discount, to the paisa. */
export function netUnitPrice(price: number, discountPercent?: number | null): number {
    const percent = Math.min(Math.max(discountPercent ?? 0, 0), 100);
    if (percent === 0) return price;
    return roundMoney(price * (1 - percent / 100));
}

/**
 * The lines as they are to be stored: the discount folded into
 * `priceAtSale` and then dropped, so nothing downstream can apply it twice.
 */
export function applyLineDiscounts<T extends { priceAtSale: number; discountPercent?: number }>(
    items: T[],
): Omit<T, 'discountPercent'>[] {
    return items.map(({ discountPercent, ...item }) => ({
        ...item,
        priceAtSale: netUnitPrice(item.priceAtSale, discountPercent),
    }));
}

/**
 * The whole-bill charges the entry form adds after the discount: transport,
 * labour and a rounding adjustment (which may be negative). They are part of
 * what the customer is billed, so they are part of `total_amount` — exactly as
 * the update path already stores them — but they are not the value of any
 * line's supply, so no line carries them.
 */
export function saleSurcharges(dto: {
    transportAmount?: number;
    laborAmount?: number;
    roundingAmount?: number;
}): number {
    return (dto.transportAmount ?? 0) + (dto.laborAmount ?? 0) + (dto.roundingAmount ?? 0);
}
