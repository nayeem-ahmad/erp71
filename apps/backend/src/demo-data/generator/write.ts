import { Prisma } from '@prisma/client';
import { applyInventoryMovement } from '../../database/inventory.utils';
import { autoPostFromRules } from '../../accounting/posting.utils';
import { classifyPaymentMode } from '../../sales/classify-payment-mode';
import { type AnomalyKind, anomalyNote } from './anomalies';
import type { DemoWorld, ProductRuntime, StoreRuntime } from './context';
import { businessName, personName, phoneNumber } from './people';
import { catalogForBusinessType, type DemoCatalogProduct } from './catalogs';

type Tx = Prisma.TransactionClient;

/** Round to 2 dp — money is stored as Decimal; keep generated values clean. */
export function money(n: number): number {
    return Math.round(n * 100) / 100;
}

/** A paid (non-credit) sale eligible for a later return. */
interface ReturnableSale {
    saleId: string;
    storeId: string;
    warehouseId: string;
    paymentMode: string;
    items: Array<{ saleItemId: string; productId: string; quantity: number; price: number }>;
    epochDay: number;
    /** Set when an anomaly scheduled this whole invoice to come straight back. */
    forcedFullReturnOnEpochDay?: number;
}

interface ReturnablePurchase {
    purchaseId: string;
    supplierIndex: number;
    items: Array<{ purchaseItemId: string; productId: string; quantity: number; unitCost: number }>;
    epochDay: number;
    warehouseId: string;
}

/** A scheduled settlement of an outstanding credit sale. */
interface PendingSettlement {
    customerIndex: number;
    amount: number;
    settleOnEpochDay: number;
}

/** Line-level overrides, used to replay a sale verbatim (duplicate invoice). */
export interface SaleLineSpec {
    productId: string;
    quantity: number;
    price: number;
}

export interface SaleOverrides {
    /** Bends the sale into a deliberately odd shape and tags it for the demo. */
    anomaly?: AnomalyKind;
    /** Exact lines to write, instead of drawing a fresh basket. */
    lines?: SaleLineSpec[];
    /** Index into `world.customers`; -1 for a walk-in. */
    customerIndex?: number;
    paymentLabel?: string;
    /** Provenance, when this sale was raised off a quotation or a sales order. */
    quotationId?: string;
    salesOrderId?: string;
}

/** What a written sale turned out to be, so a caller can replay or return it. */
export interface SaleResult {
    saleId: string;
    serial: string;
    total: number;
    lines: SaleLineSpec[];
    customerIndex: number;
    paymentLabel: string;
}

const EXPENSE_CATEGORIES = ['Shop Rent', 'Utilities', 'Salaries', 'Transport', 'Miscellaneous'];

/** Round totals a large cash sale is forced onto, with quantities that divide them. */
const ROUND_SPIKE_TOTALS = [20000, 25000, 40000, 50000];
const ROUND_SPIKE_QUANTITIES = [1, 2, 4, 5, 10];

/**
 * Writes demo rows through the real inventory + accounting primitives, backdated.
 * Simulation state that must persist across the per-day transactions lives on the
 * shared `DemoWorld`; what stays here is the core writer's own bookkeeping —
 * which sales are still returnable, which credits are due when.
 */
export class DemoWriter {
    private shrinkageReasons: Array<{ id: string; code: string }> = [];

    private pendingSettlements: PendingSettlement[] = [];
    private returnableSales: ReturnableSale[] = [];
    private returnablePurchases: ReturnablePurchase[] = [];

    constructor(private readonly world: DemoWorld) {}

    get counts() {
        return this.world.counts;
    }

    private get catalog(): DemoCatalogProduct[] {
        return catalogForBusinessType(this.world.businessType).products;
    }

    /* ---------------------------------------------------------------- */
    /*  Setup — catalog, parties, opening stock                          */
    /* ---------------------------------------------------------------- */

    /** Ensure groups/subgroups/brands/products + ProductPrice rows exist. */
    async ensureCatalog(tx: Tx): Promise<void> {
        const { tenantId } = this.world;
        const groupIds = new Map<string, string>();
        const subgroupIds = new Map<string, string>();
        const brandIds = new Map<string, string>();
        // ProductPrice must be effective before the earliest sale, else
        // unit_cost_at_sale resolves null and every margin reads 100%.
        const priceEffectiveFrom = new Date(this.world.start.getTime() - 24 * 60 * 60 * 1000);

        for (const [index, def] of this.catalog.entries()) {
            const groupId = await this.upsertGroup(tx, tenantId, def.group, groupIds);
            const subgroupId = await this.upsertSubgroup(tx, tenantId, groupId, def.subgroup, subgroupIds);
            const brandId = def.brand ? await this.upsertBrand(tx, tenantId, def.brand, brandIds) : undefined;
            // A slice of the catalog carries a warranty so the warranty-claims
            // module has something to claim against.
            const warranted = index % 7 === 3;

            const product = await tx.product.upsert({
                where: { tenant_id_sku: { tenant_id: tenantId, sku: def.sku } },
                update: {
                    name: def.name, price: def.sellPrice, reorder_level: def.reorderLevel,
                    unit_type: def.unitType, group_id: groupId, subgroup_id: subgroupId, brand_id: brandId,
                    warranty_enabled: warranted, warranty_duration_days: warranted ? 365 : null,
                },
                create: {
                    tenant_id: tenantId, name: def.name, sku: def.sku, price: def.sellPrice,
                    reorder_level: def.reorderLevel, unit_type: def.unitType,
                    group_id: groupId, subgroup_id: subgroupId, brand_id: brandId,
                    warranty_enabled: warranted, warranty_duration_days: warranted ? 365 : null,
                },
            });

            await tx.productPrice.create({
                data: {
                    tenant_id: tenantId, product_id: product.id, price: def.sellPrice,
                    cost: def.purchaseCost, effective_from: priceEffectiveFrom,
                },
            });

            this.world.products.push({
                id: product.id, sku: def.sku, name: def.name, sellPrice: def.sellPrice,
                cost: def.purchaseCost, reorderLevel: def.reorderLevel,
                popularityWeight: def.popularityWeight, supplierIndex: index,
                warranty: warranted, stock: new Map(),
            });
        }
        this.counts.products = this.world.products.length;

        // Mirror any existing on-hand stock so in-memory == DB (append-safe).
        const existing = await tx.productStock.findMany({
            where: { tenant_id: tenantId },
            select: { product_id: true, warehouse_id: true, quantity: true },
        });
        const stockByProduct = new Map<string, Map<string, number>>();
        for (const row of existing) {
            if (!stockByProduct.has(row.product_id)) stockByProduct.set(row.product_id, new Map());
            stockByProduct.get(row.product_id)!.set(row.warehouse_id, row.quantity);
        }
        for (const p of this.world.products) {
            const mine = stockByProduct.get(p.id);
            for (const store of this.world.stores) {
                p.stock.set(store.warehouseId, mine?.get(store.warehouseId) ?? 0);
            }
        }
    }

    private async upsertGroup(tx: Tx, tenantId: string, name: string, cache: Map<string, string>): Promise<string> {
        if (cache.has(name)) return cache.get(name)!;
        const row = await tx.productGroup.upsert({
            where: { tenant_id_name: { tenant_id: tenantId, name } },
            update: {}, create: { tenant_id: tenantId, name },
        });
        cache.set(name, row.id);
        return row.id;
    }

    private async upsertSubgroup(tx: Tx, tenantId: string, groupId: string, name: string, cache: Map<string, string>): Promise<string> {
        const key = `${groupId}:${name}`;
        if (cache.has(key)) return cache.get(key)!;
        const row = await tx.productSubgroup.upsert({
            where: { group_id_name: { group_id: groupId, name } },
            update: {}, create: { tenant_id: tenantId, group_id: groupId, name },
        });
        cache.set(key, row.id);
        return row.id;
    }

    private async upsertBrand(tx: Tx, tenantId: string, name: string, cache: Map<string, string>): Promise<string> {
        if (cache.has(name)) return cache.get(name)!;
        const row = await tx.brand.upsert({
            where: { tenant_id_name: { tenant_id: tenantId, name } },
            update: {}, create: { tenant_id: tenantId, name },
        });
        cache.set(name, row.id);
        return row.id;
    }

    /** Ensure customers, suppliers, and expense categories. */
    async ensureParties(tx: Tx, customerCount: number, supplierCount: number): Promise<void> {
        const { tenantId, rng, batchNumber } = this.world;

        for (let i = 0; i < customerCount; i++) {
            const seq = batchNumber * 100000 + i;
            const creditLimit = 50000;
            const customer = await tx.customer.create({
                data: {
                    tenant_id: tenantId,
                    customer_code: `D${batchNumber}-CUS${String(i + 1).padStart(5, '0')}`,
                    name: personName(rng),
                    phone: phoneNumber(rng, seq),
                    customer_type: 'INDIVIDUAL',
                    credit_enabled: true,
                    credit_limit: creditLimit,
                },
            });
            this.world.customers.push({ id: customer.id, name: customer.name, due: 0, creditLimit, loyaltyPoints: 0 });
        }
        this.counts.customers = this.world.customers.length;

        for (let i = 0; i < supplierCount; i++) {
            const supplier = await tx.supplier.create({
                data: {
                    tenant_id: tenantId,
                    name: `${businessName(rng)} #${batchNumber}-${i + 1}`,
                    phone: phoneNumber(rng, batchNumber * 100000 + 90000 + i),
                },
            });
            this.world.suppliers.push({ id: supplier.id, name: supplier.name, due: 0 });
        }
        this.counts.suppliers = this.world.suppliers.length;

        for (const name of EXPENSE_CATEGORIES) {
            const cat = await tx.expenseCategory.upsert({
                where: { tenant_id_name: { tenant_id: tenantId, name } },
                update: {}, create: { tenant_id: tenantId, name },
            });
            this.world.expenseCategoryIds.set(name, cat.id);
        }
    }

    async loadShrinkageReasons(tx: Tx): Promise<void> {
        this.shrinkageReasons = await tx.inventoryReason.findMany({
            where: { tenant_id: this.world.tenantId, type: 'SHRINKAGE', is_active: true },
            select: { id: true, code: true },
        });
    }

    /** Day-0 opening purchases: one per supplier, backdated to the start. */
    async openingPurchases(tx: Tx, date: Date): Promise<void> {
        const bySupplier = new Map<number, ProductRuntime[]>();
        for (const p of this.world.products) {
            const idx = p.supplierIndex % this.world.suppliers.length;
            if (!bySupplier.has(idx)) bySupplier.set(idx, []);
            bySupplier.get(idx)!.push(p);
        }
        const mainStore = this.world.mainStore;
        for (const [supplierIndex, products] of bySupplier) {
            const lines = products.map((p) => ({
                product: p,
                // Open with enough stock to trade for weeks before reordering.
                quantity: p.reorderLevel * this.world.rng.int(3, 5),
            }));
            await this.writePurchase(tx, date, supplierIndex, mainStore, lines);
        }
    }

    /* ---------------------------------------------------------------- */
    /*  Purchases                                                        */
    /* ---------------------------------------------------------------- */

    async writePurchase(
        tx: Tx, date: Date, supplierIndex: number, store: StoreRuntime,
        lines: Array<{ product: ProductRuntime; quantity: number; unitCost?: number }>,
        anomaly?: AnomalyKind,
    ): Promise<{ purchaseId: string; purchaseNumber: string; total: number }> {
        const supplier = this.world.suppliers[supplierIndex % this.world.suppliers.length];
        const priced = lines.map((l) => ({ ...l, unitCost: money(l.unitCost ?? l.product.cost) }));
        const total = money(priced.reduce((s, l) => s + l.unitCost * l.quantity, 0));
        const purchaseNumber = this.world.ref('PUR');

        const purchase = await tx.purchase.create({
            data: {
                tenant_id: this.world.tenantId,
                store_id: store.storeId,
                supplier_id: supplier.id,
                purchase_number: purchaseNumber,
                subtotal_amount: total,
                total_amount: total,
                paid_amount: 0,
                payment_status: 'UNPAID',
                notes: anomaly ? anomalyNote(anomaly) : undefined,
                created_by: this.world.userId,
                created_at: date,
                items: {
                    create: priced.map((l) => ({
                        product_id: l.product.id,
                        quantity: l.quantity,
                        unit_cost: l.unitCost,
                        line_total: money(l.unitCost * l.quantity),
                    })),
                },
            },
            include: { items: true },
        });

        for (const line of priced) {
            await applyInventoryMovement(tx, {
                tenantId: this.world.tenantId,
                productId: line.product.id,
                warehouseId: store.warehouseId,
                quantityDelta: line.quantity,
                movementType: 'PURCHASE_RECEIPT',
                referenceType: 'PURCHASE',
                referenceId: purchase.id,
                unitCost: line.unitCost,
                occurredAt: date,
            });
            line.product.stock.set(store.warehouseId, (line.product.stock.get(store.warehouseId) ?? 0) + line.quantity);
        }

        // Every purchase is booked as a payable (the model has no cash-purchase rule).
        const balanceAfter = money(supplier.due + total);
        await tx.supplierCreditTransaction.create({
            data: {
                tenant_id: this.world.tenantId,
                supplier_id: supplier.id,
                type: 'CREDIT_PURCHASE',
                amount: total,
                balance_after: balanceAfter,
                reference_type: 'PURCHASE',
                reference_id: purchase.id,
                created_by: this.world.userId,
                created_at: date,
            },
        });
        supplier.due = balanceAfter;
        await tx.supplier.update({ where: { id: supplier.id }, data: { due_balance: balanceAfter } });

        await autoPostFromRules({
            tx,
            tenantId: this.world.tenantId,
            eventType: 'purchase',
            conditionKey: 'payment_mode',
            conditionValue: 'credit',
            sourceModule: 'purchases',
            sourceType: 'purchase',
            sourceId: purchase.id,
            amount: total,
            description: `Auto-posted purchase ${purchaseNumber}`,
            referenceNumber: purchaseNumber,
            date,
            storeId: store.storeId,
            partyType: 'SUPPLIER',
            partyId: supplier.id,
        });
        this.counts.purchases++;

        // Keep recent purchases available for a possible return.
        this.returnablePurchases.push({
            purchaseId: purchase.id,
            supplierIndex,
            warehouseId: store.warehouseId,
            epochDay: Math.floor(date.getTime() / 86400000),
            items: purchase.items.map((it) => ({
                purchaseItemId: it.id, productId: it.product_id, quantity: it.quantity, unitCost: Number(it.unit_cost),
            })),
        });
        if (this.returnablePurchases.length > 40) this.returnablePurchases.shift();

        return { purchaseId: purchase.id, purchaseNumber, total };
    }

    /** Replenish one product from its assigned supplier when stock runs low. */
    async reorderIfNeeded(tx: Tx, date: Date, product: ProductRuntime, store: StoreRuntime): Promise<void> {
        const onHand = product.stock.get(store.warehouseId) ?? 0;
        if (onHand > product.reorderLevel) return;
        const quantity = product.reorderLevel * this.world.rng.int(3, 5);
        await this.writePurchase(tx, date, product.supplierIndex, store, [{ product, quantity }]);
    }

    /** Buy in whatever it takes to have `wanted` units on hand at this store. */
    private async ensureStock(tx: Tx, date: Date, product: ProductRuntime, store: StoreRuntime, wanted: number): Promise<void> {
        const onHand = product.stock.get(store.warehouseId) ?? 0;
        if (onHand >= wanted) return;
        await this.writePurchase(tx, date, product.supplierIndex, store, [
            { product, quantity: wanted - onHand + product.reorderLevel },
        ]);
    }

    /**
     * A supplier bills the same goods at a far higher unit cost than usual — the
     * overcharge a purchase-price-variance report exists to catch.
     */
    async writeSupplierPriceSpike(tx: Tx, date: Date, store: StoreRuntime): Promise<void> {
        const rng = this.world.rng;
        const product = rng.pick(this.world.products);
        const inflated = money(product.cost * rng.range(2.3, 2.9));
        const quantity = rng.int(4, 12);
        const result = await this.writePurchase(
            tx, date, product.supplierIndex, store,
            [{ product, quantity, unitCost: inflated }],
            'SUPPLIER_PRICE_SPIKE',
        );
        this.recordAnomaly('SUPPLIER_PRICE_SPIKE', date, 'Purchase', result.purchaseId, result.purchaseNumber,
            `${product.name} billed at ৳${inflated.toFixed(2)}/unit against a usual ৳${product.cost.toFixed(2)}.`);
    }

    /** The same bill keyed twice on one day — paid twice unless someone notices. */
    async writeDuplicateSupplierBill(tx: Tx, date: Date, store: StoreRuntime): Promise<void> {
        const rng = this.world.rng;
        const product = rng.pick(this.world.products);
        const quantity = rng.int(5, 20);
        const first = await this.writePurchase(tx, date, product.supplierIndex, store, [{ product, quantity }]);
        const second = await this.writePurchase(
            tx, new Date(date.getTime() + 40 * 60_000), product.supplierIndex, store,
            [{ product, quantity }], 'DUPLICATE_SUPPLIER_BILL',
        );
        this.recordAnomaly('DUPLICATE_SUPPLIER_BILL', date, 'Purchase', second.purchaseId, second.purchaseNumber,
            `Identical to ${first.purchaseNumber} — same supplier, same day, both ৳${second.total.toFixed(2)}.`);
    }

    /* ---------------------------------------------------------------- */
    /*  Sales                                                            */
    /* ---------------------------------------------------------------- */

    async writeSale(tx: Tx, date: Date, store: StoreRuntime, growth: number, overrides?: SaleOverrides): Promise<SaleResult | null> {
        const rng = this.world.rng;
        const anomaly = overrides?.anomaly;
        let lines: Array<{ product: ProductRuntime; quantity: number; price: number }>;

        if (overrides?.lines) {
            // Replaying an exact basket (duplicate invoice). Skip if the stock is
            // no longer there — a demo anomaly must never drive stock negative.
            lines = [];
            for (const spec of overrides.lines) {
                const product = this.world.products.find((p) => p.id === spec.productId);
                if (!product) continue;
                if ((product.stock.get(store.warehouseId) ?? 0) < spec.quantity) return null;
                lines.push({ product, quantity: spec.quantity, price: spec.price });
            }
            if (lines.length === 0) return null;
        } else if (anomaly === 'ROUND_NUMBER_CASH_SPIKE') {
            const target = rng.pick(ROUND_SPIKE_TOTALS);
            const quantity = rng.pick(ROUND_SPIKE_QUANTITIES);
            const product = rng.pick(this.world.products);
            await this.ensureStock(tx, date, product, store, quantity);
            lines = [{ product, quantity, price: money(target / quantity) }];
        } else if (anomaly === 'CREDIT_LIMIT_BREACH') {
            // Size the basket so the customer's balance ends up over their limit.
            const customer = this.world.customers[overrides?.customerIndex ?? 0];
            const headroom = Math.max(1000, customer.creditLimit - customer.due);
            const product = [...this.world.products].sort((a, b) => b.sellPrice - a.sellPrice)[0];
            const quantity = Math.max(1, Math.ceil((headroom * 1.35) / product.sellPrice));
            await this.ensureStock(tx, date, product, store, quantity);
            lines = [{ product, quantity, price: product.sellPrice }];
        } else {
            const itemCount = rng.weighted([1, 2, 3, 4, 5], [40, 28, 18, 9, 5]);
            const chosen = new Map<string, number>();

            for (let i = 0; i < itemCount; i++) {
                const product = rng.weighted(this.world.products, this.world.products.map((p) => p.popularityWeight));
                const qty = rng.weighted([1, 2, 3, 5, 10], [55, 25, 12, 5, 3]);
                // Ensure stock; reorder if the line can't be satisfied.
                await this.reorderIfNeeded(tx, date, product, store);
                const onHand = product.stock.get(store.warehouseId) ?? 0;
                const sellable = Math.min(qty, onHand);
                if (sellable <= 0) continue;
                chosen.set(product.id, (chosen.get(product.id) ?? 0) + sellable);
            }
            if (chosen.size === 0) return null;

            lines = [...chosen.entries()].map(([productId, quantity]) => {
                const product = this.world.products.find((p) => p.id === productId)!;
                let price = product.sellPrice;
                if (anomaly === 'BELOW_COST_SALE') price = money(product.cost * rng.range(0.7, 0.85));
                if (anomaly === 'DEEP_DISCOUNT_SALE') price = money(product.sellPrice * rng.range(0.35, 0.45));
                return { product, quantity, price };
            });
        }

        const total = money(lines.reduce((s, l) => s + l.price * l.quantity, 0));

        // ~40% named customers; of those ~15% buy on full credit (settled later).
        // The generator uses full credit (not partial) for simplicity — one
        // balanced voucher. (sales.service now handles a partial down-payment
        // correctly via legKey, so this is a generator choice, not a workaround.)
        const forcedCustomer = overrides?.customerIndex !== undefined;
        const named = forcedCustomer ? overrides!.customerIndex! >= 0 : rng.chance(0.4);
        const customerIndex = forcedCustomer
            ? overrides!.customerIndex!
            : (named ? rng.int(0, this.world.customers.length - 1) : -1);
        const onCredit = anomaly === 'CREDIT_LIMIT_BREACH' || anomaly === 'STALE_CREDIT_DEBT'
            ? true
            : (overrides?.paymentLabel ? overrides.paymentLabel === 'Credit' : named && rng.chance(0.15));
        const amountPaid = onCredit ? 0 : total;
        const balanceDue = money(Math.max(0, total - amountPaid));

        const paymentLabel = onCredit
            ? 'Credit'
            : (overrides?.paymentLabel
                ?? (anomaly === 'ROUND_NUMBER_CASH_SPIKE' ? 'Cash' : rng.weighted(['Cash', 'bKash', 'Nagad', 'Card'], [55, 20, 12, 13])));
        const paidMode = classifyPaymentMode(paymentLabel);
        const serial = this.world.ref('S');

        const sale = await tx.sale.create({
            data: {
                tenant_id: this.world.tenantId,
                store_id: store.storeId,
                serial_number: serial,
                total_amount: total,
                amount_paid: amountPaid,
                status: 'COMPLETED',
                note: anomaly ? anomalyNote(anomaly) : undefined,
                quotation_id: overrides?.quotationId,
                sales_order_id: overrides?.salesOrderId,
                customer_id: customerIndex >= 0 ? this.world.customers[customerIndex].id : null,
                created_by: this.world.userId,
                sale_date: date,
                created_at: date,
                items: {
                    create: lines.map((l) => ({
                        product_id: l.product.id,
                        quantity: l.quantity,
                        price_at_sale: l.price,
                        unit_cost_at_sale: l.product.cost,
                    })),
                },
            },
            include: { items: true },
        });

        if (amountPaid > 0.005) {
            await tx.paymentRecord.create({
                data: { sale_id: sale.id, payment_method: paymentLabel, amount: amountPaid, created_at: date },
            });
        }

        for (const l of lines) {
            await applyInventoryMovement(tx, {
                tenantId: this.world.tenantId,
                productId: l.product.id,
                warehouseId: store.warehouseId,
                quantityDelta: -l.quantity,
                movementType: 'SALE',
                referenceType: 'SALE',
                referenceId: sale.id,
                unitCost: l.product.cost,
                occurredAt: date,
            });
            l.product.stock.set(store.warehouseId, (l.product.stock.get(store.warehouseId) ?? 0) - l.quantity);
        }

        // Posting: a single balanced voucher (credit → Dr AR / Cr Sales, else → Dr <mode> / Cr Sales).
        if (balanceDue > 0.005 && customerIndex >= 0) {
            const customer = this.world.customers[customerIndex];
            await this.postSale(tx, date, sale.id, serial, 'credit', balanceDue, store.storeId, customer.id);
            const balanceAfter = money(customer.due + balanceDue);
            await tx.customerCreditTransaction.create({
                data: {
                    tenant_id: this.world.tenantId, customer_id: customer.id, type: 'CREDIT_SALE',
                    amount: balanceDue, balance_after: balanceAfter,
                    reference_type: 'SALE', reference_id: sale.id, created_by: this.world.userId, created_at: date,
                },
            });
            customer.due = balanceAfter;
            await tx.customer.update({ where: { id: customer.id }, data: { due_balance: balanceAfter, total_spent: { increment: total } } });
            // Settle 3–45 days later — unless this one is meant to go stale, in
            // which case it is scheduled past the end of the window and never does.
            const settleDelay = anomaly === 'STALE_CREDIT_DEBT' ? 100_000 : rng.int(3, 45);
            this.pendingSettlements.push({
                customerIndex, amount: balanceDue,
                settleOnEpochDay: Math.floor(date.getTime() / 86400000) + settleDelay,
            });
            this.counts.creditSales++;

            if (anomaly === 'CREDIT_LIMIT_BREACH') {
                this.recordAnomaly('CREDIT_LIMIT_BREACH', date, 'Sale', sale.id, serial,
                    `${customer.name} now owes ৳${balanceAfter.toFixed(2)} against a ৳${customer.creditLimit.toFixed(2)} limit.`);
            }
            if (anomaly === 'STALE_CREDIT_DEBT') {
                this.recordAnomaly('STALE_CREDIT_DEBT', date, 'Sale', sale.id, serial,
                    `৳${balanceDue.toFixed(2)} owed by ${customer.name} is never settled inside the window.`);
            }
        } else {
            await this.postSale(tx, date, sale.id, serial, paidMode, total, store.storeId);
            if (customerIndex >= 0) {
                await tx.customer.update({ where: { id: this.world.customers[customerIndex].id }, data: { total_spent: { increment: total } } });
            }
            // Fully-paid sales are eligible for a rare return.
            this.returnableSales.push({
                saleId: sale.id, storeId: store.storeId, warehouseId: store.warehouseId, paymentMode: paidMode,
                epochDay: Math.floor(date.getTime() / 86400000),
                items: sale.items.map((it) => ({ saleItemId: it.id, productId: it.product_id, quantity: it.quantity, price: Number(it.price_at_sale) })),
                forcedFullReturnOnEpochDay: anomaly === 'RAPID_FULL_RETURN'
                    ? Math.floor(date.getTime() / 86400000) + 1
                    : undefined,
            });
            if (this.returnableSales.length > 60) this.returnableSales.shift();
        }
        this.counts.sales++;

        const result: SaleResult = {
            saleId: sale.id,
            serial,
            total,
            lines: lines.map((l) => ({ productId: l.product.id, quantity: l.quantity, price: l.price })),
            customerIndex,
            paymentLabel,
        };

        this.recordSaleAnomaly(anomaly, date, result, lines);
        this.world.recordSaleForFollowUp({
            saleId: sale.id, serial, total, storeId: store.storeId, warehouseId: store.warehouseId,
            customerIndex, date, productIds: lines.map((l) => l.product.id),
        });
        return result;
    }

    /** The sale-shaped anomalies that are fully described by the row just written. */
    private recordSaleAnomaly(
        anomaly: AnomalyKind | undefined, date: Date, result: SaleResult,
        lines: Array<{ product: ProductRuntime; quantity: number; price: number }>,
    ): void {
        if (!anomaly) return;
        const first = lines[0];
        switch (anomaly) {
            case 'BELOW_COST_SALE':
                this.recordAnomaly(anomaly, date, 'Sale', result.saleId, result.serial,
                    `${first.product.name} sold at ৳${first.price.toFixed(2)} against a ৳${first.product.cost.toFixed(2)} cost.`);
                break;
            case 'DEEP_DISCOUNT_SALE':
                this.recordAnomaly(anomaly, date, 'Sale', result.saleId, result.serial,
                    `${first.product.name} sold at ৳${first.price.toFixed(2)} against a ৳${first.product.sellPrice.toFixed(2)} list price.`);
                break;
            case 'AFTER_HOURS_SALE':
                this.recordAnomaly(anomaly, date, 'Sale', result.saleId, result.serial,
                    `Rung up at ${date.toISOString().slice(11, 16)} UTC, hours outside the 10:00–20:00 trading day.`);
                break;
            case 'ROUND_NUMBER_CASH_SPIKE':
                this.recordAnomaly(anomaly, date, 'Sale', result.saleId, result.serial,
                    `Cash sale of exactly ৳${result.total.toFixed(2)} — far above the usual basket.`);
                break;
            case 'RAPID_FULL_RETURN':
                this.recordAnomaly(anomaly, date, 'Sale', result.saleId, result.serial,
                    `৳${result.total.toFixed(2)} invoice returned in full the next day.`);
                break;
            default:
                // Credit anomalies are recorded on the credit branch, where the
                // resulting balance is known; duplicates by their caller.
                break;
        }
    }

    /** Ring the same basket up twice, minutes apart — the classic double-charge. */
    async writeDuplicateInvoice(tx: Tx, date: Date, store: StoreRuntime, growth: number): Promise<void> {
        const first = await this.writeSale(tx, date, store, growth, { customerIndex: this.world.rng.int(0, this.world.customers.length - 1) });
        if (!first) return;
        const repeatAt = this.world.clampToWindow(new Date(date.getTime() + this.world.rng.int(3, 9) * 60_000));
        const second = await this.writeSale(tx, repeatAt, store, growth, {
            anomaly: 'DUPLICATE_INVOICE',
            lines: first.lines,
            customerIndex: first.customerIndex,
            paymentLabel: first.paymentLabel,
        });
        if (!second) return;
        this.recordAnomaly('DUPLICATE_INVOICE', repeatAt, 'Sale', second.saleId, second.serial,
            `Same customer, same lines and same ৳${second.total.toFixed(2)} total as ${first.serial}, minutes apart.`);
    }

    private async postSale(
        tx: Tx, date: Date, saleId: string, serial: string, mode: string, amount: number, storeId: string,
        customerId?: string,
    ): Promise<void> {
        await autoPostFromRules({
            tx,
            tenantId: this.world.tenantId,
            eventType: 'sale',
            conditionKey: 'payment_mode',
            conditionValue: mode,
            sourceModule: 'sales',
            sourceType: 'sale',
            sourceId: saleId,
            amount,
            description: `Auto-posted sale ${serial}`,
            referenceNumber: serial,
            date,
            storeId,
            // Only the credit sale's AR leg is a control account; tags nothing on
            // a cash sale, so the undefined default is fine there.
            partyType: 'CUSTOMER',
            partyId: customerId,
        });
    }

    /* ---------------------------------------------------------------- */
    /*  Credit settlements + supplier payments                           */
    /* ---------------------------------------------------------------- */

    async settleDueCredits(tx: Tx, date: Date, epochDay: number): Promise<void> {
        const due = this.pendingSettlements.filter((s) => s.settleOnEpochDay <= epochDay);
        this.pendingSettlements = this.pendingSettlements.filter((s) => s.settleOnEpochDay > epochDay);
        for (const settlement of due) {
            const customer = this.world.customers[settlement.customerIndex];
            const amount = money(Math.min(settlement.amount, customer.due));
            if (amount <= 0.005) continue;
            const balanceAfter = money(customer.due - amount);
            const paymentNumber = this.world.ref('CPY');
            const payment = await tx.customerCreditTransaction.create({
                data: {
                    tenant_id: this.world.tenantId, customer_id: customer.id, type: 'PAYMENT',
                    amount, balance_after: balanceAfter, payment_number: paymentNumber,
                    notes: 'Demo credit settlement', created_by: this.world.userId, created_at: date,
                },
            });
            customer.due = balanceAfter;
            await tx.customer.update({ where: { id: customer.id }, data: { due_balance: balanceAfter } });
            await autoPostFromRules({
                tx,
                tenantId: this.world.tenantId,
                eventType: 'customer_payment',
                conditionKey: 'payment_direction',
                conditionValue: 'receive',
                sourceModule: 'customers',
                sourceType: 'customer_payment',
                sourceId: payment.id,
                amount,
                description: `Customer payment — ${customer.name}`,
                referenceNumber: paymentNumber,
                date,
                storeId: this.world.mainStore.storeId,
                partyType: 'CUSTOMER',
                partyId: customer.id,
            });
            this.counts.customerPayments++;
        }
    }

    /**
     * Pay down a supplier's balance, posting Dr Purchase Payable / Cr Cash.
     * With `overpay`, the payment deliberately exceeds what is owed and the
     * payable goes into debit — money we now have to chase back.
     */
    async paySuppliers(tx: Tx, date: Date, overpay = false): Promise<void> {
        const rng = this.world.rng;
        if (!overpay && !rng.chance(0.3)) return;
        const owing = this.world.suppliers.filter((s) => s.due > 100);
        if (owing.length === 0) return;
        const supplier = rng.pick(owing);
        const amount = money(overpay ? supplier.due * rng.range(1.15, 1.4) : supplier.due * rng.range(0.4, 1));
        const balanceAfter = money(supplier.due - amount);
        const paymentNumber = this.world.ref('SPY');
        const payment = await tx.supplierCreditTransaction.create({
            data: {
                tenant_id: this.world.tenantId, supplier_id: supplier.id, type: 'PAYMENT',
                amount, balance_after: balanceAfter, payment_number: paymentNumber,
                notes: overpay ? anomalyNote('SUPPLIER_OVERPAYMENT') : 'Demo supplier payment',
                created_by: this.world.userId, created_at: date,
            },
        });
        supplier.due = balanceAfter;
        await tx.supplier.update({ where: { id: supplier.id }, data: { due_balance: balanceAfter } });
        await autoPostFromRules({
            tx,
            tenantId: this.world.tenantId,
            eventType: 'supplier_payment',
            conditionKey: 'payment_direction',
            conditionValue: 'pay',
            sourceModule: 'suppliers',
            sourceType: 'supplier_payment',
            sourceId: payment.id,
            amount,
            description: `Supplier payment — ${supplier.name}`,
            referenceNumber: paymentNumber,
            date,
            storeId: this.world.mainStore.storeId,
            partyType: 'SUPPLIER',
            partyId: supplier.id,
        });
        this.counts.supplierPayments++;

        if (overpay) {
            this.recordAnomaly('SUPPLIER_OVERPAYMENT', date, 'SupplierCreditTransaction', payment.id, paymentNumber,
                `Paid ৳${amount.toFixed(2)} to ${supplier.name}; the payable is now ৳${balanceAfter.toFixed(2)}.`);
        }
    }

    /* ---------------------------------------------------------------- */
    /*  Expenses                                                         */
    /* ---------------------------------------------------------------- */

    async writeExpense(tx: Tx, date: Date, categoryName: string, amount: number, bank: boolean, anomaly?: AnomalyKind): Promise<void> {
        const categoryId = this.world.expenseCategoryIds.get(categoryName);
        if (!categoryId) return;
        const store = this.world.mainStore;
        const paymentMode = bank ? 'bank' : 'cash';
        const entry = await tx.expenseEntry.create({
            data: {
                tenant_id: this.world.tenantId,
                category_id: categoryId,
                amount: money(amount),
                expense_date: date,
                description: anomaly ? `${categoryName} — ${anomalyNote(anomaly)}` : `${categoryName} — demo`,
                payment_method: bank ? 'BANK' : 'CASH',
                store_id: store.storeId,
                created_by: this.world.userId,
                created_at: date,
            },
        });
        await autoPostFromRules({
            tx,
            tenantId: this.world.tenantId,
            eventType: 'expense',
            conditionKey: 'payment_mode',
            conditionValue: paymentMode,
            sourceModule: 'expenses',
            sourceType: 'expense_entry',
            sourceId: entry.id,
            amount: money(amount),
            description: `Auto-posted expense: ${categoryName}`,
            date,
            storeId: store.storeId,
        });
        this.counts.expenses++;

        if (anomaly === 'EXPENSE_SPIKE') {
            this.recordAnomaly(anomaly, date, 'ExpenseEntry', entry.id, undefined,
                `${categoryName} of ৳${money(amount).toFixed(2)} — several times the usual month.`);
        }
    }

    /** One expense far above its category's usual level. */
    async writeExpenseSpike(tx: Tx, date: Date): Promise<void> {
        const rng = this.world.rng;
        const categoryName = rng.pick(['Transport', 'Utilities', 'Miscellaneous']);
        await this.writeExpense(tx, date, categoryName, rng.int(45000, 90000), false, 'EXPENSE_SPIKE');
    }

    /* ---------------------------------------------------------------- */
    /*  Returns                                                          */
    /* ---------------------------------------------------------------- */

    async maybeSalesReturn(tx: Tx, date: Date, epochDay: number): Promise<void> {
        const rng = this.world.rng;
        // An invoice an anomaly marked for a same-week full return takes priority;
        // otherwise ~2% of paid sales come back within days, one line at a time.
        const forced = this.returnableSales.find((s) => s.forcedFullReturnOnEpochDay != null && s.forcedFullReturnOnEpochDay <= epochDay);
        const candidate = forced
            ?? this.returnableSales.find((s) => epochDay - s.epochDay >= 1 && epochDay - s.epochDay <= 7 && rng.chance(0.02));
        if (!candidate) return;
        this.returnableSales = this.returnableSales.filter((s) => s !== candidate);

        const returnedItems = forced
            ? candidate.items.map((item) => ({ item, qty: item.quantity }))
            : (() => {
                const item = rng.pick(candidate.items);
                return [{ item, qty: rng.int(1, item.quantity) }];
            })();
        const refund = money(returnedItems.reduce((s, r) => s + r.item.price * r.qty, 0));
        const returnNumber = this.world.ref('RS');

        const salesReturn = await tx.salesReturn.create({
            data: {
                tenant_id: this.world.tenantId, store_id: candidate.storeId, sale_id: candidate.saleId,
                return_number: returnNumber, total_refund: refund,
                reason: forced ? anomalyNote('RAPID_FULL_RETURN') : 'Demo return',
                status: 'COMPLETED', created_by: this.world.userId, created_at: date,
                items: {
                    create: returnedItems.map((r) => ({
                        sale_item_id: r.item.saleItemId, product_id: r.item.productId,
                        quantity: r.qty, refund_amount: money(r.item.price * r.qty),
                    })),
                },
            },
        });
        for (const { item, qty } of returnedItems) {
            const product = this.world.products.find((p) => p.id === item.productId);
            await applyInventoryMovement(tx, {
                tenantId: this.world.tenantId, productId: item.productId, warehouseId: candidate.warehouseId,
                quantityDelta: qty, movementType: 'SALES_RETURN', referenceType: 'SALES_RETURN',
                referenceId: salesReturn.id, unitCost: product?.cost, occurredAt: date,
            });
            if (product) product.stock.set(candidate.warehouseId, (product.stock.get(candidate.warehouseId) ?? 0) + qty);
        }

        await autoPostFromRules({
            tx, tenantId: this.world.tenantId, eventType: 'sale_return', conditionKey: 'payment_mode',
            conditionValue: candidate.paymentMode, sourceModule: 'sales', sourceType: 'sale_return',
            sourceId: salesReturn.id, amount: refund, description: `Auto-posted sales return ${returnNumber}`,
            referenceNumber: returnNumber, date, storeId: candidate.storeId,
        });
        this.counts.salesReturns++;
    }

    async maybePurchaseReturn(tx: Tx, date: Date, epochDay: number): Promise<void> {
        const rng = this.world.rng;
        // ~3% of purchases are returned within days.
        const candidate = this.returnablePurchases.find((p) => epochDay - p.epochDay >= 1 && epochDay - p.epochDay <= 10 && rng.chance(0.03));
        if (!candidate) return;
        this.returnablePurchases = this.returnablePurchases.filter((p) => p !== candidate);

        const item = rng.pick(candidate.items);
        const product = this.world.products.find((p) => p.id === item.productId);
        const onHand = product?.stock.get(candidate.warehouseId) ?? 0;
        const qty = Math.min(rng.int(1, item.quantity), onHand);
        if (qty <= 0) return;
        const lineTotal = money(item.unitCost * qty);
        const returnNumber = this.world.ref('RP');

        const purchaseReturn = await tx.purchaseReturn.create({
            data: {
                tenant_id: this.world.tenantId, store_id: this.world.mainStore.storeId, purchase_id: candidate.purchaseId,
                supplier_id: this.world.suppliers[candidate.supplierIndex % this.world.suppliers.length].id,
                return_number: returnNumber, total_amount: lineTotal, status: 'RECORDED',
                created_by: this.world.userId, created_at: date,
                items: { create: [{ purchase_item_id: item.purchaseItemId, product_id: item.productId, quantity: qty, unit_cost: item.unitCost, line_total: lineTotal }] },
            },
        });
        await applyInventoryMovement(tx, {
            tenantId: this.world.tenantId, productId: item.productId, warehouseId: candidate.warehouseId,
            quantityDelta: -qty, movementType: 'PURCHASE_RETURN', referenceType: 'PURCHASE_RETURN',
            referenceId: purchaseReturn.id, unitCost: item.unitCost, occurredAt: date,
        });
        if (product) product.stock.set(candidate.warehouseId, onHand - qty);

        // Returning payable goods reduces what we owe the supplier. Clamp the
        // credit-ledger reduction to what is actually owed — matching
        // purchase-returns.service (creditReduction = min(total, due)). The earlier
        // form recorded the full -lineTotal in the ledger while flooring due_balance
        // at 0, so an over-return left the two out of sync (an intermittent
        // reconciliation failure whenever a return exceeded a supplier's balance).
        const supplier = this.world.suppliers[candidate.supplierIndex % this.world.suppliers.length];
        const creditReduction = money(Math.min(lineTotal, supplier.due));
        if (creditReduction > 0.005) {
            const balanceAfter = money(supplier.due - creditReduction);
            await tx.supplierCreditTransaction.create({
                data: {
                    tenant_id: this.world.tenantId, supplier_id: supplier.id, type: 'ADJUSTMENT',
                    amount: -creditReduction, balance_after: balanceAfter, reference_type: 'PURCHASE_RETURN',
                    reference_id: purchaseReturn.id, notes: 'Demo purchase return', created_by: this.world.userId, created_at: date,
                },
            });
            supplier.due = balanceAfter;
            await tx.supplier.update({ where: { id: supplier.id }, data: { due_balance: balanceAfter } });
        }

        await autoPostFromRules({
            tx, tenantId: this.world.tenantId, eventType: 'purchase_return', conditionKey: 'none',
            conditionValue: null, sourceModule: 'purchases', sourceType: 'purchase_return',
            sourceId: purchaseReturn.id, amount: lineTotal, description: `Auto-posted purchase return ${returnNumber}`,
            referenceNumber: returnNumber, date, storeId: this.world.mainStore.storeId,
            partyType: 'SUPPLIER', partyId: supplier.id,
        });
        this.counts.purchaseReturns++;
    }

    /* ---------------------------------------------------------------- */
    /*  Inventory ops                                                    */
    /* ---------------------------------------------------------------- */

    /**
     * Transfer stock Main → second store. fund_movement has no rule, so nothing
     * posts. With `roundTrip`, the same quantity comes straight back the same day
     * — movement with no purpose, and a sign of stock being covered up.
     */
    async maybeTransfer(tx: Tx, date: Date, roundTrip = false): Promise<void> {
        const rng = this.world.rng;
        const main = this.world.mainStore;
        const other = this.world.secondStore;
        if (!other || (!roundTrip && !rng.chance(0.5))) return;

        const product = rng.pick(this.world.products);
        const onHand = product.stock.get(main.warehouseId) ?? 0;
        const qty = Math.min(rng.int(2, 10), Math.max(0, onHand - product.reorderLevel));
        if (qty <= 0) return;

        const outbound = await this.writeTransfer(tx, date, main, other, product, qty);
        if (!roundTrip) return;

        const backAt = this.world.clampToWindow(new Date(date.getTime() + 4 * 3_600_000));
        await this.writeTransfer(tx, backAt, other, main, product, qty);
        this.recordAnomaly('ROUND_TRIP_TRANSFER', date, 'WarehouseTransfer', outbound.id, outbound.number,
            `${qty} × ${product.name} left the main store and came back the same day.`);
    }

    private async writeTransfer(
        tx: Tx, date: Date, from: StoreRuntime, to: StoreRuntime, product: ProductRuntime, qty: number,
    ): Promise<{ id: string; number: string }> {
        const transferNumber = this.world.ref('TRF');
        const transfer = await tx.warehouseTransfer.create({
            data: {
                tenant_id: this.world.tenantId, transfer_number: transferNumber,
                source_warehouse_id: from.warehouseId, destination_warehouse_id: to.warehouseId,
                source_store_id: from.storeId, destination_store_id: to.storeId,
                status: 'RECEIVED', is_cross_branch: true, sent_at: date, received_at: date, created_at: date,
                items: { create: [{ product_id: product.id, quantity_sent: qty, quantity_received: qty }] },
            },
        });
        await applyInventoryMovement(tx, {
            tenantId: this.world.tenantId, productId: product.id, warehouseId: from.warehouseId,
            quantityDelta: -qty, movementType: 'TRANSFER_OUT', referenceType: 'WAREHOUSE_TRANSFER',
            referenceId: transfer.id, occurredAt: date,
        });
        await applyInventoryMovement(tx, {
            tenantId: this.world.tenantId, productId: product.id, warehouseId: to.warehouseId,
            quantityDelta: qty, movementType: 'TRANSFER_IN', referenceType: 'WAREHOUSE_TRANSFER',
            referenceId: transfer.id, occurredAt: date,
        });
        product.stock.set(from.warehouseId, (product.stock.get(from.warehouseId) ?? 0) - qty);
        product.stock.set(to.warehouseId, (product.stock.get(to.warehouseId) ?? 0) + qty);
        this.counts.transfers++;
        return { id: transfer.id, number: transferNumber };
    }

    /**
     * Write off a little stock. inventory_adjustment has no rule, so nothing
     * posts. With `large`, one write-off dwarfs the routine ones.
     */
    async maybeShrinkage(tx: Tx, date: Date, large = false): Promise<void> {
        const rng = this.world.rng;
        if (this.shrinkageReasons.length === 0 || (!large && !rng.chance(0.15))) return;
        const store = rng.pick(this.world.stores);
        const product = large
            ? [...this.world.products].sort(
                (a, b) => (b.stock.get(store.warehouseId) ?? 0) - (a.stock.get(store.warehouseId) ?? 0),
            )[0]
            : rng.pick(this.world.products);
        const onHand = product.stock.get(store.warehouseId) ?? 0;
        const qty = Math.min(large ? rng.int(25, 60) : rng.int(1, 3), onHand);
        if (qty <= 0) return;
        const reason = rng.pick(this.shrinkageReasons);
        const referenceNumber = this.world.ref('SHR');

        const shrinkage = await tx.inventoryShrinkage.create({
            data: {
                tenant_id: this.world.tenantId, warehouse_id: store.warehouseId, reason_id: reason.id,
                reference_number: referenceNumber, created_at: date,
                notes: large ? anomalyNote('LARGE_SHRINKAGE') : undefined,
                items: { create: [{ product_id: product.id, quantity: qty, unit_cost: product.cost }] },
            },
        });
        await applyInventoryMovement(tx, {
            tenantId: this.world.tenantId, productId: product.id, warehouseId: store.warehouseId,
            quantityDelta: -qty, movementType: 'SHRINKAGE', referenceType: 'INVENTORY_SHRINKAGE',
            referenceId: shrinkage.id, unitCost: product.cost, occurredAt: date,
        });
        product.stock.set(store.warehouseId, onHand - qty);
        await autoPostFromRules({
            tx, tenantId: this.world.tenantId, eventType: 'inventory_adjustment', conditionKey: 'reason_type',
            conditionValue: reason.code, sourceModule: 'inventory', sourceType: 'shrinkage',
            sourceId: shrinkage.id, amount: money(product.cost * qty),
            description: `Auto-posted shrinkage ${referenceNumber}`, referenceNumber, date, storeId: store.storeId,
        });
        this.counts.shrinkages++;

        if (large) {
            this.recordAnomaly('LARGE_SHRINKAGE', date, 'InventoryShrinkage', shrinkage.id, referenceNumber,
                `${qty} × ${product.name} written off as ${reason.code} in one go (৳${money(product.cost * qty).toFixed(2)}).`);
        }
    }

    /**
     * A quarterly stock take with small (sub-threshold) variances. With
     * `bigVariance`, one line is off by far more than a miscount would explain.
     */
    async writeStockTake(tx: Tx, date: Date, store: StoreRuntime, bigVariance = false): Promise<void> {
        const rng = this.world.rng;
        const sessionNumber = this.world.ref('STK');
        const sample = rng.shuffle(this.world.products).slice(0, 10);
        const outlierIndex = bigVariance ? rng.int(0, sample.length - 1) : -1;
        const lines = sample.map((p, index) => {
            const expected = p.stock.get(store.warehouseId) ?? 0;
            const variance = index === outlierIndex
                ? -Math.min(expected, rng.int(18, 40))
                : (rng.chance(0.3) ? rng.int(-2, 2) : 0);
            return { product: p, expected, counted: Math.max(0, expected + variance), variance };
        });

        const session = await tx.stockTakeSession.create({
            data: {
                tenant_id: this.world.tenantId, warehouse_id: store.warehouseId, session_number: sessionNumber,
                status: 'POSTED', started_at: date, posted_at: date, created_at: date,
                lines: {
                    create: lines.map((l) => ({
                        product_id: l.product.id, expected_quantity: l.expected,
                        counted_quantity: l.counted, variance_quantity: l.counted - l.expected,
                    })),
                },
            },
        });
        let adjustmentAmount = 0;
        for (const l of lines) {
            const delta = l.counted - l.expected;
            if (delta === 0) continue;
            await applyInventoryMovement(tx, {
                tenantId: this.world.tenantId, productId: l.product.id, warehouseId: store.warehouseId,
                quantityDelta: delta, movementType: 'STOCK_TAKE_ADJUSTMENT', referenceType: 'STOCK_TAKE',
                referenceId: session.id, unitCost: l.product.cost, occurredAt: date,
            });
            l.product.stock.set(store.warehouseId, l.counted);
            adjustmentAmount += Math.abs(delta) * l.product.cost;
        }
        await autoPostFromRules({
            tx, tenantId: this.world.tenantId, eventType: 'inventory_adjustment', conditionKey: 'reason_type',
            conditionValue: 'DISCREPANCY', sourceModule: 'inventory', sourceType: 'stock_take_adjustment',
            sourceId: session.id, amount: money(adjustmentAmount),
            description: `Auto-posted stock take ${sessionNumber}`, referenceNumber: sessionNumber, date, storeId: store.storeId,
        });
        this.counts.stockTakes++;

        if (outlierIndex >= 0) {
            const outlier = lines[outlierIndex];
            if (outlier.counted !== outlier.expected) {
                this.recordAnomaly('STOCK_TAKE_VARIANCE', date, 'StockTakeSession', session.id, sessionNumber,
                    `${outlier.product.name} counted ${outlier.counted} against an expected ${outlier.expected}.`);
            }
        }
    }

    /* ---------------------------------------------------------------- */
    /*  Cashier sessions                                                 */
    /* ---------------------------------------------------------------- */

    async writeCashierSession(tx: Tx, dayStart: Date, store: StoreRuntime, short = false): Promise<void> {
        const rng = this.world.rng;
        const openedAt = new Date(dayStart.getTime() + 9 * 3600000); // 9am
        const closedAt = this.world.clampToWindow(new Date(dayStart.getTime() + 21 * 3600000)); // 9pm
        const openingCash = rng.int(2000, 5000);
        // A normal day closes well above its float; a short one closes barely
        // above it, which is what a missing day of takings actually looks like.
        const closingCash = short ? openingCash + rng.int(100, 700) : openingCash + rng.int(3000, 15000);
        const session = await tx.cashierSession.create({
            data: {
                tenant_id: this.world.tenantId, store_id: store.storeId, user_id: this.world.userId,
                opening_cash: openingCash, closing_cash: closingCash,
                status: 'CLOSED', opened_at: openedAt, closed_at: closedAt,
            },
        });
        this.counts.cashierSessions++;

        // A routine mid-shift cash drop or petty payout, so the drawer has
        // movement inside the session rather than only two endpoints.
        if (rng.chance(0.25)) {
            const payout = rng.chance(0.5);
            await tx.cashTransaction.create({
                data: {
                    tenant_id: this.world.tenantId, session_id: session.id,
                    amount: payout ? -rng.int(200, 1500) : rng.int(1000, 4000),
                    type: payout ? 'PAYOUT' : 'DROP',
                    description: payout ? 'Petty cash payout' : 'Mid-shift cash drop',
                    created_at: new Date(dayStart.getTime() + 15 * 3600000),
                },
            });
            this.counts.cashTransactions++;
        }

        if (short) {
            this.recordAnomaly('CASH_DRAWER_SHORTAGE', closedAt, 'CashierSession', session.id, undefined,
                `Closed on ৳${closingCash.toFixed(2)} against a ৳${openingCash.toFixed(2)} float — barely a day's takings in the drawer.`);
        }
    }

    /* ---------------------------------------------------------------- */
    /*  Anomaly bookkeeping                                              */
    /* ---------------------------------------------------------------- */

    private recordAnomaly(
        kind: AnomalyKind, date: Date, entity: string, entityId: string, reference: string | undefined, detail: string,
    ): void {
        this.world.anomalies.record(kind, { occurredAt: date, entity, entityId, reference, detail });
        this.counts.anomalies = this.world.anomalies.count;
    }
}
