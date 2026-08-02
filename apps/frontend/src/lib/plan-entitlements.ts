import {
    hasPlanEntitlement,
    normalizePlanFeatures,
    resolveDashboardVariant,
    type DashboardVariant,
} from '@erp71/shared-types';

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

/** True when the plan or an admin could put this tenant on the accounting dashboard. */
export function canChooseAccountingDashboard(
    planCode: string | null | undefined,
    featuresJson: Record<string, unknown> | null | undefined,
) {
    return hasPlanEntitlement(resolveTenantPlanFeatures(planCode, featuresJson), 'premiumAccounting');
}

/** Which dashboard to render — plan default, tenant choice, then what the user can load. */
export function tenantDashboardVariant(
    planCode: string | null | undefined,
    featuresJson: Record<string, unknown> | null | undefined,
    dashboardPreference: string | null | undefined,
    permissions: readonly string[] = [],
): DashboardVariant {
    return resolveDashboardVariant(
        dashboardPreference,
        resolveTenantPlanFeatures(planCode, featuresJson),
        permissions,
    );
}