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

/**
 * Where the buyer remits. Present only on a proforma, and only when the seller
 * has filled the details in — a null here means "not configured", and the page
 * shows nothing rather than an empty bank panel.
 */
export type PublicBeneficiaryBank = {
    bank_name: string | null;
    bank_branch: string | null;
    account_name: string | null;
    account_number: string | null;
    routing_number: string | null;
    swift_code: string | null;
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

    /// QUOTE | PROFORMA. The page reads this to decide what to call itself and
    /// whether to render the terms and bank panels at all.
    doc_kind: string;
    currency: string;
    incoterm: string | null;
    port_of_loading: string | null;
    port_of_discharge: string | null;
    payment_terms: string | null;
    advance_percent: number | null;
    advance_amount: number | null;
    delivery_lead_time_days: number | null;
    country_of_origin: string | null;
    beneficiary_bank: PublicBeneficiaryBank | null;
};

const money = (value: unknown): number => Number(value ?? 0);

export function toPublicQuotation(row: any, bank?: any): PublicQuotation {
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

    const total_amount = money(row.total_amount);
    const advance_percent = row.advance_percent == null ? null : Number(row.advance_percent);

    // Any bank column filled counts as configured. Requiring all six would hide
    // the panel from a domestic seller who has no SWIFT code and does not need
    // one; requiring none would render an empty box on every proforma.
    const hasBank = bank
        ? Object.values(bank).some((value) => typeof value === 'string' && value.trim() !== '')
        : false;

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
        total_amount,

        doc_kind: row.doc_kind ?? 'QUOTE',
        currency: row.currency ?? 'BDT',
        incoterm: row.incoterm ?? null,
        port_of_loading: row.port_of_loading ?? null,
        port_of_discharge: row.port_of_discharge ?? null,
        payment_terms: row.payment_terms ?? null,
        advance_percent,
        // Computed rather than left to the page: the buyer's question is "how
        // much do I send now", and every client that renders this document
        // otherwise has to re-derive the same rounding.
        advance_amount: advance_percent
            ? Math.round(total_amount * advance_percent) / 100
            : null,
        delivery_lead_time_days: row.delivery_lead_time_days ?? null,
        country_of_origin: row.country_of_origin ?? null,
        beneficiary_bank: hasBank
            ? {
                  bank_name: bank.bank_name ?? null,
                  bank_branch: bank.bank_branch ?? null,
                  account_name: bank.bank_account_name ?? null,
                  account_number: bank.bank_account_number ?? null,
                  routing_number: bank.bank_routing_number ?? null,
                  swift_code: bank.bank_swift_code ?? null,
              }
            : null,
    };
}
