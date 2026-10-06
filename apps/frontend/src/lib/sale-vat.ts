import { computeEntryTax, netUnitPrice, resolveTaxRate } from '@erp71/shared-types';

/**
 * Helpers for showing a stored sale the way it was entered.
 *
 * A sale is always stored VAT-inclusive. One entered with VAT added on top
 * (`prices_include_vat === false`) has its before-VAT prices recovered from the
 * stored price and the rates the line was snapshotted at, which is exact — see
 * `netUnitPrice`.
 */

function rate(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

/**
 * A product's own VAT and SD rates as a cart line carries them: null where the
 * product has none of its own (the shop default then applies). The API sends
 * these Decimal columns as strings.
 */
export function productTaxRates(product: any): { vatRate: number | null; sdRate: number | null } {
    return { vatRate: rate(product?.vat_rate), sdRate: rate(product?.sd_rate) };
}

/** True when a stored document was entered with VAT added on top. */
export function enteredBeforeVat(doc: { prices_include_vat?: boolean | null } | null | undefined): boolean {
    return doc?.prices_include_vat === false;
}

/**
 * The rates a stored sale line was taxed at: its own snapshot, else the
 * product's, else the shop default (lines written before the snapshot existed).
 */
export function saleLineRates(
    item: { vat_rate?: unknown; sd_rate?: unknown; product?: any },
    defaultVatRate = 0,
): { vatRate: number; sdRate: number } {
    const product = productTaxRates(item.product);
    return {
        vatRate: resolveTaxRate(rate(item.vat_rate) ?? product.vatRate, defaultVatRate),
        sdRate: resolveTaxRate(rate(item.sd_rate) ?? product.sdRate, 0),
    };
}

/** A stored, VAT-inclusive unit price back as it was entered before VAT. */
export function enteredUnitPrice(
    item: { price_at_sale?: unknown; vat_rate?: unknown; sd_rate?: unknown; product?: any },
    defaultVatRate = 0,
): number {
    return netUnitPrice(Number(item.price_at_sale ?? 0), saleLineRates(item, defaultVatRate));
}

/**
 * A sale's invoice-level discount in the terms it was entered in.
 *
 * The stored discount is the gap between the VAT-inclusive lines and the total.
 * Entered before VAT, it was scaled up to those terms on the way in
 * (`computeEntryTax`); scaling back by the same share recovers it to within a
 * paisa.
 */
export function enteredDiscount(grossLines: number, netLines: number, total: number): number {
    const grossDiscount = grossLines - total;
    if (grossDiscount <= 0.005 || grossLines <= 0) return 0;
    return Math.round(((grossDiscount * netLines) / grossLines) * 100) / 100;
}

/**
 * A quotation's or sales order's totals. Those documents have no discount row
 * and store their lines as typed, so with VAT added on top the VAT (and any SD,
 * kept together in `vat_amount`) sits between the lines and the total;
 * VAT-inclusive, there is nothing to add and nothing is stored.
 */
export function documentVatTotals(
    lines: { quantity: number; unitPrice: number; vatRate?: number | null; sdRate?: number | null }[],
    pricing: { defaultVatRate: number; pricesIncludeVat: boolean },
): { subtotal: number; vatAmount: number; total: number; vatRate: number | null } {
    const taxLines = lines.map((line, index) => ({
        key: String(index),
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        vatRate: resolveTaxRate(line.vatRate ?? null, pricing.defaultVatRate),
        sdRate: resolveTaxRate(line.sdRate ?? null, 0),
    }));
    const entry = computeEntryTax(taxLines, 0, pricing.pricesIncludeVat);
    const rates = new Set(taxLines.map((line) => line.vatRate));
    const vatRate = taxLines.length === 0 ? pricing.defaultVatRate : rates.size === 1 ? [...rates][0] : null;
    if (pricing.pricesIncludeVat) return { subtotal: entry.subtotal, vatAmount: 0, total: entry.subtotal, vatRate };
    const vatAmount = Math.round((entry.vatAmount + entry.sdAmount) * 100) / 100;
    // Lines plus VAT, exactly: nothing checks a quotation's total against a
    // tax snapshot, so it should at least foot on its face.
    return { subtotal: entry.subtotal, vatAmount, total: Math.round((entry.subtotal + vatAmount) * 100) / 100, vatRate };
}

/**
 * How a quotation or order prices VAT: the shop's setting for a new one, the
 * document's own for an existing one, and never VAT for a foreign-currency
 * proforma — an export price.
 */
export function documentPricing(
    pricesIncludeVat: boolean,
    defaultVatRate: number,
    currency?: string | null,
): { defaultVatRate: number; pricesIncludeVat: boolean } {
    if (currency && currency.toUpperCase() !== 'BDT') return { defaultVatRate: 0, pricesIncludeVat: true };
    return { defaultVatRate, pricesIncludeVat };
}
