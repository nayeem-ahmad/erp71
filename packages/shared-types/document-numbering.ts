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

/** Document types a tenant can configure. Import shipments still use a fixed series. */
export const NUMBERING_DOC_TYPES = ['SALE', 'QUOTE', 'PROFORMA', 'PURCHASE'] as const;
export type NumberingDocType = (typeof NUMBERING_DOC_TYPES)[number];

export interface NumberingDocTypeInfo {
  /** The tab and section heading: "Quotations". */
  label: string;
  /** One of them, for "Next quotation: …". */
  noun: string;
  /** What the built-in formats and presets print in front of the number. */
  prefix: string;
  /**
   * Whether the document is rung up at a POS counter. Only then do `{COUNTER}`
   * and per-counter series mean anything: a quotation or a supplier bill has
   * no till, so every one would print counter 0.
   */
  hasCounter: boolean;
}

export const NUMBERING_DOC_TYPE_INFO: Record<NumberingDocType, NumberingDocTypeInfo> = {
  SALE: { label: 'Sales invoices', noun: 'invoice', prefix: 'INV', hasCounter: true },
  QUOTE: { label: 'Quotations', noun: 'quotation', prefix: 'QT', hasCounter: false },
  PROFORMA: { label: 'Proforma invoices', noun: 'proforma invoice', prefix: 'PI', hasCounter: false },
  PURCHASE: { label: 'Purchases', noun: 'purchase', prefix: 'PUR', hasCounter: false },
};

export const NUMBERING_RESET_POLICIES = ['NEVER', 'FISCAL_YEAR', 'CALENDAR_YEAR', 'MONTHLY'] as const;
export type NumberingResetPolicy = (typeof NUMBERING_RESET_POLICIES)[number];

export const NUMBERING_SCOPES = ['TENANT', 'STORE', 'COUNTER'] as const;
export type NumberingScope = (typeof NUMBERING_SCOPES)[number];

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

/**
 * What a tenant gets until it saves its own format — the formats each document
 * printed before it was configurable, so turning this on renumbers nothing.
 * Fiscal-year reset is the period Bangladeshi VAT returns and audits run on;
 * purchases have always been one running series.
 */
export const DEFAULT_DOCUMENT_NUMBERING: Record<NumberingDocType, DocumentNumberingConfig> = {
  SALE: { template: 'INV-{FY}-{SEQ}', resetPolicy: 'FISCAL_YEAR', scope: 'TENANT', seqWidth: 5 },
  QUOTE: { template: 'QT-{FY}-{SEQ}', resetPolicy: 'FISCAL_YEAR', scope: 'TENANT', seqWidth: 5 },
  PROFORMA: { template: 'PI-{FY}-{SEQ}', resetPolicy: 'FISCAL_YEAR', scope: 'TENANT', seqWidth: 5 },
  PURCHASE: { template: 'PUR-{SEQ}', resetPolicy: 'NEVER', scope: 'TENANT', seqWidth: 5 },
};

export interface DocumentNumberingPreset {
  key: string;
  label: string;
  config: DocumentNumberingConfig;
}

/** Ready-made formats the settings page offers before "Custom". */
export function documentNumberingPresets(docType: NumberingDocType): DocumentNumberingPreset[] {
  const p = NUMBERING_DOC_TYPE_INFO[docType].prefix;
  // Sales keep the shapes they shipped with: the monthly one is the
  // `2610-042` look the old reference numbers had.
  const sale = docType === 'SALE';
  return [
    {
      key: 'fiscal-year',
      label: 'Yearly series (resets every July)',
      config: { template: `${p}-{FY}-{SEQ}`, resetPolicy: 'FISCAL_YEAR', scope: 'TENANT', seqWidth: 5 },
    },
    {
      key: 'per-branch',
      label: 'Separate series per branch',
      config: {
        template: sale ? '{STORE}-{FY}-{SEQ}' : `{STORE}-${p}-{FY}-{SEQ}`,
        resetPolicy: 'FISCAL_YEAR',
        scope: 'STORE',
        seqWidth: 5,
      },
    },
    {
      key: 'monthly',
      label: 'Monthly series',
      config: sale
        ? { template: '{YY}{MM}-{SEQ}', resetPolicy: 'MONTHLY', scope: 'TENANT', seqWidth: 3 }
        : { template: `${p}-{YY}{MM}-{SEQ}`, resetPolicy: 'MONTHLY', scope: 'TENANT', seqWidth: 4 },
    },
    {
      key: 'running',
      label: 'Running number, never resets',
      config: { template: `${p}-{SEQ}`, resetPolicy: 'NEVER', scope: 'TENANT', seqWidth: sale ? 6 : 5 },
    },
  ];
}

/** The scopes a document type can be numbered under — see `hasCounter`. */
export function numberingScopesFor(docType: NumberingDocType): NumberingScope[] {
  return NUMBERING_DOC_TYPE_INFO[docType].hasCounter ? [...NUMBERING_SCOPES] : ['TENANT', 'STORE'];
}

/** The tokens a document type's format may use — see `hasCounter`. */
export function numberingTokensFor(docType: NumberingDocType): NumberingToken[] {
  return NUMBERING_DOC_TYPE_INFO[docType].hasCounter
    ? [...NUMBERING_TOKENS]
    : NUMBERING_TOKENS.filter((token) => token !== 'COUNTER');
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
 * them. Empty when it is valid.
 */
export function validateNumberingConfig(
  config: DocumentNumberingConfig,
  docType: NumberingDocType = 'SALE',
): string[] {
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

  if (!NUMBERING_DOC_TYPE_INFO[docType].hasCounter && (config.scope === 'COUNTER' || has('COUNTER'))) {
    errors.push(`${NUMBERING_DOC_TYPE_INFO[docType].label} are not rung up at a POS counter, so {COUNTER} and per-counter series do not apply.`);
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
    .map((part) => ('literal' in part ? part.literal : renderToken(part.token, seq, config.seqWidth, ctx)))
    .join('');
}

function renderToken(token: NumberingToken, seq: number, seqWidth: number, ctx: NumberingRenderContext): string {
  switch (token) {
    case 'SEQ':
      return String(seq).padStart(seqWidth, '0');
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
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');

/**
 * How to recognise the numbers a format has already printed for one counter,
 * so a counter used for the first time can continue after them rather than
 * hand them out again — a tenant switching to a format it used before, or a
 * document type whose old numbers were never counted (purchases were
 * `count() + 1`).
 *
 * `prefix` is the fixed text in front of the running number, for a cheap
 * starts-with query; `seqOf` reads the running number back out of a candidate,
 * or returns null when the candidate is not one of this counter's numbers.
 * Assumes a config that passed `validateNumberingConfig` (one `{SEQ}`).
 */
export function numberingMatcher(
  config: Pick<DocumentNumberingConfig, 'template'>,
  ctx: NumberingRenderContext,
): { prefix: string; seqOf: (candidate: string) => number | null } {
  const { parts } = parseNumberingTemplate(config.template.trim());
  const seqAt = parts.findIndex((part) => 'token' in part && part.token === 'SEQ');
  const text = (from: number, to: number) => parts
    .slice(from, to)
    .map((part) => ('literal' in part ? part.literal : renderToken(part.token, 0, 0, ctx)))
    .join('');
  const before = text(0, seqAt);
  const after = text(seqAt + 1, parts.length);
  const pattern = new RegExp(`^${escapeRegExp(before)}(\\d+)${escapeRegExp(after)}$`);
  return {
    prefix: before,
    seqOf: (candidate: string) => {
      const match = pattern.exec(candidate);
      return match ? Number(match[1]) : null;
    },
  };
}

/** Upper-cases and trims a branch code; `null` when it is not a valid one. */
export function normalizeStoreCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return STORE_CODE_PATTERN.test(code) ? code : null;
}
