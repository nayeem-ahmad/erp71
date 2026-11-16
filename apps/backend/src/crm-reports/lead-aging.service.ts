import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { calendarDaysBetween, percent } from '../common/dashboard-window';
import { startOfZonedToday, zonedDateString } from '../common/tenant-time.util';
import { LeadStatus, OPEN_LEAD_STATUSES } from '../crm-leads/crm-leads.dto';
import { STALE_AFTER_DAYS, staleLeadCutoff } from '../crm-leads/crm-leads.dto';

/**
 * How long an open lead has been open, in the spans a sales manager actually
 * asks about. Upper bound is inclusive.
 */
export const AGING_BUCKETS = [
    { key: '0-7', maxDays: 7 },
    { key: '8-14', maxDays: 14 },
    { key: '15-30', maxDays: 30 },
    { key: '31-60', maxDays: 60 },
    { key: '61-90', maxDays: 90 },
    { key: '90+', maxDays: null },
] as const;

export type AgingBucketKey = (typeof AGING_BUCKETS)[number]['key'];

export type AgingBucket = {
    key: AgingBucketKey;
    leads: number;
    share_pct: number | null;
    stale: number;
    oldest_days: number | null;
};

export type AgingStage = {
    status: LeadStatus;
    leads: number;
    avg_age_days: number | null;
    oldest_days: number | null;
    stale: number;
};

export type LeadAgingReport = {
    as_of: string;
    stale_after_days: number;
    buckets: AgingBucket[];
    by_stage: AgingStage[];
    totals: {
        open: number;
        stale: number;
        stale_pct: number | null;
        avg_age_days: number | null;
        oldest_days: number | null;
    };
};

/** One decimal, without dragging in a formatter for a number the client re-renders. */
function round1(value: number): number {
    return Math.round(value * 10) / 10;
}

function bucketFor(days: number): AgingBucketKey {
    for (const bucket of AGING_BUCKETS) {
        if (bucket.maxDays === null || days <= bucket.maxDays) return bucket.key;
    }
    // Unreachable: the last bucket has no upper bound.
    return '90+';
}

type OpenLead = {
    id: string;
    status: string;
    created_at: Date;
    last_activity_at: Date | null;
};

/**
 * Lead aging — how long the open pipeline has been open.
 *
 * A **stock** report, like the dashboard's stage counts: an open pipeline has no
 * window, because "leads created this month that are still open" is a different
 * and much less useful question than "what is sitting in my pipeline right now".
 * So there is no `from`/`to`; the only date is `as_of`, which is today.
 *
 * Age is measured to the tenant calendar day, not in 24-hour blocks: a lead
 * filed at 23:00 last night is one day old at noon, not zero. That is the same
 * rule the follow-up report uses for due dates, and it keeps "90+ days" honest
 * when a lead was filed late in the evening.
 *
 * Starships "stale" from `staleLeadWhere` — the rule the dashboard's tile and
 * the leads list already share — so the report's count agrees with the number
 * on the dashboard for the same tenant.
 */
@Injectable()
export class LeadAgingService {
    constructor(private readonly db: DatabaseService) {}

    async report(
        tenantId: string,
        ownerId?: string,
        timezone: string = 'Asia/Dhaka',
    ): Promise<LeadAgingReport> {
        const now = new Date();
        const todayStart = startOfZonedToday(timezone, now);
        const asOf = zonedDateString(todayStart, timezone);

        // Same instant the dashboard and the leads list use for "no activity in
        // N days", so the two counts cannot drift apart.
        const staleCutoff = staleLeadCutoff(STALE_AFTER_DAYS, now);

        const where: any = {
            tenant_id: tenantId,
            status: { in: [...OPEN_LEAD_STATUSES] },
        };
        if (ownerId) {
            where.assigned_to = ownerId;
        }

        const leads = (await this.db.lead.findMany({
            where,
            select: {
                id: true,
                status: true,
                created_at: true,
                last_activity_at: true,
            },
        })) as OpenLead[];

        const buckets = new Map<AgingBucketKey, { leads: number; stale: number; oldest: number }>();
        for (const bucket of AGING_BUCKETS) {
            buckets.set(bucket.key, { leads: 0, stale: 0, oldest: 0 });
        }

        const stages = new Map<string, { leads: number; totalDays: number; oldest: number; stale: number }>();

        let totalDays = 0;
        let staleTotal = 0;
        let oldest = 0;

        for (const lead of leads) {
            const createdDay = zonedDateString(lead.created_at, timezone);
            const days = calendarDaysBetween(createdDay, asOf);

            // Mirrors `staleLeadWhere`: an absent `last_activity_at` falls back to
            // `created_at`, because a lead nobody has ever worked is the strongest
            // neglect signal rather than an exemption from it.
            const lastTouched = lead.last_activity_at ?? lead.created_at;
            const isStale = lastTouched.getTime() < staleCutoff.getTime();

            const bucket = buckets.get(bucketFor(days))!;
            bucket.leads += 1;
            if (isStale) bucket.stale += 1;
            if (days > bucket.oldest) bucket.oldest = days;

            let stage = stages.get(lead.status);
            if (!stage) {
                stage = { leads: 0, totalDays: 0, oldest: 0, stale: 0 };
                stages.set(lead.status, stage);
            }
            stage.leads += 1;
            stage.totalDays += days;
            if (isStale) stage.stale += 1;
            if (days > stage.oldest) stage.oldest = days;

            totalDays += days;
            if (isStale) staleTotal += 1;
            if (days > oldest) oldest = days;
        }

        const open = leads.length;

        const bucketRows: AgingBucket[] = AGING_BUCKETS.map(({ key }) => {
            const row = buckets.get(key)!;
            return {
                key,
                leads: row.leads,
                share_pct: percent(row.leads, open),
                stale: row.stale,
                oldest_days: row.leads > 0 ? row.oldest : null,
            };
        });

        // Only stages that actually hold leads: a zero row for a stage nobody
        // uses is noise, and the stage list is per-tenant anyway.
        const stageRows: AgingStage[] = [];
        for (const status of Object.values(LeadStatus)) {
            const stage = stages.get(status);
            if (!stage) continue;
            stageRows.push({
                status,
                leads: stage.leads,
                avg_age_days: round1(stage.totalDays / stage.leads),
                oldest_days: stage.oldest,
                stale: stage.stale,
            });
        }

        return {
            as_of: asOf,
            stale_after_days: STALE_AFTER_DAYS,
            buckets: bucketRows,
            by_stage: stageRows,
            totals: {
                open,
                stale: staleTotal,
                stale_pct: percent(staleTotal, open),
                avg_age_days: open > 0 ? round1(totalDays / open) : null,
                oldest_days: open > 0 ? oldest : null,
            },
        };
    }
}
