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
 */
export const DEFAULT_PAYMENT_METHODS: {
    name: string;
    type: 'Cash' | 'Mobile Wallet' | 'Card' | 'Bank';
    sort_order: number;
}[] = [
    { name: 'Cash', type: 'Cash', sort_order: 1 },
    { name: 'bKash', type: 'Mobile Wallet', sort_order: 2 },
    { name: 'Nagad', type: 'Mobile Wallet', sort_order: 3 },
    { name: 'Card', type: 'Card', sort_order: 4 },
    { name: 'Bank', type: 'Bank', sort_order: 5 },
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
