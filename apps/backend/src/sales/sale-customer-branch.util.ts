import { BadRequestException } from '@nestjs/common';

/** Prisma client or transaction client — both expose the model delegates used here. */
type DbLike = any;

/**
 * Refuse a sale's customer when they belong to another branch, unless the
 * tenant has turned `SalesSettings.branch_customers_only` off.
 *
 * Selling to another branch's customer splits the sale across two branches:
 * the sale, its stock and its receivable post to the sale's branch, while the
 * due, the later payment and any advance post to the customer's (see
 * `customer-branch.util.ts`), so each branch's books and drawer drift.
 *
 * Called wherever a sale gets its customer — create, park, finalise, and an
 * edit that changes the customer. An edit that keeps the customer is not
 * checked, so a sale recorded before the rule can still be corrected.
 */
export async function assertSaleCustomerBranch(
    tx: DbLike,
    tenantId: string,
    customerId: string | null | undefined,
    storeId: string,
): Promise<void> {
    if (!customerId) return;

    const settings = await tx.salesSettings.findUnique({
        where: { tenant_id: tenantId },
        select: { branch_customers_only: true },
    });
    // On for a tenant with no settings row, matching the column default.
    if (settings?.branch_customers_only === false) return;

    const customer = await tx.customer.findFirst({
        where: { id: customerId, tenant_id: tenantId },
        select: { name: true, store_id: true, store: { select: { name: true } } },
    });
    // An unknown customer is not this check's to report: the sale's own
    // lookups already answer it, and naming nothing here leaks nothing.
    if (!customer?.store_id || customer.store_id === storeId) return;

    throw new BadRequestException(
        `${customer.name} is a customer of ${customer.store?.name ?? 'another branch'}. `
        + 'Pick a customer of this branch, or ask an owner to move them here.',
    );
}
