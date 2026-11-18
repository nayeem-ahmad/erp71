/**
 * The CEO KPI scorecard: eighteen business health figures, read by a shop owner
 * about their own business and by the platform owner about ERP71 itself.
 *
 * This file is the one list both sides read. The backend uses it to decide
 * which KPIs to compute for an audience, and the frontend uses it to order the
 * tiles, pick the number format, and colour a change as better or worse. The
 * words (what / why / how) live in the localisation catalogue under
 * `kpis.items.<id>`, keyed by the same ids.
 *
 * Not every KPI makes sense for both audiences. A shop has no recurring
 * revenue, so burn multiple and the SaaS quick ratio do not apply to it.
 * Others apply but depend on data the system does not record yet. Those are
 * listed as `planned`, with the gap that blocks them, so the scorecard can show
 * what is coming instead of leaving it out.
 */

export const KPI_IDS = [
  'revenue_growth',
  'gross_margin',
  'net_profit_margin',
  'operating_cash_flow',
  'cash_runway',
  'customer_acquisition_cost',
  'customer_lifetime_value',
  'ltv_to_cac',
  'net_revenue_retention',
  'churn_rate',
  'avg_revenue_per_account',
  'burn_multiple',
  'sales_cycle_length',
  'employee_turnover',
  'net_promoter_score',
  'days_sales_outstanding',
  'quick_ratio',
  'ebitda',
] as const;

export type KpiId = (typeof KPI_IDS)[number];

export const KpiAudience = {
  TENANT: 'tenant',
  PLATFORM: 'platform',
} as const;
export type KpiAudience = (typeof KpiAudience)[keyof typeof KpiAudience];

/** How a value is formatted. `money` is BDT; `percent` is already ×100. */
export type KpiUnit = 'percent' | 'money' | 'months' | 'days' | 'ratio' | 'score';

/** What has to be built before a planned KPI can be computed. */
export type KpiGap =
  /** A log of subscription MRR changes (new, expansion, contraction, churn). Delivered in phase 2. */
  | 'mrr_history'
  /** Expenses tagged as marketing, cost of service, interest, tax, depreciation. */
  | 'expense_classification'
  /** A way to ask customers how likely they are to recommend the business. Delivered in phase 4. */
  | 'nps_survey';

export type KpiAvailability =
  | { kind: 'live' }
  | { kind: 'planned'; phase: 2 | 3 | 4; needs: KpiGap }
  | { kind: 'not_applicable' };

export interface KpiDefinition {
  id: KpiId;
  /** Position on the scorecard, 1–18. */
  number: number;
  unit: KpiUnit;
  /**
   * Whether a rise is good news. Decides the colour of the change, so churn
   * going up shows red and margin going up shows green.
   */
  higherIsBetter: boolean;
  availability: Record<KpiAudience, KpiAvailability>;
}

const LIVE: KpiAvailability = { kind: 'live' };
const NOT_APPLICABLE: KpiAvailability = { kind: 'not_applicable' };
const planned = (phase: 2 | 3 | 4, needs: KpiGap): KpiAvailability => ({ kind: 'planned', phase, needs });

export const KPI_DEFINITIONS: readonly KpiDefinition[] = [
  { id: 'revenue_growth', number: 1, unit: 'percent', higherIsBetter: true, availability: { tenant: LIVE, platform: LIVE } },
  { id: 'gross_margin', number: 2, unit: 'percent', higherIsBetter: true, availability: { tenant: LIVE, platform: LIVE } },
  { id: 'net_profit_margin', number: 3, unit: 'percent', higherIsBetter: true, availability: { tenant: LIVE, platform: LIVE } },
  { id: 'operating_cash_flow', number: 4, unit: 'money', higherIsBetter: true, availability: { tenant: LIVE, platform: LIVE } },
  { id: 'cash_runway', number: 5, unit: 'months', higherIsBetter: true, availability: { tenant: LIVE, platform: LIVE } },
  { id: 'customer_acquisition_cost', number: 6, unit: 'money', higherIsBetter: false, availability: { tenant: LIVE, platform: LIVE } },
  { id: 'customer_lifetime_value', number: 7, unit: 'money', higherIsBetter: true, availability: { tenant: LIVE, platform: LIVE } },
  { id: 'ltv_to_cac', number: 8, unit: 'ratio', higherIsBetter: true, availability: { tenant: LIVE, platform: LIVE } },
  { id: 'net_revenue_retention', number: 9, unit: 'percent', higherIsBetter: true, availability: { tenant: LIVE, platform: LIVE } },
  { id: 'churn_rate', number: 10, unit: 'percent', higherIsBetter: false, availability: { tenant: LIVE, platform: LIVE } },
  { id: 'avg_revenue_per_account', number: 11, unit: 'money', higherIsBetter: true, availability: { tenant: LIVE, platform: LIVE } },
  { id: 'burn_multiple', number: 12, unit: 'ratio', higherIsBetter: false, availability: { tenant: NOT_APPLICABLE, platform: LIVE } },
  { id: 'sales_cycle_length', number: 13, unit: 'days', higherIsBetter: false, availability: { tenant: LIVE, platform: LIVE } },
  { id: 'employee_turnover', number: 14, unit: 'percent', higherIsBetter: false, availability: { tenant: LIVE, platform: LIVE } },
  { id: 'net_promoter_score', number: 15, unit: 'score', higherIsBetter: true, availability: { tenant: LIVE, platform: LIVE } },
  { id: 'days_sales_outstanding', number: 16, unit: 'days', higherIsBetter: false, availability: { tenant: LIVE, platform: LIVE } },
  { id: 'quick_ratio', number: 17, unit: 'ratio', higherIsBetter: true, availability: { tenant: NOT_APPLICABLE, platform: LIVE } },
  { id: 'ebitda', number: 18, unit: 'money', higherIsBetter: true, availability: { tenant: LIVE, platform: LIVE } },
];

export const KPI_DEFINITION_BY_ID: Readonly<Record<KpiId, KpiDefinition>> = Object.fromEntries(
  KPI_DEFINITIONS.map((definition) => [definition.id, definition]),
) as Record<KpiId, KpiDefinition>;

/**
 * - `ok`: computed. `value` can still be null when the KPI has a word for its
 *   answer instead of a number (a business that is not burning cash has no
 *   runway figure; see the `cash_positive` note).
 * - `no_data`: the KPI applies but the period had nothing to divide by.
 * - `planned`: the KPI applies but needs data the system does not record yet.
 * - `not_applicable`: the KPI has no meaning for this audience.
 */
export type KpiStatus = 'ok' | 'no_data' | 'planned' | 'not_applicable';

/** Caveats the scorecard shows under a value. Translated by the frontend. */
export type KpiNote =
  /** Cash grew over the trailing three months, so there is no burn to divide by. */
  | 'cash_positive'
  /** Walk-in sales carry no customer, so only named customers are counted. */
  | 'named_customers_only'
  /** Some sold items have no cost recorded; the margin covers the costed share. */
  | 'partly_costed'
  /** Read from the ledger, so it depends on vouchers being posted. */
  | 'ledger_based'
  /** The platform's books are not set up, or platform accounting is switched off. */
  | 'books_unavailable'
  /** A customer counts as lost after the lapse window set in Sales Settings (the `lapseDays` input). */
  | 'lapse_window'
  /** Burn is averaged over the three months ending with the period. */
  | 'trailing_three_months'
  /** Measured from workspace signup to first paid activation. */
  | 'signup_to_activation'
  /** Taken from the platform team's own HR records. */
  | 'platform_workspace_staff'
  /** Subscription MRR after each tenant's discount, yearly fees ÷ 12, add-ons included. */
  | 'subscription_mrr'
  /** The MRR history does not reach back to the start of this period. */
  | 'mrr_history_short'
  /** Cash grew over the period, so nothing was burned. */
  | 'not_burning'
  /** Sums accounts by their KPI class (set in the chart of accounts, or guessed from the name). */
  | 'classified_accounts'
  /** No expense account is classified as sales & marketing, so there is no spend to divide. */
  | 'no_marketing_accounts'
  /** No churn in the period, so customer lifespan is capped at five years. */
  | 'lifespan_capped'
  /** From customers who answered the survey link on their receipt SMS. */
  | 'nps_from_receipts'
  /** From shop owners, asked in the app at most every 90 days. */
  | 'nps_owner_survey'
  /** Fewer than 10 answers, so one answer moves the score a lot. */
  | 'small_sample';

export interface KpiResult {
  id: KpiId;
  status: KpiStatus;
  /** The figure for the period, in the KPI's unit. */
  value: number | null;
  /** The same figure for the period before, when it means anything. */
  previous: number | null;
  /**
   * The inputs behind the value — numerator, denominator and the like — so the
   * figure can be checked by hand. Keys are stable and named in camelCase.
   */
  basis: Record<string, number | null>;
  notes: KpiNote[];
  /** For a `planned` KPI: the release phase that unlocks it, and what it needs. */
  phase?: 2 | 3 | 4;
  needs?: KpiGap;
}

export interface KpiScorecard {
  audience: KpiAudience;
  period: { from: string; to: string };
  previousPeriod: { from: string; to: string };
  /** The branch the figures cover; null for the whole business. */
  storeId: string | null;
  kpis: KpiResult[];
  /** Vouchers still awaiting posting or approval, which ledger KPIs leave out. */
  unpostedVouchers: number;
  generatedAt: string;
}

export function kpiDefinitionsFor(audience: KpiAudience): KpiDefinition[] {
  return KPI_DEFINITIONS.filter((definition) => definition.availability[audience].kind !== 'not_applicable');
}

/** The result for a KPI that is not computed for this audience (planned or not applicable). */
export function unavailableKpiResult(id: KpiId, audience: KpiAudience): KpiResult {
  const availability = KPI_DEFINITION_BY_ID[id].availability[audience];
  if (availability.kind === 'planned') {
    return { id, status: 'planned', value: null, previous: null, basis: {}, notes: [], phase: availability.phase, needs: availability.needs };
  }
  return { id, status: 'not_applicable', value: null, previous: null, basis: {}, notes: [] };
}

/**
 * How a value moved against the previous period.
 *
 * Percentages move by points (a margin from 20% to 25% is +5 points, not
 * +25%). Everything else moves by its relative change, because a jump from
 * ৳10,000 to ৳12,000 reads as +20% whatever the absolute size of the business.
 * `improved` is null when nothing moved or there is nothing to compare.
 */
export function kpiChange(
  definition: Pick<KpiDefinition, 'unit' | 'higherIsBetter'>,
  value: number | null,
  previous: number | null,
): { kind: 'points' | 'relative'; amount: number; improved: boolean | null } | null {
  if (value === null || previous === null) return null;
  const diff = value - previous;
  let amount: number;
  let kind: 'points' | 'relative';
  if (definition.unit === 'percent') {
    kind = 'points';
    amount = diff;
  } else {
    if (previous === 0) return null;
    kind = 'relative';
    amount = (diff / Math.abs(previous)) * 100;
  }
  amount = Math.round(amount * 10) / 10 + 0;
  const improved = amount === 0 ? null : (amount > 0) === definition.higherIsBetter;
  return { kind, amount, improved };
}

// ---------------------------------------------------------------------------
// Account classification for the KPIs (phase 3)
// ---------------------------------------------------------------------------

/**
 * What an expense account is, for the KPIs that need more than "an expense":
 * gross margin (cost of sales), CAC (sales & marketing) and EBITDA (interest,
 * tax, depreciation, amortisation). `operating` says "none of these" and stops
 * the name-based guess.
 */
export const KPI_ACCOUNT_CLASSES = [
  'cost_of_sales',
  'sales_marketing',
  'interest',
  'tax',
  'depreciation',
  'amortization',
  'operating',
] as const;
export type KpiAccountClass = (typeof KPI_ACCOUNT_CLASSES)[number];
/** The classes a KPI sums; `operating` is the absence of one. */
export type KpiExpenseClass = Exclude<KpiAccountClass, 'operating'>;
export const KPI_EXPENSE_CLASSES = KPI_ACCOUNT_CLASSES.filter((c) => c !== 'operating') as KpiExpenseClass[];

export function isKpiAccountClass(value: unknown): value is KpiAccountClass {
  return typeof value === 'string' && (KPI_ACCOUNT_CLASSES as readonly string[]).includes(value);
}

export interface ClassifiableExpenseAccount {
  /** `AccountType`, lower case (`expense`, `revenue`, …). */
  type: string;
  name: string;
  code?: string | null;
  /** The class set by hand, or null to infer it. */
  kpiClass?: string | null;
  groupName?: string | null;
  subgroupName?: string | null;
}

const NAME_RULES: Array<[RegExp, KpiExpenseClass]> = [
  [/depreciation/i, 'depreciation'],
  [/amorti[sz]ation/i, 'amortization'],
  [/\binterest\b/i, 'interest'],
  [/(income|corporate)\s*tax|tax\s*expense/i, 'tax'],
  [/marketing|advertis|promotion|campaign|referral\s*commission|sales\s*commission/i, 'sales_marketing'],
  [/cost\s*of\s*(sales|goods|services?|revenue)|cogs/i, 'cost_of_sales'],
];

const PARENT_RULES: Array<[RegExp, KpiExpenseClass]> = [
  [/sales\s*&\s*marketing|marketing/i, 'sales_marketing'],
  [/cost\s*of\s*(sales|goods|services?|revenue)|infrastructure\s*&\s*platform\s*costs|usage\s*costs/i, 'cost_of_sales'],
];

/**
 * The KPI class an expense account counts toward, or null for a plain
 * operating expense (and for anything that is not an expense).
 *
 * A class set by hand wins. Otherwise it is guessed from the account's own
 * name, then from its subgroup and group, so the default charts work without
 * anyone tagging anything: a shop's "Depreciation Expense" and "Cost of Sales"
 * subgroup, the platform's "Infrastructure & Platform Costs" group and its
 * "Sales & Marketing" subgroup.
 */
export function resolveKpiAccountClass(account: ClassifiableExpenseAccount): KpiExpenseClass | null {
  if (account.type !== 'expense') return null;
  if (isKpiAccountClass(account.kpiClass)) {
    return account.kpiClass === 'operating' ? null : account.kpiClass;
  }
  const own = `${account.name} ${account.code ?? ''}`;
  for (const [pattern, kpiClass] of NAME_RULES) if (pattern.test(own)) return kpiClass;
  for (const parent of [account.subgroupName, account.groupName]) {
    if (!parent) continue;
    for (const [pattern, kpiClass] of PARENT_RULES) if (pattern.test(parent)) return kpiClass;
  }
  return null;
}
