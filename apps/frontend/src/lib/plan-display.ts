type PlanLike = { code?: string | null; name?: string | null } | null | undefined;

/** Human-readable subscription label for headers and billing UI. */
export function formatPlanDisplayName(plan: PlanLike): string | null {
    if (!plan?.code) return null;
    if (plan.name && plan.name !== plan.code) return plan.name;
    return plan.code.charAt(0) + plan.code.slice(1).toLowerCase();
}