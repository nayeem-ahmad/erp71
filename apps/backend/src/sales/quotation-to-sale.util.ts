import { grossUpUnitPrice, resolveTaxRate, roundMoney } from '@erp71/shared-types';

/** Most quotations one "Convert to sales" run takes — a list page, roughly. */
export const QUOTATION_BATCH_LIMIT = 50;

/**
 * The statuses a quotation can still be invoiced from in bulk. CONVERTED has
 * already been, REVISED was replaced by a newer version, and REJECTED or
 * EXPIRED is an offer the customer never took up. The single-quote "Convert to
 * Sale" screen lets a person override that judgement; a batch, with nobody
 * looking at each row, does not.
 */
export const BULK_CONVERTIBLE_QUOTATION_STATUSES = ['DRAFT', 'SENT', 'ACCEPTED'] as const;

export type QuotationSkipReason =
    | 'NOT_FOUND'
    | 'NOT_CONVERTIBLE'
    | 'ALREADY_INVOICED'
    | 'NO_CUSTOMER'
    | 'NO_ITEMS'
    | 'NO_EXCHANGE_RATE'
    | 'BRANCH_FORBIDDEN'
    | 'TOTAL_CHANGED';

export interface QuotationRef {
    quotationId: string;
    /** Null only for an id that matched no quotation in this workspace. */
    quoteNumber: string | null;
}

export interface QuotationConversionResult {
    converted: (QuotationRef & { saleId: string; serialNumber: string; totalAmount: number })[];
    /** Never attempted: the quotation is not something a batch should invoice. */
    skipped: (QuotationRef & { reason: QuotationSkipReason; status?: string })[];
    /** Attempted and refused by the sale itself — stock, credit limit, warehouse. */
    failed: (QuotationRef & { message: string })[];
}

export interface QuotationForSale {
    status: string;
    customer_id: string | null;
    currency: string | null;
    exchange_rate: unknown;
    prices_include_vat: boolean | null;
    total_amount: unknown;
    items: {
        product_id: string;
        quantity: number;
        unit_price: unknown;
        product: { vat_rate: unknown; sd_rate: unknown } | null;
    }[];
}

export interface QuotationSalePricing {
    items: { productId: string; quantity: number; priceAtSale: number }[];
    totalAmount: number;
    /** How the quotation was priced, so the sale is shown back the same way. */
    pricesIncludeVat: boolean;
    /** The quotation's own total, in BDT. */
    quotedTotal: number;
}

function rate(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

const isForeign = (quote: Pick<QuotationForSale, 'currency'>) => !!quote.currency && quote.currency !== 'BDT';

/**
 * 1 for a BDT document, the rate written on it otherwise, and 0 when a foreign
 * document carries none — the same rule as `convertToOrder` and the sale entry
 * screen's `exchangeRateOf`.
 */
export function quotationExchangeRate(quote: Pick<QuotationForSale, 'currency' | 'exchange_rate'>): number {
    if (!isForeign(quote)) return 1;
    return Number(quote.exchange_rate ?? 0) || 0;
}

/**
 * Why a quotation should not be invoiced by a batch, judged from the row
 * alone. Branch access and the repriced total are checked by the caller.
 *
 * A credit sale keeps its whole total as the customer's due, and the server
 * refuses due on a walk-in sale, so a quotation with no customer is skipped
 * here rather than failed later.
 */
export function quotationSkipReason(
    quote: QuotationForSale,
    alreadyInvoiced: boolean,
): QuotationSkipReason | null {
    if (!(BULK_CONVERTIBLE_QUOTATION_STATUSES as readonly string[]).includes(quote.status)) {
        return 'NOT_CONVERTIBLE';
    }
    // A sale already raised against it, draft or posted: invoicing it again
    // would bill the customer twice for one offer.
    if (alreadyInvoiced) return 'ALREADY_INVOICED';
    if (!quote.customer_id) return 'NO_CUSTOMER';
    if (quote.items.length === 0) return 'NO_ITEMS';
    if (!quotationExchangeRate(quote)) return 'NO_EXCHANGE_RATE';
    return null;
}

/**
 * The sale lines a quotation becomes, in the terms a sale is stored in.
 *
 * A sale is always stored VAT-inclusive (`SaleItem.price_at_sale` is what the
 * customer pays for one unit), so a quotation priced before VAT has each line
 * grossed up with its product's rates — the shop default where the product
 * has none — exactly as the sale entry screen does when it is opened from the
 * quotation. A foreign-currency proforma is an export price: translated at the
 * rate written on it and never grossed up.
 *
 * Every unit price is taken to the paisa, as `price_at_sale` stores it, so the
 * stored lines foot to the stored total. A translated proforma price is the
 * only one that would otherwise carry more decimals than the column keeps.
 */
export function priceQuotationForSale(quote: QuotationForSale, defaultVatRate: number): QuotationSalePricing {
    const exchangeRate = quotationExchangeRate(quote);
    const foreign = isForeign(quote);
    const beforeVat = !foreign && quote.prices_include_vat === false;

    const items = quote.items.map((item) => {
        const price = Number(item.unit_price ?? 0) * exchangeRate;
        const rates = {
            vatRate: resolveTaxRate(rate(item.product?.vat_rate), defaultVatRate),
            sdRate: resolveTaxRate(rate(item.product?.sd_rate), 0),
        };
        return {
            productId: item.product_id,
            quantity: item.quantity,
            priceAtSale: beforeVat ? grossUpUnitPrice(price, rates) : roundMoney(price),
        };
    });

    return {
        items,
        totalAmount: roundMoney(items.reduce((sum, item) => sum + item.quantity * item.priceAtSale, 0)),
        pricesIncludeVat: !beforeVat,
        quotedTotal: roundMoney(Number(quote.total_amount ?? 0) * exchangeRate),
    };
}

/**
 * Whether the sale would bill a different amount from the one quoted.
 *
 * Taking each unit price to the paisa moves it by up to half a paisa, which a
 * line's quantity then multiplies, so the tolerance grows with the units
 * sold. Anything past that means a product's VAT rate changed since the quote
 * was written, or the quotation's total was never its lines (an imported
 * document with a discount the lines do not carry) — either way a person
 * should look at it before it is invoiced.
 */
export function totalChangedSinceQuoted(pricing: QuotationSalePricing): boolean {
    const units = pricing.items.reduce((sum, item) => sum + Math.abs(item.quantity), 0);
    const tolerance = 0.01 + 0.005 * units;
    return Math.abs(pricing.totalAmount - pricing.quotedTotal) > tolerance;
}
