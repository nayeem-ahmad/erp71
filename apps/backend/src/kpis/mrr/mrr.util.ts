/**
 * Monthly recurring revenue: what each tenant pays the platform per month, and
 * how that changed between two days.
 *
 * Pure functions so the billing rules they mirror can be pinned by tests. The
 * rules are the fee cron's (`billing-scheduler.service.ts`): a monthly
 * subscription pays the plan's monthly price, a yearly one the yearly price
 * (or 12 × monthly when the plan has none), the tenant's discount comes off the
 * cycle's fee, and add-ons bill their monthly price undiscounted. MRR is that
 * fee per month, so a yearly fee is divided by 12.
 */
import { applySubscriptionDiscount } from '../../billing/discount.util';
import { normalizeBillingCycle } from '../../billing/billing-cycle.util';

const money = (value: number) => Math.round(value * 100) / 100 + 0;

export interface SubscriptionForMrr {
    status: string;
    billingCycle: string | null;
    /** When the tenant first paid. Null means never activated, so not a customer yet. */
    activatedAt: Date | null;
    /** Set while the billing sweep has suspended the workspace for non-payment. */
    suspendedAt: Date | null;
    monthlyPrice: number;
    yearlyPrice: number | null;
    discountType: string | null;
    discountValue: number | null;
    /** Monthly prices of the tenant's active add-ons. */
    addonMonthlyPrices: number[];
}

export interface TenantMrr {
    mrr: number;
    planMrr: number;
    addonMrr: number;
}

/**
 * Whether a subscription counts as paying.
 *
 * Active, or past due after having paid at least once (a customer in dunning
 * is still a customer until the sweep suspends them or they cancel). A trial,
 * a cancelled subscription, a suspended workspace, and a workspace provisioned
 * at signup that has never paid (`PAST_DUE` with no `activated_at`) are not.
 */
export function isPaying(sub: Pick<SubscriptionForMrr, 'status' | 'activatedAt' | 'suspendedAt'>): boolean {
    if (sub.suspendedAt) return false;
    if (sub.status === 'ACTIVE') return sub.activatedAt !== null;
    if (sub.status === 'PAST_DUE') return sub.activatedAt !== null;
    return false;
}

export function subscriptionMrr(sub: SubscriptionForMrr): TenantMrr {
    if (!isPaying(sub)) return { mrr: 0, planMrr: 0, addonMrr: 0 };

    const yearly = normalizeBillingCycle(sub.billingCycle) === 'YEARLY';
    const base = yearly ? (sub.yearlyPrice ?? sub.monthlyPrice * 12) : sub.monthlyPrice;
    const fee = base > 0 ? applySubscriptionDiscount(base, sub.discountType, sub.discountValue) : 0;
    const planMrr = money(yearly ? fee / 12 : fee);
    const addonMrr = money(sub.addonMonthlyPrices.reduce((sum, price) => sum + Math.max(price, 0), 0));
    return { mrr: money(planMrr + addonMrr), planMrr, addonMrr };
}

/** How MRR moved between a start day and an end day, summed over tenants. */
export interface MrrMovements {
    startMrr: number;
    endMrr: number;
    /** Tenants paying for the first time. */
    newMrr: number;
    /** Paying more than at the start. */
    expansionMrr: number;
    /** Paying less than at the start, but still paying. */
    contractionMrr: number;
    /** Paying at the start and nothing at the end: the whole starting amount. */
    churnedMrr: number;
    /** Paying at the end after having paid before the start, but not at it. */
    reactivationMrr: number;
    startCustomers: number;
    endCustomers: number;
    newCustomers: number;
    lostCustomers: number;
}

/**
 * Classify each tenant's change from `start` to `end`.
 *
 * `paidBefore` holds the tenants that paid at some point up to the start day;
 * a tenant at zero on the start day who pays at the end is a reactivation if
 * it is in there, new otherwise.
 */
export function mrrMovements(
    start: ReadonlyMap<string, number>,
    end: ReadonlyMap<string, number>,
    paidBefore: ReadonlySet<string>,
): MrrMovements {
    const totals = {
        startMrr: 0, endMrr: 0, newMrr: 0, expansionMrr: 0, contractionMrr: 0, churnedMrr: 0, reactivationMrr: 0,
        startCustomers: 0, endCustomers: 0, newCustomers: 0, lostCustomers: 0,
    };
    for (const tenantId of new Set([...start.keys(), ...end.keys()])) {
        const before = Math.max(start.get(tenantId) ?? 0, 0);
        const after = Math.max(end.get(tenantId) ?? 0, 0);
        totals.startMrr += before;
        totals.endMrr += after;
        if (before > 0) totals.startCustomers += 1;
        if (after > 0) totals.endCustomers += 1;

        if (before > 0 && after === 0) {
            totals.churnedMrr += before;
            totals.lostCustomers += 1;
        } else if (before === 0 && after > 0) {
            if (paidBefore.has(tenantId)) {
                totals.reactivationMrr += after;
            } else {
                totals.newMrr += after;
                totals.newCustomers += 1;
            }
        } else if (after > before) {
            totals.expansionMrr += after - before;
        } else if (after < before) {
            totals.contractionMrr += before - after;
        }
    }
    return Object.fromEntries(
        Object.entries(totals).map(([key, value]) => [key, key.endsWith('Customers') ? value : money(value)]),
    ) as unknown as MrrMovements;
}
