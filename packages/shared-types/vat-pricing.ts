/**
 * Prices entered before VAT, with the tax added on top.
 *
 * A shop chooses how it prices (`Tenant.prices_include_vat`). ERP71 *stores*
 * every sale VAT-inclusive either way — `SaleItem.price_at_sale` is what the
 * customer pays for one unit, taxes included — so the server's total check,
 * the tax snapshot, Mushak, returns and reports read every sale alike. A shop
 * that prices before VAT therefore has its prices converted on the way in, and
 * converted back to show a stored sale the way it was entered.
 *
 * The entry screens and the server must reach the same total and the same VAT
 * to the paisa, or the server refuses the sale ("Sale total mismatch") or a
 * printed invoice disagrees with its Mushak. That is why the VAT here is not
 * "15% of the subtotal" but `computeSaleTax` run on exactly what will be posted
 * — the very calculation the server snapshots.
 */

import { computeSaleTax, roundMoney, type MushakTaxRates } from './mushak';

function factor(rates: MushakTaxRates): number {
  const vat = Number.isFinite(rates.vatRate) ? Math.max(0, rates.vatRate) : 0;
  const sd = Number.isFinite(rates.sdRate) ? Math.max(0, rates.sdRate) : 0;
  // SD is levied on the value of the supply, VAT on the value plus the SD.
  return (1 + sd / 100) * (1 + vat / 100);
}

/** A before-VAT unit price with its VAT (and SD) added — what is stored. */
export function grossUpUnitPrice(net: number, rates: MushakTaxRates): number {
  return roundMoney(net * factor(rates));
}

/**
 * A stored, VAT-inclusive unit price taken back to the before-VAT price it was
 * entered as. For a price in whole paisa this returns exactly what was typed:
 * gross-up rounds by at most half a paisa, and dividing that error by a factor
 * of at least one keeps it under half a paisa.
 */
export function netUnitPrice(gross: number, rates: MushakTaxRates): number {
  return roundMoney(gross / factor(rates));
}

export interface EntryTaxLine extends MushakTaxRates {
  /** Echoed back by `computeSaleTax`; any stable id. */
  key: string;
  quantity: number;
  /** The unit price as entered — VAT-inclusive or before VAT, per the mode. */
  unitPrice: number;
}

export interface EntryTax {
  /** Unit prices to post, line for line: always VAT-inclusive. */
  postedUnitPrices: number[];
  /** Σ quantity × entered price — the Sub Total a screen shows. */
  subtotal: number;
  /** The discount as entered, capped at the subtotal. */
  discount: number;
  /**
   * The discount to show beside the other figures. With VAT added on top it is
   * worked back from them (subtotal + VAT + SD − total), so the block always
   * foots; it differs from the typed discount by paisa rounding at most.
   */
  discountShown: number;
  /** The discount to post, in the same VAT-inclusive terms as the prices. */
  postedDiscount: number;
  vatAmount: number;
  sdAmount: number;
  /** What the customer pays. */
  total: number;
}

function sum(values: number[]): number {
  return roundMoney(values.reduce((acc, value) => acc + value, 0));
}

/**
 * What an entry screen shows and posts for its lines and discount.
 *
 * Prices include VAT: the lines are posted as typed and the VAT shown is the
 * part already inside the discounted total. VAT added on top: each line is
 * grossed up with its own rates, the discount is scaled to the same
 * VAT-inclusive terms, and the VAT is what lies between the result and its
 * before-VAT value — charged on the amount after the discount.
 */
export function computeEntryTax(
  lines: EntryTaxLine[],
  discount: number,
  pricesIncludeVat: boolean,
): EntryTax {
  const subtotal = sum(lines.map((line) => roundMoney(line.quantity * line.unitPrice)));
  const typed = roundMoney(Math.min(Math.max(Number.isFinite(discount) ? discount : 0, 0), subtotal));

  if (pricesIncludeVat) {
    const total = roundMoney(subtotal - typed);
    const tax = computeSaleTax(lines, total);
    return {
      postedUnitPrices: lines.map((line) => line.unitPrice),
      subtotal,
      discount: typed,
      discountShown: typed,
      postedDiscount: typed,
      vatAmount: tax.vatAmount,
      sdAmount: tax.sdAmount,
      total,
    };
  }

  const postedUnitPrices = lines.map((line) => grossUpUnitPrice(line.unitPrice, line));
  const posted = lines.map((line, index) => ({ ...line, unitPrice: postedUnitPrices[index] }));
  const gross = sum(posted.map((line) => roundMoney(line.quantity * line.unitPrice)));
  // The same share of the VAT-inclusive lines as the typed discount is of the
  // before-VAT ones. With one rate that is simply the discount plus its VAT.
  const postedDiscount = subtotal > 0 ? Math.min(roundMoney((typed * gross) / subtotal), gross) : 0;
  const total = roundMoney(gross - postedDiscount);
  const tax = computeSaleTax(posted, total);

  return {
    postedUnitPrices,
    subtotal,
    discount: typed,
    discountShown: roundMoney(subtotal + tax.vatAmount + tax.sdAmount - total),
    postedDiscount,
    vatAmount: tax.vatAmount,
    sdAmount: tax.sdAmount,
    total,
  };
}
