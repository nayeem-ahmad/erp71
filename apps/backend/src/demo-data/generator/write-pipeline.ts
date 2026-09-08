import { Prisma } from '@prisma/client';
import type { DemoWorld, ProductRuntime, StoreRuntime } from './context';
import { DemoWriter, money } from './write';

type Tx = Prisma.TransactionClient;

/**
 * The documents either side of a sale or a purchase: what a customer was quoted,
 * what they ordered and paid a deposit on, what was delivered, what came back
 * under warranty — and on the buying side, what was asked for, quoted by
 * suppliers and ordered.
 *
 * These are the modules a walkthrough opens right after the POS, and until now
 * every one of them was empty in a demo store. They matter for a second reason:
 * a quotation that converts into an order that converts into a sale is the only
 * way the `Sale.quotation_id` / `sales_order_id` provenance links get exercised.
 */
export class PipelineWriter {
    /** Customers whose loyalty balance moved today, flushed once at day end. */
    private readonly loyaltyDirty = new Set<number>();

    constructor(private readonly world: DemoWorld, private readonly core: DemoWriter) {}

    private get counts() {
        return this.world.counts;
    }

    /** A basket of 1–4 distinct products with plausible quantities. */
    private draftLines(store: StoreRuntime, maxLines = 4): Array<{ product: ProductRuntime; quantity: number }> {
        const rng = this.world.rng;
        const picked = new Map<string, { product: ProductRuntime; quantity: number }>();
        const lineCount = rng.int(1, maxLines);
        for (let i = 0; i < lineCount; i++) {
            const product = rng.weighted(this.world.products, this.world.products.map((p) => p.popularityWeight));
            const existing = picked.get(product.id);
            const quantity = rng.weighted([1, 2, 3, 5, 10], [40, 26, 18, 10, 6]);
            if (existing) existing.quantity += quantity;
            else picked.set(product.id, { product, quantity });
        }
        void store;
        return [...picked.values()];
    }

    /* ---------------------------------------------------------------- */
    /*  Sales quotations                                                 */
    /* ---------------------------------------------------------------- */

    /**
     * A quotation, roughly a third of which are accepted and converted the same
     * week. The accepted ones return their id so the caller can raise an order
     * against them.
     */
    async writeQuotation(tx: Tx, date: Date, store: StoreRuntime): Promise<{ id: string; number: string; accepted: boolean } | null> {
        const rng = this.world.rng;
        if (this.world.customers.length === 0) return null;

        const lines = this.draftLines(store);
        const total = money(lines.reduce((s, l) => s + l.product.sellPrice * l.quantity, 0));
        const quoteNumber = this.world.ref('QT');
        const customer = rng.pick(this.world.customers);
        const accepted = rng.chance(0.35);
        // A proforma is a quotation with commercial terms and a foreign currency
        // on it — the document a buyer's bank wants for an LC. One in six, so the
        // PI print template and the currency path are both represented.
        const proforma = rng.chance(0.16);

        const quotation = await tx.quotation.create({
            data: {
                tenant_id: this.world.tenantId,
                store_id: store.storeId,
                customer_id: customer.id,
                quote_number: quoteNumber,
                total_amount: total,
                status: accepted ? 'ACCEPTED' : rng.weighted(['SENT', 'DRAFT', 'REJECTED', 'EXPIRED'], [45, 20, 20, 15]),
                valid_until: new Date(date.getTime() + 14 * 86400000),
                notes: proforma ? 'Proforma invoice for an import buyer' : undefined,
                created_at: date,
                ...(proforma
                    ? {
                        doc_kind: 'PROFORMA',
                        currency: 'USD',
                        exchange_rate: new Prisma.Decimal(rng.range(118, 124).toFixed(6)),
                        incoterm: rng.pick(['FOB', 'CFR', 'CIF']),
                        port_of_loading: rng.pick(['Chattogram', 'Mongla']),
                        port_of_discharge: rng.pick(['Singapore', 'Jebel Ali', 'Colombo']),
                        payment_terms: '30% advance, balance against documents',
                        advance_percent: new Prisma.Decimal(30),
                        delivery_lead_time_days: rng.int(21, 60),
                        country_of_origin: 'Bangladesh',
                    }
                    : {}),
                items: {
                    create: lines.map((l) => ({
                        product_id: l.product.id,
                        quantity: l.quantity,
                        unit_price: l.product.sellPrice,
                    })),
                },
            },
        });
        this.counts.quotations++;
        return { id: quotation.id, number: quoteNumber, accepted };
    }

    /* ---------------------------------------------------------------- */
    /*  Sales orders                                                     */
    /* ---------------------------------------------------------------- */

    /**
     * A sales order, usually with a deposit against it. Delivered orders are
     * invoiced through the core writer so the stock and the ledger move exactly
     * as they would for a walk-in sale — only with the order's id on the invoice.
     */
    async writeSalesOrder(tx: Tx, date: Date, store: StoreRuntime, quotationId?: string): Promise<void> {
        const rng = this.world.rng;
        if (this.world.customers.length === 0) return;

        const lines = this.draftLines(store, 3);
        const total = money(lines.reduce((s, l) => s + l.product.sellPrice * l.quantity, 0));
        const customerIndex = rng.int(0, this.world.customers.length - 1);
        const orderNumber = this.world.ref('SO');
        const delivered = rng.chance(0.55);
        const depositAmount = rng.chance(0.6) ? money(total * rng.range(0.2, 0.5)) : 0;

        const order = await tx.salesOrder.create({
            data: {
                tenant_id: this.world.tenantId,
                store_id: store.storeId,
                customer_id: this.world.customers[customerIndex].id,
                order_number: orderNumber,
                total_amount: total,
                amount_paid: depositAmount,
                status: delivered ? 'DELIVERED' : rng.weighted(['CONFIRMED', 'PROCESSING', 'DRAFT', 'CANCELLED'], [40, 30, 20, 10]),
                payment_status: depositAmount >= total ? 'PAID' : depositAmount > 0 ? 'PARTIAL' : 'UNPAID',
                delivery_date: new Date(date.getTime() + rng.int(2, 10) * 86400000),
                created_by: this.world.userId,
                created_at: date,
                items: {
                    create: lines.map((l) => ({
                        product_id: l.product.id,
                        quantity: l.quantity,
                        price_at_order: l.product.sellPrice,
                    })),
                },
            },
        });
        this.counts.salesOrders++;

        if (depositAmount > 0) {
            await tx.orderDeposit.create({
                data: {
                    order_id: order.id,
                    amount: depositAmount,
                    payment_method: rng.pick(['Cash', 'bKash', 'Card']),
                    created_at: date,
                },
            });
            this.counts.orderDeposits++;
        }

        if (delivered) {
            await this.core.writeSale(tx, date, store, 1, {
                customerIndex,
                salesOrderId: order.id,
                quotationId,
            });
        }
    }

    /* ---------------------------------------------------------------- */
    /*  After the sale — delivery, warranty, loyalty                     */
    /* ---------------------------------------------------------------- */

    /** A home delivery raised against a recent invoice. */
    async maybeDeliveryOrder(tx: Tx, date: Date): Promise<void> {
        const rng = this.world.rng;
        const candidates = this.world.recent.filter((s) => s.customerIndex >= 0);
        if (candidates.length === 0 || !rng.chance(0.35)) return;

        const sale = rng.pick(candidates);
        const customer = this.world.customers[sale.customerIndex];
        const delivered = rng.chance(0.7);
        await tx.deliveryOrder.create({
            data: {
                tenantId: this.world.tenantId,
                saleId: sale.saleId,
                customerName: customer.name,
                deliveryAddress: `House ${rng.int(1, 90)}, Road ${rng.int(1, 25)}, ${rng.pick(['Dhanmondi', 'Banani', 'Uttara', 'Mirpur', 'Gulshan'])}, Dhaka`,
                driverName: rng.pick(['Jashim', 'Robiul', 'Shohag', 'Nayeem']),
                status: delivered ? 'DELIVERED' : rng.weighted(['PENDING', 'IN_TRANSIT', 'CANCELLED'], [40, 45, 15]),
                scheduledAt: new Date(date.getTime() + 3 * 3600000),
                deliveredAt: delivered ? this.world.clampToWindow(new Date(date.getTime() + 6 * 3600000)) : null,
                created_at: date,
                updated_at: date,
            },
        });
        this.counts.deliveryOrders++;
    }

    /** Points earned on a named customer's invoice, occasionally redeemed. */
    async writeLoyalty(tx: Tx, date: Date, saleId: string, customerIndex: number, total: number): Promise<void> {
        if (customerIndex < 0) return;
        const customer = this.world.customers[customerIndex];
        const earned = Math.floor(total / 100);
        if (earned <= 0) return;

        await tx.loyaltyTransaction.create({
            data: {
                tenantId: this.world.tenantId, customerId: customer.id, saleId,
                type: 'EARN', points: earned, description: 'Points earned on purchase', created_at: date,
            },
        });
        customer.loyaltyPoints += earned;
        this.counts.loyaltyTransactions++;

        // Redeem once a balance is worth redeeming.
        if (customer.loyaltyPoints >= 500 && this.world.rng.chance(0.25)) {
            const redeemed = Math.min(customer.loyaltyPoints, 500);
            await tx.loyaltyTransaction.create({
                data: {
                    tenantId: this.world.tenantId, customerId: customer.id, saleId,
                    type: 'REDEEM', points: -redeemed, description: 'Points redeemed against a purchase', created_at: date,
                },
            });
            customer.loyaltyPoints -= redeemed;
            this.counts.loyaltyTransactions++;
        }

        // The customer row is written once per day in `flushLoyalty` rather than
        // once per invoice — a regular who shops three times in a day would
        // otherwise cost three updates to land on the same number.
        this.loyaltyDirty.add(customerIndex);
    }

    /** Persist the day's loyalty balances. Call at the end of each day. */
    async flushLoyalty(tx: Tx, date: Date): Promise<void> {
        for (const index of this.loyaltyDirty) {
            const customer = this.world.customers[index];
            await tx.customer.update({
                where: { id: customer.id },
                data: { loyalty_points: customer.loyaltyPoints, last_contacted_at: date },
            });
        }
        this.loyaltyDirty.clear();
    }

    /** A warranty claim against a warranted product someone bought recently. */
    async maybeWarrantyClaim(tx: Tx, date: Date): Promise<void> {
        const rng = this.world.rng;
        if (!rng.chance(0.06)) return;

        const warranted = new Set(this.world.products.filter((p) => p.warranty).map((p) => p.id));
        if (warranted.size === 0) return;
        const candidates = this.world.recent.filter((s) => s.productIds.some((id) => warranted.has(id)));
        if (candidates.length === 0) return;

        const sale = rng.pick(candidates);
        const productId = rng.pick(sale.productIds.filter((id) => warranted.has(id)));
        const product = this.world.products.find((p) => p.id === productId)!;
        const claimNumber = this.world.ref('WC');
        const serialNumber = `SN-${this.world.batchNumber}-${product.sku}-${rng.int(100000, 999999)}`;
        const resolved = rng.chance(0.6);

        const claim = await tx.warrantyClaim.create({
            data: {
                tenant_id: this.world.tenantId,
                store_id: sale.storeId,
                claim_number: claimNumber,
                serial_number: serialNumber,
                product_id: productId,
                sale_id: sale.saleId,
                customer_id: sale.customerIndex >= 0 ? this.world.customers[sale.customerIndex].id : null,
                status: resolved ? rng.pick(['REPAIRED', 'REPLACED', 'COMPLETED']) : rng.pick(['SUBMITTED', 'APPROVED', 'REJECTED']),
                reason: rng.pick([
                    'Stopped working within the warranty period',
                    'Manufacturing defect reported by the customer',
                    'Damaged on arrival',
                    'Intermittent fault since purchase',
                ]),
                resolved_at: resolved ? this.world.clampToWindow(new Date(date.getTime() + 2 * 86400000)) : null,
                created_at: date,
                updated_at: date,
            },
        });
        this.counts.warrantyClaims++;

        // Mirror the serial so the serial lookup finds the claim too.
        await tx.productSerial.create({
            data: {
                tenant_id: this.world.tenantId, store_id: sale.storeId, product_id: productId,
                serial_number: serialNumber, status: 'CLAIMED', source_type: 'SALE', source_id: sale.saleId,
                claim_reference: claim.id, sold_at: sale.date, created_at: sale.date, updated_at: date,
            },
        });
    }

    /** An order placed on the public storefront, awaiting shop confirmation. */
    async maybeStorefrontOrder(tx: Tx, date: Date): Promise<void> {
        const rng = this.world.rng;
        if (!rng.chance(0.18) || this.world.customers.length === 0) return;

        const customer = rng.pick(this.world.customers);
        const lines = this.draftLines(this.world.mainStore, 3);
        const total = money(lines.reduce((s, l) => s + l.product.sellPrice * l.quantity, 0));

        // Storefront orders deliberately do not move stock: in the app they are
        // web enquiries until the shop confirms one into a sale, and inventing a
        // movement here would put ProductStock out of step with the ledger.
        await tx.storefrontOrder.create({
            data: {
                tenantId: this.world.tenantId,
                customerName: customer.name,
                customerEmail: `${customer.name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`,
                customerPhone: null,
                totalAmount: total,
                status: rng.weighted(['PENDING', 'CONFIRMED', 'CANCELLED'], [45, 45, 10]),
                created_at: date,
                updated_at: date,
                items: {
                    create: lines.map((l) => ({
                        productId: l.product.id,
                        quantity: l.quantity,
                        priceAtOrder: l.product.sellPrice,
                    })),
                },
            },
        });
        this.counts.storefrontOrders++;
    }

    /* ---------------------------------------------------------------- */
    /*  Purchasing pipeline                                              */
    /* ---------------------------------------------------------------- */

    /** An RFQ sent to a supplier, sometimes answered with a price. */
    async writePurchaseQuotation(tx: Tx, date: Date): Promise<void> {
        const rng = this.world.rng;
        if (this.world.suppliers.length === 0) return;

        const lines = this.draftLines(this.world.mainStore, 3);
        const total = money(lines.reduce((s, l) => s + l.product.cost * l.quantity, 0));
        const rfqNumber = this.world.ref('RFQ');

        await tx.purchaseQuotation.create({
            data: {
                tenant_id: this.world.tenantId,
                store_id: this.world.mainStore.storeId,
                supplier_id: rng.pick(this.world.suppliers).id,
                rfq_number: rfqNumber,
                status: rng.weighted(['SENT', 'RECEIVED', 'DRAFT', 'CONVERTED', 'REJECTED'], [30, 25, 20, 15, 10]),
                valid_until: new Date(date.getTime() + 21 * 86400000),
                total_amount: total,
                created_at: date,
                updated_at: date,
                items: {
                    create: lines.map((l) => ({
                        product_id: l.product.id,
                        quantity: l.quantity,
                        unit_cost: l.product.cost,
                        line_total: money(l.product.cost * l.quantity),
                    })),
                },
            },
        });
        this.counts.purchaseQuotations++;
    }

    /**
     * A purchase order. Received ones are booked as a real purchase through the
     * core writer, so the goods land in stock and the payable posts — the PO
     * itself carries no accounting.
     */
    async writePurchaseOrder(tx: Tx, date: Date): Promise<void> {
        const rng = this.world.rng;
        if (this.world.suppliers.length === 0) return;

        const supplierIndex = rng.int(0, this.world.suppliers.length - 1);
        const lines = this.draftLines(this.world.mainStore, 3).map((l) => ({
            ...l,
            quantity: l.quantity * rng.int(2, 6),
        }));
        const total = money(lines.reduce((s, l) => s + l.product.cost * l.quantity, 0));
        const poNumber = this.world.ref('PO');
        const received = rng.chance(0.5);

        await tx.purchaseOrder.create({
            data: {
                tenant_id: this.world.tenantId,
                store_id: this.world.mainStore.storeId,
                supplier_id: this.world.suppliers[supplierIndex].id,
                po_number: poNumber,
                status: received ? 'RECEIVED' : rng.weighted(['SENT', 'DRAFT', 'CANCELLED'], [55, 30, 15]),
                expected_date: new Date(date.getTime() + rng.int(3, 14) * 86400000),
                subtotal_amount: total,
                total_amount: total,
                received_at: received ? date : null,
                created_by: this.world.userId,
                created_at: date,
                updated_at: date,
                items: {
                    create: lines.map((l) => ({
                        product_id: l.product.id,
                        quantity: l.quantity,
                        unit_cost: l.product.cost,
                        line_total: money(l.product.cost * l.quantity),
                    })),
                },
            },
        });
        this.counts.purchaseOrders++;

        if (received) {
            await this.core.writePurchase(tx, date, supplierIndex, this.world.mainStore, lines);
        }
    }

    /** A branch asking head office to send stock — the requisition flow. */
    async writeProductDemand(tx: Tx, date: Date): Promise<void> {
        const rng = this.world.rng;
        const store = this.world.secondStore ?? this.world.mainStore;
        const lines = this.draftLines(store, 4);
        const demandNumber = this.world.ref('DMD');
        const stage = rng.weighted(['FULFILLED', 'APPROVED', 'SUBMITTED', 'DRAFT', 'REJECTED'], [30, 25, 25, 12, 8]);
        const reviewed = stage === 'FULFILLED' || stage === 'APPROVED' || stage === 'REJECTED';

        await tx.productDemand.create({
            data: {
                tenant_id: this.world.tenantId,
                store_id: store.storeId,
                warehouse_id: store.warehouseId,
                demand_number: demandNumber,
                status: stage,
                priority: rng.weighted(['NORMAL', 'HIGH', 'LOW', 'URGENT'], [50, 25, 15, 10]),
                needed_by: new Date(date.getTime() + rng.int(2, 12) * 86400000),
                requested_by: this.world.userId,
                submitted_at: stage === 'DRAFT' ? null : date,
                reviewed_by: reviewed ? this.world.userId : null,
                reviewed_at: reviewed ? new Date(date.getTime() + 3600000) : null,
                fulfilled_at: stage === 'FULFILLED' ? new Date(date.getTime() + 2 * 86400000) : null,
                fulfilled_by: stage === 'FULFILLED' ? this.world.userId : null,
                created_at: date,
                updated_at: date,
                items: {
                    create: lines.map((l) => ({
                        product_id: l.product.id,
                        quantity_requested: l.quantity,
                        quantity_approved: reviewed ? l.quantity : null,
                    })),
                },
            },
        });
        this.counts.productDemands++;
    }
}
