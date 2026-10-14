/** Units of a sale line not already taken by a return or a completed exchange. */
export function openSaleLineQty(saleItem: {
    quantity?: number | string | null;
    returns?: Array<{ quantity?: number | string | null }> | null;
    exchangeLines?: Array<{ returned_quantity?: number | string | null }> | null;
}): number {
    const returned = (saleItem.returns ?? []).reduce(
        (sum, row) => sum + Number(row?.quantity ?? 0),
        0,
    );
    const exchanged = (saleItem.exchangeLines ?? []).reduce(
        (sum, row) => sum + Number(row?.returned_quantity ?? 0),
        0,
    );
    return Math.max(0, Number(saleItem.quantity ?? 0) - returned - exchanged);
}
