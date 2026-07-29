import {
    ExpressRetailCustomer,
    ExpressRetailPayment,
    ExpressRetailProduct,
    ExpressRetailPurchase,
    ExpressRetailPurchaseLine,
    ExpressRetailSale,
    ExpressRetailSaleLine,
    ExpressRetailSaleReturn,
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
    /** Opening balance from the provider; zero for most parties. */
    previousDue: number;
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
        previousDue: toMoney(row.previous_due),
        externalUpdatedAt: parseTimestamp(row.updated_at),
    };
}

export interface MappedSupplier {
    externalId: string;
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    /** Opening balance from the provider; zero for most parties. */
    previousDue: number;
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
        previousDue: toMoney(row.previous_due),
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
    /**
     * Which account the money actually landed in. The provider splits `paid`
     * into cashPaid/bankPaid, so a posted import can debit the right side
     * instead of assuming cash.
     */
    paymentMode: 'cash' | 'bank';
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
        // Mixed cash+bank settlements are rare; the larger side wins, since a
        // posting has to pick one debit account.
        paymentMode: toMoney(row.bankPaid) > toMoney(row.cashPaid) ? 'bank' : 'cash',
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
export interface MappedSaleReturnItem {
    externalProductId: string;
    quantity: number;
    refundAmount: number;
}

export interface MappedSaleReturn {
    externalId: string;
    returnNumber: string;
    /** The provider's own transaction number, unprefixed. */
    referenceNumber: string | null;
    /** From the nested `sale` object — the return has no sale_id column. */
    externalSaleId: string | null;
    totalRefund: number;
    reason: string | null;
    returnDate: Date;
    externalUpdatedAt: Date | null;
    items: MappedSaleReturnItem[];
}

export function mapSaleReturn(
    row: ExpressRetailSaleReturn,
    documentPrefix: string,
    warnings: SyncWarning[],
): MappedSaleReturn {
    const externalId = String(row.id);

    const items: MappedSaleReturnItem[] = (row.sale_return_details ?? []).map((line) => {
        const { quantity, rounded, originalQuantity } = resolveQuantity(line.quantity);
        if (rounded) {
            warnings.push({
                entity: 'SALE_RETURN',
                externalId,
                code: 'QUANTITY_ROUNDED',
                message: `Return ${row.invoice}: quantity ${originalQuantity} rounded to ${quantity} (our line quantities are whole numbers)`,
            });
        }
        // The provider gives the line total directly; fall back to unit × qty
        // only if it is missing.
        const lineAmount = toMoney(line.amount);
        return {
            externalProductId: String(line.product_id),
            quantity,
            refundAmount: lineAmount > 0 ? lineAmount : Math.round(toMoney(line.unit_price) * quantity * 100) / 100,
        };
    });

    return {
        externalId,
        returnNumber: buildDocumentNumber(documentPrefix, row.invoice),
        referenceNumber: emptyToNull(row.invoice),
        externalSaleId: row.sale ? String(row.sale.id) : null,
        totalRefund: toMoney(row.amount),
        reason: emptyToNull(row.description),
        returnDate: parseProviderDate(row.date),
        externalUpdatedAt: parseTimestamp(row.updated_at),
        items,
    };
}

/** Which way the cash moved, from our side. */
export type PaymentDirection = 'IN' | 'OUT';

export type PaymentParty = 'CUSTOMER' | 'SUPPLIER';

export interface MappedPayment {
    externalId: string;
    /** Prefixed, so an imported payment cannot collide with our own numbering. */
    paymentNumber: string;
    /** The provider's own transaction number, unprefixed. */
    referenceNumber: string | null;
    externalPartyId: string | null;
    direction: PaymentDirection;
    amount: number;
    date: Date;
    method: string | null;
    /** The provider's due for this party before the payment; customer rows only. */
    previousDue: number | null;
    note: string | null;
    externalUpdatedAt: Date | null;
}

/**
 * The provider's `type` is a cash direction, not a party role: CR is cash
 * received, CP is cash paid. Both values appear in both lists, because a
 * customer can be refunded and a supplier can refund us.
 *
 * This is deliberately strict — an unrecognised code returns null so the caller
 * can skip the row rather than guess a direction. Every sampled `amount` was
 * positive, so a wrong guess would move a balance the wrong way rather than
 * fail loudly.
 */
export function resolvePaymentDirection(type: string | null | undefined): PaymentDirection | null {
    switch ((type ?? '').trim().toUpperCase()) {
        case 'CR':
            return 'IN';
        case 'CP':
            return 'OUT';
        default:
            return null;
    }
}

/**
 * Returns null when the row cannot be mapped safely; a warning is pushed so the
 * run row explains what was dropped and why.
 */
export function mapPayment(
    row: ExpressRetailPayment,
    party: PaymentParty,
    documentPrefix: string,
    warnings: SyncWarning[],
): MappedPayment | null {
    const externalId = String(row.id);
    const entity = party === 'CUSTOMER' ? 'CUSTOMER_PAYMENT' : 'SUPPLIER_PAYMENT';

    const direction = resolvePaymentDirection(row.type);
    if (!direction) {
        warnings.push({
            entity,
            externalId,
            code: 'PAYMENT_TYPE_UNKNOWN',
            message: `Payment ${row.invoice}: unrecognised type "${row.type}" — skipped rather than guess whether it was money in or out`,
        });
        return null;
    }

    const amount = toMoney(row.amount);
    if (amount <= 0) {
        warnings.push({
            entity,
            externalId,
            code: 'PAYMENT_AMOUNT_INVALID',
            message: `Payment ${row.invoice}: amount ${row.amount ?? 'null'} is not a positive number — skipped`,
        });
        return null;
    }

    const externalPartyId = party === 'CUSTOMER'
        ? emptyToNull(row.customer_id ?? null)
        : emptyToNull(row.supplier_id ?? null);

    const previousDue = row.previous_due != null ? toMoney(row.previous_due) : null;

    // The credit-transaction models have no payment-method column, so keep the
    // provider's method in the note rather than lose it.
    const method = emptyToNull(row.method);
    const noteParts = [emptyToNull(row.note), method ? `via ${method}` : null].filter(Boolean);

    return {
        externalId,
        paymentNumber: buildDocumentNumber(documentPrefix, row.invoice),
        referenceNumber: emptyToNull(row.invoice),
        externalPartyId,
        direction,
        amount,
        date: parseProviderDate(row.date),
        method,
        previousDue,
        note: noteParts.length ? noteParts.join(' — ') : null,
        externalUpdatedAt: parseTimestamp(row.updated_at),
    };
}

/**
 * Our credit models express direction as PAYMENT/PAYOUT relative to the party,
 * so the same cash direction means opposite things on the two sides: money in
 * from a customer settles their due, whereas money in from a supplier is a
 * refund that increases what we owe them.
 */
export function creditTransactionType(party: PaymentParty, direction: PaymentDirection): 'PAYMENT' | 'PAYOUT' {
    if (party === 'CUSTOMER') return direction === 'IN' ? 'PAYMENT' : 'PAYOUT';
    return direction === 'OUT' ? 'PAYMENT' : 'PAYOUT';
}

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
