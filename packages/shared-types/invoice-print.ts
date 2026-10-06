/**
 * How one member likes their sales invoices laid out.
 *
 * Saved per member of a workspace (on `TenantUser`), not per browser like the
 * paper size: these describe the document the customer takes home, so the
 * cashier who hides balances keeps hiding them whichever till they sign in at,
 * and a second cashier on the same till keeps their own answers.
 *
 * Stored as a versioned JSON blob so a new option needs no migration — bump
 * `version` and teach `normalizeInvoicePrintPrefs` the older shape when the
 * meaning of an existing field changes. Adding a field only needs a default.
 *
 * Shared because the API validates against the same option lists the printer
 * renders, and two copies of a list like this drift the first time one side
 * gains an option.
 */

/**
 * Which page design the invoice prints on. `standard` is the layout the
 * invoice has always had; `detailed` is the full trade invoice — a labelled
 * invoice / order / date strip, bill-to and payment status side by side, a
 * warranty column, tax broken out beside the totals, and a QR code that opens
 * the invoice in the app for anyone allowed to see it. Sheet paper only: a
 * roll prints the standard design whatever is chosen.
 */
export const INVOICE_LAYOUTS = ['standard', 'detailed'] as const;
export type InvoiceLayout = (typeof INVOICE_LAYOUTS)[number];

/** Breathing room around the invoice body, on top of the page margin. */
export const INVOICE_PADDINGS = ['narrow', 'normal', 'wide'] as const;
export type InvoicePadding = (typeof INVOICE_PADDINGS)[number];

/**
 * When the customer's running balance — previous due and total due — prints.
 * `when-owed` is how the invoice always behaved: only when there is a balance.
 */
export const INVOICE_BALANCE_MODES = ['when-owed', 'always', 'never'] as const;
export type InvoiceBalanceMode = (typeof INVOICE_BALANCE_MODES)[number];

export const INVOICE_TABLE_STYLES = ['minimal', 'striped', 'grid', 'shaded-header'] as const;
export type InvoiceTableStyle = (typeof INVOICE_TABLE_STYLES)[number];

/** Long enough for a return policy, short enough to stay a footer. */
export const INVOICE_FOOTER_MAX_LENGTH = 500;

export interface InvoicePrintPrefs {
  version: 1;
  layout: InvoiceLayout;
  padding: InvoicePadding;
  balance: InvoiceBalanceMode;
  table_style: InvoiceTableStyle;
  /** "Taka One Thousand Two Hundred Only" under the totals. */
  amount_in_words: boolean;
  /** A leading SL column numbering the item rows. */
  serial_column: boolean;
  /** Customer and authorised signature lines at the foot of the invoice. */
  signature_lines: boolean;
  /** Drop the Discount column when no line carries a discount. */
  hide_empty_discount: boolean;
  /**
   * The line under the invoice. `null` prints the built-in thank-you; an empty
   * string prints no footer at all — the two are different answers.
   */
  footer_text: string | null;
}

/** Exactly how the invoice printed before any of this was configurable. */
export const DEFAULT_INVOICE_PRINT_PREFS: InvoicePrintPrefs = {
  version: 1,
  layout: 'standard',
  padding: 'normal',
  balance: 'when-owed',
  table_style: 'minimal',
  amount_in_words: false,
  serial_column: false,
  signature_lines: false,
  hide_empty_discount: false,
  footer_text: null,
};

function oneOf<T extends string>(options: readonly T[], value: unknown, fallback: T): T {
  return typeof value === 'string' && (options as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Reads a stored or submitted blob as a complete set of answers.
 *
 * Field by field rather than all-or-nothing: an option retired from a list must
 * not throw away the member's other choices, and an invoice must always print,
 * so anything unreadable falls back to the default rather than failing.
 */
export function normalizeInvoicePrintPrefs(raw: unknown): InvoicePrintPrefs {
  const d = DEFAULT_INVOICE_PRINT_PREFS;
  if (!raw || typeof raw !== 'object') return { ...d };
  const r = raw as Record<string, unknown>;

  return {
    version: 1,
    layout: oneOf(INVOICE_LAYOUTS, r.layout, d.layout),
    padding: oneOf(INVOICE_PADDINGS, r.padding, d.padding),
    balance: oneOf(INVOICE_BALANCE_MODES, r.balance, d.balance),
    table_style: oneOf(INVOICE_TABLE_STYLES, r.table_style, d.table_style),
    amount_in_words: bool(r.amount_in_words, d.amount_in_words),
    serial_column: bool(r.serial_column, d.serial_column),
    signature_lines: bool(r.signature_lines, d.signature_lines),
    hide_empty_discount: bool(r.hide_empty_discount, d.hide_empty_discount),
    footer_text:
      typeof r.footer_text === 'string'
        ? r.footer_text.slice(0, INVOICE_FOOTER_MAX_LENGTH)
        : d.footer_text,
  };
}
