/**
 * Mushak (মূসক) 6.x — the NBR document family a VAT-registered Bangladeshi
 * business has to issue and keep.
 *
 * Everything here is deliberately framework-free and lives in shared-types
 * because three places need exactly the same answers and must never drift:
 *
 *  - the backend, which snapshots VAT and supplementary duty onto each sale
 *    line as the sale is posted;
 *  - the Mushak document endpoints, which re-read those snapshots to build a
 *    6.3 tax invoice, a 6.2 sales book, a 6.7 credit note or a 6.10 statement;
 *  - the frontend, which lays the documents out in the gazetted column order.
 *
 * The statutory reference throughout is the Value Added Tax and Supplementary
 * Duty Act 2012 and the Rules 2016; each form below carries the rule that
 * prescribes it so the citation printed on a document comes from one place.
 */

// ── Form catalogue ──────────────────────────────────────────────────────────

export const MushakForm = {
  /** ক্রয় হিসাব পুস্তক — purchase book. */
  PURCHASE_BOOK: "6.1",
  /** বিক্রয় হিসাব পুস্তক — sales book. */
  SALES_BOOK: "6.2",
  /** ক্রয়-বিক্রয় হিসাব পুস্তক — combined book for traders. */
  PURCHASE_SALES_BOOK: "6.2.1",
  /** কর চালানপত্র — tax invoice. */
  TAX_INVOICE: "6.3",
  /** সংকুচিত ভিত্তিমূল্যে/চুক্তিভিত্তিক উৎপাদনের চালানপত্র. */
  CONTRACT_MANUFACTURING_INVOICE: "6.4",
  /** কেন্দ্রীয় নিবন্ধিত প্রতিষ্ঠানের স্থানান্তর চালানপত্র — branch transfer note. */
  TRANSFER_INVOICE: "6.5",
  /** উৎসে কর কর্তন সনদপত্র — VAT-deducted-at-source certificate. */
  VDS_CERTIFICATE: "6.6",
  /** ক্রেডিট নোট — credit note, reducing the value of a supply already invoiced. */
  CREDIT_NOTE: "6.7",
  /** ডেবিট নোট — debit note, increasing it. */
  DEBIT_NOTE: "6.8",
  /** মেরামত/সেবার জন্য প্রেরিত পণ্যের হিসাব. */
  REPAIR_REGISTER: "6.9",
  /** অনিবন্ধিত ক্রেতার নিকট ২ লক্ষ টাকার ঊর্ধ্বে সরবরাহের তালিকা. */
  LARGE_SUPPLY_STATEMENT: "6.10",
} as const;
export type MushakForm = (typeof MushakForm)[keyof typeof MushakForm];

export interface MushakFormMeta {
  code: MushakForm;
  /** Gazetted Bangla title, printed as the document heading. */
  titleBn: string;
  /** Working English gloss. Never printed alone — it sits under the Bangla. */
  titleEn: string;
  /** The rule that prescribes the form, printed under the heading. */
  ruleBn: string;
  /**
   * Whether this build actually produces the form. `false` is not a promise
   * that it is coming — it is what the UI shows so a user is never left
   * believing the system files something on their behalf that it does not.
   */
  supported: boolean;
  /** Which module the form is produced from, for the "supported" ones. */
  module?: "sales" | "purchases";
}

/**
 * Ordered so a list of forms reads the way NBR numbers them rather than the
 * order this product happened to implement them in.
 */
export const MUSHAK_FORMS: readonly MushakFormMeta[] = [
  {
    code: MushakForm.PURCHASE_BOOK,
    titleBn: "ক্রয় হিসাব পুস্তক",
    titleEn: "Purchase book",
    ruleBn: "[বিধি ৪০ এর উপ-বিধি (১) এর দফা (গ) দ্রষ্টব্য]",
    supported: false,
  },
  {
    code: MushakForm.SALES_BOOK,
    titleBn: "বিক্রয় হিসাব পুস্তক",
    titleEn: "Sales book",
    ruleBn: "[বিধি ৪০ এর উপ-বিধি (১) এর দফা (ঘ) দ্রষ্টব্য]",
    supported: true,
    module: "sales",
  },
  {
    code: MushakForm.PURCHASE_SALES_BOOK,
    titleBn: "ক্রয়-বিক্রয় হিসাব পুস্তক",
    titleEn: "Purchase and sales book",
    ruleBn: "[বিধি ৪০ এর উপ-বিধি (১) এর দফা (ঙ) দ্রষ্টব্য]",
    supported: false,
  },
  {
    code: MushakForm.TAX_INVOICE,
    titleBn: "কর চালানপত্র",
    titleEn: "Tax invoice",
    ruleBn: "[বিধি ৪০ এর উপ-বিধি (১) এর দফা (চ) দ্রষ্টব্য]",
    supported: true,
    module: "sales",
  },
  {
    code: MushakForm.CONTRACT_MANUFACTURING_INVOICE,
    titleBn: "চুক্তিভিত্তিক উৎপাদনের চালানপত্র",
    titleEn: "Contract manufacturing invoice",
    ruleBn: "[বিধি ৪০ এর উপ-বিধি (১) এর দফা (ছ) দ্রষ্টব্য]",
    supported: false,
  },
  {
    code: MushakForm.TRANSFER_INVOICE,
    titleBn: "কেন্দ্রীয়ভাবে নিবন্ধিত প্রতিষ্ঠানের স্থানান্তর চালানপত্র",
    titleEn: "Branch transfer invoice",
    ruleBn: "[বিধি ৪০ এর উপ-বিধি (১) এর দফা (জ) দ্রষ্টব্য]",
    supported: false,
  },
  {
    code: MushakForm.VDS_CERTIFICATE,
    titleBn: "উৎসে কর কর্তন সনদপত্র",
    titleEn: "VAT deducted at source certificate",
    ruleBn: "[বিধি ৪০ এর উপ-বিধি (১) এর দফা (ঝ) দ্রষ্টব্য]",
    supported: false,
  },
  {
    code: MushakForm.CREDIT_NOTE,
    titleBn: "ক্রেডিট নোট",
    titleEn: "Credit note",
    ruleBn: "[বিধি ৪০ এর উপ-বিধি (১) এর দফা (ঞ) দ্রষ্টব্য]",
    supported: true,
    module: "sales",
  },
  {
    code: MushakForm.DEBIT_NOTE,
    titleBn: "ডেবিট নোট",
    titleEn: "Debit note",
    ruleBn: "[বিধি ৪০ এর উপ-বিধি (১) এর দফা (ট) দ্রষ্টব্য]",
    supported: false,
  },
  {
    code: MushakForm.REPAIR_REGISTER,
    titleBn: "মেরামত বা সেবার জন্য প্রেরিত পণ্যের হিসাব",
    titleEn: "Register of goods sent for repair or servicing",
    ruleBn: "[বিধি ৪০ এর উপ-বিধি (১) এর দফা (ঠ) দ্রষ্টব্য]",
    supported: false,
  },
  {
    code: MushakForm.LARGE_SUPPLY_STATEMENT,
    titleBn:
      "নিবন্ধিত নয় এমন ব্যক্তির নিকট ২ (দুই) লক্ষ টাকার ঊর্ধ্বে সরবরাহের তালিকা",
    titleEn: "Statement of supplies over BDT 2 lakh to unregistered buyers",
    ruleBn: "[বিধি ৪০ এর উপ-বিধি (১) এর দফা (ড) দ্রষ্টব্য]",
    supported: true,
    module: "sales",
  },
];

export const MUSHAK_FORM_BY_CODE: Readonly<Record<string, MushakFormMeta>> =
  Object.freeze(
    MUSHAK_FORMS.reduce<Record<string, MushakFormMeta>>((acc, form) => {
      acc[form.code] = form;
      return acc;
    }, {}),
  );

export const SUPPORTED_MUSHAK_FORMS: readonly MushakForm[] = MUSHAK_FORMS.filter(
  (form) => form.supported,
).map((form) => form.code);

export function isSupportedMushakForm(code: string): code is MushakForm {
  return MUSHAK_FORM_BY_CODE[code]?.supported === true;
}

/**
 * Rule 40(1)(ড): a supply to a buyer who is not VAT-registered has to be
 * listed once it passes two lakh taka. Kept here rather than inline in the
 * report so the threshold is stated once if NBR moves it.
 */
export const MUSHAK_LARGE_SUPPLY_THRESHOLD_BDT = 200000;

// ── Units of supply (column ৩ of the 6.3) ───────────────────────────────────

/**
 * `Product.unit_type` carries the compound unit the catalogue sells in. The
 * 6.3 wants a unit of supply in that box, so each one maps to the Bangla word
 * for the unit the quantity column is counted in. `none` means the product is
 * sold by the piece, which is how every ERP71 quantity is stored.
 */
export const MUSHAK_SUPPLY_UNITS: Readonly<
  Record<string, { bn: string; en: string }>
> = Object.freeze({
  none: { bn: "সংখ্যা", en: "Pcs" },
  ft_in: { bn: "ফুট", en: "Ft" },
  dozen_pcs: { bn: "সংখ্যা", en: "Pcs" },
  kg_g: { bn: "কেজি", en: "Kg" },
  lb_oz: { bn: "পাউন্ড", en: "Lb" },
  m_cm: { bn: "মিটার", en: "Metre" },
});

export function mushakSupplyUnit(unitType?: string | null): {
  bn: string;
  en: string;
} {
  return MUSHAK_SUPPLY_UNITS[unitType ?? "none"] ?? MUSHAK_SUPPLY_UNITS.none;
}

// ── Bengali numerals ────────────────────────────────────────────────────────

const BENGALI_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];

/**
 * Western digits to Bengali. Used for the gazetted column-number row — the
 * money columns stay in Western digits, which NBR accepts and which is what a
 * bookkeeper reconciling against the ledger can actually read.
 */
export function toBengaliDigits(value: string | number): string {
  return String(value).replace(/[0-9]/g, (d) => BENGALI_DIGITS[Number(d)]);
}

// ── VAT and supplementary duty arithmetic ───────────────────────────────────

/** Two decimal places, the precision every money column is stored at. */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  // `+ Number.EPSILON` is deliberate: 1.005 is stored as 1.00499… in binary
  // and would otherwise round down, which shows up as a one-paisa gap
  // between a line and the invoice total it is supposed to foot to.
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export interface MushakTaxRates {
  /** VAT rate as a percentage, e.g. 15 for 15%. */
  vatRate: number;
  /** Supplementary duty rate as a percentage. Zero for almost everything. */
  sdRate: number;
}

export interface MushakLineTax extends MushakTaxRates {
  /** মোট মূল্য — value of the supply, excluding both SD and VAT. */
  taxableValue: number;
  /** সম্পূরক শুল্কের পরিমাণ. */
  sdAmount: number;
  /** মূসকের পরিমাণ. */
  vatAmount: number;
  /** সকল প্রকার শুল্ক ও করসহ মূল্য — what the customer actually pays. */
  inclusiveTotal: number;
}

/**
 * Split a tax-inclusive amount into value, supplementary duty and VAT.
 *
 * ERP71 stores `SaleItem.price_at_sale` as the price the customer pays, taxes
 * included — the Bangladeshi retail convention, and the assumption the invoice
 * screen has always made. Under the VAT and SD Act 2012 supplementary duty is
 * levied on the value of the supply and VAT on the value *plus* that duty, so
 * an inclusive amount `P` decomposes as
 *
 *     P = V × (1 + s/100) × (1 + v/100)
 *
 * and the value of the supply is what is left once both are peeled off. With
 * `s = 0` this reduces to the familiar `P × v / (100 + v)`.
 */
export function splitTaxInclusive(
  inclusiveTotal: number,
  rates: MushakTaxRates,
): MushakLineTax {
  const vatRate = Number.isFinite(rates.vatRate) ? Math.max(0, rates.vatRate) : 0;
  const sdRate = Number.isFinite(rates.sdRate) ? Math.max(0, rates.sdRate) : 0;
  const gross = roundMoney(inclusiveTotal);

  const taxableValue = roundMoney(
    gross / ((1 + sdRate / 100) * (1 + vatRate / 100)),
  );
  const sdAmount = roundMoney(taxableValue * (sdRate / 100));
  // Derived by subtraction rather than by its own multiplication so the three
  // parts always add back up to the gross the customer was charged; rounding
  // each independently leaves a stray paisa on roughly one line in fifty.
  const vatAmount = roundMoney(gross - taxableValue - sdAmount);

  return { vatRate, sdRate, taxableValue, sdAmount, vatAmount, inclusiveTotal: gross };
}

export interface MushakSaleLineInput {
  /** Stable key echoed back on the result, e.g. the sale-item id. */
  key: string;
  quantity: number;
  /** Unit price as charged, taxes included. */
  unitPrice: number;
  vatRate: number;
  sdRate: number;
}

export interface MushakSaleLineTax extends MushakLineTax {
  key: string;
  quantity: number;
  /** Unit price after any invoice-level reduction was spread over the lines. */
  unitPrice: number;
}

export interface MushakSaleTax {
  lines: MushakSaleLineTax[];
  taxableValue: number;
  sdAmount: number;
  vatAmount: number;
  inclusiveTotal: number;
}

/**
 * Allocate `target` across `weights` so the parts are proportional and add up
 * to exactly `target` at two decimal places.
 *
 * Plain pro-rata rounding loses or gains a paisa; the largest-remainder method
 * hands the difference to the lines with the biggest fractional part, which is
 * what keeps a tax invoice footing. Exported for the tests — callers want
 * `computeSaleTax` below.
 */
export function allocateProRata(target: number, weights: number[]): number[] {
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const goal = roundMoney(target);

  if (weights.length === 0) return [];
  if (totalWeight <= 0) {
    // Nothing to weight by — put it all on the first line rather than dropping
    // it, so the allocation still sums to the target.
    return weights.map((_, index) => (index === 0 ? goal : 0));
  }

  const exact = weights.map((w) => (w / totalWeight) * goal);
  const floored = exact.map((value) => Math.floor(value * 100) / 100);
  const allocatedPaisa = floored.reduce((sum, v) => sum + Math.round(v * 100), 0);
  let remainder = Math.round(goal * 100) - allocatedPaisa;

  const order = exact
    .map((value, index) => ({ index, fraction: value * 100 - Math.floor(value * 100) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  const result = [...floored];
  let cursor = 0;
  while (remainder > 0 && order.length > 0) {
    const { index } = order[cursor % order.length];
    result[index] = roundMoney(result[index] + 0.01);
    remainder -= 1;
    cursor += 1;
  }
  // A negative remainder means flooring somehow over-allocated, which only
  // happens when `goal` itself carries sub-paisa noise. Claw it back from the
  // largest line so the total still holds.
  while (remainder < 0) {
    const largest = result.reduce(
      (best, value, index) => (value > result[best] ? index : best),
      0,
    );
    result[largest] = roundMoney(result[largest] - 0.01);
    remainder += 1;
  }

  return result.map(roundMoney);
}

/**
 * The VAT and supplementary duty position of a whole sale, line by line.
 *
 * `invoiceTotal` is what the customer was actually billed. It can be below the
 * sum of the lines, because ERP71 keeps invoice-level reductions — a promo
 * code, redeemed loyalty points, a hand-typed discount — in the sale total
 * rather than on the lines. A reduction in the consideration is a reduction in
 * the value of the supply, so it is spread back over the lines before any tax
 * is worked out; otherwise the 6.3 would declare more output VAT than the
 * business collected and would not foot to its own total.
 *
 * Omit `invoiceTotal` (or pass a larger one — surcharges are not a supply
 * value and are not taxed here) to tax the lines as they stand.
 */
export function computeSaleTax(
  lines: MushakSaleLineInput[],
  invoiceTotal?: number | null,
): MushakSaleTax {
  const grossPerLine = lines.map((line) =>
    roundMoney(line.quantity * line.unitPrice),
  );
  const gross = roundMoney(grossPerLine.reduce((sum, value) => sum + value, 0));

  const billed =
    invoiceTotal == null || !Number.isFinite(invoiceTotal)
      ? gross
      : roundMoney(invoiceTotal);

  // Only a genuine reduction is spread. A total *above* the lines is transport,
  // labour or a rounding-up adjustment, which the entry form keeps outside the
  // line values and which is not part of the value of these supplies.
  const adjusted =
    billed < gross && billed >= 0 ? allocateProRata(billed, grossPerLine) : grossPerLine;

  const taxed = lines.map((line, index) => {
    const lineTotal = adjusted[index];
    const split = splitTaxInclusive(lineTotal, {
      vatRate: line.vatRate,
      sdRate: line.sdRate,
    });
    return {
      key: line.key,
      quantity: line.quantity,
      unitPrice:
        line.quantity > 0 ? roundMoney(lineTotal / line.quantity) : roundMoney(line.unitPrice),
      ...split,
    };
  });

  return {
    lines: taxed,
    taxableValue: roundMoney(taxed.reduce((sum, l) => sum + l.taxableValue, 0)),
    sdAmount: roundMoney(taxed.reduce((sum, l) => sum + l.sdAmount, 0)),
    vatAmount: roundMoney(taxed.reduce((sum, l) => sum + l.vatAmount, 0)),
    inclusiveTotal: roundMoney(taxed.reduce((sum, l) => sum + l.inclusiveTotal, 0)),
  };
}

/**
 * Which rate applies to a line: the product's own override, else the
 * workspace default, else nothing. A product row that says `0` is an explicit
 * zero-rated or exempt supply and must not fall through to the workspace rate,
 * which is why this checks for null rather than falsiness.
 */
export function resolveTaxRate(
  productRate: number | null | undefined,
  tenantRate: number | null | undefined,
): number {
  if (productRate != null && Number.isFinite(productRate)) return Math.max(0, productRate);
  if (tenantRate != null && Number.isFinite(tenantRate)) return Math.max(0, tenantRate);
  return 0;
}

// ── Issuer details a Mushak document cannot be printed without ──────────────

export interface MushakIssuerReadiness {
  ready: boolean;
  /** Settings fields still to be filled in, as `Tenant` column names. */
  missing: string[];
}

/**
 * A 6.3 without a BIN is not a tax invoice, it is a cash memo. The document
 * endpoints still return the data — a half-configured workspace should be able
 * to see what it would print — but they say what is missing so the UI can send
 * the user to Settings › Tax instead of handing NBR an invalid document.
 */
export function checkMushakIssuer(tenant: {
  vat_registration_no?: string | null;
  mushak_issue_address?: string | null;
  mushak_officer_name?: string | null;
  mushak_officer_designation?: string | null;
}): MushakIssuerReadiness {
  const missing: string[] = [];
  if (!tenant.vat_registration_no?.trim()) missing.push("vat_registration_no");
  if (!tenant.mushak_issue_address?.trim()) missing.push("mushak_issue_address");
  if (!tenant.mushak_officer_name?.trim()) missing.push("mushak_officer_name");
  if (!tenant.mushak_officer_designation?.trim()) {
    missing.push("mushak_officer_designation");
  }
  return { ready: missing.length === 0, missing };
}
