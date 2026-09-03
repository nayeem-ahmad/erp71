import { z } from 'zod';

/** Fixed plan codes — Phase 1 does not allow creating new codes. */
export const SUBSCRIPTION_PLAN_CODES = [
  'FREE',
  'BASIC',
  'ACCOUNTING',
  'STANDARD',
  'PREMIUM',
] as const;

export type FixedSubscriptionPlanCode = (typeof SUBSCRIPTION_PLAN_CODES)[number];

/** Paid plans offered on signup and self-serve checkout. */
export const SELF_SERVE_SUBSCRIPTION_PLAN_CODES = [
  'BASIC',
  'ACCOUNTING',
  'STANDARD',
] as const;

export type SelfServeSubscriptionPlanCode = (typeof SELF_SERVE_SUBSCRIPTION_PLAN_CODES)[number];

/** Visible on marketing but not yet available for self-serve purchase. */
export const COMING_SOON_SUBSCRIPTION_PLAN_CODES = [
  'PREMIUM',
] as const;

export type ComingSoonSubscriptionPlanCode = (typeof COMING_SOON_SUBSCRIPTION_PLAN_CODES)[number];

export function isComingSoonSubscriptionPlan(
  code: string,
): code is ComingSoonSubscriptionPlanCode {
  return (COMING_SOON_SUBSCRIPTION_PLAN_CODES as readonly string[]).includes(code);
}

export function isSelfServeSubscriptionPlan(
  code: string,
  monthlyPrice?: number,
): code is SelfServeSubscriptionPlanCode {
  if (code === 'FREE') {
    return false;
  }

  if (isComingSoonSubscriptionPlan(code)) {
    return false;
  }

  if (typeof monthlyPrice === 'number' && monthlyPrice <= 0) {
    return false;
  }

  return (SELF_SERVE_SUBSCRIPTION_PLAN_CODES as readonly string[]).includes(code);
}

export type PlanEntitlementType = 'boolean' | 'number';

export type PlanEntitlementGroup =
  | 'quotas'
  | 'modules'
  | 'accounting'
  | 'ai'
  | 'platform';

export interface PlanEntitlementDefinition {
  key: string;
  type: PlanEntitlementType;
  label: string;
  description?: string;
  defaultValue: boolean | number;
  min?: number;
  max?: number;
  /** Groups entitlements in the platform-admin plan editor. */
  group?: PlanEntitlementGroup;
}

export const PLAN_ENTITLEMENT_GROUP_ORDER: PlanEntitlementGroup[] = [
  'quotas',
  'modules',
  'accounting',
  'ai',
  'platform',
];

/** Registry of editable plan entitlements for the platform-admin plan editor. */
export const PLAN_ENTITLEMENT_REGISTRY: PlanEntitlementDefinition[] = [
  {
    key: 'maxStores',
    type: 'number',
    label: 'Max stores',
    description: 'Maximum store locations for the tenant.',
    defaultValue: 1,
    min: 1,
    max: 100,
    group: 'quotas',
  },
  {
    key: 'maxUsers',
    type: 'number',
    label: 'Max users',
    description: 'Maximum team members across the tenant.',
    defaultValue: 1,
    min: 1,
    max: 500,
    group: 'quotas',
  },
  {
    key: 'maxSkus',
    type: 'number',
    label: 'Max SKUs',
    description: 'Product catalog limit. Use -1 for unlimited.',
    defaultValue: 100,
    min: -1,
    max: 1_000_000,
    group: 'quotas',
  },
  {
    key: 'premiumAccounting',
    type: 'boolean',
    label: 'Accounting module',
    description: 'Unlocks the accounting workspace and core financial reports.',
    defaultValue: false,
    group: 'modules',
  },
  {
    key: 'premiumInventoryReports',
    type: 'boolean',
    label: 'Retail advanced reports',
    description: 'Advanced sales, purchase, and inventory analytics.',
    defaultValue: false,
    group: 'modules',
  },
  {
    key: 'premiumCrm',
    type: 'boolean',
    label: 'Premium CRM',
    description: 'Lead pipeline and premium CRM features.',
    defaultValue: false,
    group: 'modules',
  },
  {
    key: 'teamChat',
    type: 'boolean',
    label: 'Team chat',
    description: 'Private staff-to-staff messaging inside the workspace.',
    // Off on every plan: chat ships as an add-on, and add-ons only ever grant
    // capability on top of the plan (see mergeAddonFeatures). A plan can still
    // be edited to include it.
    defaultValue: false,
    group: 'modules',
  },
  {
    key: 'multiStore',
    type: 'boolean',
    label: 'Multi-store',
    description: 'Branch switching and multi-location operations.',
    defaultValue: false,
    group: 'modules',
  },
  {
    key: 'apiAccess',
    type: 'boolean',
    label: 'API access',
    description: 'Tenant API keys and integrations.',
    defaultValue: false,
    group: 'modules',
  },
  {
    key: 'accountingOnly',
    type: 'boolean',
    label: 'Accounting-only pack',
    description: 'Hides retail modules in the sidebar and blocks retail routes.',
    defaultValue: false,
    group: 'modules',
  },
  {
    // Never grant this from an add-on: `mergeAddonFeatures` ORs booleans in, so
    // an add-on carrying it would silently replace a retail tenant's dashboard
    // rather than adding anything. A tenant's own choice lives in
    // `Tenant.dashboard_preference` — see `resolveDashboardVariant`.
    key: 'accountingDashboard',
    type: 'boolean',
    label: 'Accounting dashboard',
    description: 'Lands on the ledger-focused dashboard instead of the retail one.',
    defaultValue: false,
    group: 'modules',
  },
  {
    // Same add-on caveat as `accountingDashboard` above: an add-on carrying this
    // would replace a retail tenant's dashboard rather than add anything.
    key: 'crmDashboard',
    type: 'boolean',
    label: 'CRM dashboard',
    description: 'Lands on the pipeline dashboard instead of the retail one.',
    defaultValue: false,
    group: 'modules',
  },
  {
    key: 'premiumAccountingAdvanced',
    type: 'boolean',
    label: 'Advanced accounting reports',
    description: 'Comparative P&L, budget vs actual, cash flow, and financial ratios.',
    defaultValue: false,
    group: 'accounting',
  },
  {
    key: 'premiumManufacturing',
    type: 'boolean',
    label: 'Manufacturing module',
    description: 'BOM, production jobs, wastage recording, and production analytics.',
    defaultValue: false,
    group: 'modules',
  },
  {
    key: 'premiumStorefront',
    type: 'boolean',
    label: 'eCommerce storefront',
    description: 'Public storefront pages and customer order intake.',
    defaultValue: false,
    group: 'modules',
  },
  {
    key: 'premiumBookPublishing',
    type: 'boolean',
    label: 'Book publishing module',
    description: 'Publishing-specific catalog, print runs, and royalty tracking.',
    defaultValue: false,
    group: 'modules',
  },
  {
    key: 'premiumAi',
    type: 'boolean',
    label: 'AI assistant',
    description: 'Report narration, draft messages, and other AI features.',
    defaultValue: false,
    group: 'ai',
  },
  {
    key: 'premiumAiAnomaly',
    type: 'boolean',
    label: 'AI anomaly detection',
    description: 'Flags unusual movements in sales and stock. The one AI capability held above the entry tier.',
    defaultValue: false,
    group: 'ai',
  },
  {
    key: 'premiumVoice',
    type: 'boolean',
    label: 'Voice navigation',
    description: 'Voice commands in the header and voice entry on forms.',
    defaultValue: false,
    group: 'ai',
  },
  {
    key: 'aiCreditsMonthly',
    type: 'number',
    label: 'AI credits / month',
    description: 'Monthly AI credit allowance (1 credit = 1,000 tokens). Set to 0 when AI is off.',
    defaultValue: 0,
    min: 0,
    max: 100_000,
    group: 'ai',
  },
  {
    key: 'planRank',
    type: 'number',
    label: 'API tier rank',
    description: 'Controls @RequiresPlan ladder (0=FREE/ACCOUNTING, 1=BASIC, 2=STANDARD, 3=PREMIUM).',
    defaultValue: 0,
    min: 0,
    max: 3,
    group: 'platform',
  },
];

/** Fallback ranks when `planRank` is absent from stored features_json. */
export const LEGACY_PLAN_RANK: Record<FixedSubscriptionPlanCode, number> = {
  FREE: 0,
  ACCOUNTING: 0,
  BASIC: 1,
  STANDARD: 2,
  PREMIUM: 3,
};

/** Fallback AI credits when `aiCreditsMonthly` is absent from stored features_json. */
export const LEGACY_AI_CREDITS_MONTHLY: Record<FixedSubscriptionPlanCode, number> = {
  FREE: 0,
  BASIC: 100,
  ACCOUNTING: 100,
  STANDARD: 500,
  PREMIUM: 2000,
};

/** Sidebar module keys visible on accounting-only plans. */
export const ACCOUNTING_ONLY_MODULE_KEYS = new Set([
  'dashboard',
  'accounting',
  'account-settings',
  'help',
  'support',
]);

const entitlementKeys = new Set(PLAN_ENTITLEMENT_REGISTRY.map((entry) => entry.key));

export const planFeaturesSchema = z
  .record(z.string(), z.union([z.boolean(), z.number()]))
  .superRefine((value, ctx) => {
    for (const [key, raw] of Object.entries(value)) {
      if (!entitlementKeys.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown entitlement key: ${key}`,
        });
        continue;
      }

      const definition = PLAN_ENTITLEMENT_REGISTRY.find((entry) => entry.key === key)!;
      if (definition.type === 'boolean') {
        if (typeof raw !== 'boolean') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${key} must be a boolean`,
          });
        }
        continue;
      }

      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${key} must be a number`,
        });
        continue;
      }

      if (definition.min !== undefined && raw < definition.min) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${key} must be at least ${definition.min}`,
        });
      }
      if (definition.max !== undefined && raw > definition.max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${key} must be at most ${definition.max}`,
        });
      }
    }
  });

/**
 * Keys in `features_json` that the registry does not define.
 *
 * `normalizePlanFeatures` and `mergeAddonFeatures` both iterate the registry and
 * ignore anything else, so a plan or add-on carrying an unregistered key grants
 * exactly nothing — silently. That is not hypothetical: the IMPORTS_LC add-on
 * was sold at BDT 999/month for months while setting `premiumImports`, a key no
 * registry entry, controller or guard has ever known about. Seeding calls this
 * and refuses to write a row that would repeat it.
 */
export function unknownEntitlementKeys(features: Record<string, unknown>): string[] {
  return Object.keys(features).filter((key) => !entitlementKeys.has(key));
}

export function assertKnownEntitlements(label: string, features: Record<string, unknown>): void {
  const unknown = unknownEntitlementKeys(features);
  if (unknown.length > 0) {
    throw new Error(
      `${label} declares entitlement key(s) absent from PLAN_ENTITLEMENT_REGISTRY: ${unknown.join(', ')}. ` +
        'They would be dropped on merge and grant nothing. Register them or remove them.',
    );
  }
}

export function defaultPlanFeatures(): Record<string, boolean | number> {
  return Object.fromEntries(
    PLAN_ENTITLEMENT_REGISTRY.map((entry) => [entry.key, entry.defaultValue]),
  );
}

function isFixedPlanCode(code: string | null | undefined): code is FixedSubscriptionPlanCode {
  return Boolean(code && (SUBSCRIPTION_PLAN_CODES as readonly string[]).includes(code));
}

export function resolvePlanRank(
  features: Record<string, boolean | number>,
  planCode?: string | null,
): number {
  if (typeof features.planRank === 'number' && Number.isFinite(features.planRank)) {
    return features.planRank;
  }
  if (isFixedPlanCode(planCode)) {
    return LEGACY_PLAN_RANK[planCode];
  }
  return 0;
}

export function resolveAiCreditsMonthly(
  features: Record<string, boolean | number>,
  planCode?: string | null,
): number {
  if (typeof features.aiCreditsMonthly === 'number' && Number.isFinite(features.aiCreditsMonthly)) {
    return features.aiCreditsMonthly;
  }
  if (isFixedPlanCode(planCode)) {
    return LEGACY_AI_CREDITS_MONTHLY[planCode];
  }
  return 0;
}

export function normalizePlanFeatures(
  input: Record<string, unknown> | null | undefined,
  planCode?: string | null,
): Record<string, boolean | number> {
  const base = defaultPlanFeatures();
  if (!input || typeof input !== 'object') {
    if (isFixedPlanCode(planCode)) {
      base.planRank = LEGACY_PLAN_RANK[planCode];
      base.aiCreditsMonthly = LEGACY_AI_CREDITS_MONTHLY[planCode];
    }
    return base;
  }

  for (const definition of PLAN_ENTITLEMENT_REGISTRY) {
    const raw = input[definition.key];
    if (definition.type === 'boolean') {
      if (typeof raw === 'boolean') {
        base[definition.key] = raw;
      } else if (typeof raw === 'string') {
        base[definition.key] = raw.toLowerCase() === 'true' || raw === '1';
      } else if (typeof raw === 'number') {
        base[definition.key] = raw > 0;
      }
      continue;
    }

    if (typeof raw === 'number' && Number.isFinite(raw)) {
      base[definition.key] = raw;
    } else if (typeof raw === 'string' && raw.trim() !== '' && !Number.isNaN(Number(raw))) {
      base[definition.key] = Number(raw);
    }
  }

  if (input.planRank === undefined && isFixedPlanCode(planCode)) {
    base.planRank = LEGACY_PLAN_RANK[planCode];
  }
  if (input.aiCreditsMonthly === undefined && isFixedPlanCode(planCode)) {
    base.aiCreditsMonthly = LEGACY_AI_CREDITS_MONTHLY[planCode];
  }

  return base;
}

export function parsePlanFeatures(
  input: unknown,
  planCode?: string | null,
): Record<string, boolean | number> {
  const normalized = normalizePlanFeatures(
    input && typeof input === 'object' ? (input as Record<string, unknown>) : undefined,
    planCode,
  );
  planFeaturesSchema.parse(normalized);
  return normalized;
}

/**
 * Unions one or more purchased add-ons' `features_json` on top of a tenant's
 * normalized plan features. Add-ons only ever grant capability: booleans are
 * OR'd in, numeric quotas take the max of plan vs. every active add-on — an
 * add-on can never reduce what the base plan already grants.
 */
export function mergeAddonFeatures(
  baseFeatures: Record<string, boolean | number>,
  addonFeaturesList: Array<Record<string, unknown> | null | undefined>,
): Record<string, boolean | number> {
  const merged: Record<string, boolean | number> = { ...baseFeatures };

  for (const addonFeatures of addonFeaturesList) {
    if (!addonFeatures || typeof addonFeatures !== 'object') continue;

    for (const definition of PLAN_ENTITLEMENT_REGISTRY) {
      const raw = addonFeatures[definition.key];
      if (raw === undefined) continue;

      if (definition.type === 'boolean') {
        const grants =
          typeof raw === 'boolean'
            ? raw
            : typeof raw === 'string'
              ? raw.toLowerCase() === 'true' || raw === '1'
              : typeof raw === 'number'
                ? raw > 0
                : false;
        if (grants) {
          merged[definition.key] = true;
        }
        continue;
      }

      const numericValue =
        typeof raw === 'number' && Number.isFinite(raw)
          ? raw
          : typeof raw === 'string' && raw.trim() !== '' && !Number.isNaN(Number(raw))
            ? Number(raw)
            : undefined;
      if (numericValue === undefined) continue;

      const current = merged[definition.key];
      const currentNumeric = typeof current === 'number' ? current : 0;
      merged[definition.key] = Math.max(currentNumeric, numericValue);
    }
  }

  return merged;
}

export function hasPlanEntitlement(
  features: Record<string, boolean | number>,
  key: string,
): boolean {
  const value = features[key];
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value > 0;
  }
  return false;
}

/** Stored in `Tenant.dashboard_preference`. AUTO defers to the plan. */
export const DASHBOARD_PREFERENCES = ['AUTO', 'RETAIL', 'ACCOUNTING', 'CRM'] as const;

export type DashboardPreference = (typeof DASHBOARD_PREFERENCES)[number];

/** What the dashboard page actually renders once the preference is resolved. */
export type DashboardVariant = 'RETAIL' | 'ACCOUNTING' | 'CRM';

export function isDashboardPreference(value: unknown): value is DashboardPreference {
  return typeof value === 'string' && (DASHBOARD_PREFERENCES as readonly string[]).includes(value);
}

/**
 * Which dashboard a given user in a given tenant lands on, resolved from three
 * layers: the plan's `accountingDashboard`/`crmDashboard` default, the tenant's
 * own choice, and what the user can actually load.
 *
 * The fallbacks are not cosmetic. Every accounting panel reads from
 * `AccountingController`, which is gated on both `premiumAccounting` and the
 * `VIEW_LEDGER` *store* permission — send a cashier there and every tile 403s.
 * `CrmDashboardController` is the same story with `premiumCrm` + `VIEW_LEADS`.
 * In the other direction an `accountingOnly` tenant has no retail routes to fall
 * back to, so the plan stays the floor and the choice cannot escape it.
 */
export function resolveDashboardVariant(
  preference: string | null | undefined,
  features: Record<string, boolean | number>,
  permissions: readonly string[] = [],
): DashboardVariant {
  // An accounting-only workspace has no retail or CRM modules, routes or data,
  // so neither a preference nor a missing permission can move it elsewhere.
  if (hasPlanEntitlement(features, 'accountingOnly')) {
    return 'ACCOUNTING';
  }

  // Accounting wins the plan default when a plan somehow carries both, because
  // an accounting-flavoured plan is the narrower claim.
  let planDefault: DashboardVariant = 'RETAIL';
  if (hasPlanEntitlement(features, 'accountingDashboard')) {
    planDefault = 'ACCOUNTING';
  } else if (hasPlanEntitlement(features, 'crmDashboard')) {
    planDefault = 'CRM';
  }

  const chosen = isDashboardPreference(preference) && preference !== 'AUTO'
    ? (preference as DashboardVariant)
    : planDefault;

  if (chosen === 'RETAIL') {
    return 'RETAIL';
  }

  if (chosen === 'CRM') {
    const canReadPipeline =
      hasPlanEntitlement(features, 'premiumCrm') && permissions.includes('VIEW_LEADS');
    return canReadPipeline ? 'CRM' : 'RETAIL';
  }

  const canReadLedger =
    hasPlanEntitlement(features, 'premiumAccounting') && permissions.includes('VIEW_LEDGER');
  return canReadLedger ? 'ACCOUNTING' : 'RETAIL';
}

export function parseMarketingFeatures(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 20);
}