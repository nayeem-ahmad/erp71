import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.service';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';
import { JOB_NAMES } from '../system-health/jobs/job-names';
import { AppLogger } from '../common/app-logger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CrmLeadTaxonomyService } from '../crm-lead-taxonomy/crm-lead-taxonomy.service';
import { LeadTaxonomyKind } from '../crm-lead-taxonomy/lead-taxonomy.dto';
import { paginate } from '../common/pagination.dto';
import { createdAtRange, dhakaDayRange } from '../common/created-range.util';
import { UNASSIGNED_OWNER_FILTER } from '../crm-leads/crm-leads.dto';
import { resolveOrderBy, type SortableMap } from '../common/sort.util';
import { computeLeadScore, DEFAULT_SOURCE_WEIGHT } from '../crm-leads/lead-scoring.util';
import {
    CompleteCrmActivityDto,
    CreateCrmActivityDto,
    UpdateCrmActivityDto,
} from './crm-activities.dto';

export const ACTIVITY_INCLUDES = {
    lead: { select: { id: true, name: true, mobile: true } },
    customer: { select: { id: true, name: true, phone: true } },
    purpose: { select: { id: true, code: true, name: true, icon: true } },
    channel: { select: { id: true, code: true, name: true, icon: true } },
    assignee: { select: { id: true, name: true, email: true } },
    creator: { select: { id: true, name: true, email: true } },
};

const ACTIVITY_SORTABLE: SortableMap = {
    due_at: (dir) => ({ due_at: dir }),
    completed_at: (dir) => ({ completed_at: dir }),
    created_at: (dir) => ({ created_at: dir }),
    status: (dir) => ({ status: dir }),
    subject: (dir) => ({ subject: dir }),
};

const ACTIVITY_DEFAULT_ORDER = [{ due_at: 'asc' as const }, { created_at: 'desc' as const }];

/** How long a customer must go untouched before the reorder cron flags them. */
const REORDER_DORMANT_DAYS = 60;

export type ListActivityOpts = {
    leadId?: string;
    customerId?: string;
    target?: 'lead' | 'customer';
    status?: string;
    assignedTo?: string;
    /** A user id, or UNASSIGNED_OWNER_FILTER — the owner of the *lead*, not the activity's assignee. */
    leadOwner?: string;
    purposeId?: string;
    channelId?: string;
    dueToday?: boolean;
    overdue?: boolean;
    dueFrom?: string;
    dueTo?: string;
    createdFrom?: string;
    createdTo?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortDir?: string;
};

function startOfToday(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}

/** A Prisma `due_at` constraint. `lt` is exclusive (windows), `lte` inclusive (calendar days). */
type DueWindow = { gte?: Date; lt?: Date; lte?: Date };

const startInstant = (w: DueWindow) => (w.gte ? w.gte.getTime() : -Infinity);
/** `lte X` and `lt X+1ms` are the same instant, so both ends compare on one scale. */
const endInstant = (w: DueWindow) =>
    w.lt ? w.lt.getTime() : w.lte ? w.lte.getTime() + 1 : Infinity;

/**
 * Narrows one due window by another: the later start and the earlier end win.
 *
 * `dueToday`, `overdue` and the explicit `dueFrom`/`dueTo` range each carry a
 * due window, and callers can send more than one. Assigning them in turn would
 * let the last one silently discard the others; intersecting means every filter
 * the caller asked for still constrains the result.
 */
function intersectDueWindow(current: DueWindow | undefined, next: DueWindow): DueWindow {
    if (!current) return next;
    const start = startInstant(current) >= startInstant(next) ? current : next;
    const end = endInstant(current) <= endInstant(next) ? current : next;
    const merged: DueWindow = {};
    if (start.gte) merged.gte = start.gte;
    if (end.lt) merged.lt = end.lt;
    else if (end.lte) merged.lte = end.lte;
    return merged;
}

@Injectable()
export class CrmActivitiesService {
    constructor(
        private readonly db: DatabaseService,
        private readonly taxonomy: CrmLeadTaxonomyService,
        private readonly logger: AppLogger,
        private readonly notifications: NotificationsService,
        private readonly jobTracker: JobTrackerService,
    ) {}

    /**
     * Exactly one of lead_id / customer_id, and it must exist in this tenant.
     * Lifted verbatim from CrmFollowUpsService.validateFollowUpTarget so the
     * rule does not fork.
     */
    private async resolveTarget(tenantId: string, leadId?: string, customerId?: string) {
        const hasLead = Boolean(leadId);
        const hasCustomer = Boolean(customerId);
        if (hasLead === hasCustomer) {
            throw new BadRequestException('Provide exactly one of lead_id or customer_id.');
        }

        if (leadId) {
            const lead = await this.db.lead.findFirst({
                where: { id: leadId, tenant_id: tenantId },
                select: { id: true, status: true },
            });
            if (!lead) throw new NotFoundException('Lead not found');
            if (lead.status === 'LOST' || lead.status === 'CONVERTED') {
                throw new BadRequestException(
                    'Activities cannot be created for lost or converted leads.',
                );
            }
            return { lead_id: leadId };
        }

        const customer = await this.db.customer.findFirst({
            where: { id: customerId, tenant_id: tenantId, deleted_at: null },
            select: { id: true },
        });
        if (!customer) throw new NotFoundException('Customer not found');
        return { customer_id: customerId };
    }

    private async resolveChannel(tenantId: string, value: string) {
        const channel = await this.taxonomy.resolveByIdOrCode(
            tenantId,
            LeadTaxonomyKind.CHANNEL,
            value,
        );
        if (!channel) throw new BadRequestException(`Unknown conversation channel "${value}".`);
        if (!channel.is_active) {
            throw new BadRequestException(`Conversation channel "${channel.name}" is retired.`);
        }
        return channel;
    }

    private async resolvePurpose(tenantId: string, value?: string) {
        if (!value) return null;
        const purpose = await this.taxonomy.resolveByIdOrCode(
            tenantId,
            LeadTaxonomyKind.PURPOSE,
            value,
        );
        if (!purpose) throw new BadRequestException(`Unknown activity purpose "${value}".`);
        return purpose;
    }

    async create(tenantId: string, userId: string, dto: CreateCrmActivityDto) {
        const target = await this.resolveTarget(tenantId, dto.lead_id, dto.customer_id);
        const status = dto.status ?? 'PLANNED';

        if (status === 'PLANNED' && !dto.subject) {
            throw new BadRequestException('subject is required when planning an activity.');
        }
        if (status === 'DONE' && (!dto.summary || !dto.channel)) {
            throw new BadRequestException(
                'summary and channel are required when logging a completed activity.',
            );
        }

        const purpose = await this.resolvePurpose(tenantId, dto.purpose);
        const channel = dto.channel ? await this.resolveChannel(tenantId, dto.channel) : null;
        const now = new Date();

        const activity = await this.db.crmActivity.create({
            data: {
                tenant_id: tenantId,
                ...target,
                subject: dto.subject ?? null,
                status,
                due_at: dto.due_at ? new Date(dto.due_at) : null,
                completed_at: status === 'DONE' ? now : null,
                purpose_id: purpose?.id ?? null,
                channel_id: channel?.id ?? null,
                channel_code: channel?.code ?? null,
                summary: dto.summary ?? null,
                outcome: dto.outcome ?? null,
                notes: dto.notes ?? null,
                direction: dto.direction ?? 'OUTBOUND',
                // Falls back to the creator, as CrmLeadsService.create does for a
                // lead's owner. An activity nobody owns is invisible to the
                // assignee filter and silently skips notifyAssignee.
                assigned_to: dto.assigned_to ?? userId,
                store_id: dto.store_id ?? null,
                created_by: userId,
                origin: 'MANUAL',
            },
            include: ACTIVITY_INCLUDES,
        });

        await this.recalculateRollup(this.db, tenantId, target);
        await this.notifyAssignee(tenantId, userId, activity);
        return activity;
    }

    async findAll(tenantId: string, opts: ListActivityOpts) {
        const page = opts.page ?? 1;
        const limit = Math.min(opts.limit ?? 20, 100);
        const skip = (page - 1) * limit;

        const where: any = { tenant_id: tenantId };
        if (opts.leadId) where.lead_id = opts.leadId;
        if (opts.customerId) where.customer_id = opts.customerId;
        if (opts.target === 'lead') where.lead_id = { not: null };
        if (opts.target === 'customer') where.customer_id = { not: null };
        if (opts.status) where.status = opts.status;
        if (opts.assignedTo) where.assigned_to = opts.assignedTo;
        if (opts.purposeId) where.purpose_id = opts.purposeId;
        if (opts.channelId) where.channel_id = opts.channelId;

        // Filtering through the relation also drops customer activities, which is
        // right: they have no lead, so they have no lead owner either.
        if (opts.leadOwner === UNASSIGNED_OWNER_FILTER) where.lead = { assigned_to: null };
        else if (opts.leadOwner) where.lead = { assigned_to: opts.leadOwner };

        let due = dhakaDayRange(opts.dueFrom, opts.dueTo) as DueWindow | undefined;
        if (opts.dueToday) {
            const today = startOfToday();
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            where.status = 'PLANNED';
            due = intersectDueWindow(due, { gte: today, lt: tomorrow });
        }
        if (opts.overdue) {
            where.status = 'PLANNED';
            due = intersectDueWindow(due, { lt: startOfToday() });
        }
        if (due) where.due_at = due;

        const created = createdAtRange(opts.createdFrom, opts.createdTo);
        if (created) where.created_at = created;

        const [items, total] = await Promise.all([
            this.db.crmActivity.findMany({
                where,
                include: ACTIVITY_INCLUDES,
                orderBy: resolveOrderBy(
                    opts.sortBy,
                    opts.sortDir,
                    ACTIVITY_SORTABLE,
                    ACTIVITY_DEFAULT_ORDER,
                ) as any,
                skip,
                take: limit,
            }),
            this.db.crmActivity.count({ where }),
        ]);

        return paginate(items, total, page, limit);
    }

    async findOne(tenantId: string, id: string) {
        const activity = await this.db.crmActivity.findFirst({
            where: { id, tenant_id: tenantId },
            include: ACTIVITY_INCLUDES,
        });
        if (!activity) throw new NotFoundException('Activity not found');
        return activity;
    }

    async update(tenantId: string, id: string, dto: UpdateCrmActivityDto) {
        const existing = await this.db.crmActivity.findFirst({ where: { id, tenant_id: tenantId } });
        if (!existing) throw new NotFoundException('Activity not found');
        if (existing.status !== 'PLANNED') {
            throw new BadRequestException('Only a planned activity can be edited.');
        }

        const purpose = await this.resolvePurpose(tenantId, dto.purpose);
        const data: any = {};
        if (dto.subject !== undefined) data.subject = dto.subject;
        if (dto.due_at !== undefined) data.due_at = dto.due_at ? new Date(dto.due_at) : null;
        if (dto.notes !== undefined) data.notes = dto.notes;
        if (dto.assigned_to !== undefined) data.assigned_to = dto.assigned_to;
        if (purpose) data.purpose_id = purpose.id;

        const updated = await this.db.crmActivity.update({
            where: { id },
            data,
            include: ACTIVITY_INCLUDES,
        });

        const target = existing.lead_id
            ? { lead_id: existing.lead_id }
            : { customer_id: existing.customer_id };
        await this.recalculateRollup(this.db, tenantId, target);
        return updated;
    }

    /**
     * Mark done, record what happened, and optionally schedule the next one —
     * in a single transaction. This endpoint is why the merge exists: before it,
     * completing a follow-up and logging the call it produced were two writes to
     * two tables with nothing linking them.
     */
    async complete(tenantId: string, userId: string, id: string, dto: CompleteCrmActivityDto) {
        const existing = await this.db.crmActivity.findFirst({
            where: { id, tenant_id: tenantId },
        });
        if (!existing) throw new NotFoundException('Activity not found');
        if (existing.status !== 'PLANNED') {
            // Not a no-op: a double-submitted form would otherwise create a
            // second "next" activity for one completion.
            throw new BadRequestException(`Activity is already ${existing.status.toLowerCase()}.`);
        }

        const channel = await this.resolveChannel(tenantId, dto.channel);
        const nextPurpose = dto.next?.purpose
            ? await this.resolvePurpose(tenantId, dto.next.purpose)
            : null;

        // Typed as both-optional rather than a union: rescoreLead and
        // recalculateRollup both read `.lead_id` off it, which a
        // `{lead_id} | {customer_id}` union rejects at compile time.
        const target: { lead_id?: string | null; customer_id?: string | null } = existing.lead_id
            ? { lead_id: existing.lead_id }
            : { customer_id: existing.customer_id };
        const now = new Date();

        return this.db.$transaction(async (tx: any) => {
            const completed = await tx.crmActivity.update({
                where: { id },
                data: {
                    status: 'DONE',
                    completed_at: now,
                    channel_id: channel.id,
                    channel_code: channel.code,
                    summary: dto.summary,
                    outcome: dto.outcome ?? null,
                    direction: dto.direction ?? existing.direction,
                },
                include: ACTIVITY_INCLUDES,
            });

            let next = null;
            if (dto.next) {
                next = await tx.crmActivity.create({
                    data: {
                        tenant_id: tenantId,
                        ...target,
                        subject: dto.next.subject,
                        status: 'PLANNED',
                        due_at: new Date(dto.next.due_at),
                        // Inherit the purpose and assignee of the activity being
                        // closed unless the caller overrode them — chasing the
                        // same invoice is still a COLLECTION.
                        purpose_id: nextPurpose?.id ?? existing.purpose_id,
                        assigned_to: dto.next.assigned_to ?? existing.assigned_to,
                        store_id: existing.store_id,
                        created_by: userId,
                        origin: 'MANUAL',
                    },
                    include: ACTIVITY_INCLUDES,
                });
            }

            await this.stampLastContacted(tx, target, now);
            await this.recalculateRollup(tx, tenantId, target);
            await this.rescoreLead(tx, tenantId, target.lead_id);

            return { completed, next };
        });
    }

    /**
     * Completion now counts as contact. Before the merge only logging a
     * conversation did, so the reorder cron re-fired at customers the team had
     * called and marked done.
     */
    private async stampLastContacted(tx: any, target: any, at: Date) {
        if (target.lead_id) {
            await tx.lead.update({ where: { id: target.lead_id }, data: { last_contacted_at: at } });
            return;
        }
        await tx.customer.update({
            where: { id: target.customer_id },
            data: { last_contacted_at: at },
        });
    }

    /**
     * Completion rescores the lead. computeLeadScore is unchanged — only the
     * source of its conversationCount moves, from LeadConversation rows to DONE
     * activities. After the backfill those counts are identical, so no lead is
     * rescored on migration day.
     */
    private async rescoreLead(tx: any, tenantId: string, leadId?: string | null) {
        if (!leadId) return;

        const lead = await tx.lead.findFirst({
            where: { id: leadId, tenant_id: tenantId },
            include: { sourceOption: { select: { score_weight: true } } },
        });
        if (!lead) return;

        const doneCount = await tx.crmActivity.count({
            where: { tenant_id: tenantId, lead_id: leadId, status: 'DONE' },
        });

        const score = computeLeadScore(
            {
                status: lead.status,
                sourceWeight: lead.sourceOption?.score_weight ?? DEFAULT_SOURCE_WEIGHT,
                priority: lead.priority,
                last_contacted_at: lead.last_contacted_at,
                next_step_date: lead.next_step_date,
            },
            doneCount,
        );

        await tx.lead.update({ where: { id: leadId }, data: { score } });
    }

    /** Cancels rather than deletes: the fact that it was planned is history. */
    async cancel(tenantId: string, id: string) {
        const existing = await this.db.crmActivity.findFirst({ where: { id, tenant_id: tenantId } });
        if (!existing) throw new NotFoundException('Activity not found');

        const updated = await this.db.crmActivity.update({
            where: { id },
            data: { status: 'CANCELLED' },
            include: ACTIVITY_INCLUDES,
        });

        const target = existing.lead_id
            ? { lead_id: existing.lead_id }
            : { customer_id: existing.customer_id };
        await this.recalculateRollup(this.db, tenantId, target);
        return updated;
    }

    async remove(tenantId: string, id: string) {
        const existing = await this.db.crmActivity.findFirst({ where: { id, tenant_id: tenantId } });
        if (!existing) throw new NotFoundException('Activity not found');

        await this.db.crmActivity.delete({ where: { id } });

        const target = existing.lead_id
            ? { lead_id: existing.lead_id }
            : { customer_id: existing.customer_id };
        await this.recalculateRollup(this.db, tenantId, target);
        return { success: true };
    }

    async summary(tenantId: string) {
        const today = startOfToday();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const [dueToday, overdue, total] = await Promise.all([
            this.db.crmActivity.count({
                where: {
                    tenant_id: tenantId,
                    status: 'PLANNED',
                    due_at: { gte: today, lt: tomorrow },
                },
            }),
            this.db.crmActivity.count({
                where: { tenant_id: tenantId, status: 'PLANNED', due_at: { lt: today } },
            }),
            this.db.crmActivity.count({ where: { tenant_id: tenantId, status: 'PLANNED' } }),
        ]);

        return { dueToday, overdue, total };
    }

    /* ---------------------------------------------------------------- */
    /*  Scheduled sweeps — moved off CrmFollowUp in R1                   */
    /* ---------------------------------------------------------------- */

    /**
     * Birthday activities. Was `customer.findMany({ where: { deleted_at: null } })`
     * with the month/day match done in JavaScript — every customer on the
     * platform, every day, forever. The month/day comparison can't be pushed into
     * a WHERE clause portably (Prisma has no date-part filter), so it goes
     * through $queryRaw instead: EXTRACT is one index-free scan of Customer
     * filtered down to today's ~1/365th up front, rather than the whole table
     * pulled into Node to be filtered there.
     */
    @Cron(CronExpression.EVERY_DAY_AT_8AM)
    async autoCreateBirthdayActivities() {
        return this.jobTracker.track(JOB_NAMES.CRM_BIRTHDAY_FOLLOWUPS, () =>
            this.autoCreateBirthdayActivitiesImpl(),
        );
    }

    private async autoCreateBirthdayActivitiesImpl() {
        const today = new Date();

        const birthdayCustomers = await this.db.$queryRaw<
            { id: string; tenant_id: string; name: string }[]
        >`
            SELECT id, tenant_id, name FROM "Customer"
            WHERE deleted_at IS NULL
              AND birthday IS NOT NULL
              AND EXTRACT(MONTH FROM birthday) = ${today.getMonth() + 1}
              AND EXTRACT(DAY FROM birthday) = ${today.getDate()}
        `;

        let created = 0;
        for (const [tenantId, customers] of this.groupByTenant(birthdayCustomers)) {
            // Resolved once per tenant, not once per customer — this sweep runs
            // over every tenant's whole customer base.
            const purposeId = await this.cronPurposeId(tenantId, 'BIRTHDAY');
            if (!purposeId) continue;

            for (const c of customers) {
                const existing = await this.db.crmActivity.findFirst({
                    where: {
                        tenant_id: tenantId,
                        customer_id: c.id,
                        purpose_id: purposeId,
                        status: 'PLANNED',
                        // Scoped to today onward, as the follow-up cron was: a
                        // birthday task left open from last year must not
                        // suppress this year's greeting.
                        due_at: { gte: today },
                    },
                });
                if (existing) continue;

                const activity = await this.db.crmActivity.create({
                    data: {
                        tenant_id: tenantId,
                        customer_id: c.id,
                        purpose_id: purposeId,
                        subject: `Birthday greeting for ${c.name}`,
                        status: 'PLANNED',
                        due_at: today,
                        origin: 'BIRTHDAY_CRON',
                    },
                });
                await this.recalculateRollup(this.db, tenantId, { customer_id: c.id });
                await this.notifyCronActivity(tenantId, activity);
                created++;
            }
        }

        this.logger.debug(`Birthday activities created: ${created}`);
    }

    /**
     * Reorder-reminder activities, for customers who have gone quiet.
     *
     * Was `last_contacted_at: { lt: sixtyDaysAgo }`, which in SQL EXCLUDES NULL —
     * so a customer nobody has ever logged contact with, the single strongest
     * "reach out" signal there is, was invisible to this check. Reworked as
     * `(last_contacted_at IS NULL OR last_contacted_at < cutoff)`, falling back to
     * `created_at` for the "how long has this been true" comparison so a
     * newly-created customer isn't immediately flagged as dormant on day one.
     */
    @Cron(CronExpression.EVERY_DAY_AT_8AM)
    async autoCreateReorderActivities() {
        return this.jobTracker.track(JOB_NAMES.CRM_REORDER_FOLLOWUPS, () =>
            this.autoCreateReorderActivitiesImpl(),
        );
    }

    private async autoCreateReorderActivitiesImpl() {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - REORDER_DORMANT_DAYS);

        const atRiskCustomers = await this.db.customer.findMany({
            where: {
                deleted_at: null,
                OR: [
                    { last_contacted_at: { lt: cutoff } },
                    { last_contacted_at: null, created_at: { lt: cutoff } },
                ],
            },
            select: { id: true, tenant_id: true, name: true },
        });

        let created = 0;
        for (const [tenantId, customers] of this.groupByTenant(atRiskCustomers)) {
            const purposeId = await this.cronPurposeId(tenantId, 'REORDER_REMINDER');
            if (!purposeId) continue;

            for (const c of customers) {
                const existing = await this.db.crmActivity.findFirst({
                    where: {
                        tenant_id: tenantId,
                        customer_id: c.id,
                        purpose_id: purposeId,
                        status: 'PLANNED',
                    },
                });
                if (existing) continue;

                const activity = await this.db.crmActivity.create({
                    data: {
                        tenant_id: tenantId,
                        customer_id: c.id,
                        purpose_id: purposeId,
                        subject: `Follow up with ${c.name} — no contact in ${REORDER_DORMANT_DAYS}+ days`,
                        status: 'PLANNED',
                        due_at: new Date(),
                        origin: 'REORDER_CRON',
                    },
                });
                await this.recalculateRollup(this.db, tenantId, { customer_id: c.id });
                await this.notifyCronActivity(tenantId, activity);
                created++;
            }
        }

        this.logger.debug(`Reorder activities created: ${created}`);
    }

    private groupByTenant<T extends { tenant_id: string }>(rows: T[]): Map<string, T[]> {
        const byTenant = new Map<string, T[]>();
        for (const row of rows) {
            const bucket = byTenant.get(row.tenant_id);
            if (bucket) bucket.push(row);
            else byTenant.set(row.tenant_id, [row]);
        }
        return byTenant;
    }

    /**
     * Purpose lookup for the crons. Returns null instead of throwing the way
     * `resolvePurpose` does: these sweeps run across every tenant on the
     * platform, so one whose purposes were never seeded must be skipped, not
     * allowed to take the whole run down.
     */
    private async cronPurposeId(tenantId: string, code: string): Promise<string | null> {
        const purpose = await this.taxonomy.resolveByIdOrCode(
            tenantId,
            LeadTaxonomyKind.PURPOSE,
            code,
        );
        if (!purpose) {
            this.logger.warn(
                `Tenant ${tenantId} has no "${code}" activity purpose — skipping its sweep. ` +
                    'Run sync:lead-taxonomy to seed it.',
            );
            return null;
        }
        return purpose.id;
    }

    /**
     * An activity that only appears if someone happens to open the CRM hub is
     * not much of a reminder. Cron-created rows notify in-app: the assignee if
     * there is one, otherwise the tenant owner, so one is never created into a
     * void. Carried over from CrmFollowUpsService.notifyOwner.
     */
    private async notifyCronActivity(tenantId: string, activity: any) {
        let recipientId = activity.assigned_to as string | null;
        if (!recipientId) {
            const tenant = await this.db.tenant.findUnique({
                where: { id: tenantId },
                select: { owner_id: true },
            });
            recipientId = tenant?.owner_id ?? null;
        }
        if (!recipientId) return;

        try {
            await this.notifications.create(
                tenantId,
                recipientId,
                'CRM_ACTIVITY_ASSIGNED',
                activity.subject ?? 'CRM activity created',
                'A CRM activity was created for you.',
                `/crm/activities?highlight=${activity.id}`,
            );
        } catch (err) {
            this.logger.error(`Failed to notify owner of activity ${activity.id}: ${err}`);
        }
    }

    /**
     * The parent's next_* columns are a cache of its earliest PLANNED activity.
     * This is the ONLY writer of those five columns — nothing else may set them,
     * or they drift back into the hand-maintained field this design replaced.
     *
     * `tx` is the transaction client when called inside one, so the rollup and
     * the mutation that caused it commit together.
     */
    private async recalculateRollup(
        tx: any,
        tenantId: string,
        target: { lead_id?: string | null; customer_id?: string | null },
    ) {
        const where = target.lead_id
            ? { tenant_id: tenantId, lead_id: target.lead_id, status: 'PLANNED' }
            : { tenant_id: tenantId, customer_id: target.customer_id, status: 'PLANNED' };

        // NULLS LAST is not expressible in a Prisma orderBy shorthand, but an
        // undated activity sorting first would make it the "next step" ahead of
        // a dated one. Fetch dated rows first; fall back to any planned row.
        const next =
            (await tx.crmActivity.findFirst({
                where: { ...where, due_at: { not: null } },
                orderBy: [{ due_at: 'asc' }, { created_at: 'asc' }],
                select: { id: true, subject: true, due_at: true, assigned_to: true },
            })) ??
            (await tx.crmActivity.findFirst({
                where,
                orderBy: [{ due_at: 'asc' }, { created_at: 'asc' }],
                select: { id: true, subject: true, due_at: true, assigned_to: true },
            }));

        if (target.lead_id) {
            await tx.lead.update({
                where: { id: target.lead_id },
                data: {
                    next_step: next?.subject ?? null,
                    next_step_date: next?.due_at ?? null,
                    next_step_assigned_to: next?.assigned_to ?? null,
                    next_activity_id: next?.id ?? null,
                },
            });
            return;
        }

        await tx.customer.update({
            where: { id: target.customer_id },
            data: {
                next_activity_id: next?.id ?? null,
                next_activity_date: next?.due_at ?? null,
            },
        });
    }

    /**
     * In-app notification for the assignee. Skipped when they are the person who
     * just created the row — they are already looking at it — matching the guard
     * CrmFollowUpsService.notifyOwner already applies to cron-created rows.
     * Failure is logged, never thrown: a notification outage must not fail the
     * write it describes.
     */
    private async notifyAssignee(tenantId: string, actingUserId: string, activity: any) {
        if (!activity.assigned_to || activity.assigned_to === actingUserId) return;
        try {
            await this.notifications.create(
                tenantId,
                activity.assigned_to,
                'CRM_ACTIVITY_ASSIGNED',
                activity.subject ?? 'CRM activity assigned',
                'A CRM activity was assigned to you.',
                `/crm/activities?highlight=${activity.id}`,
            );
        } catch (err) {
            this.logger.error(`Failed to notify assignee of activity ${activity.id}: ${err}`);
        }
    }
}
