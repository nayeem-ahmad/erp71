import {
    computeSaleTax,
    resolveTaxRate,
    type MushakSaleLineTax,
} from '@erp71/shared-types';

/**
 * Working out the VAT and supplementary duty a sale carries, at the moment it
 * is posted.
 *
 * The arithmetic itself lives in `@erp71/shared-types` so the frontend can show
 * the same figures before anything is saved; this file is the database half —
 * reading the rates in force and shaping the result into the columns
 * `SaleItem` and `Sale` store.
 *
 * Why store it at all, rather than derive it when a tax invoice is printed:
 * a Mushak 6.3 is a statutory document NBR holds its own copy of. Re-deriving
 * from today's catalogue would restate last quarter's invoices the first time
 * anybody edits a VAT rate, and the 6.2 sales book built from the same rates
 * would move with them. Snapshotting is what makes a reprint a reprint.
 */

export interface SaleTaxLineInput {
    productId: string;
    quantity: number;
    /** Price as charged, taxes included — what `SaleItem.price_at_sale` holds. */
    priceAtSale: number;
}

/** The tax columns of one `SaleItem`, in database shape. */
export interface SaleItemTaxColumns {
    vat_rate: number;
    sd_rate: number;
    vat_amount: number;
    sd_amount: number;
}

export interface SaleTaxSnapshot {
    /** Keyed by the line's position in the input array, since two lines may
     *  carry the same product and must still be stored separately. */
    lines: SaleItemTaxColumns[];
    /** The `Sale` rollups. Contained in `total_amount`, never added to it. */
    vat_amount: number;
    sd_amount: number;
    /** Value of the supply — `total_amount` less both taxes. */
    taxable_value: number;
}

const EMPTY_SNAPSHOT: SaleTaxSnapshot = {
    lines: [],
    vat_amount: 0,
    sd_amount: 0,
    taxable_value: 0,
};

/**
 * The rates in force for a set of products: the product's own override where
 * it has one, the workspace default otherwise. One query for the products and
 * one for the workspace, whatever the length of the sale.
 */
export async function loadTaxRates(
    tx: {
        product: { findMany(args: any): Promise<any[]> };
        tenant: { findUnique(args: any): Promise<any> };
    },
    tenantId: string,
    productIds: string[],
): Promise<Map<string, { vatRate: number; sdRate: number }>> {
    const unique = [...new Set(productIds)];
    const [products, tenant] = await Promise.all([
        unique.length
            ? tx.product.findMany({
                  where: { tenant_id: tenantId, id: { in: unique } },
                  select: { id: true, vat_rate: true, sd_rate: true },
              })
            : Promise.resolve([]),
        tx.tenant.findUnique({
            where: { id: tenantId },
            select: { default_vat_rate: true },
        }),
    ]);

    const tenantVatRate = tenant?.default_vat_rate != null ? Number(tenant.default_vat_rate) : null;

    const rates = new Map<string, { vatRate: number; sdRate: number }>();
    for (const product of products) {
        rates.set(product.id, {
            vatRate: resolveTaxRate(
                product.vat_rate != null ? Number(product.vat_rate) : null,
                tenantVatRate,
            ),
            // Supplementary duty is a Third Schedule commodity rate. There is
            // deliberately no workspace fallback: a business does not have an
            // SD rate, only particular goods do.
            sdRate: product.sd_rate != null ? Math.max(0, Number(product.sd_rate)) : 0,
        });
    }

    // A product that vanished between the cart and the post still has to price;
    // the workspace rate is the only defensible answer left.
    for (const id of unique) {
        if (!rates.has(id)) {
            rates.set(id, { vatRate: resolveTaxRate(null, tenantVatRate), sdRate: 0 });
        }
    }

    return rates;
}

/**
 * Turn the rates and the lines into the columns to write.
 *
 * `invoiceTotal` is what the customer is actually billed. When it is below the
 * sum of the lines — a promo code, redeemed loyalty points, a typed discount,
 * none of which ERP71 keeps on the lines — the reduction is spread back over
 * them before tax is worked out, because a lower consideration is a lower
 * value of supply. Without that the invoice would declare output VAT the
 * business never collected, and the 6.3 would not foot to its own total.
 */
export function buildSaleTaxSnapshot(
    lines: SaleTaxLineInput[],
    rates: Map<string, { vatRate: number; sdRate: number }>,
    invoiceTotal?: number | null,
): SaleTaxSnapshot {
    if (lines.length === 0) return { ...EMPTY_SNAPSHOT, lines: [] };

    const tax = computeSaleTax(
        lines.map((line, index) => {
            const rate = rates.get(line.productId) ?? { vatRate: 0, sdRate: 0 };
            return {
                key: String(index),
                quantity: line.quantity,
                unitPrice: line.priceAtSale,
                vatRate: rate.vatRate,
                sdRate: rate.sdRate,
            };
        }),
        invoiceTotal,
    );

    return {
        lines: tax.lines.map(toColumns),
        vat_amount: tax.vatAmount,
        sd_amount: tax.sdAmount,
        taxable_value: tax.taxableValue,
    };
}

function toColumns(line: MushakSaleLineTax): SaleItemTaxColumns {
    return {
        vat_rate: line.vatRate,
        sd_rate: line.sdRate,
        vat_amount: line.vatAmount,
        sd_amount: line.sdAmount,
    };
}

/**
 * Both halves in one call, for the posting paths that have a transaction
 * client to hand. Returns a snapshot whose `lines` line up positionally with
 * the `lines` passed in.
 */
export async function snapshotSaleTax(
    tx: Parameters<typeof loadTaxRates>[0],
    tenantId: string,
    lines: SaleTaxLineInput[],
    invoiceTotal?: number | null,
): Promise<SaleTaxSnapshot> {
    if (lines.length === 0) return { ...EMPTY_SNAPSHOT, lines: [] };
    const rates = await loadTaxRates(tx, tenantId, lines.map((line) => line.productId));
    return buildSaleTaxSnapshot(lines, rates, invoiceTotal);
}
