// CommonJS runtime counterpart of payment-method.seed.ts — keep the two in sync.
// `type` values must match the shared PaymentMethodType contract.
// `link_to` names the default account the method's tenders post to.
const DEFAULT_PAYMENT_METHODS = [
    { name: 'Cash', type: 'Cash', sort_order: 1, link_to: 'Cash in Hand' },
    { name: 'Bank', type: 'Bank', sort_order: 2, link_to: 'Main Bank Account' },
    { name: 'bKash', type: 'Mobile Wallet', sort_order: 3, link_to: 'bKash Account' },
    { name: 'Nagad', type: 'Mobile Wallet', sort_order: 4, link_to: 'Nagad Account' },
    { name: 'Card', type: 'Card', sort_order: 5, link_to: 'Main Bank Account' },
];

// Idempotent: skips names already present for the tenant.
async function seedDefaultPaymentMethods(tx, tenantId) {
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

// Points each default-named method that has no account yet at the default account
// of the matching name. Never overwrites an existing link; skips a name with no
// matching account. Run after bootstrapDefaultAccountingForTenant.
async function linkDefaultPaymentMethodAccounts(tx, tenantId) {
    const targets = new Map(DEFAULT_PAYMENT_METHODS.map((m) => [m.name, m.link_to]));

    const methods = await tx.paymentMethod.findMany({
        where: { tenant_id: tenantId, account_id: null, name: { in: [...targets.keys()] } },
        select: { id: true, name: true },
    });
    if (methods.length === 0) return { linked: [] };

    const accounts = await tx.account.findMany({
        where: { tenant_id: tenantId, name: { in: [...new Set(targets.values())] } },
        select: { id: true, name: true },
    });
    const accountIdByName = new Map(accounts.map((a) => [a.name, a.id]));

    const linked = [];
    for (const method of methods) {
        const accountId = accountIdByName.get(targets.get(method.name));
        if (!accountId) continue;
        await tx.paymentMethod.update({ where: { id: method.id }, data: { account_id: accountId } });
        linked.push(method.name);
    }
    return { linked };
}

module.exports = { seedDefaultPaymentMethods, linkDefaultPaymentMethodAccounts, DEFAULT_PAYMENT_METHODS };
