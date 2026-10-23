/**
 * How a tenant numbers its documents: `INV-2627-00042`, `DHK/2610/0007`.
 *
 * Shared between the API, which issues numbers, and the settings page, which
 * previews them as the owner types. One copy of the rules is what makes the
 * preview honest: a format the page accepts is a format the server issues.
 *
 * A format is a template of literal text and tokens, plus two policies:
 *
 * - **Reset** — when the counter starts again at 1 (never, every fiscal year,
 *   every calendar year, every month).
 * - **Scope** — whether the whole business shares one counter, or each branch
 *   (or each POS counter) runs its own.
 *
 * Both policies only stay collision-free if the template *prints* what tells
 * the series apart. A monthly reset with no month in the number hands out
 * `INV-00001` again next month; per-branch counters with no branch code in
 * the number give Dhaka and Chattogram the same `INV-00001`. Validation
 * refuses those combinations rather than leaving the unique index to reject a
 * sale at the till.
 */

/**
 * Document types a tenant can configure. `QUOTE`, `PROFORMA` and
 * `IMPORT_SHIPMENT` are the names their counters were stored under before they
 * became configurable, so those counters carry straight over.
 */
export const NUMBERING_DOC_TYPES = [
  'SALE',
  'SALES_RETURN',
  'SALES_EXCHANGE',
  'SALES_ORDER',
  'QUOTE',
  'PROFORMA',
  'WARRANTY_CLAIM',
  'PURCHASE',
  'PURCHASE_RETURN',
  'PURCHASE_ORDER',
  'RFQ',
  'IMPORT_SHIPMENT',
  'WAREHOUSE_TRANSFER',
  'STOCK_TAKE',
  'SHRINKAGE',
  'STOCK_FOUND',
] as const;
export type NumberingDocType = (typeof NUMBERING_DOC_TYPES)[number];

export const NUMBERING_RESET_POLICIES = ['NEVER', 'FISCAL_YEAR', 'CALENDAR_YEAR', 'MONTHLY'] as const;
export type NumberingResetPolicy = (typeof NUMBERING_RESET_POLICIES)[number];

export const NUMBERING_SCOPES = ['TENANT', 'STORE', 'COUNTER'] as const;
export type NumberingScope = (typeof NUMBERING_SCOPES)[number];

export const NUMBERING_DOC_GROUPS = ['SALES', 'PURCHASES', 'INVENTORY'] as const;
export type NumberingDocGroup = (typeof NUMBERING_DOC_GROUPS)[number];

export const NUMBERING_DOC_GROUP_LABELS: Record<NumberingDocGroup, string> = {
  SALES: 'Sales',
  PURCHASES: 'Purchases',
  INVENTORY: 'Inventory',
};

export interface NumberingDocTypeInfo {
  label: string;
  /** Lower-case plural, for sentences: "Only new purchase returns change." */
  plural: string;
  group: NumberingDocGroup;
  /** Letters the built-in formats start with: `PUR` in `PUR-00042`. */
  prefix: string;
  /**
   * Who may run a separate series. Only a sale knows the POS counter it was
   * rung up on, so per-counter numbering is a sales-invoice option alone.
   */
  scopes: readonly NumberingScope[];
  /**
   * The other type numbered into the same unique column (quotations and
   * proformas are both `Quotation.quote_number`). The two must not share a
   * format, or each would keep landing on the other's numbers.
   */
  sharesColumnWith?: NumberingDocType;
}

const BRANCH_SCOPES: readonly NumberingScope[] = ['TENANT', 'STORE'];

export const NUMBERING_DOC_TYPE_INFO: Record<NumberingDocType, NumberingDocTypeInfo> = {
  SALE: { label: 'Sales invoice', plural: 'sales invoices', group: 'SALES', prefix: 'INV', scopes: NUMBERING_SCOPES },
  SALES_RETURN: { label: 'Sales return', plural: 'sales returns', group: 'SALES', prefix: 'RET', scopes: BRANCH_SCOPES },
  SALES_EXCHANGE: { label: 'Sales exchange', plural: 'sales exchanges', group: 'SALES', prefix: 'EXC', scopes: BRANCH_SCOPES },
  SALES_ORDER: { label: 'Sales order', plural: 'sales orders', group: 'SALES', prefix: 'ORD', scopes: BRANCH_SCOPES },
  QUOTE: {
    label: 'Quotation', plural: 'quotations', group: 'SALES', prefix: 'QT', scopes: BRANCH_SCOPES,
    sharesColumnWith: 'PROFORMA',
  },
  PROFORMA: {
    label: 'Proforma invoice', plural: 'proforma invoices', group: 'SALES', prefix: 'PI', scopes: BRANCH_SCOPES,
    sharesColumnWith: 'QUOTE',
  },
  WARRANTY_CLAIM: { label: 'Warranty claim', plural: 'warranty claims', group: 'SALES', prefix: 'WC', scopes: BRANCH_SCOPES },
  PURCHASE: { label: 'Purchase', plural: 'purchases', group: 'PURCHASES', prefix: 'PUR', scopes: BRANCH_SCOPES },
  PURCHASE_RETURN: { label: 'Purchase return', plural: 'purchase returns', group: 'PURCHASES', prefix: 'PRET', scopes: BRANCH_SCOPES },
  PURCHASE_ORDER: { label: 'Purchase order', plural: 'purchase orders', group: 'PURCHASES', prefix: 'PO', scopes: BRANCH_SCOPES },
  RFQ: { label: 'Purchase quotation (RFQ)', plural: 'purchase quotations', group: 'PURCHASES', prefix: 'RFQ', scopes: BRANCH_SCOPES },
  IMPORT_SHIPMENT: { label: 'Import shipment', plural: 'import shipments', group: 'PURCHASES', prefix: 'IMP', scopes: BRANCH_SCOPES },
  WAREHOUSE_TRANSFER: { label: 'Warehouse transfer', plural: 'warehouse transfers', group: 'INVENTORY', prefix: 'TRF', scopes: BRANCH_SCOPES },
  STOCK_TAKE: { label: 'Stock take', plural: 'stock takes', group: 'INVENTORY', prefix: 'STK', scopes: BRANCH_SCOPES },
  SHRINKAGE: {
    label: 'Shrinkage (stock loss)', plural: 'shrinkage entries', group: 'INVENTORY', prefix: 'SHR', scopes: BRANCH_SCOPES,
    sharesColumnWith: 'STOCK_FOUND',
  },
  STOCK_FOUND: {
    label: 'Stock found', plural: 'stock-found entries', group: 'INVENTORY', prefix: 'FND', scopes: BRANCH_SCOPES,
    sharesColumnWith: 'SHRINKAGE',
  },
};

export function isNumberingDocType(value: unknown): value is NumberingDocType {
  return typeof value === 'string' && (NUMBERING_DOC_TYPES as readonly string[]).includes(value);
}

export const NUMBERING_TOKENS = ['SEQ', 'FY', 'YYYY', 'YY', 'MM', 'STORE', 'COUNTER'] as const;
export type NumberingToken = (typeof NUMBERING_TOKENS)[number];

export interface DocumentNumberingConfig {
  template: string;
  resetPolicy: NumberingResetPolicy;
  scope: NumberingScope;
  /** Minimum digits for `{SEQ}`, zero-padded. A larger number simply grows. */
  seqWidth: number;
}

export const NUMBERING_TEMPLATE_MAX_LENGTH = 40;
export const NUMBERING_SEQ_WIDTH_MIN = 1;
export const NUMBERING_SEQ_WIDTH_MAX = 8;
/** Largest "next number" an owner may set — keeps the counter well inside a Postgres int. */
export const NUMBERING_NEXT_NUMBER_MAX = 999_999_999;

/** Branch codes print inside document numbers, so they are short and plain. */
export const STORE_CODE_PATTERN = /^[A-Z0-9]{1,6}$/;

const fiscalYearSeries = (prefix: string): DocumentNumberingConfig =>
  ({ template: `${prefix}-{FY}-{SEQ}`, resetPolicy: 'FISCAL_YEAR', scope: 'TENANT', seqWidth: 5 });
const runningSeries = (prefix: string): DocumentNumberingConfig =>
  ({ template: `${prefix}-{SEQ}`, resetPolicy: 'NEVER', scope: 'TENANT', seqWidth: 5 });

/**
 * What a tenant gets until it saves its own format. Fiscal-year reset because
 * that is the period Bangladeshi VAT returns and audits run on.
 *
 * The purchase and inventory documents keep the running `PUR-00042` shape they
 * had before they were configurable, so nobody's numbering changes on the day
 * this ships; their counters are seeded past the existing numbers by
 * `prisma/sync-document-sequences.ts`. The types that were numbered by epoch
 * millis (`RET-1755764812345`) had no series worth keeping and start one.
 */
export const DEFAULT_DOCUMENT_NUMBERING: Record<NumberingDocType, DocumentNumberingConfig> = {
  SALE: fiscalYearSeries('INV'),
  SALES_RETURN: fiscalYearSeries('RET'),
  SALES_EXCHANGE: fiscalYearSeries('EXC'),
  SALES_ORDER: fiscalYearSeries('ORD'),
  QUOTE: fiscalYearSeries('QT'),
  PROFORMA: fiscalYearSeries('PI'),
  WARRANTY_CLAIM: fiscalYearSeries('WC'),
  PURCHASE: runningSeries('PUR'),
  PURCHASE_RETURN: runningSeries('PRET'),
  PURCHASE_ORDER: runningSeries('PO'),
  RFQ: runningSeries('RFQ'),
  IMPORT_SHIPMENT: fiscalYearSeries('IMP'),
  WAREHOUSE_TRANSFER: runningSeries('TRF'),
  STOCK_TAKE: runningSeries('STK'),
  SHRINKAGE: runningSeries('SHR'),
  STOCK_FOUND: runningSeries('FND'),
};

type NumberingPreset = { key: string; label: string; config: DocumentNumberingConfig };

/** Ready-made sales-invoice formats the settings page offers before "Custom". */
export const DOCUMENT_NUMBERING_PRESETS: NumberingPreset[] = [
  {
    key: 'fiscal-year',
    label: 'Yearly series (resets every July)',
    config: { template: 'INV-{FY}-{SEQ}', resetPolicy: 'FISCAL_YEAR', scope: 'TENANT', seqWidth: 5 },
  },
  {
    key: 'per-branch',
    label: 'Separate series per branch',
    config: { template: '{STORE}-{FY}-{SEQ}', resetPolicy: 'FISCAL_YEAR', scope: 'STORE', seqWidth: 5 },
  },
  {
    key: 'monthly',
    label: 'Monthly series',
    config: { template: '{YY}{MM}-{SEQ}', resetPolicy: 'MONTHLY', scope: 'TENANT', seqWidth: 4 },
  },
  {
    key: 'running',
    label: 'Running number, never resets',
    config: { template: 'INV-{SEQ}', resetPolicy: 'NEVER', scope: 'TENANT', seqWidth: 6 },
  },
];

/**
 * The presets for one document type. Sales invoices keep the list above; every
 * other type gets the same four shapes under its own prefix, so a per-branch
 * purchase reads `PUR-S1-2627-00001` rather than looking like an invoice.
 */
export function documentNumberingPresets(docType: NumberingDocType): NumberingPreset[] {
  if (docType === 'SALE') return DOCUMENT_NUMBERING_PRESETS;
  const prefix = NUMBERING_DOC_TYPE_INFO[docType].prefix;
  return [
    { key: 'fiscal-year', label: 'Yearly series (resets every July)', config: fiscalYearSeries(prefix) },
    {
      key: 'per-branch',
      label: 'Separate series per branch',
      config: { template: `${prefix}-{STORE}-{FY}-{SEQ}`, resetPolicy: 'FISCAL_YEAR', scope: 'STORE', seqWidth: 5 },
    },
    {
      key: 'monthly',
      label: 'Monthly series',
      config: { template: `${prefix}-{YY}{MM}-{SEQ}`, resetPolicy: 'MONTHLY', scope: 'TENANT', seqWidth: 4 },
    },
    { key: 'running', label: 'Running number, never resets', config: runningSeries(prefix) },
  ];
}

export const NUMBERING_RESET_LABELS: Record<NumberingResetPolicy, string> = {
  NEVER: 'Never',
  FISCAL_YEAR: 'Every fiscal year (July)',
  CALENDAR_YEAR: 'Every calendar year (January)',
  MONTHLY: 'Every month',
};

export const NUMBERING_SCOPE_LABELS: Record<NumberingScope, string> = {
  TENANT: 'One series for the whole business',
  STORE: 'Separate series per branch',
  COUNTER: 'Separate series per POS counter',
};

export const NUMBERING_TOKEN_LABELS: Record<NumberingToken, string> = {
  SEQ: 'running number',
  FY: 'fiscal year, e.g. 2627',
  YYYY: 'year, e.g. 2026',
  YY: 'year, e.g. 26',
  MM: 'month, e.g. 10',
  STORE: 'branch code',
  COUNTER: 'POS counter number',
};

type TemplatePart = { literal: string } | { token: NumberingToken };

const TOKEN_RE = /\{([^{}]*)\}/g;
/** Characters a number may carry around its tokens: safe in URLs, file names and barcodes. */
const LITERAL_RE = /^[A-Za-z0-9\-/_.]*$/;

/**
 * Splits a template into literal runs and tokens. Returns an error rather than
 * throwing so the settings page can show it inline as the owner types.
 */
export function parseNumberingTemplate(template: string): { parts: TemplatePart[]; error?: string } {
  const parts: TemplatePart[] = [];
  let last = 0;
  for (const match of template.matchAll(TOKEN_RE)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ literal: template.slice(last, index) });
    const name = match[1].toUpperCase();
    if (!(NUMBERING_TOKENS as readonly string[]).includes(name)) {
      return { parts, error: `Unknown token {${match[1]}}. Use ${NUMBERING_TOKENS.map((t) => `{${t}}`).join(', ')}.` };
    }
    parts.push({ token: name as NumberingToken });
    last = index + match[0].length;
  }
  if (last < template.length) parts.push({ literal: template.slice(last) });

  for (const part of parts) {
    if ('literal' in part && !LITERAL_RE.test(part.literal)) {
      return {
        parts,
        error: 'Only letters, digits and - / _ . may appear outside tokens (check for a stray brace or space).',
      };
    }
  }
  return { parts };
}

function tokensOf(parts: TemplatePart[]): NumberingToken[] {
  return parts.flatMap((part) => ('token' in part ? [part.token] : []));
}

/** Whether a template prints a branch code — callers then need one for the store. */
export function templateUsesToken(template: string, token: NumberingToken): boolean {
  const { parts } = parseNumberingTemplate(template);
  return tokensOf(parts).includes(token);
}

/**
 * Every reason this format cannot be saved, in the order the owner should fix
 * them. Empty when it is valid. With `docType`, also refuses a scope that type
 * cannot be numbered by.
 */
export function validateNumberingConfig(config: DocumentNumberingConfig, docType?: NumberingDocType): string[] {
  const errors: string[] = [];
  const template = typeof config.template === 'string' ? config.template.trim() : '';

  if (!template) return ['Enter a number format.'];
  if (template.length > NUMBERING_TEMPLATE_MAX_LENGTH) {
    errors.push(`Keep the format to ${NUMBERING_TEMPLATE_MAX_LENGTH} characters or fewer.`);
  }
  if (!(NUMBERING_RESET_POLICIES as readonly string[]).includes(config.resetPolicy)) {
    errors.push('Choose when the number resets.');
  }
  if (!(NUMBERING_SCOPES as readonly string[]).includes(config.scope)) {
    errors.push('Choose who shares a series.');
  } else if (docType && !NUMBERING_DOC_TYPE_INFO[docType].scopes.includes(config.scope)) {
    errors.push(`${NUMBERING_DOC_TYPE_INFO[docType].label} numbers cannot run a separate series per POS counter.`);
  }
  if (
    !Number.isInteger(config.seqWidth)
    || config.seqWidth < NUMBERING_SEQ_WIDTH_MIN
    || config.seqWidth > NUMBERING_SEQ_WIDTH_MAX
  ) {
    errors.push(`Number width must be between ${NUMBERING_SEQ_WIDTH_MIN} and ${NUMBERING_SEQ_WIDTH_MAX} digits.`);
  }

  const { parts, error } = parseNumberingTemplate(template);
  if (error) return [...errors, error];

  const tokens = tokensOf(parts);
  const count = (token: NumberingToken) => tokens.filter((t) => t === token).length;
  const has = (token: NumberingToken) => count(token) > 0;

  if (count('SEQ') !== 1) {
    errors.push('The format must contain {SEQ} exactly once — it is the running number.');
  }
  const repeated = NUMBERING_TOKENS.filter((token) => token !== 'SEQ' && count(token) > 1);
  if (repeated.length > 0) {
    errors.push(`Use each token once: ${repeated.map((t) => `{${t}}`).join(', ')} appears more than once.`);
  }

  // The date tokens must pin down the reset period, or the first number of the
  // next period repeats the first number of this one.
  const year = has('YYYY') || has('YY');
  const fy = has('FY');
  const month = has('MM');
  if (config.resetPolicy === 'FISCAL_YEAR' && !(fy || (year && month))) {
    errors.push('A fiscal-year reset needs {FY} in the format, or numbers would repeat every July.');
  }
  if (config.resetPolicy === 'CALENDAR_YEAR' && !(year || (fy && month))) {
    errors.push('A calendar-year reset needs {YYYY} or {YY} in the format, or numbers would repeat every January.');
  }
  if (config.resetPolicy === 'MONTHLY' && !(month && (year || fy))) {
    errors.push('A monthly reset needs {MM} and a year ({YYYY}, {YY} or {FY}), or numbers would repeat.');
  }

  // Likewise the scope: separate counters only stay apart if the number says whose it is.
  if (config.scope === 'STORE' && !has('STORE')) {
    errors.push('A separate series per branch needs {STORE} in the format, or two branches would issue the same number.');
  }
  if (config.scope === 'COUNTER' && !(has('STORE') && has('COUNTER'))) {
    errors.push('A separate series per counter needs both {STORE} and {COUNTER}, or two counters would issue the same number.');
  }

  return errors;
}

/** Bangladeshi fiscal year label: July 2025–June 2026 is `2526`. `month` is 1–12. */
export function fiscalYearLabel(year: number, month: number): string {
  const startYear = month >= 7 ? year : year - 1;
  const two = (n: number) => String(((n % 100) + 100) % 100).padStart(2, '0');
  return `${two(startYear)}${two(startYear + 1)}`;
}

/**
 * The counter a document draws from within its scope. Fiscal years keep the bare
 * `2526` form the quotation series already stored; the others are prefixed so a
 * tenant that switches policy can never land on a counter from the other one
 * (fiscal `2021` and calendar `2021` would otherwise be the same row).
 */
export function numberingPeriodKey(
  resetPolicy: NumberingResetPolicy,
  date: { year: number; month: number },
): string {
  switch (resetPolicy) {
    case 'FISCAL_YEAR':
      return fiscalYearLabel(date.year, date.month);
    case 'CALENDAR_YEAR':
      return `Y${date.year}`;
    case 'MONTHLY':
      return `M${date.year}-${String(date.month).padStart(2, '0')}`;
    default:
      return '';
  }
}

export interface NumberingRenderContext {
  /** Calendar year and month (1–12) of the document, in the tenant's timezone. */
  year: number;
  month: number;
  storeCode?: string | null;
  /** `null` for a sale rung up outside any counter; prints as 0. */
  counterNumber?: number | null;
}

/** The number as printed. Assumes a config that passed `validateNumberingConfig`. */
export function renderDocumentNumber(
  config: Pick<DocumentNumberingConfig, 'template' | 'seqWidth'>,
  seq: number,
  ctx: NumberingRenderContext,
): string {
  const { parts } = parseNumberingTemplate(config.template.trim());
  return parts
    .map((part) => {
      if ('literal' in part) return part.literal;
      switch (part.token) {
        case 'SEQ':
          return String(seq).padStart(config.seqWidth, '0');
        case 'FY':
          return fiscalYearLabel(ctx.year, ctx.month);
        case 'YYYY':
          return String(ctx.year);
        case 'YY':
          return String(ctx.year % 100).padStart(2, '0');
        case 'MM':
          return String(ctx.month).padStart(2, '0');
        case 'STORE':
          return ctx.storeCode ?? '';
        case 'COUNTER':
          return String(ctx.counterNumber ?? 0);
      }
    })
    .join('');
}

/** Upper-cases and trims a branch code; `null` when it is not a valid one. */
export function normalizeStoreCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return STORE_CODE_PATTERN.test(code) ? code : null;
}
