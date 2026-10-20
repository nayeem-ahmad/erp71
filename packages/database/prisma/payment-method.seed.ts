/**
 * Default payment methods provisioned for every new tenant.
 *
 * `type` MUST be one of the backend PaymentMethodType enum *values*
 * ('Cash' | 'Mobile Wallet' | 'Card' | 'Bank') — the sales-entry UI maps the
 * stored type to a canonical accounting string, and the API validates against
 * these same values.
 *
 * `sort_order` is the "Serial" shown in Settings → Payment Methods;
 * `show_on_entry` controls whether the method appears on the sales-entry UI
 * by default (others remain addable via the "Add method" picker).
 *
 * `link_to` is the NAME of the default chart-of-accounts account the method's
 * tenders post to (see `linkDefaultPaymentMethodAccounts`). It is not stored on
 * the method: only the resolved `account_id` is.
 */
export const DEFAULT_PAYMENT_METHODS: {
    name: string;
    type: 'Cash' | 'Mobile Wallet' | 'Card' | 'Bank';
    sort_order: number;
    link_to: string;
}[] = [
    { name: 'Cash', type: 'Cash', sort_order: 1, link_to: 'Cash in Hand' },
    { name: 'Bank', type: 'Bank', sort_order: 2, link_to: 'Main Bank Account' },
    { name: 'bKash', type: 'Mobile Wallet', sort_order: 3, link_to: 'bKash Account' },
    { name: 'Nagad', type: 'Mobile Wallet', sort_order: 4, link_to: 'Nagad Account' },
    { name: 'Card', type: 'Card', sort_order: 5, link_to: 'Main Bank Account' },
];

/**
 * Idempotent: safe to call for an existing tenant (skips names already present,
 * honouring the @@unique([tenant_id, name]) constraint).
 */
export async function seedDefaultPaymentMethods(tx: any, tenantId: string) {
    await tx.paymentMethod.createMany({
        data: DEFAULT_PAYMENT_METHODS.map((m) => ({
            tenant_id: tenantId,
            name: m.name,
            type: m.type,
            sort_order: m.sort_order,
            is_active: true,
            show_on_entry: true,
        })),
        skipDuplicates: true,
    });
}

/**
 * Points each default-named method that has no account yet at the default
 * account of the matching name, so its tenders post there.
 *
 * Reads only unlinked methods, so it never overwrites a link an owner chose,
 * and a name with no matching account (an owner renamed or deleted it) is
 * skipped rather than guessed. Idempotent. Run it after
 * `bootstrapDefaultAccountingForTenant`, which creates the accounts.
 */
export async function linkDefaultPaymentMethodAccounts(
    tx: any,
    tenantId: string,
): Promise<{ linked: string[] }> {
    const targets = new Map(DEFAULT_PAYMENT_METHODS.map((m) => [m.name, m.link_to]));

    const methods: { id: string; name: string }[] = await tx.paymentMethod.findMany({
        where: { tenant_id: tenantId, account_id: null, name: { in: [...targets.keys()] } },
        select: { id: true, name: true },
    });
    if (methods.length === 0) return { linked: [] };

    const accounts: { id: string; name: string }[] = await tx.account.findMany({
        where: { tenant_id: tenantId, name: { in: [...new Set(targets.values())] } },
        select: { id: true, name: true },
    });
    const accountIdByName = new Map(accounts.map((a) => [a.name, a.id]));

    const linked: string[] = [];
    for (const method of methods) {
        const accountId = accountIdByName.get(targets.get(method.name) as string);
        if (!accountId) continue;
        await tx.paymentMethod.update({ where: { id: method.id }, data: { account_id: accountId } });
        linked.push(method.name);
    }
    return { linked };
}
