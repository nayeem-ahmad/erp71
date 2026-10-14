import type { RecordHistoryEntityType } from '@erp71/shared-types';
import type { DatabaseService } from '../database/database.service';
import { keyLines, normalizeSnapshot } from './record-history.diff';

/**
 * What one record looked like at one instant: the aggregate a person thinks of
 * as "the invoice" — header, lines, payments — with names next to the ids, so a
 * history row still reads correctly after the customer is renamed or the
 * product deleted.
 */
export interface RecordSnapshot {
    tenantId: string;
    /** Invoice number, customer name — what people call the record. */
    label: string | null;
    data: Record<string, unknown>;
}

type Loader = (db: DatabaseService, id: string) => Promise<RecordSnapshot | null>;

/**
 * Fields left out of every snapshot. `tenant_id` is on the history row itself;
 * `updated_at` moves on every write, so it would be the one "change" every
 * edit shows.
 */
const OMITTED = new Set(['tenant_id', 'updated_at']);

/**
 * The row's own columns, minus its loaded relations and the foreign keys a
 * snapshot replaces with a name: "supplier: Karim Wholesale" says what changed,
 * a supplier id and a supplier name changing side by side only say it twice.
 */
function scalars(row: Record<string, unknown>, omit: string[] = []): Record<string, unknown> {
    const skip = new Set([...OMITTED, ...omit]);
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
        if (!skip.has(key)) out[key] = value;
    }
    return out;
}

const named = { select: { name: true } } as const;
const productRef = { select: { name: true, sku: true } } as const;

function nameOf(row: { name?: string | null } | null | undefined): string | null {
    return row?.name ?? null;
}

function snapshot(tenantId: string, label: string | null, data: Record<string, unknown>): RecordSnapshot {
    return { tenantId, label, data: normalizeSnapshot(data) };
}

/**
 * `created_by` / `cancelled_by` are bare user ids with no relation to load, so
 * they are named here: "cancelled by: Rahim" rather than a uuid. One query for
 * however many of the fields are set.
 */
async function withUserNames(
    db: DatabaseService,
    data: Record<string, unknown>,
    fields: string[],
): Promise<Record<string, unknown>> {
    const ids = fields.map((field) => data[field]).filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (!ids.length) return data;
    const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } });
    const nameById = new Map(users.map((user) => [user.id, user.name || user.email]));
    const out = { ...data };
    for (const field of fields) {
        const id = data[field];
        if (typeof id === 'string' && nameById.has(id)) out[field] = nameById.get(id);
    }
    return out;
}

const loadCustomer: Loader = async (db, id) => {
    const row = await db.customer.findUnique({
        where: { id },
        include: { customerGroup: named, territory: named, salesRep: named, store: named },
    });
    if (!row) return null;
    const { customerGroup, territory, salesRep, store } = row;
    return snapshot(row.tenant_id, row.name, {
        ...scalars(row, ['customerGroup', 'territory', 'salesRep', 'store', 'customer_group_id', 'territory_id', 'sales_rep_id', 'store_id']),
        customer_group: nameOf(customerGroup),
        territory: nameOf(territory),
        sales_rep: nameOf(salesRep),
        branch: nameOf(store),
    });
};

const loadSupplier: Loader = async (db, id) => {
    const row = await db.supplier.findUnique({ where: { id }, include: { store: named } });
    if (!row) return null;
    return snapshot(row.tenant_id, row.supplier_code ? `${row.name} (${row.supplier_code})` : row.name, {
        ...scalars(row, ['store', 'store_id']),
        branch: nameOf(row.store),
    });
};

const loadProduct: Loader = async (db, id) => {
    const row = await db.product.findUnique({
        where: { id },
        include: { brand: named, group: named, subgroup: named },
    });
    if (!row) return null;
    return snapshot(row.tenant_id, row.sku ? `${row.name} (${row.sku})` : row.name, {
        ...scalars(row, ['brand', 'group', 'subgroup', 'brand_id', 'group_id', 'subgroup_id']),
        brand: nameOf(row.brand),
        group: nameOf(row.group),
        subgroup: nameOf(row.subgroup),
    });
};

const loadSale: Loader = async (db, id) => {
    const row = await db.sale.findUnique({
        where: { id },
        include: {
            customer: { select: { name: true, customer_code: true } },
            store: named,
            warehouse: named,
            salesRep: named,
            items: { include: { product: productRef, warehouse: named } },
            payments: { include: { account: named }, orderBy: { created_at: 'asc' } },
        },
    });
    if (!row) return null;
    const { customer, store, warehouse, salesRep, items, payments } = row;
    return snapshot(row.tenant_id, row.serial_number, {
        ...scalars(await withUserNames(db, row, ['created_by', 'cancelled_by']), ['customer', 'store', 'warehouse', 'salesRep', 'items', 'payments', 'customer_id', 'store_id', 'warehouse_id', 'sales_rep_id']),
        customer: customer ? `${customer.name} (${customer.customer_code})` : null,
        branch: nameOf(store),
        warehouse: nameOf(warehouse),
        sales_rep: nameOf(salesRep),
        items: keyLines(
            items.map((item) => ({
                _ref: item.product_id,
                product: item.product?.name ?? null,
                sku: item.product?.sku ?? null,
                quantity: item.quantity,
                price_at_sale: item.price_at_sale,
                unit_cost_at_sale: item.unit_cost_at_sale,
                vat_rate: item.vat_rate,
                vat_amount: item.vat_amount,
                sd_rate: item.sd_rate,
                sd_amount: item.sd_amount,
                warehouse: nameOf(item.warehouse),
            })),
            (line) => line._ref,
            (line) => line.product ?? line._ref,
        ),
        payments: keyLines(
            payments.map((payment) => ({
                payment_method: payment.payment_method,
                amount: payment.amount,
                account: nameOf(payment.account),
                bank_name: payment.bank_name,
                reference_no: payment.reference_no,
                instrument_date: payment.instrument_date,
            })),
            (line) => line.payment_method,
            (line) => line.payment_method,
        ),
    });
};

const loadSalesReturn: Loader = async (db, id) => {
    const row = await db.salesReturn.findUnique({
        where: { id },
        include: {
            sale: { select: { serial_number: true } },
            store: named,
            warehouse: named,
            items: { include: { product: productRef, warehouse: named } },
        },
    });
    if (!row) return null;
    const { sale, store, warehouse, items } = row;
    return snapshot(row.tenant_id, row.return_number, {
        ...scalars(await withUserNames(db, row, ['created_by']), ['sale', 'store', 'warehouse', 'items', 'sale_id', 'store_id', 'warehouse_id']),
        sale: sale?.serial_number ?? null,
        branch: nameOf(store),
        warehouse: nameOf(warehouse),
        items: keyLines(
            items.map((item) => ({
                _ref: item.product_id,
                product: item.product?.name ?? null,
                sku: item.product?.sku ?? null,
                quantity: item.quantity,
                refund_amount: item.refund_amount,
                unit_cost_at_return: item.unit_cost_at_return,
                warehouse: nameOf(item.warehouse),
            })),
            (line) => line._ref,
            (line) => line.product ?? line._ref,
        ),
    });
};

const loadSalesExchange: Loader = async (db, id) => {
    const row = await db.salesExchange.findUnique({
        where: { id },
        include: {
            sale: { select: { serial_number: true, reference_number: true } },
            store: named,
            warehouse: named,
            items: {
                include: {
                    returnedProduct: productRef,
                    replacementProduct: productRef,
                    warehouse: named,
                },
            },
        },
    });
    if (!row) return null;
    const { sale, store, warehouse, items } = row;
    return snapshot(row.tenant_id, row.exchange_number, {
        ...scalars(await withUserNames(db, row, ['created_by', 'cancelled_by']), [
            'sale', 'store', 'warehouse', 'items', 'sale_id', 'store_id', 'warehouse_id', 'session_id',
        ]),
        sale: sale?.reference_number || sale?.serial_number || null,
        branch: nameOf(store),
        warehouse: nameOf(warehouse),
        items: keyLines(
            items.map((item) => ({
                _ref: item.id,
                returned_product: item.returnedProduct?.name ?? null,
                returned_sku: item.returnedProduct?.sku ?? null,
                returned_quantity: item.returned_quantity,
                returned_unit_price: item.returned_unit_price,
                replacement_product: item.replacementProduct?.name ?? null,
                replacement_sku: item.replacementProduct?.sku ?? null,
                replacement_quantity: item.replacement_quantity,
                replacement_unit_price: item.replacement_unit_price,
                warehouse: nameOf(item.warehouse),
            })),
            (line) => line._ref,
            (line) => line.replacement_product ?? line.returned_product ?? line._ref,
        ),
    });
};

const loadPurchase: Loader = async (db, id) => {
    const row = await db.purchase.findUnique({
        where: { id },
        include: {
            supplier: named,
            store: named,
            warehouse: named,
            items: { include: { product: productRef, warehouse: named } },
            payments: { orderBy: { created_at: 'asc' } },
        },
    });
    if (!row) return null;
    const { supplier, store, warehouse, items, payments } = row;
    return snapshot(row.tenant_id, row.purchase_number, {
        ...scalars(await withUserNames(db, row, ['created_by', 'cancelled_by']), ['supplier', 'store', 'warehouse', 'items', 'payments', 'supplier_id', 'store_id', 'warehouse_id']),
        supplier: nameOf(supplier),
        branch: nameOf(store),
        warehouse: nameOf(warehouse),
        items: keyLines(
            items.map((item) => ({
                _ref: item.product_id,
                product: item.product?.name ?? null,
                sku: item.product?.sku ?? null,
                quantity: item.quantity,
                unit_cost: item.unit_cost,
                line_total: item.line_total,
                warehouse: nameOf(item.warehouse),
            })),
            (line) => line._ref,
            (line) => line.product ?? line._ref,
        ),
        payments: keyLines(
            payments.map((payment) => ({
                payment_method: payment.payment_method,
                amount: payment.amount,
                bank_name: payment.bank_name,
                reference_no: payment.reference_no,
                instrument_date: payment.instrument_date,
            })),
            (line) => line.payment_method,
            (line) => line.payment_method,
        ),
    });
};

const loadPurchaseReturn: Loader = async (db, id) => {
    const row = await db.purchaseReturn.findUnique({
        where: { id },
        include: {
            purchase: { select: { purchase_number: true } },
            supplier: named,
            store: named,
            warehouse: named,
            items: { include: { product: productRef, warehouse: named } },
        },
    });
    if (!row) return null;
    const { purchase, supplier, store, warehouse, items } = row;
    return snapshot(row.tenant_id, row.return_number, {
        ...scalars(await withUserNames(db, row, ['created_by']), ['purchase', 'supplier', 'store', 'warehouse', 'items', 'purchase_id', 'supplier_id', 'store_id', 'warehouse_id']),
        purchase: purchase?.purchase_number ?? null,
        supplier: nameOf(supplier),
        branch: nameOf(store),
        warehouse: nameOf(warehouse),
        items: keyLines(
            items.map((item) => ({
                _ref: item.product_id,
                product: item.product?.name ?? null,
                sku: item.product?.sku ?? null,
                quantity: item.quantity,
                unit_cost: item.unit_cost,
                line_total: item.line_total,
                warehouse: nameOf(item.warehouse),
            })),
            (line) => line._ref,
            (line) => line.product ?? line._ref,
        ),
    });
};

const loadCustomerPayment: Loader = async (db, id) => {
    const row = await db.customerCreditTransaction.findUnique({
        where: { id },
        include: {
            customer: { select: { name: true, customer_code: true } },
            store: named,
            creator: named,
        },
    });
    if (!row) return null;
    const { customer, store, creator } = row;
    const who = customer ? `${customer.name} (${customer.customer_code})` : null;
    return snapshot(row.tenant_id, row.payment_number ?? who, {
        ...scalars(row, ['customer', 'store', 'creator', 'customer_id', 'store_id', 'created_by', 'payment_method_id']),
        customer: who,
        branch: nameOf(store),
        created_by_name: nameOf(creator),
    });
};

const loadSupplierPayment: Loader = async (db, id) => {
    const row = await db.supplierCreditTransaction.findUnique({
        where: { id },
        include: {
            supplier: named,
            store: named,
            creator: named,
            allocations: { include: { purchase: { select: { purchase_number: true } } } },
        },
    });
    if (!row) return null;
    const { supplier, store, creator, allocations } = row;
    return snapshot(row.tenant_id, row.payment_number ?? nameOf(supplier), {
        ...scalars(row, ['supplier', 'store', 'creator', 'allocations', 'supplier_id', 'store_id', 'created_by', 'payment_method_id']),
        supplier: nameOf(supplier),
        branch: nameOf(store),
        created_by_name: nameOf(creator),
        allocations: keyLines(
            allocations.map((allocation) => ({
                _ref: allocation.purchase_id,
                purchase: allocation.purchase?.purchase_number ?? null,
                amount: allocation.amount,
            })),
            (line) => line._ref,
            (line) => line.purchase ?? line._ref,
        ),
    });
};

export const SNAPSHOT_LOADERS: Record<RecordHistoryEntityType, Loader> = {
    CUSTOMER: loadCustomer,
    SUPPLIER: loadSupplier,
    PRODUCT: loadProduct,
    SALE: loadSale,
    SALES_RETURN: loadSalesReturn,
    SALES_EXCHANGE: loadSalesExchange,
    PURCHASE: loadPurchase,
    PURCHASE_RETURN: loadPurchaseReturn,
    CUSTOMER_PAYMENT: loadCustomerPayment,
    SUPPLIER_PAYMENT: loadSupplierPayment,
};
