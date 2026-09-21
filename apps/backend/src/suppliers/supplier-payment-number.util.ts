/**
 * Allocates the next `SupplierCreditTransaction.payment_number`.
 *
 * Extracted out of `SuppliersService` because a purchase entry can now settle
 * its own bill at the counter, which writes a PAYMENT row from
 * `PurchasesService` instead. `payment_number` is `@@unique([tenant_id,
 * payment_number])`, so two generators drifting apart would not produce two
 * numbering schemes — it would produce a constraint violation at the till.
 */
export async function nextSupplierPaymentNumber(
    tenantId: string,
    tx: any,
    txType: 'PAYMENT' | 'PAYOUT',
): Promise<string> {
    const prefix = txType === 'PAYOUT' ? 'SPO-' : 'SPY-';
    const last = await tx.supplierCreditTransaction.findFirst({
        where: {
            tenant_id: tenantId,
            type: txType,
            payment_number: { startsWith: prefix },
        },
        orderBy: { payment_number: 'desc' },
        select: { payment_number: true },
    });

    if (!last?.payment_number) return `${prefix}00001`;

    const match = last.payment_number.match(new RegExp(`${prefix.replace('-', '\\-')}(\\d+)`));
    const nextNum = match ? parseInt(match[1], 10) + 1 : 1;
    return `${prefix}${String(nextNum).padStart(5, '0')}`;
}
