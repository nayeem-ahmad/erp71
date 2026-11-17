import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../../database/database.service';
import { JobTrackerService } from '../../system-health/jobs/job-tracker.service';
import { JOB_NAMES } from '../../system-health/jobs/job-names';
import { normalizeBillingCycle } from '../../billing/billing-cycle.util';
import { addCalendarDays, DEFAULT_TENANT_TIMEZONE, zonedDateString } from '../../common/tenant-time.util';
import { subscriptionMrr, type TenantMrr } from './mrr.util';

/** Customer workspaces only: not deleted, not the platform's own. */
const LIVE_TENANT = { deleted_at: null, platform_workspace_key: null } as const;

/** Add-on subscriptions that bill. */
const BILLING_ADDON_STATUSES = ['ACTIVE', 'PAST_DUE'] as const;

/** How many month-ends the one-off backfill reconstructs. */
export const BACKFILL_MONTHS = 12;

export interface TenantMrrRow extends TenantMrr {
    tenantId: string;
    planCode: string | null;
    status: string;
    billingCycle: string;
}

/** Every tenant's MRR on a day, or `covered: false` when the day predates the history. */
export interface MrrOnDay {
    covered: boolean;
    byTenant: Map<string, number>;
}

/**
 * Keeps the platform's MRR history (`TenantMrrSnapshot`) and answers "what
 * was each tenant paying on day X".
 *
 * Today's figure is always computed live from the subscriptions. Past days
 * read the most recent snapshot day on or before them: the nightly job writes
 * a complete set every day, so a gap (a missed run) carries the previous day
 * forward rather than reading as zero. Before the first snapshot there is no
 * history, and the KPIs say so instead of guessing.
 */
@Injectable()
export class MrrSnapshotService implements OnApplicationBootstrap {
    private readonly logger = new Logger(MrrSnapshotService.name);

    constructor(
        private readonly db: DatabaseService,
        private readonly jobTracker: JobTrackerService,
    ) {}

    /** Today in the platform's calendar. */
    today(now: Date = new Date()): string {
        return zonedDateString(now, DEFAULT_TENANT_TIMEZONE);
    }

    /**
     * Start the history on the first boot after this ships, rather than waiting
     * for the first nightly run. Not awaited: a slow backfill must not hold up
     * the API coming up. Skipped under test, where there is no real database.
     */
    onApplicationBootstrap(): void {
        if (process.env.NODE_ENV === 'test') return;
        void this.ensureHistory().catch((err) => this.logger.error(`MRR history bootstrap failed: ${err}`));
    }

    @Cron('50 23 * * *', { timeZone: 'Asia/Dhaka' })
    async recordDaily(): Promise<void> {
        await this.jobTracker.track(JOB_NAMES.PLATFORM_MRR_SNAPSHOT, () => this.ensureHistory());
    }

    /** Backfill once if there is no history, then record today. Idempotent. */
    async ensureHistory(): Promise<{ backfilled: number; recorded: number }> {
        const existing = await this.db.tenantMrrSnapshot.count();
        const backfilled = existing === 0 ? await this.backfill() : 0;
        const recorded = await this.recordDay(this.today());
        return { backfilled, recorded };
    }

    /** Every tenant's MRR as of now, from the subscriptions as they stand. */
    async liveMrr(): Promise<TenantMrrRow[]> {
        const [subscriptions, addons] = await Promise.all([
            this.db.tenantSubscription.findMany({
                where: { tenant: LIVE_TENANT },
                select: {
                    tenant_id: true,
                    status: true,
                    billing_cycle: true,
                    activated_at: true,
                    discount_type: true,
                    discount_value: true,
                    plan: { select: { code: true, monthly_price: true, yearly_price: true } },
                    tenant: { select: { billing_suspended_at: true } },
                },
            }),
            this.db.tenantAddonSubscription.findMany({
                where: { status: { in: [...BILLING_ADDON_STATUSES] }, tenant: LIVE_TENANT },
                select: { tenant_id: true, addon: { select: { monthly_price: true } } },
            }),
        ]);

        const addonPrices = new Map<string, number[]>();
        for (const row of addons) {
            const list = addonPrices.get(row.tenant_id) ?? [];
            list.push(Number(row.addon.monthly_price ?? 0));
            addonPrices.set(row.tenant_id, list);
        }

        return subscriptions.map((sub) => ({
            tenantId: sub.tenant_id,
            planCode: sub.plan?.code ?? null,
            status: sub.status,
            billingCycle: normalizeBillingCycle(sub.billing_cycle),
            ...subscriptionMrr({
                status: sub.status,
                billingCycle: sub.billing_cycle,
                activatedAt: sub.activated_at,
                suspendedAt: sub.tenant.billing_suspended_at,
                monthlyPrice: Number(sub.plan?.monthly_price ?? 0),
                yearlyPrice: sub.plan?.yearly_price == null ? null : Number(sub.plan.yearly_price),
                discountType: sub.discount_type,
                discountValue: sub.discount_value == null ? null : Number(sub.discount_value),
                addonMonthlyPrices: addonPrices.get(sub.tenant_id) ?? [],
            }),
        }));
    }

    /** Write (or overwrite) every tenant's MRR for one day. */
    async recordDay(day: string): Promise<number> {
        const rows = await this.liveMrr();
        const date = dateOnly(day);
        for (const row of rows) {
            const data = {
                mrr: row.mrr,
                plan_mrr: row.planMrr,
                addon_mrr: row.addonMrr,
                plan_code: row.planCode,
                status: row.status,
                billing_cycle: row.billingCycle,
                source: 'daily',
            };
            await this.db.tenantMrrSnapshot.upsert({
                where: { tenant_id_day: { tenant_id: row.tenantId, day: date } },
                create: { tenant_id: row.tenantId, day: date, ...data },
                update: data,
            });
        }
        return rows.length;
    }

    /** Each tenant's MRR on `day`: live for today or later, otherwise from the history. */
    async mrrOn(day: string): Promise<MrrOnDay> {
        if (day >= this.today()) {
            const rows = await this.liveMrr();
            return { covered: true, byTenant: new Map(rows.map((r) => [r.tenantId, r.mrr])) };
        }
        const latest = await this.db.tenantMrrSnapshot.findFirst({
            where: { day: { lte: dateOnly(day) } },
            orderBy: { day: 'desc' },
            select: { day: true },
        });
        if (!latest) return { covered: false, byTenant: new Map() };

        const rows = await this.db.tenantMrrSnapshot.findMany({
            where: { day: latest.day },
            select: { tenant_id: true, mrr: true },
        });
        return { covered: true, byTenant: new Map(rows.map((r) => [r.tenant_id, Number(r.mrr)])) };
    }

    /** Tenants that paid anything on or before `day`, for telling a reactivation from a new customer. */
    async paidOnOrBefore(day: string): Promise<Set<string>> {
        const rows = await this.db.tenantMrrSnapshot.findMany({
            where: { day: { lte: dateOnly(day) }, mrr: { gt: 0 } },
            distinct: ['tenant_id'],
            select: { tenant_id: true },
        });
        return new Set(rows.map((r) => r.tenant_id));
    }

    /** The first day with history, or null when there is none yet. */
    async historyStart(): Promise<string | null> {
        const first = await this.db.tenantMrrSnapshot.findFirst({ orderBy: { day: 'asc' }, select: { day: true } });
        return first ? first.day.toISOString().slice(0, 10) : null;
    }

    /**
     * Rebuild month-end MRR for the last year from billing history, once.
     *
     * Rough by design, and marked `source: 'backfill'`. A tenant counts on a
     * month-end when it had activated by then and either was still inside its
     * first paid period, or had a subscription fee posted within one billing
     * cycle (plus a week's grace) before it. The amount is that fee spread
     * per month, or the current plan's MRR inside the first period. Add-ons
     * are not reconstructed. Days the nightly job records replace nothing
     * here: they are later days.
     */
    async backfill(now: Date = new Date()): Promise<number> {
        const today = this.today(now);
        const monthEnds = previousMonthEnds(today, BACKFILL_MONTHS);
        if (monthEnds.length === 0) return 0;

        const [subscriptions, fees, live] = await Promise.all([
            this.db.tenantSubscription.findMany({
                where: { tenant: { platform_workspace_key: null } },
                select: {
                    tenant_id: true,
                    activated_at: true,
                    billing_cycle: true,
                    plan: { select: { code: true } },
                    tenant: { select: { deleted_at: true } },
                },
            }),
            this.db.billingEvent.findMany({
                where: { event_type: 'subscription_fee', amount: { gt: 0 } },
                select: { tenant_id: true, amount: true, created_at: true, payload: true },
                orderBy: { created_at: 'asc' },
            }),
            this.liveMrr(),
        ]);
        const liveByTenant = new Map(live.map((r) => [r.tenantId, r]));
        const feesByTenant = new Map<string, Array<{ at: Date; monthly: number; cycleDays: number }>>();
        for (const fee of fees) {
            const payload = (fee.payload ?? {}) as { billing_cycle?: string };
            const yearly = normalizeBillingCycle(payload.billing_cycle) === 'YEARLY';
            const list = feesByTenant.get(fee.tenant_id) ?? [];
            list.push({ at: fee.created_at, monthly: Number(fee.amount) / (yearly ? 12 : 1), cycleDays: yearly ? 366 : 31 });
            feesByTenant.set(fee.tenant_id, list);
        }

        let written = 0;
        for (const day of monthEnds) {
            const endOfDay = new Date(`${addCalendarDays(day, 1)}T00:00:00+06:00`);
            for (const sub of subscriptions) {
                if (!sub.activated_at || sub.activated_at >= endOfDay) continue;
                if (sub.tenant.deleted_at && sub.tenant.deleted_at < endOfDay) continue;

                const yearly = normalizeBillingCycle(sub.billing_cycle) === 'YEARLY';
                const firstPeriodDays = yearly ? 366 : 31;
                const lastFee = [...(feesByTenant.get(sub.tenant_id) ?? [])].reverse().find((f) => f.at < endOfDay);
                const graceMs = 7 * 86_400_000;

                let mrr = 0;
                if (lastFee && endOfDay.getTime() - lastFee.at.getTime() <= lastFee.cycleDays * 86_400_000 + graceMs) {
                    mrr = lastFee.monthly;
                } else if (endOfDay.getTime() - sub.activated_at.getTime() <= firstPeriodDays * 86_400_000) {
                    mrr = liveByTenant.get(sub.tenant_id)?.planMrr ?? 0;
                }
                const rounded = Math.round(mrr * 100) / 100;
                await this.db.tenantMrrSnapshot.upsert({
                    where: { tenant_id_day: { tenant_id: sub.tenant_id, day: dateOnly(day) } },
                    create: {
                        tenant_id: sub.tenant_id,
                        day: dateOnly(day),
                        mrr: rounded,
                        plan_mrr: rounded,
                        addon_mrr: 0,
                        plan_code: sub.plan?.code ?? null,
                        status: rounded > 0 ? 'ACTIVE' : null,
                        billing_cycle: yearly ? 'YEARLY' : 'MONTHLY',
                        source: 'backfill',
                    },
                    update: {},
                });
                written += 1;
            }
        }
        this.logger.log(`Backfilled ${written} MRR snapshot rows across ${monthEnds.length} month-ends`);
        return written;
    }
}

/** A `YYYY-MM-DD` day as the `@db.Date` value Prisma stores. */
function dateOnly(day: string): Date {
    return new Date(`${day}T00:00:00.000Z`);
}

/** The last day of each of the `count` months before the month `today` is in, oldest first. */
export function previousMonthEnds(today: string, count: number): string[] {
    const [year, month] = today.split('-').map(Number);
    const days: string[] = [];
    for (let back = count; back >= 1; back -= 1) {
        // Day 0 of a month is the last day of the one before it.
        days.push(new Date(Date.UTC(year, month - back, 0)).toISOString().slice(0, 10));
    }
    return days;
}
