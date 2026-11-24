import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { SalesService } from '../sales/sales.service';
import type { CreateSaleDto } from '../sales/sale.dto';
import { storefrontOrderRef } from '@erp71/shared-types';

/** How long a billing attempt owns an order before another may retry it. */
const CLAIM_LEASE_MS = 5 * 60_000;

type BillTrigger = 'paid' | 'delivered';

/**
 * Turns a storefront order into a real `Sale` once the money is real — on a
 * verified online payment, or on delivery of a cash-on-delivery order.
 *
 * Everything downstream follows the ordinary sale path: stock leaves a
 * warehouse, the tender gets an `account_id`, and `autoPostFromRules` writes
 * the Dr <tender> / Cr Revenue voucher. Before this, web orders never reached
 * the ledger at all.
 *
 * Two deliberate choices:
 *
 *  - **The sale is billed at a physical branch.** Web orders sit on the virtual
 *    online branch, which holds no stock; selling from it would drive an empty
 *    branch warehouse negative. The branch that owns the tenant's configured
 *    default *sales* warehouse (else the oldest branch) is the one whose stock
 *    and books the sale belongs to.
 *  - **The shopper's Customer record is attached only when the tenant allows
 *    cross-branch customers.** Storefront customers are created on the online
 *    branch, so with `branch_customers_only` on (the default) attaching one to
 *    a physical-branch sale would be refused. The order keeps the name, email
 *    and phone either way; the sale is simply a walk-in.
 */
@Injectable()
export class StorefrontOrderBillingService {
    private readonly logger = new Logger(StorefrontOrderBillingService.name);

    constructor(
        private readonly db: DatabaseService,
        private readonly sales: SalesService,
    ) {}

    /**
     * Bills one order if it is eligible. Never throws: a callback confirming
     * money must not turn red because the books could not be written, and the
     * delivery path must not fail for the same reason. A failure is logged and
     * leaves the order unclaimed so a later delivery (or retry) can bill it.
     */
    async billOrder(
        tenantId: string,
        orderId: string,
        trigger: BillTrigger,
    ): Promise<{ saleId: string | null; reason?: string }> {
        try {
            return await this.attempt(tenantId, orderId, trigger);
        } catch (error) {
            await this.releaseClaim(orderId).catch(() => undefined);
            this.logger.warn(
                `Could not bill storefront order ${orderId} (${trigger}): ${(error as Error)?.message ?? error}`,
            );
            return { saleId: null, reason: (error as Error)?.message ?? 'Billing failed' };
        }
    }

    private async attempt(
        tenantId: string,
        orderId: string,
        trigger: BillTrigger,
    ): Promise<{ saleId: string | null; reason?: string }> {
        const order = await this.db.storefrontOrder.findFirst({
            where: { id: orderId, tenantId },
            include: { items: true },
        });
        if (!order) return { saleId: null, reason: 'Order not found' };
        if (order.sale_id) return { saleId: order.sale_id };
        if (order.status === 'CANCELLED') return { saleId: null, reason: 'Order cancelled' };

        const eligible =
            trigger === 'paid' ? order.payment_status === 'PAID' : order.status === 'DELIVERED';
        if (!eligible) return { saleId: null, reason: 'Order is not billable yet' };

        const claim = await this.claim(order.id);
        if (!claim) {
            const fresh = await this.db.storefrontOrder.findUnique({
                where: { id: order.id },
                select: { sale_id: true },
            });
            return fresh?.sale_id
                ? { saleId: fresh.sale_id }
                : { saleId: null, reason: 'Another billing attempt is in progress' };
        }

        const context = await this.billingContext(tenantId, order);
        if (!context) return { saleId: null, reason: 'No branch can take this sale' };

        const subtotal = order.items.reduce(
            (sum, item) => sum + Number(item.priceAtOrder) * item.quantity,
            0,
        );
        const total = roundMoney(Number(order.totalAmount));
        const discountAmount = Math.max(0, roundMoney(subtotal - total));

        const dto = {
            storeId: context.storeId,
            ...(context.customerId ? { customerId: context.customerId } : {}),
            // Online: the moment the gateway confirmed. COD: now, the delivery.
            saleDate: (order.paid_at ?? new Date()).toISOString(),
            items: order.items.map((item) => ({
                productId: item.productId,
                quantity: item.quantity,
                priceAtSale: Number(item.priceAtOrder),
            })),
            totalAmount: total,
            amountPaid: total,
            discountAmount,
            pricesIncludeVat: true,
            note: `Storefront order ${storefrontOrderRef(order.id)}`,
            ...(total > 0.005
                ? {
                      payments: [
                          {
                              paymentMethod: context.paymentMethod,
                              ...(context.paymentMethodId ? { paymentMethodId: context.paymentMethodId } : {}),
                              amount: total,
                          },
                      ],
                  }
                : {}),
        } as CreateSaleDto;

        const sale = await this.sales.create(tenantId, order.customerUserId ?? (null as unknown as string), dto, {
            // Points were credited when the order was placed.
            awardLoyalty: false,
            onCreated: async (tx, created) => {
                // Commits with the sale: if this update loses a race, the sale
                // it would have duplicated rolls back too.
                const linked = await tx.storefrontOrder.updateMany({
                    where: { id: order.id, sale_id: null },
                    data: { sale_id: created.id, billing_claimed_at: null },
                });
                if (linked.count === 0) {
                    throw new Error('This order was billed by another attempt.');
                }
            },
        });

        return { saleId: sale.id };
    }

    /**
     * The branch, the stock it draws from, the tender and (when allowed) the
     * customer. Returning null means no branch exists to bill against.
     */
    private async billingContext(
        tenantId: string,
        order: {
            customerUserId: string | null;
            payment_status: string;
            payment_provider: string | null;
            payment_method: string | null;
        },
    ) {
        const [tenant, inventory, salesSettings] = await Promise.all([
            this.db.tenant.findUnique({ where: { id: tenantId }, select: { online_store_id: true } }),
            this.db.inventorySettings.findUnique({
                where: { tenant_id: tenantId },
                select: { default_sales_warehouse_id: true },
            }),
            this.db.salesSettings.findUnique({
                where: { tenant_id: tenantId },
                select: { branch_customers_only: true },
            }),
        ]);

        const onlineStoreId = tenant?.online_store_id ?? null;
        const storeId = await this.resolveSaleBranch(tenantId, onlineStoreId, inventory?.default_sales_warehouse_id ?? null);
        if (!storeId) return null;

        const customerId = await this.resolveCustomer(
            tenantId,
            order.customerUserId,
            salesSettings?.branch_customers_only !== false,
        );

        const tender = await this.resolveTender(tenantId, storeId, order);

        return { storeId, customerId, ...tender };
    }

    private async resolveSaleBranch(
        tenantId: string,
        onlineStoreId: string | null,
        defaultSalesWarehouseId: string | null,
    ): Promise<string | null> {
        if (defaultSalesWarehouseId) {
            const warehouse = await this.db.warehouse.findFirst({
                where: { id: defaultSalesWarehouseId, tenant_id: tenantId, is_active: true },
                select: { store_id: true },
            });
            // The online branch holds no stock; a web sale must still draw on
            // goods a real branch has.
            if (warehouse?.store_id && warehouse.store_id !== onlineStoreId) {
                return warehouse.store_id;
            }
        }

        const store = await this.db.store.findFirst({
            where: {
                tenant_id: tenantId,
                ...(onlineStoreId ? { id: { not: onlineStoreId } } : {}),
            },
            orderBy: { created_at: 'asc' },
            select: { id: true },
        });
        return store?.id ?? onlineStoreId;
    }

    private async resolveCustomer(
        tenantId: string,
        customerUserId: string | null,
        branchCustomersOnly: boolean,
    ): Promise<string | null> {
        // A storefront customer belongs to the online branch, so a sale at a
        // physical branch may only carry them where the tenant allows it.
        if (!customerUserId || branchCustomersOnly) return null;
        const customer = await this.db.customer.findFirst({
            where: { user_id: customerUserId, tenant_id: tenantId, deleted_at: null },
            select: { id: true },
        });
        return customer?.id ?? null;
    }

    private async resolveTender(
        tenantId: string,
        storeId: string,
        order: { payment_status: string; payment_provider: string | null; payment_method: string | null },
    ): Promise<{ paymentMethod: string; paymentMethodId?: string }> {
        if (order.payment_status !== 'PAID') {
            // Cash on delivery: the money is collected as the order is handed over.
            return { paymentMethod: 'Cash' };
        }

        const code = order.payment_provider ?? order.payment_method;
        const provider = code
            ? await this.db.storefrontPaymentProvider.findUnique({ where: { code }, select: { name: true, code: true } })
            : null;
        const names = [provider?.name, provider?.code].filter((value): value is string => Boolean(value));

        const method = names.length
            ? await this.db.paymentMethod.findFirst({
                  where: {
                      tenant_id: tenantId,
                      is_active: true,
                      OR: names.map((name) => ({ name: { equals: name, mode: 'insensitive' as const } })),
                  },
                  select: {
                      id: true,
                      type: true,
                      all_branches: true,
                      stores: { select: { store_id: true } },
                  },
              })
            : null;

        const usable =
            method && (method.all_branches || method.stores.some((row) => row.store_id === storeId));
        if (usable) {
            return { paymentMethod: method.type, paymentMethodId: method.id };
        }

        // No account of the shop's own for this gateway: settlement lands in a
        // bank account, so the bank posting rule is the honest default.
        return { paymentMethod: 'Bank' };
    }

    /** Takes the billing lease; false when another attempt currently holds it. */
    private async claim(orderId: string): Promise<boolean> {
        const staleBefore = new Date(Date.now() - CLAIM_LEASE_MS);
        const claimed = await this.db.storefrontOrder.updateMany({
            where: {
                id: orderId,
                sale_id: null,
                OR: [{ billing_claimed_at: null }, { billing_claimed_at: { lt: staleBefore } }],
            },
            data: { billing_claimed_at: new Date() },
        });
        return claimed.count === 1;
    }

    private async releaseClaim(orderId: string): Promise<void> {
        await this.db.storefrontOrder.updateMany({
            where: { id: orderId, sale_id: null },
            data: { billing_claimed_at: null },
        });
    }
}

function roundMoney(value: number): number {
    return Math.round(value * 100) / 100;
}
