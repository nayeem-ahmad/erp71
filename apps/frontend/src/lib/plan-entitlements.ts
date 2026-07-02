import { hasPlanEntitlement, normalizePlanFeatures } from '@erp71/shared-types';

export function resolveTenantPlanFeatures(
    planCode: string | null | undefined,
    featuresJson: Record<string, unknown> | null | undefined,
) {
    return normalizePlanFeatures(featuresJson ?? undefined, planCode);
}

export function canAccessInventoryAdvancedReports(
    planCode: string | null | undefined,
    featuresJson: Record<string, unknown> | null | undefined,
) {
    return hasPlanEntitlement(resolveTenantPlanFeatures(planCode, featuresJson), 'premiumInventoryReports');
}

export function canAccessAccountingAdvancedReports(
    planCode: string | null | undefined,
    featuresJson: Record<string, unknown> | null | undefined,
) {
    return hasPlanEntitlement(resolveTenantPlanFeatures(planCode, featuresJson), 'premiumAccountingAdvanced');
}

export function canAccessPlanVoice(
    planCode: string | null | undefined,
    featuresJson: Record<string, unknown> | null | undefined,
) {
    return hasPlanEntitlement(resolveTenantPlanFeatures(planCode, featuresJson), 'premiumVoice');
}

export function isAccountingOnlyPlan(
    planCode: string | null | undefined,
    featuresJson: Record<string, unknown> | null | undefined,
) {
    return Boolean(resolveTenantPlanFeatures(planCode, featuresJson).accountingOnly);
}