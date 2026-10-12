import type { LineItem } from '@/lib/hooks/useNewSaleCart';
import { routes } from '@/lib/routes';
import { grossUpUnitPrice, netUnitPrice, resolveTaxRate } from '@erp71/shared-types';
import {
    enteredBeforeVat,
    enteredDiscount,
    enteredUnitPrice,
    productTaxRates,
    saleLineRates,
} from '@/lib/sale-vat';
import type { VatPricing } from '../components/SaleEntryLayout';

/**
 * A document the entry screen was opened from: a quotation or sales order via
 * "Convert to Sale", or an existing sale via "Duplicate".
 *
 * For the two conversions `id` is echoed back to the backend when the sale is
 * saved (as `quotationId` or `salesOrderId`) so the invoice records where it
 * came from. A duplicate deliberately sends neither — the copy is a standalone
 * sale, not a second invoice against the same order — so there its `id` only
 * feeds the banner, as the rest of this shape does in every case.
 */
export interface SaleSourceDocument {
    kind: 'quotation' | 'salesOrder' | 'sale';
    id: string;
    /** Quote/proforma or order number, as the customer sees it. */
    number: string;
    /** Where the banner links back to. */
    href: string;
    /** Non-BDT proformas are translated on the way in; 1 for everything else. */
    exchangeRate: number;
    currency: string;
    /** Deposits already collected against a sales order, in BDT. */
    amountPaid: number;
}

export interface SeededSale {
    source: SaleSourceDocument;
    items: LineItem[];
    customer: any;
    description: string;
}

/**
 * A missing currency reads as BDT — the column is defaulted and NOT NULL, so
 * the only way to see one absent is a narrowed select.
 *
 * Mirrors the rule `SalesQuotationsService.convertToOrder` applies on the
 * server: a foreign-currency document is translated at the rate written on it,
 * not at a live rate, so the invoice total matches the proforma the customer
 * signed. A document that carries no rate cannot be converted at all rather
 * than booking a foreign figure into a BDT ledger.
 */
export function exchangeRateOf(doc: { currency?: string | null; exchange_rate?: unknown }): number {
    if (!doc.currency || doc.currency === 'BDT') return 1;
    return Number(doc.exchange_rate ?? 0);
}

const lineFrom = (
    item: any,
    unitPrice: unknown,
    rate: number,
    fallbackName: string,
): LineItem => ({
    productId: item.product_id,
    name: item.product?.name || fallbackName,
    price: Number(unitPrice ?? 0) * rate,
    group: item.product?.group?.name,
    subgroup: item.product?.subgroup?.name,
    quantity: item.quantity,
    discount: 0,
    // The product's own VAT/SD rates, so the new sale taxes the line as the
    // catalogue says; the shop default applies where it has none.
    ...productTaxRates(item.product),
    // Neither document's payload carries stock rows, so leave availability
    // unknown rather than claiming zero — same as a voice-entry line.
    availableQty: undefined,
    // Only a sale line carries one; a quotation or order has no warehouse at
    // all, and `?? undefined` is what makes that a no-op rather than a null.
    warehouseId: item.warehouse_id ?? undefined,
});

/**
 * A quotation or order line's price in the terms the new sale is entered in.
 *
 * Those documents store their lines as typed, VAT-inclusive or before VAT
 * (`prices_include_vat`). When the shop has since switched how it prices, the
 * price is converted with the product's rates so the customer is charged what
 * the document said. A foreign-currency proforma is an export price and is
 * taken as it stands.
 */
function inTargetTerms(line: LineItem, docBeforeVat: boolean, pricing: VatPricing, foreign: boolean): LineItem {
    const targetBeforeVat = !pricing.pricesIncludeVat;
    if (foreign || docBeforeVat === targetBeforeVat) return line;
    const rates = {
        vatRate: resolveTaxRate(line.vatRate, pricing.defaultVatRate),
        sdRate: resolveTaxRate(line.sdRate, 0),
    };
    return {
        ...line,
        price: docBeforeVat ? grossUpUnitPrice(line.price, rates) : netUnitPrice(line.price, rates),
    };
}

/** Cart contents for a sale being raised from a quotation or proforma. */
export function seedFromQuotation(quote: any, pricing: VatPricing): SeededSale {
    const rate = exchangeRateOf(quote);
    const foreign = !!quote.currency && quote.currency !== 'BDT';

    return {
        source: {
            kind: 'quotation',
            id: quote.id,
            number: quote.quote_number,
            href: routes.sales.quoteDetail(quote.id),
            exchangeRate: rate,
            currency: quote.currency || 'BDT',
            amountPaid: 0,
        },
        items: (quote.items ?? []).map((item: any) =>
            inTargetTerms(lineFrom(item, item.unit_price, rate, 'Item'), enteredBeforeVat(quote), pricing, foreign),
        ),
        customer: quote.customer ? { ...quote.customer, id: quote.customer_id } : null,
        description: quote.notes || '',
    };
}

/**
 * Cart contents for a sale being copied from an existing one.
 *
 * Payments are deliberately NOT carried over. The lines are what was sold; a
 * payment is money that actually changed hands, and prefilling one would record
 * a receipt nobody made. The operator states how this copy was paid.
 *
 * A sale stores only its final total, so the gap between that and the line
 * subtotal comes across as a single rounding adjustment — the same thing the
 * detail screen does, and for the same reason: the original discount/VAT/
 * transport split is not persisted and must not be invented here.
 *
 * A shop that enters prices before VAT gets the copy in those terms instead:
 * each stored (VAT-inclusive) price is taken back with the rates its line was
 * taxed at, and the gap comes across as a discount, which the screen then
 * adds VAT on top of again.
 */
export function seedFromSale(
    sale: any,
    pricing: VatPricing,
): SeededSale & { rounding: number; discountAmount: number; warehouseId?: string } {
    const beforeVat = !pricing.pricesIncludeVat;
    const items: LineItem[] = (sale.items ?? []).map((item: any) => {
        const rates = saleLineRates(item, pricing.defaultVatRate);
        return {
            ...lineFrom(item, item.price_at_sale, 1, 'Item'),
            ...(beforeVat ? { price: enteredUnitPrice(item, pricing.defaultVatRate) } : {}),
            vatRate: rates.vatRate,
            sdRate: rates.sdRate,
        };
    });
    const subtotal = items.reduce((sum, item) => sum + item.quantity * item.price, 0);
    const total = Number(sale.total_amount ?? 0);
    const grossLines = (sale.items ?? []).reduce(
        (sum: number, item: any) => sum + item.quantity * Number(item.price_at_sale ?? 0),
        0,
    );

    return {
        source: {
            kind: 'sale',
            id: sale.id,
            number: sale.serial_number,
            href: routes.sales.detail(sale.id),
            exchangeRate: 1,
            currency: 'BDT',
            amountPaid: 0,
        },
        items,
        customer: sale.customer ? { ...sale.customer, id: sale.customer_id } : null,
        description: sale.note || '',
        rounding: beforeVat ? 0 : Number((total - subtotal).toFixed(2)),
        discountAmount: beforeVat ? enteredDiscount(grossLines, subtotal, total) : 0,
        // A copy sells out of the same place unless the user says otherwise.
        warehouseId: sale.warehouse_id ?? undefined,
    };
}

/** Cart contents for a sale being raised from a sales order. */
export function seedFromSalesOrder(order: any, pricing: VatPricing): SeededSale {
    return {
        source: {
            kind: 'salesOrder',
            id: order.id,
            number: order.order_number,
            href: routes.sales.orderDetail(order.id),
            // A sales order has no currency column — the ledger behind it is
            // BDT-only, and a foreign proforma was already translated on its
            // way into the order.
            exchangeRate: 1,
            currency: 'BDT',
            amountPaid: Number(order.amount_paid ?? 0),
        },
        items: (order.items ?? []).map((item: any) =>
            inTargetTerms(lineFrom(item, item.price_at_order, 1, 'Item'), enteredBeforeVat(order), pricing, false),
        ),
        customer: order.customer ? { ...order.customer, id: order.customer_id } : null,
        description: '',
    };
}
