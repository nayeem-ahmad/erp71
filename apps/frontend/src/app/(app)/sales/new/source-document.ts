import type { LineItem } from '@/lib/hooks/useNewSaleCart';
import { routes } from '@/lib/routes';

/**
 * A quotation or sales order the entry screen was opened from via the
 * "Convert to Sale" action on the corresponding list.
 *
 * `id` is echoed back to the backend when the sale is saved (as `quotationId`
 * or `salesOrderId`) so the invoice records where it came from; everything else
 * here only feeds the banner.
 */
export interface SaleSourceDocument {
    kind: 'quotation' | 'salesOrder';
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
