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

export type PlanEntitlementType = 'boolean' | 'number';

export interface PlanEntitlementDefinition {
  key: string;
  type: PlanEntitlementType;
  label: string;
  description?: string;
  defaultValue: boolean | number;
  min?: number;
  max?: number;
}

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
  },
  {
    key: 'maxUsers',
    type: 'number',
    label: 'Max users',
    description: 'Maximum team members across the tenant.',
    defaultValue: 1,
    min: 1,
    max: 500,
  },
  {
    key: 'maxSkus',
    type: 'number',
    label: 'Max SKUs',
    description: 'Product catalog limit. Use -1 for unlimited.',
    defaultValue: 100,
    min: -1,
    max: 1_000_000,
  },
  {
    key: 'premiumAccounting',
    type: 'boolean',
    label: 'Accounting module',
    description: 'Unlocks the full accounting workspace and financial reports.',
    defaultValue: false,
  },
  {
    key: 'premiumInventoryReports',
    type: 'boolean',
    label: 'Inventory reports',
    description: 'Advanced inventory analytics and valuation reports.',
    defaultValue: false,
  },
  {
    key: 'premiumCrm',
    type: 'boolean',
    label: 'Premium CRM',
    description: 'Lead pipeline and premium CRM features.',
    defaultValue: false,
  },
  {
    key: 'multiStore',
    type: 'boolean',
    label: 'Multi-store',
    description: 'Branch switching and multi-location operations.',
    defaultValue: false,
  },
  {
    key: 'apiAccess',
    type: 'boolean',
    label: 'API access',
    description: 'Tenant API keys and integrations.',
    defaultValue: false,
  },
  {
    key: 'accountingOnly',
    type: 'boolean',
    label: 'Accounting-only pack',
    description: 'Hides retail modules in the sidebar and blocks retail routes.',
    defaultValue: false,
  },
  {
    key: 'planRank',
    type: 'number',
    label: 'API tier rank',
    description: 'Controls @RequiresPlan ladder (0=FREE/ACCOUNTING, 1=BASIC, 2=STANDARD, 3=PREMIUM).',
    defaultValue: 0,
    min: 0,
    max: 3,
  },
  {
    key: 'aiCreditsMonthly',
    type: 'number',
    label: 'AI credits / month',
    description: 'Monthly AI credit allowance (1 credit = 1,000 tokens).',
    defaultValue: 0,
    min: 0,
    max: 100_000,
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

  if (typeof base.planRank !== 'number' && isFixedPlanCode(planCode)) {
    base.planRank = LEGACY_PLAN_RANK[planCode];
  }
  if (typeof base.aiCreditsMonthly !== 'number' && isFixedPlanCode(planCode)) {
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

export function parseMarketingFeatures(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 20);
}