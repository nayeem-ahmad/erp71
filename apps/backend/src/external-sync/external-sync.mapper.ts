import {
    ExpressRetailCustomer,
    ExpressRetailProduct,
    ExpressRetailPurchase,
    ExpressRetailPurchaseLine,
    ExpressRetailSale,
    ExpressRetailSaleLine,
    ExpressRetailSupplier,
} from './express-retail.client';

/**
 * Pure mapping from Express Retail Pro payloads onto our own shapes. Kept free
 * of Prisma and HTTP so the awkward parts — money parsing, quantity rounding,
 * code collisions — can be unit tested directly.
 */

export type SyncWarning = {
    /** PRODUCT | CUSTOMER | SUPPLIER | SALE | PURCHASE */
    entity: string;
    externalId: string;
    /** Machine-readable reason so the UI can group these. */
    code: string;
    message: string;
};

export interface DateWindow {
    from: string;
    to: string;
}

/** `YYYY-MM-DD` in UTC — the provider deals in plain dates, not instants. */
export function toDateString(date: Date): string {
    return date.toISOString().slice(0, 10);
}

export function parseProviderDate(value: string): Date {
    // Provider dates are plain `YYYY-MM-DD`; anchor them at UTC midnight so a
    // server in Asia/Dhaka does not shift them a day backwards.
    return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

/**
 * The provider builds each response in memory with no pagination, so a
 * multi-year request risks a gateway timeout. Split into month-sized windows.
 */
export function splitIntoMonthlyWindows(from: Date, to: Date): DateWindow[] {
    if (from > to) return [];

    const windows: DateWindow[] = [];
    let cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
    const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));

    while (cursor <= end) {
        // Last day of the cursor's month.
        const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
        const windowEnd = monthEnd > end ? end : monthEnd;
        windows.push({ from: toDateString(cursor), to: toDateString(windowEnd) });
        cursor = new Date(Date.UTC(windowEnd.getUTCFullYear(), windowEnd.getUTCMonth(), windowEnd.getUTCDate() + 1));
    }

    return windows;
}

/** Provider money arrives as strings like "2200.000". Never trust it blindly. */
export function parseAmount(value: string | number | null | undefined): number {
    if (value === null || value === undefined || value === '') return 0;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

/** Rounds to 2dp to match our Decimal(12,2) columns. */
export function toMoney(value: string | number | null | undefined): number {
    return Math.round(parseAmount(value) * 100) / 100;
}

export interface QuantityResult {
    quantity: number;
    /** True when the provider quantity was fractional and had to be rounded. */
    rounded: boolean;
    originalQuantity: number;
}

/**
 * Our SaleItem/PurchaseItem quantities are integers while the provider allows
 * fractions (a small number of rows genuinely use them). We round to nearest
 * and surface a warning rather than silently truncating — a rounded row is
 * visible and fixable; a truncated one is not.
 */
export function resolveQuantity(raw: string | number | null | undefined): QuantityResult {
    const original = parseAmount(raw);
    const rounded = Math.round(original);
    // Never let a rounding step turn a real line into a zero-quantity line.
    const quantity = rounded === 0 && original > 0 ? 1 : rounded;
    return { quantity, rounded: quantity !== original, originalQuantity: original };
}

/**
 * Imported documents get a prefix so they can never collide with numbers our
 * own POS generates for the same tenant.
 */
export function buildDocumentNumber(prefix: string, invoice: string): string {
    return `${prefix}${invoice}`.slice(0, 191);
}

/**
 * Provider product/customer codes are *almost* unique — the live data has a
 * handful of duplicates, and our schema enforces uniqueness per tenant. Append
 * the provider row id to any code we have already claimed.
 */
export function dedupeCode(code: string, externalId: string, claimed: Set<string>): string {
    const base = (code || '').trim() || `EXT-${externalId}`;
    if (!claimed.has(base)) {
        claimed.add(base);
        return base;
    }
    const disambiguated = `${base}-${externalId}`;
    claimed.add(disambiguated);
    return disambiguated;
}

export interface MappedProduct {
    externalId: string;
    sku: string;
    name: string;
    price: number;
    purchaseRate: number;
    vatRate: number | null;
    reorderLevel: number | null;
    isService: boolean;
    externalUpdatedAt: Date | null;
}

export function mapProduct(row: ExpressRetailProduct, claimedSkus: Set<string>): MappedProduct {
    const externalId = String(row.id);
    const reorder = row.reorder === null || row.reorder === undefined ? NaN : Number(row.reorder);
    const vat = row.vat === null || row.vat === undefined ? NaN : Number(row.vat);

    return {
        externalId,
        sku: dedupeCode(row.code, externalId, claimedSkus),
        name: (row.name || '').trim() || `Unnamed product ${externalId}`,
        price: toMoney(row.sale_rate),
        purchaseRate: toMoney(row.purchase_rate),
        vatRate: Number.isFinite(vat) && vat > 0 ? vat : null,
        reorderLevel: Number.isFinite(reorder) && reorder > 0 ? Math.round(reorder) : null,
        isService: String(row.is_service) === 'true',
        externalUpdatedAt: parseTimestamp(row.updated_at),
    };
}

export interface MappedCustomer {
    externalId: string;
    customerCode: string;
    name: string;
    ownerName: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    creditLimit: number | null;
    externalUpdatedAt: Date | null;
}

export function mapCustomer(row: ExpressRetailCustomer, claimedCodes: Set<string>): MappedCustomer {
    const externalId = String(row.id);
    const creditLimit = toMoney(row.credit_limit);

    return {
        externalId,
        customerCode: dedupeCode(row.code, externalId, claimedCodes),
        name: (row.name || '').trim() || `Unnamed customer ${externalId}`,
        ownerName: emptyToNull(row.owner_name),
        phone: emptyToNull(row.phone),
        email: emptyToNull(row.email),
        address: emptyToNull(row.address),
        // The provider uses 1000000000 as "no limit"; that is noise, not a limit.
        creditLimit: creditLimit > 0 && creditLimit < 1_000_000_000 ? creditLimit : null,
        externalUpdatedAt: parseTimestamp(row.updated_at),
    };
}

export interface MappedSupplier {
    externalId: string;
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    externalUpdatedAt: Date | null;
}

export function mapSupplier(row: ExpressRetailSupplier, claimedNames: Set<string>): MappedSupplier {
    const externalId = String(row.id);
    // Supplier is unique on [tenant_id, name] in our schema, so the name is the
    // value that has to be disambiguated rather than the code.
    const name = dedupeCode((row.name || '').trim() || `Unnamed supplier ${externalId}`, externalId, claimedNames);

    return {
        externalId,
        name,
        phone: emptyToNull(row.phone),
        email: emptyToNull(row.email),
        address: emptyToNull(row.address),
        externalUpdatedAt: parseTimestamp(row.updated_at),
    };
}

export interface MappedSaleItem {
    externalProductId: string;
    quantity: number;
    priceAtSale: number;
    unitCostAtSale: number | null;
}

export interface MappedSale {
    externalId: string;
    serialNumber: string;
    /** The provider's own transaction number, unprefixed, for `reference_number`. */
    referenceNumber: string | null;
    externalCustomerId: string | null;
    totalAmount: number;
    amountPaid: number;
    saleDate: Date;
    note: string | null;
    externalUpdatedAt: Date | null;
    items: MappedSaleItem[];
}

export function mapSale(
    row: ExpressRetailSale,
    lines: ExpressRetailSaleLine[],
    documentPrefix: string,
    warnings: SyncWarning[],
): MappedSale {
    const externalId = String(row.id);
    const items: MappedSaleItem[] = lines.map((line) => {
        const { quantity, rounded, originalQuantity } = resolveQuantity(line.quantity);
        if (rounded) {
            warnings.push({
                entity: 'SALE',
                externalId,
                code: 'QUANTITY_ROUNDED',
                message: `Invoice ${row.invoice}: quantity ${originalQuantity} rounded to ${quantity} (our line quantities are whole numbers)`,
            });
        }
        const unitCost = toMoney(line.purchase_rate);
        return {
            externalProductId: String(line.product_id),
            quantity,
            priceAtSale: toMoney(line.unit_price),
            unitCostAtSale: unitCost > 0 ? unitCost : null,
        };
    });

    return {
        externalId,
        serialNumber: buildDocumentNumber(documentPrefix, row.invoice),
        referenceNumber: emptyToNull(row.invoice),
        externalCustomerId: emptyToNull(row.customer_id),
        totalAmount: toMoney(row.total),
        amountPaid: toMoney(row.paid),
        saleDate: parseProviderDate(row.date),
        note: emptyToNull(row.description),
        externalUpdatedAt: parseTimestamp(row.updated_at),
        items,
    };
}

export interface MappedPurchaseItem {
    externalProductId: string;
    quantity: number;
    unitCost: number;
    lineTotal: number;
}

export interface MappedPurchase {
    externalId: string;
    purchaseNumber: string;
    /** The provider's own transaction number, unprefixed, for `reference_number`. */
    referenceNumber: string | null;
    externalSupplierId: string | null;
    subtotalAmount: number;
    taxAmount: number;
    discountAmount: number;
    freightAmount: number;
    totalAmount: number;
    paidAmount: number;
    paymentStatus: 'UNPAID' | 'PARTIAL' | 'PAID';
    notes: string | null;
    purchaseDate: Date;
    externalUpdatedAt: Date | null;
    items: MappedPurchaseItem[];
}

export function mapPurchase(
    row: ExpressRetailPurchase,
    lines: ExpressRetailPurchaseLine[],
    documentPrefix: string,
    warnings: SyncWarning[],
): MappedPurchase {
    const externalId = String(row.id);
    const items: MappedPurchaseItem[] = lines.map((line) => {
        const { quantity, rounded, originalQuantity } = resolveQuantity(line.quantity);
        if (rounded) {
            warnings.push({
                entity: 'PURCHASE',
                externalId,
                code: 'QUANTITY_ROUNDED',
                message: `Purchase ${row.invoice}: quantity ${originalQuantity} rounded to ${quantity} (our line quantities are whole numbers)`,
            });
        }
        const unitCost = toMoney(line.unit_price);
        return {
            externalProductId: String(line.product_id),
            quantity,
            unitCost,
            lineTotal: Math.round(unitCost * quantity * 100) / 100,
        };
    });

    const totalAmount = toMoney(row.total);
    const paidAmount = toMoney(row.paid);

    return {
        externalId,
        purchaseNumber: buildDocumentNumber(documentPrefix, row.invoice),
        referenceNumber: emptyToNull(row.invoice),
        externalSupplierId: emptyToNull(row.supplier_id),
        subtotalAmount: toMoney(row.subtotal),
        taxAmount: toMoney(row.vatAmount),
        discountAmount: toMoney(row.discountAmount),
        freightAmount: toMoney(row.transport_cost),
        totalAmount,
        paidAmount,
        paymentStatus: resolvePaymentStatus(totalAmount, paidAmount),
        notes: emptyToNull(row.description),
        purchaseDate: parseProviderDate(row.date),
        externalUpdatedAt: parseTimestamp(row.updated_at),
        items,
    };
}

export function resolvePaymentStatus(total: number, paid: number): 'UNPAID' | 'PARTIAL' | 'PAID' {
    if (paid <= 0) return 'UNPAID';
    // Tolerate sub-cent drift from the provider's 3dp amounts.
    if (paid + 0.005 >= total) return 'PAID';
    return 'PARTIAL';
}

/** Groups line rows by their parent document id. */
export function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
    const grouped = new Map<string, T[]>();
    for (const row of rows) {
        const id = key(row);
        const existing = grouped.get(id);
        if (existing) existing.push(row);
        else grouped.set(id, [row]);
    }
    return grouped;
}

function emptyToNull(value: string | null | undefined): string | null {
    const trimmed = (value ?? '').trim();
    return trimmed === '' ? null : trimmed;
}

function parseTimestamp(value: string | null | undefined): Date | null {
    if (!value) return null;
    // The provider mixes ISO ("2026-07-23T12:31:15.000000Z") and plain
    // ("2025-07-24 16:01:53") formats across endpoints.
    const normalised = value.includes('T') ? value : value.replace(' ', 'T') + 'Z';
    const parsed = new Date(normalised);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}
