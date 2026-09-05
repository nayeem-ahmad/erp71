import type { LineItem } from '@/lib/hooks/useNewSaleCart';
import { routes } from '@/lib/routes';

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
    // Neither document's payload carries stock rows, so leave availability
    // unknown rather than claiming zero — same as a voice-entry line.
    availableQty: undefined,
});

/** Cart contents for a sale being raised from a quotation or proforma. */
export function seedFromQuotation(quote: any): SeededSale {
    const rate = exchangeRateOf(quote);

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
        items: (quote.items ?? []).map((item: any) => lineFrom(item, item.unit_price, rate, 'Item')),
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
 */
export function seedFromSale(sale: any): SeededSale & { rounding: number } {
    const items: LineItem[] = (sale.items ?? []).map((item: any) =>
        lineFrom(item, item.price_at_sale, 1, 'Item'),
    );
    const subtotal = items.reduce((sum, item) => sum + item.quantity * item.price, 0);

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
        rounding: Number((Number(sale.total_amount ?? 0) - subtotal).toFixed(2)),
    };
}

/** Cart contents for a sale being raised from a sales order. */
export function seedFromSalesOrder(order: any): SeededSale {
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
        items: (order.items ?? []).map((item: any) => lineFrom(item, item.price_at_order, 1, 'Item')),
        customer: order.customer ? { ...order.customer, id: order.customer_id } : null,
        description: '',
    };
}
