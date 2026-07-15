// CommonJS runtime counterpart of payment-method.seed.ts — keep the two in sync.
// `type` values must match the shared PaymentMethodType contract.
const DEFAULT_PAYMENT_METHODS = [
    { name: 'Cash', type: 'Cash', sort_order: 1 },
    { name: 'bKash', type: 'Mobile Wallet', sort_order: 2 },
    { name: 'Nagad', type: 'Mobile Wallet', sort_order: 3 },
    { name: 'Card', type: 'Card', sort_order: 4 },
    { name: 'Bank', type: 'Bank', sort_order: 5 },
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

module.exports = { seedDefaultPaymentMethods, DEFAULT_PAYMENT_METHODS };
