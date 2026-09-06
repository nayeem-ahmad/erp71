/**
 * Stamps `TenantSubscription.setup_fee_paid_at` on every subscription that
 * predates the one-time setup fee.
 *
 * Why this exists
 * ---------------
 * Production does not run `prisma migrate deploy`. The container boots with
 * `prisma db push` (see apps/backend/Dockerfile), which syncs the *shape* of the
 * schema and nothing else. So migration `20260903160000_add_setup_fee` — which
 * adds both columns and backfills the stamp — only ever runs on a developer's
 * machine. In production the column lands NULL on every existing subscription.
 *
 * Why that matters
 * ----------------
 * `BillingService.createCheckout` reads the stamp to decide whether to add the
 * plan's setup fee to the amount. NULL means "never paid", so the day a platform
 * admin sets a non-zero `setup_fee` on a plan — which is exactly how the pricing
 * proposal lands, since `upsertPlan` never rewrites an existing row's price —
 * every tenant already on that plan is charged an onboarding fee the next time
 * they check out. They are existing customers. They were onboarded long ago.
 * Billing them for it is the single most damaging thing this feature could do.
 *
 * So the stamp has to exist before any fee does, which is why this runs on every
 * container start rather than as a one-off.
 *
 * Where the value comes from
 * --------------------------
 * `current_period_start` — the closest thing on the row to "when this tenant
 * started paying". The exact date does not matter, only that it is not NULL:
 * nothing reads it except the has-it-been-paid check.
 *
 * Idempotent: only rows where the stamp is still NULL are touched, so a second
 * run is a no-op and a value corrected by hand is never overwritten.
 *
 * Why there is a cutoff
 * ---------------------
 * "Stamp every NULL" was too broad, and it silently destroyed revenue. Signup
 * creates a subscription with status PAST_DUE and no stamp — the customer is
 * expected to go and check out afterwards. Any restart in that window (a deploy,
 * an OOM kill) ran this script, which could not tell that row apart from a
 * legacy tenant and stamped it. Checkout then read the stamp as "already paid"
 * and billed the plan price with no setup fee, permanently and silently, on an
 * invoice that looked correct. With Business at a 15,000 BDT setup fee that is
 * the largest single loss the billing code can produce.
 *
 * SETUP_FEE_EPOCH is the date `20260903160000_add_setup_fee` landed. No fee
 * existed before it, so a subscription that started earlier cannot owe one and
 * is safe to stamp. A subscription that started on or after it is a genuine
 * "has this been paid?" question that only checkout can answer, so it is left
 * NULL and reported rather than assumed.
 *
 * Usage:
 *   npx tsx prisma/sync-setup-fee-paid.ts --dry-run
 *   npx tsx prisma/sync-setup-fee-paid.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface SyncResult {
    scanned: number;
    stamped: number;
    /** Rows left NULL because they postdate the fee — awaiting a real checkout. */
    skipped: number;
}

/**
 * The date migration `20260903160000_add_setup_fee` landed. A subscription that
 * started before this could not have been charged a setup fee, so backfilling
 * its stamp is safe. One that started after it must not be assumed paid.
 */
export const SETUP_FEE_EPOCH = new Date('2026-09-03T00:00:00.000Z');

export async function syncSetupFeePaid(client: PrismaClient, dryRun = false): Promise<SyncResult> {
    const pending = await client.tenantSubscription.findMany({
        where: { setup_fee_paid_at: null, current_period_start: { lt: SETUP_FEE_EPOCH } },
        select: { id: true, current_period_start: true },
    });

    // Never stamped, only counted. These are new enough to genuinely owe a fee;
    // reported so an unbilled backlog is visible rather than silent.
    const skipped = await client.tenantSubscription.count({
        where: { setup_fee_paid_at: null, current_period_start: { gte: SETUP_FEE_EPOCH } },
    });

    const result: SyncResult = { scanned: pending.length, stamped: 0, skipped };
    if (pending.length === 0 || dryRun) {
        return result;
    }

    for (const subscription of pending) {
        await client.tenantSubscription.update({
            where: { id: subscription.id },
            data: { setup_fee_paid_at: subscription.current_period_start },
        });
        result.stamped += 1;
    }

    return result;
}

async function main() {
    const dryRun = process.argv.slice(2).includes('--dry-run');
    const result = await syncSetupFeePaid(prisma, dryRun);
    const prefix = dryRun ? '[dry run] ' : '';
    console.log(
        `${prefix}sync-setup-fee-paid: scanned ${result.scanned} pre-fee subscription(s) with no setup-fee stamp, ` +
            `stamped ${result.stamped}.`,
    );
    if (result.skipped > 0) {
        // Deliberately loud: these are subscriptions that may still owe a setup
        // fee. Stamping them is what silently loses the money, so they are named
        // rather than absorbed.
        console.log(
            `${prefix}sync-setup-fee-paid: left ${result.skipped} subscription(s) unstamped — ` +
                `they start on or after ${SETUP_FEE_EPOCH.toISOString().slice(0, 10)} and may still owe a setup fee.`,
        );
    }
}

if (require.main === module) {
    main()
        .catch((error) => {
            // Warn, never exit non-zero. This runs in an && chain ahead of
            // `node main.js` in the container CMD, where a non-zero exit is a
            // full outage rather than a failed script.
            console.error('sync-setup-fee-paid failed:', error);
            process.exitCode = 0;
        })
        .finally(() => prisma.$disconnect());
}
