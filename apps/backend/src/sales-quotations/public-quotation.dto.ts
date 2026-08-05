/**
 * The customer-facing shape of a quotation.
 *
 * Built as an explicit allow-list, never a spread of the Prisma row: this object
 * is served to anyone holding the link, so a column added to Quotation later
 * cannot reach a public page — it is simply not copied across, and the
 * accompanying test stays green because the output is unchanged. What that test
 * pins is the exact output key set, so it fails the moment someone *adds a key
 * here*, which is the only way a new field can ever get out. That is also why no
 * internal identifier is included — a customer needs to read a quote, not to
 * learn our tenant, store, product or customer ids.
 */

export type PublicQuotationItem = {
    product_name: string;
    quantity: number;
    unit_price: number;
    line_total: number;
};

export type PublicQuotation = {
    quote_number: string;
    version: number;
    status: string;
    created_at: Date;
    valid_until: Date | null;
    customer_name: string;
    seller_name: string;
    notes: string | null;
    items: PublicQuotationItem[];
    total_amount: number;
};

const money = (value: unknown): number => Number(value ?? 0);

export function toPublicQuotation(row: any): PublicQuotation {
    const items: PublicQuotationItem[] = (row.items ?? []).map((item: any) => {
        const quantity = Number(item.quantity ?? 0);
        const unit_price = money(item.unit_price);
        return {
            product_name: item.product?.name ?? '',
            quantity,
            unit_price,
            line_total: quantity * unit_price,
        };
    });

    return {
        quote_number: row.quote_number,
        version: row.version,
        status: row.status,
        created_at: row.created_at,
        valid_until: row.valid_until ?? null,
        customer_name: row.customer?.name ?? '',
        seller_name: row.store?.name ?? '',
        notes: row.notes ?? null,
        items,
        total_amount: money(row.total_amount),
    };
}
