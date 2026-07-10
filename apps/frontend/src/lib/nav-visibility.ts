import { hasPlanEntitlement, normalizePlanFeatures } from '@erp71/shared-types';

export type EntitlementGate = { entitlement?: string };

export function isItemVisible(
  item: EntitlementGate,
  features: Record<string, unknown> | null | undefined,
): boolean {
  if (!item.entitlement) return true;
  return hasPlanEntitlement(normalizePlanFeatures(features ?? undefined), item.entitlement);
}

export function extractTenantPlan(
  me: any,
  tenantId: string | null,
): { planCode: string | null; features: Record<string, unknown> } {
  const tenants = me?.tenants ?? [];
  const tenant = tenants.find((entry: { id: string }) => entry.id === tenantId) ?? tenants[0];
  return {
    planCode: tenant?.subscription?.plan?.code ?? null,
    features: (tenant?.subscription?.plan?.features_json ?? {}) as Record<string, unknown>,
  };
}
