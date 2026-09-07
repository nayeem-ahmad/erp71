/**
 * Repairs subscriptions left frozen by the missing-renewal bug.
 *
 * What went wrong
 * ---------------
 * Nothing in the codebase ever advanced `TenantSubscription.current_period_end`.
 * The fee cron selected subscriptions whose period had ended, posted a
 * `BillingEvent` keyed `subscription_fee:{tenantId}:{periodEnd as YYYY-MM-DD}`,
 * and stopped there. The next night it selected the same rows, computed the same
 * key, found the existing event and skipped — forever. So every paying tenant was
 * charged exactly once, on the day their subscription was created, and never
 * again. BUETEN (750/- monthly) is the case that surfaced it.
 *
 * `BillingSchedulerService` now advances the period, which fixes it going
 * forward. This script fixes what the frozen rows left behind.
 *
 * What it does
 * ------------
 * For every subscription whose `current_period_end` is in the past, it walks the
 * elapsed periods and posts the fee that each one should have generated, using
 * the same idempotency key the cron uses — so a period that *was* charged (or
 * that an admin has since voided) is left alone. It then advances the row onto
 * the period that is still running.
 *
 * Why not just let the cron do it
 * -------------------------------
 * It would, but silently and at 10pm, on tenants nobody is watching, generating
 * months of back-charges as a side effect of a deploy. Arrears are the user's
 * commercial decision, not a migration artifact — so this is a separate,
 * explicit, dry-run-by-default step with a per-tenant report.
 *
 * Not wired into the container CMD, deliberately. Run it by hand, read the dry
 * run, then run it for real:
 *
 *     npm run backfill:billing-periods --workspace=@erp71/database
 *     npm run backfill:billing-periods --workspace=@erp71/database -- --apply
 *
 * By default it only advances the period and posts NO back-charges: a tenant who
 * was never billed for months mostly should not receive a surprise invoice for
 * all of them. Pass `--charge-arrears` to post them, and `--max-periods=N` to
 * bound how far back that goes.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type BillingCycle = 'MONTHLY' | 'YEARLY';

/** Mirrors `apps/backend/src/billing/billing-cycle.util.ts`; kept local so this script has no cross-app import. */
function addMonths(from: Date, count: number): Date {
    const result = new Date(from);
    const targetDay = result.getUTCDate();
    result.setUTCDate(1);
    result.setUTCMonth(result.getUTCMonth() + count);
    const daysInTargetMonth = new Date(
        Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
    ).getUTCDate();
    result.setUTCDate(Math.min(targetDay, daysInTargetMonth));
    return result;
}

function elapsedPeriods(
    currentPeriodEnd: Date,
    cycle: BillingCycle,
    now: Date,
    maxPeriods: number,
): Array<{ periodStart: Date; periodEnd: Date }> {
    const periods: Array<{ periodStart: Date; periodEnd: Date }> = [];
    const step = cycle === 'YEARLY' ? 12 : 1;
    let index = 0;

    while (index < maxPeriods) {
        const periodStart = addMonths(currentPeriodEnd, index * step);
        if (periodStart > now) break;
        periods.push({ periodStart, periodEnd: addMonths(currentPeriodEnd, (index + 1) * step) });
        index += 1;
    }

    return periods;
}

/** Mirrors `applySubscriptionDiscount` in the backend; must stay identical or the backfill mis-bills. */
function applyDiscount(base: number, type: string | null, value: number | null): number {
    const amount = value ?? 0;
    if (!type || amount <= 0) return base;

    let net = base;
    if (type === 'PERCENTAGE') {
        net = base * (100 - amount) / 100;
    } else if (type === 'FIXED') {
        net = base - amount;
    }

    return Math.max(0, Math.round(net * 100) / 100);
}

export interface BackfillOptions {
    apply: boolean;
    chargeArrears: boolean;
    maxPeriods: number;
}

export interface TenantReport {
    tenantId: string;
    tenantName: string;
    planCode: string | null;
    cycle: BillingCycle;
    frozenSince: Date;
    missedPeriods: number;
    feeEach: number;
    feesPosted: number;
    newPeriodEnd: Date | null;
}

export async function backfillFrozenBillingPeriods(
    client: PrismaClient,
    options: BackfillOptions,
): Promise<TenantReport[]> {
    const now = new Date();

    const stale = await client.tenantSubscription.findMany({
        where: {
            current_period_end: { lt: now },
            status: { in: ['ACTIVE', 'PAST_DUE'] },
            tenant: { deleted_at: null, platform_workspace_key: null },
        },
        include: { tenant: { select: { name: true } }, plan: true },
    });

    const reports: TenantReport[] = [];

    for (const sub of stale) {
        const cycle: BillingCycle = sub.billing_cycle === 'YEARLY' ? 'YEARLY' : 'MONTHLY';
        const periods = elapsedPeriods(sub.current_period_end, cycle, now, options.maxPeriods);
        if (periods.length === 0) continue;

        const base = cycle === 'YEARLY'
            ? Number(sub.plan?.yearly_price ?? Number(sub.plan?.monthly_price ?? 0) * 12)
            : Number(sub.plan?.monthly_price ?? 0);
        const fee = base > 0
            ? applyDiscount(
                base,
                sub.discount_type,
                sub.discount_value != null ? Number(sub.discount_value) : null,
            )
            : 0;

        const finalPeriod = periods[periods.length - 1];
        const report: TenantReport = {
            tenantId: sub.tenant_id,
            tenantName: sub.tenant?.name ?? '(unknown)',
            planCode: sub.plan?.code ?? null,
            cycle,
            frozenSince: sub.current_period_end,
            missedPeriods: periods.length,
            feeEach: fee,
            feesPosted: 0,
            newPeriodEnd: options.apply ? finalPeriod.periodEnd : null,
        };

        if (options.apply && options.chargeArrears && fee > 0) {
            for (const period of periods) {
                const externalEventId =
                    `subscription_fee:${sub.tenant_id}:${period.periodStart.toISOString().slice(0, 10)}`;

                // Same key the cron uses, so an already-charged or admin-voided
                // period is never double-posted.
                const existing = await client.billingEvent.findUnique({
                    where: {
                        provider_name_external_event_id: {
                            provider_name: 'manual',
                            external_event_id: externalEventId,
                        },
                    },
                });
                if (existing) continue;

                await client.billingEvent.create({
                    data: {
                        tenant_id: sub.tenant_id,
                        provider_name: 'manual',
                        external_event_id: externalEventId,
                        event_type: 'subscription_fee',
                        status: 'posted',
                        amount: fee,
                        currency: 'BDT',
                        reference_id: sub.plan?.code ?? null,
                        payload: {
                            period_end: period.periodStart.toISOString(),
                            next_period_end: period.periodEnd.toISOString(),
                            billing_cycle: cycle,
                            plan_code: sub.plan?.code ?? null,
                            plan_name: sub.plan?.name ?? null,
                            base_amount: base,
                            backfilled: true,
                        },
                    },
                });
                report.feesPosted += 1;
            }
        }

        if (options.apply) {
            await client.tenantSubscription.update({
                where: { tenant_id: sub.tenant_id },
                data: {
                    current_period_start: finalPeriod.periodStart,
                    current_period_end: finalPeriod.periodEnd,
                },
            });
        }

        reports.push(report);
    }

    return reports;
}

async function main() {
    const argv = process.argv.slice(2);
    const maxArg = argv.find((a) => a.startsWith('--max-periods='));

    const options: BackfillOptions = {
        apply: argv.includes('--apply'),
        chargeArrears: argv.includes('--charge-arrears'),
        maxPeriods: maxArg ? Math.max(1, parseInt(maxArg.split('=')[1], 10) || 24) : 24,
    };

    const reports = await backfillFrozenBillingPeriods(prisma, options);
    const prefix = options.apply ? '' : '[dry run] ';

    if (reports.length === 0) {
        console.log(`${prefix}backfill-frozen-billing-periods: no frozen subscriptions found.`);
        return;
    }

    console.log(
        `${prefix}backfill-frozen-billing-periods: ${reports.length} subscription(s) with an elapsed period.\n`,
    );

    for (const r of reports) {
        console.log(
            `  ${r.tenantName} (${r.tenantId})\n` +
            `    plan=${r.planCode ?? 'none'} cycle=${r.cycle} fee=৳${r.feeEach.toFixed(2)}\n` +
            `    frozen since ${r.frozenSince.toISOString().slice(0, 10)}, ${r.missedPeriods} period(s) elapsed\n` +
            `    arrears if charged: ৳${(r.feeEach * r.missedPeriods).toFixed(2)}` +
            (options.apply ? ` | posted ${r.feesPosted} fee(s), period now ends ${r.newPeriodEnd?.toISOString().slice(0, 10)}` : ''),
        );
    }

    if (!options.apply) {
        console.log(
            `\n  Nothing was written. Re-run with --apply to advance the periods, ` +
            `and add --charge-arrears to also post the missed fees.`,
        );
    } else if (!options.chargeArrears) {
        console.log(
            `\n  Periods advanced; no back-charges posted (--charge-arrears not set). ` +
            `Billing resumes from the current period.`,
        );
    }
}

if (require.main === module) {
    main()
        .catch((error) => {
            console.error('backfill-frozen-billing-periods failed:', error);
            process.exitCode = 1;
        })
        .finally(() => prisma.$disconnect());
}
