import { Prisma } from '@prisma/client';
import { applyInventoryMovement } from '../../database/inventory.utils';
import { autoPostFromRules } from '../../accounting/posting.utils';
import { classifyPaymentMode } from '../../sales/classify-payment-mode';
import { Rng } from './rng';
import { businessName, personName, phoneNumber } from './people';
import { catalogForBusinessType, type DemoCatalogProduct } from './catalogs';

type Tx = Prisma.TransactionClient;

/** Round to 2 dp — money is stored as Decimal; keep generated values clean. */
function money(n: number): number {
    return Math.round(n * 100) / 100;
}

interface ProductRuntime {
    id: string;
    sku: string;
    name: string;
    sellPrice: number;
    cost: number;
    reorderLevel: number;
    popularityWeight: number;
    supplierIndex: number;
    /** In-memory on-hand mirror of DB ProductStock, keyed by warehouseId. */
    stock: Map<string, number>;
}

interface PartyRuntime {
    id: string;
    name: string;
    due: number;
}

interface StoreRuntime {
    storeId: string;
    warehouseId: string;
    isMain: boolean;
}

/** A paid (non-credit) sale eligible for a later return. */
interface ReturnableSale {
    saleId: string;
    storeId: string;
    warehouseId: string;
    paymentMode: string;
    items: Array<{ saleItemId: string; productId: string; quantity: number; price: number }>;
    epochDay: number;
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

export interface DemoWriterDeps {
    tenantId: string;
    userId: string;
    businessType: string | null | undefined;
    batchNumber: number;
    stores: StoreRuntime[];
    rng: Rng;
    start: Date;
    end: Date;
}

export interface DemoCounts {
    products: number;
    customers: number;
    suppliers: number;
    purchases: number;
    sales: number;
    creditSales: number;
    customerPayments: number;
    supplierPayments: number;
    expenses: number;
    salesReturns: number;
    purchaseReturns: number;
    transfers: number;
    shrinkages: number;
    stockTakes: number;
    cashierSessions: number;
}

const EXPENSE_CATEGORIES = ['Shop Rent', 'Utilities', 'Salaries', 'Transport', 'Miscellaneous'];

/**
 * Writes demo rows through the real inventory + accounting primitives, backdated.
 * Holds the in-memory simulation state (stock, party dues, ref-number counters)
 * that must persist across the per-day transactions the orchestrator opens.
 */
export class DemoWriter {
    readonly counts: DemoCounts = {
        products: 0, customers: 0, suppliers: 0, purchases: 0, sales: 0, creditSales: 0,
        customerPayments: 0, supplierPayments: 0, expenses: 0, salesReturns: 0,
        purchaseReturns: 0, transfers: 0, shrinkages: 0, stockTakes: 0, cashierSessions: 0,
    };

    products: ProductRuntime[] = [];
    customers: PartyRuntime[] = [];
    suppliers: PartyRuntime[] = [];
    private expenseCategoryIds = new Map<string, string>();
    private shrinkageReasons: Array<{ id: string; code: string }> = [];

    private pendingSettlements: PendingSettlement[] = [];
    private returnableSales: ReturnableSale[] = [];
    private returnablePurchases: ReturnablePurchase[] = [];

    // Ref-number sequences — namespaced by batchNumber so appends never collide
    // with prior batches or with any real reference numbers.
    private seq = { sale: 0, purchase: 0, custPay: 0, supPay: 0, salesReturn: 0, purchaseReturn: 0, transfer: 0, shrinkage: 0, stockTake: 0 };

    constructor(private readonly deps: DemoWriterDeps) {}

    private ref(prefix: string, n: number): string {
        return `D${this.deps.batchNumber}-${prefix}${String(n).padStart(5, '0')}`;
    }

    private get catalog(): DemoCatalogProduct[] {
        return catalogForBusinessType(this.deps.businessType).products;
    }

    /* ---------------------------------------------------------------- */
    /*  Setup — catalog, parties, opening stock                          */
    /* ---------------------------------------------------------------- */

    /** Ensure groups/subgroups/brands/products + ProductPrice rows exist. */
    async ensureCatalog(tx: Tx): Promise<void> {
        const { tenantId } = this.deps;
        const groupIds = new Map<string, string>();
        const subgroupIds = new Map<string, string>();
        const brandIds = new Map<string, string>();
        // ProductPrice must be effective before the earliest sale, else
        // unit_cost_at_sale resolves null and every margin reads 100%.
        const priceEffectiveFrom = new Date(this.deps.start.getTime() - 24 * 60 * 60 * 1000);

        for (const [index, def] of this.catalog.entries()) {
            const groupId = await this.upsertGroup(tx, tenantId, def.group, groupIds);
            const subgroupId = await this.upsertSubgroup(tx, tenantId, groupId, def.subgroup, subgroupIds);
            const brandId = def.brand ? await this.upsertBrand(tx, tenantId, def.brand, brandIds) : undefined;

            const product = await tx.product.upsert({
                where: { tenant_id_sku: { tenant_id: tenantId, sku: def.sku } },
                update: {
                    name: def.name, price: def.sellPrice, reorder_level: def.reorderLevel,
                    unit_type: def.unitType, group_id: groupId, subgroup_id: subgroupId, brand_id: brandId,
                },
                create: {
                    tenant_id: tenantId, name: def.name, sku: def.sku, price: def.sellPrice,
                    reorder_level: def.reorderLevel, unit_type: def.unitType,
                    group_id: groupId, subgroup_id: subgroupId, brand_id: brandId,
                },
            });

            await tx.productPrice.create({
                data: {
                    tenant_id: tenantId, product_id: product.id, price: def.sellPrice,
                    cost: def.purchaseCost, effective_from: priceEffectiveFrom,
                },
            });

            this.products.push({
                id: product.id, sku: def.sku, name: def.name, sellPrice: def.sellPrice,
                cost: def.purchaseCost, reorderLevel: def.reorderLevel,
                popularityWeight: def.popularityWeight, supplierIndex: index,
                stock: new Map(),
            });
        }
        this.counts.products = this.products.length;

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
        for (const p of this.products) {
            const mine = stockByProduct.get(p.id);
            for (const store of this.deps.stores) {
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
        const { tenantId, rng, batchNumber } = this.deps;

        for (let i = 0; i < customerCount; i++) {
            const seq = batchNumber * 100000 + i;
            const customer = await tx.customer.create({
                data: {
                    tenant_id: tenantId,
                    customer_code: this.ref('CUS', i + 1),
                    name: personName(rng),
                    phone: phoneNumber(rng, seq),
                    customer_type: 'INDIVIDUAL',
                    credit_enabled: true,
                    credit_limit: 50000,
                },
            });
            this.customers.push({ id: customer.id, name: customer.name, due: 0 });
        }
        this.counts.customers = this.customers.length;

        for (let i = 0; i < supplierCount; i++) {
            const supplier = await tx.supplier.create({
                data: {
                    tenant_id: tenantId,
                    name: `${businessName(rng)} #${batchNumber}-${i + 1}`,
                    phone: phoneNumber(rng, batchNumber * 100000 + 90000 + i),
                },
            });
            this.suppliers.push({ id: supplier.id, name: supplier.name, due: 0 });
        }
        this.counts.suppliers = this.suppliers.length;

        for (const name of EXPENSE_CATEGORIES) {
            const cat = await tx.expenseCategory.upsert({
                where: { tenant_id_name: { tenant_id: tenantId, name } },
                update: {}, create: { tenant_id: tenantId, name },
            });
            this.expenseCategoryIds.set(name, cat.id);
        }
    }

    async loadShrinkageReasons(tx: Tx): Promise<void> {
        this.shrinkageReasons = await tx.inventoryReason.findMany({
            where: { tenant_id: this.deps.tenantId, type: 'SHRINKAGE', is_active: true },
            select: { id: true, code: true },
        });
    }

    /** Day-0 opening purchases: one per supplier, backdated to the start. */
    async openingPurchases(tx: Tx, date: Date): Promise<void> {
        const bySupplier = new Map<number, ProductRuntime[]>();
        for (const p of this.products) {
            const idx = p.supplierIndex % this.suppliers.length;
            if (!bySupplier.has(idx)) bySupplier.set(idx, []);
            bySupplier.get(idx)!.push(p);
        }
        const mainStore = this.deps.stores.find((s) => s.isMain) ?? this.deps.stores[0];
        for (const [supplierIndex, products] of bySupplier) {
            const lines = products.map((p) => ({
                product: p,
                // Open with enough stock to trade for weeks before reordering.
                quantity: p.reorderLevel * this.deps.rng.int(3, 5),
            }));
            await this.writePurchase(tx, date, supplierIndex, mainStore, lines);
        }
    }

    /* ---------------------------------------------------------------- */
    /*  Purchases                                                        */
    /* ---------------------------------------------------------------- */

    private async writePurchase(
        tx: Tx, date: Date, supplierIndex: number, store: StoreRuntime,
        lines: Array<{ product: ProductRuntime; quantity: number }>,
    ): Promise<void> {
        const supplier = this.suppliers[supplierIndex % this.suppliers.length];
        const total = money(lines.reduce((s, l) => s + l.product.cost * l.quantity, 0));
        const purchaseNumber = this.ref('PUR', ++this.seq.purchase);

        const purchase = await tx.purchase.create({
            data: {
                tenant_id: this.deps.tenantId,
                store_id: store.storeId,
                supplier_id: supplier.id,
                purchase_number: purchaseNumber,
                subtotal_amount: total,
                total_amount: total,
                paid_amount: 0,
                payment_status: 'UNPAID',
                created_by: this.deps.userId,
                created_at: date,
                items: {
                    create: lines.map((l) => ({
                        product_id: l.product.id,
                        quantity: l.quantity,
                        unit_cost: l.product.cost,
                        line_total: money(l.product.cost * l.quantity),
                    })),
                },
            },
            include: { items: true },
        });

        for (const line of lines) {
            await applyInventoryMovement(tx, {
                tenantId: this.deps.tenantId,
                productId: line.product.id,
                warehouseId: store.warehouseId,
                quantityDelta: line.quantity,
                movementType: 'PURCHASE_RECEIPT',
                referenceType: 'PURCHASE',
                referenceId: purchase.id,
                unitCost: line.product.cost,
                occurredAt: date,
            });
            line.product.stock.set(store.warehouseId, (line.product.stock.get(store.warehouseId) ?? 0) + line.quantity);
        }

        // Every purchase is booked as a payable (the model has no cash-purchase rule).
        const balanceAfter = money(supplier.due + total);
        await tx.supplierCreditTransaction.create({
            data: {
                tenant_id: this.deps.tenantId,
                supplier_id: supplier.id,
                type: 'CREDIT_PURCHASE',
                amount: total,
                balance_after: balanceAfter,
                reference_type: 'PURCHASE',
                reference_id: purchase.id,
                created_by: this.deps.userId,
                created_at: date,
            },
        });
        supplier.due = balanceAfter;
        await tx.supplier.update({ where: { id: supplier.id }, data: { due_balance: balanceAfter } });

        await autoPostFromRules({
            tx,
            tenantId: this.deps.tenantId,
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
    }

    /** Replenish one product from its assigned supplier when stock runs low. */
    async reorderIfNeeded(tx: Tx, date: Date, product: ProductRuntime, store: StoreRuntime): Promise<void> {
        const onHand = product.stock.get(store.warehouseId) ?? 0;
        if (onHand > product.reorderLevel) return;
        const quantity = product.reorderLevel * this.deps.rng.int(3, 5);
        await this.writePurchase(tx, date, product.supplierIndex, store, [{ product, quantity }]);
    }

    /* ---------------------------------------------------------------- */
    /*  Sales                                                            */
    /* ---------------------------------------------------------------- */

    async writeSale(tx: Tx, date: Date, store: StoreRuntime, growth: number): Promise<void> {
        const rng = this.deps.rng;
        const itemCount = rng.weighted([1, 2, 3, 4, 5], [40, 28, 18, 9, 5]);
        const chosen = new Map<string, number>();

        for (let i = 0; i < itemCount; i++) {
            const product = rng.weighted(this.products, this.products.map((p) => p.popularityWeight));
            const qty = rng.weighted([1, 2, 3, 5, 10], [55, 25, 12, 5, 3]);
            // Ensure stock; reorder if the line can't be satisfied.
            await this.reorderIfNeeded(tx, date, product, store);
            const onHand = product.stock.get(store.warehouseId) ?? 0;
            const sellable = Math.min(qty, onHand);
            if (sellable <= 0) continue;
            chosen.set(product.id, (chosen.get(product.id) ?? 0) + sellable);
        }
        if (chosen.size === 0) return;

        const lines = [...chosen.entries()].map(([productId, quantity]) => {
            const product = this.products.find((p) => p.id === productId)!;
            return { product, quantity, price: product.sellPrice };
        });
        const total = money(lines.reduce((s, l) => s + l.price * l.quantity, 0));

        // ~40% named customers; of those ~15% buy on full credit (settled later).
        // Full credit (not partial) keeps posting to a single balanced voucher,
        // matching sales.service (which reuses one sourceId for both portions and
        // so drops the paid portion as a duplicate).
        const named = rng.chance(0.4);
        const customerIndex = named ? rng.int(0, this.customers.length - 1) : -1;
        const onCredit = named && rng.chance(0.15);
        const amountPaid = onCredit ? 0 : total;
        const balanceDue = money(Math.max(0, total - amountPaid));

        const paymentLabel = onCredit ? 'Credit' : rng.weighted(['Cash', 'bKash', 'Nagad', 'Card'], [55, 20, 12, 13]);
        const paidMode = classifyPaymentMode(paymentLabel);
        const serial = this.ref('S', ++this.seq.sale);

        const sale = await tx.sale.create({
            data: {
                tenant_id: this.deps.tenantId,
                store_id: store.storeId,
                serial_number: serial,
                total_amount: total,
                amount_paid: amountPaid,
                status: 'COMPLETED',
                customer_id: customerIndex >= 0 ? this.customers[customerIndex].id : null,
                created_by: this.deps.userId,
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
                tenantId: this.deps.tenantId,
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
        if (balanceDue > 0.005) {
            const customer = this.customers[customerIndex];
            await this.postSale(tx, date, sale.id, serial, 'credit', balanceDue, store.storeId, customer.id);
            const balanceAfter = money(customer.due + balanceDue);
            await tx.customerCreditTransaction.create({
                data: {
                    tenant_id: this.deps.tenantId, customer_id: customer.id, type: 'CREDIT_SALE',
                    amount: balanceDue, balance_after: balanceAfter,
                    reference_type: 'SALE', reference_id: sale.id, created_by: this.deps.userId, created_at: date,
                },
            });
            customer.due = balanceAfter;
            await tx.customer.update({ where: { id: customer.id }, data: { due_balance: balanceAfter, total_spent: { increment: total } } });
            // Settle 3–45 days later.
            this.pendingSettlements.push({
                customerIndex, amount: balanceDue,
                settleOnEpochDay: Math.floor(date.getTime() / 86400000) + rng.int(3, 45),
            });
            this.counts.creditSales++;
        } else {
            await this.postSale(tx, date, sale.id, serial, paidMode, total, store.storeId);
            if (customerIndex >= 0) {
                await tx.customer.update({ where: { id: this.customers[customerIndex].id }, data: { total_spent: { increment: total } } });
            }
            // Fully-paid sales are eligible for a rare return.
            this.returnableSales.push({
                saleId: sale.id, storeId: store.storeId, warehouseId: store.warehouseId, paymentMode: paidMode,
                epochDay: Math.floor(date.getTime() / 86400000),
                items: sale.items.map((it) => ({ saleItemId: it.id, productId: it.product_id, quantity: it.quantity, price: Number(it.price_at_sale) })),
            });
            if (this.returnableSales.length > 60) this.returnableSales.shift();
        }
        this.counts.sales++;
    }

    private async postSale(
        tx: Tx, date: Date, saleId: string, serial: string, mode: string, amount: number, storeId: string,
        customerId?: string,
    ): Promise<void> {
        await autoPostFromRules({
            tx,
            tenantId: this.deps.tenantId,
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
            const customer = this.customers[settlement.customerIndex];
            const amount = money(Math.min(settlement.amount, customer.due));
            if (amount <= 0.005) continue;
            const balanceAfter = money(customer.due - amount);
            const paymentNumber = this.ref('CPY', ++this.seq.custPay);
            const payment = await tx.customerCreditTransaction.create({
                data: {
                    tenant_id: this.deps.tenantId, customer_id: customer.id, type: 'PAYMENT',
                    amount, balance_after: balanceAfter, payment_number: paymentNumber,
                    notes: 'Demo credit settlement', created_by: this.deps.userId, created_at: date,
                },
            });
            customer.due = balanceAfter;
            await tx.customer.update({ where: { id: customer.id }, data: { due_balance: balanceAfter } });
            await autoPostFromRules({
                tx,
                tenantId: this.deps.tenantId,
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
                storeId: this.deps.stores[0].storeId,
                partyType: 'CUSTOMER',
                partyId: customer.id,
            });
            this.counts.customerPayments++;
        }
    }

    /** Pay down a supplier's balance, posting Dr Purchase Payable / Cr Cash. */
    async paySuppliers(tx: Tx, date: Date): Promise<void> {
        const rng = this.deps.rng;
        if (!rng.chance(0.3)) return;
        const owing = this.suppliers.filter((s) => s.due > 100);
        if (owing.length === 0) return;
        const supplier = rng.pick(owing);
        const amount = money(supplier.due * rng.range(0.4, 1));
        const balanceAfter = money(supplier.due - amount);
        const paymentNumber = this.ref('SPY', ++this.seq.supPay);
        const payment = await tx.supplierCreditTransaction.create({
            data: {
                tenant_id: this.deps.tenantId, supplier_id: supplier.id, type: 'PAYMENT',
                amount, balance_after: balanceAfter, payment_number: paymentNumber,
                notes: 'Demo supplier payment', created_by: this.deps.userId, created_at: date,
            },
        });
        supplier.due = balanceAfter;
        await tx.supplier.update({ where: { id: supplier.id }, data: { due_balance: balanceAfter } });
        await autoPostFromRules({
            tx,
            tenantId: this.deps.tenantId,
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
            storeId: this.deps.stores[0].storeId,
            partyType: 'SUPPLIER',
            partyId: supplier.id,
        });
        this.counts.supplierPayments++;
    }

    /* ---------------------------------------------------------------- */
    /*  Expenses                                                         */
    /* ---------------------------------------------------------------- */

    async writeExpense(tx: Tx, date: Date, categoryName: string, amount: number, bank: boolean): Promise<void> {
        const categoryId = this.expenseCategoryIds.get(categoryName);
        if (!categoryId) return;
        const store = this.deps.stores[0];
        const paymentMode = bank ? 'bank' : 'cash';
        const entry = await tx.expenseEntry.create({
            data: {
                tenant_id: this.deps.tenantId,
                category_id: categoryId,
                amount: money(amount),
                expense_date: date,
                description: `${categoryName} — demo`,
                payment_method: bank ? 'BANK' : 'CASH',
                store_id: store.storeId,
                created_by: this.deps.userId,
                created_at: date,
            },
        });
        await autoPostFromRules({
            tx,
            tenantId: this.deps.tenantId,
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
    }

    /* ---------------------------------------------------------------- */
    /*  Returns                                                          */
    /* ---------------------------------------------------------------- */

    async maybeSalesReturn(tx: Tx, date: Date, epochDay: number): Promise<void> {
        const rng = this.deps.rng;
        // ~2% of paid sales are returned within days.
        const candidate = this.returnableSales.find((s) => epochDay - s.epochDay >= 1 && epochDay - s.epochDay <= 7 && rng.chance(0.02));
        if (!candidate) return;
        this.returnableSales = this.returnableSales.filter((s) => s !== candidate);

        const item = rng.pick(candidate.items);
        const qty = rng.int(1, item.quantity);
        const refund = money(item.price * qty);
        const returnNumber = this.ref('RS', ++this.seq.salesReturn);

        const salesReturn = await tx.salesReturn.create({
            data: {
                tenant_id: this.deps.tenantId, store_id: candidate.storeId, sale_id: candidate.saleId,
                return_number: returnNumber, total_refund: refund, reason: 'Demo return',
                status: 'COMPLETED', created_by: this.deps.userId, created_at: date,
                items: { create: [{ sale_item_id: item.saleItemId, product_id: item.productId, quantity: qty, refund_amount: refund }] },
            },
        });
        const product = this.products.find((p) => p.id === item.productId);
        await applyInventoryMovement(tx, {
            tenantId: this.deps.tenantId, productId: item.productId, warehouseId: candidate.warehouseId,
            quantityDelta: qty, movementType: 'SALES_RETURN', referenceType: 'SALES_RETURN',
            referenceId: salesReturn.id, unitCost: product?.cost, occurredAt: date,
        });
        if (product) product.stock.set(candidate.warehouseId, (product.stock.get(candidate.warehouseId) ?? 0) + qty);

        await autoPostFromRules({
            tx, tenantId: this.deps.tenantId, eventType: 'sale_return', conditionKey: 'payment_mode',
            conditionValue: candidate.paymentMode, sourceModule: 'sales', sourceType: 'sale_return',
            sourceId: salesReturn.id, amount: refund, description: `Auto-posted sales return ${returnNumber}`,
            referenceNumber: returnNumber, date, storeId: candidate.storeId,
        });
        this.counts.salesReturns++;
    }

    async maybePurchaseReturn(tx: Tx, date: Date, epochDay: number): Promise<void> {
        const rng = this.deps.rng;
        // ~3% of purchases are returned within days.
        const candidate = this.returnablePurchases.find((p) => epochDay - p.epochDay >= 1 && epochDay - p.epochDay <= 10 && rng.chance(0.03));
        if (!candidate) return;
        this.returnablePurchases = this.returnablePurchases.filter((p) => p !== candidate);

        const item = rng.pick(candidate.items);
        const product = this.products.find((p) => p.id === item.productId);
        const onHand = product?.stock.get(candidate.warehouseId) ?? 0;
        const qty = Math.min(rng.int(1, item.quantity), onHand);
        if (qty <= 0) return;
        const lineTotal = money(item.unitCost * qty);
        const returnNumber = this.ref('RP', ++this.seq.purchaseReturn);

        const purchaseReturn = await tx.purchaseReturn.create({
            data: {
                tenant_id: this.deps.tenantId, store_id: this.deps.stores[0].storeId, purchase_id: candidate.purchaseId,
                supplier_id: this.suppliers[candidate.supplierIndex % this.suppliers.length].id,
                return_number: returnNumber, total_amount: lineTotal, status: 'RECORDED',
                created_by: this.deps.userId, created_at: date,
                items: { create: [{ purchase_item_id: item.purchaseItemId, product_id: item.productId, quantity: qty, unit_cost: item.unitCost, line_total: lineTotal }] },
            },
        });
        await applyInventoryMovement(tx, {
            tenantId: this.deps.tenantId, productId: item.productId, warehouseId: candidate.warehouseId,
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
        const supplier = this.suppliers[candidate.supplierIndex % this.suppliers.length];
        const creditReduction = money(Math.min(lineTotal, supplier.due));
        if (creditReduction > 0.005) {
            const balanceAfter = money(supplier.due - creditReduction);
            await tx.supplierCreditTransaction.create({
                data: {
                    tenant_id: this.deps.tenantId, supplier_id: supplier.id, type: 'ADJUSTMENT',
                    amount: -creditReduction, balance_after: balanceAfter, reference_type: 'PURCHASE_RETURN',
                    reference_id: purchaseReturn.id, notes: 'Demo purchase return', created_by: this.deps.userId, created_at: date,
                },
            });
            supplier.due = balanceAfter;
            await tx.supplier.update({ where: { id: supplier.id }, data: { due_balance: balanceAfter } });
        }

        await autoPostFromRules({
            tx, tenantId: this.deps.tenantId, eventType: 'purchase_return', conditionKey: 'none',
            conditionValue: null, sourceModule: 'purchases', sourceType: 'purchase_return',
            sourceId: purchaseReturn.id, amount: lineTotal, description: `Auto-posted purchase return ${returnNumber}`,
            referenceNumber: returnNumber, date, storeId: this.deps.stores[0].storeId,
            partyType: 'SUPPLIER', partyId: supplier.id,
        });
        this.counts.purchaseReturns++;
    }

    /* ---------------------------------------------------------------- */
    /*  Inventory ops                                                    */
    /* ---------------------------------------------------------------- */

    /** Transfer stock Main → Banani. fund_movement has no rule, so nothing posts. */
    async maybeTransfer(tx: Tx, date: Date): Promise<void> {
        const rng = this.deps.rng;
        const main = this.deps.stores.find((s) => s.isMain);
        const other = this.deps.stores.find((s) => !s.isMain);
        if (!main || !other || !rng.chance(0.5)) return;

        const product = rng.pick(this.products);
        const onHand = product.stock.get(main.warehouseId) ?? 0;
        const qty = Math.min(rng.int(2, 10), Math.max(0, onHand - product.reorderLevel));
        if (qty <= 0) return;
        const transferNumber = this.ref('TRF', ++this.seq.transfer);

        const transfer = await tx.warehouseTransfer.create({
            data: {
                tenant_id: this.deps.tenantId, transfer_number: transferNumber,
                source_warehouse_id: main.warehouseId, destination_warehouse_id: other.warehouseId,
                source_store_id: main.storeId, destination_store_id: other.storeId,
                status: 'RECEIVED', is_cross_branch: true, sent_at: date, received_at: date, created_at: date,
                items: { create: [{ product_id: product.id, quantity_sent: qty, quantity_received: qty }] },
            },
        });
        await applyInventoryMovement(tx, {
            tenantId: this.deps.tenantId, productId: product.id, warehouseId: main.warehouseId,
            quantityDelta: -qty, movementType: 'TRANSFER_OUT', referenceType: 'WAREHOUSE_TRANSFER',
            referenceId: transfer.id, occurredAt: date,
        });
        await applyInventoryMovement(tx, {
            tenantId: this.deps.tenantId, productId: product.id, warehouseId: other.warehouseId,
            quantityDelta: qty, movementType: 'TRANSFER_IN', referenceType: 'WAREHOUSE_TRANSFER',
            referenceId: transfer.id, occurredAt: date,
        });
        product.stock.set(main.warehouseId, onHand - qty);
        product.stock.set(other.warehouseId, (product.stock.get(other.warehouseId) ?? 0) + qty);
        this.counts.transfers++;
    }

    /** Write off a little stock. inventory_adjustment has no rule, so nothing posts. */
    async maybeShrinkage(tx: Tx, date: Date): Promise<void> {
        const rng = this.deps.rng;
        if (this.shrinkageReasons.length === 0 || !rng.chance(0.15)) return;
        const store = rng.pick(this.deps.stores);
        const product = rng.pick(this.products);
        const onHand = product.stock.get(store.warehouseId) ?? 0;
        const qty = Math.min(rng.int(1, 3), onHand);
        if (qty <= 0) return;
        const reason = rng.pick(this.shrinkageReasons);
        const referenceNumber = this.ref('SHR', ++this.seq.shrinkage);

        const shrinkage = await tx.inventoryShrinkage.create({
            data: {
                tenant_id: this.deps.tenantId, warehouse_id: store.warehouseId, reason_id: reason.id,
                reference_number: referenceNumber, created_at: date,
                items: { create: [{ product_id: product.id, quantity: qty, unit_cost: product.cost }] },
            },
        });
        await applyInventoryMovement(tx, {
            tenantId: this.deps.tenantId, productId: product.id, warehouseId: store.warehouseId,
            quantityDelta: -qty, movementType: 'SHRINKAGE', referenceType: 'INVENTORY_SHRINKAGE',
            referenceId: shrinkage.id, unitCost: product.cost, occurredAt: date,
        });
        product.stock.set(store.warehouseId, onHand - qty);
        await autoPostFromRules({
            tx, tenantId: this.deps.tenantId, eventType: 'inventory_adjustment', conditionKey: 'reason_type',
            conditionValue: reason.code, sourceModule: 'inventory', sourceType: 'shrinkage',
            sourceId: shrinkage.id, amount: money(product.cost * qty),
            description: `Auto-posted shrinkage ${referenceNumber}`, referenceNumber, date, storeId: store.storeId,
        });
        this.counts.shrinkages++;
    }

    /** A quarterly stock take with small (sub-threshold) variances. */
    async writeStockTake(tx: Tx, date: Date, store: StoreRuntime): Promise<void> {
        const rng = this.deps.rng;
        const sessionNumber = this.ref('STK', ++this.seq.stockTake);
        const sample = rng.shuffle(this.products).slice(0, 10);
        const lines = sample.map((p) => {
            const expected = p.stock.get(store.warehouseId) ?? 0;
            const variance = rng.chance(0.3) ? rng.int(-2, 2) : 0;
            return { product: p, expected, counted: Math.max(0, expected + variance), variance };
        });

        const session = await tx.stockTakeSession.create({
            data: {
                tenant_id: this.deps.tenantId, warehouse_id: store.warehouseId, session_number: sessionNumber,
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
                tenantId: this.deps.tenantId, productId: l.product.id, warehouseId: store.warehouseId,
                quantityDelta: delta, movementType: 'STOCK_TAKE_ADJUSTMENT', referenceType: 'STOCK_TAKE',
                referenceId: session.id, unitCost: l.product.cost, occurredAt: date,
            });
            l.product.stock.set(store.warehouseId, l.counted);
            adjustmentAmount += Math.abs(delta) * l.product.cost;
        }
        await autoPostFromRules({
            tx, tenantId: this.deps.tenantId, eventType: 'inventory_adjustment', conditionKey: 'reason_type',
            conditionValue: 'DISCREPANCY', sourceModule: 'inventory', sourceType: 'stock_take_adjustment',
            sourceId: session.id, amount: money(adjustmentAmount),
            description: `Auto-posted stock take ${sessionNumber}`, referenceNumber: sessionNumber, date, storeId: store.storeId,
        });
        this.counts.stockTakes++;
    }

    /* ---------------------------------------------------------------- */
    /*  Cashier sessions                                                 */
    /* ---------------------------------------------------------------- */

    async writeCashierSession(tx: Tx, dayStart: Date, store: StoreRuntime): Promise<void> {
        const rng = this.deps.rng;
        const openedAt = new Date(dayStart.getTime() + 9 * 3600000); // 9am
        const closedAt = new Date(dayStart.getTime() + 21 * 3600000); // 9pm
        const openingCash = rng.int(2000, 5000);
        await tx.cashierSession.create({
            data: {
                tenant_id: this.deps.tenantId, store_id: store.storeId, user_id: this.deps.userId,
                opening_cash: openingCash, closing_cash: openingCash + rng.int(3000, 15000),
                status: 'CLOSED', opened_at: openedAt, closed_at: closedAt,
            },
        });
        this.counts.cashierSessions++;
    }
}
