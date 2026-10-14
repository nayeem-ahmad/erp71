/** Quantity of a sale line already taken by a return or a completed exchange. */
export function committedReturnQuantity(item: {
    returns?: Array<{ quantity: number }>;
    exchangeLines?: Array<{ returned_quantity: number }>;
}): number {
    const returned = (item.returns ?? []).reduce((sum, row) => sum + row.quantity, 0);
    const exchanged = (item.exchangeLines ?? []).reduce((sum, row) => sum + row.returned_quantity, 0);
    return returned + exchanged;
}

/** Completed exchange lines, the only ones that still hold quantity on the sale. */
export const completedExchangeLinesInclude = {
    where: { exchange: { status: { not: 'CANCELLED' } } },
    select: { returned_quantity: true },
} as const;
