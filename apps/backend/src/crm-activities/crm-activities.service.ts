import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AppLogger } from '../common/app-logger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CrmLeadTaxonomyService } from '../crm-lead-taxonomy/crm-lead-taxonomy.service';
import { LeadTaxonomyKind } from '../crm-lead-taxonomy/lead-taxonomy.dto';
import { paginate } from '../common/pagination.dto';
import { resolveOrderBy, type SortableMap } from '../common/sort.util';
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

export type ListActivityOpts = {
    leadId?: string;
    customerId?: string;
    target?: 'lead' | 'customer';
    status?: string;
    assignedTo?: string;
    purposeId?: string;
    channelId?: string;
    dueToday?: boolean;
    overdue?: boolean;
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

@Injectable()
export class CrmActivitiesService {
    constructor(
        private readonly db: DatabaseService,
        private readonly taxonomy: CrmLeadTaxonomyService,
        private readonly logger: AppLogger,
        private readonly notifications: NotificationsService,
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
                assigned_to: dto.assigned_to ?? null,
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

        if (opts.dueToday) {
            const today = startOfToday();
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            where.status = 'PLANNED';
            where.due_at = { gte: today, lt: tomorrow };
        }
        if (opts.overdue) {
            where.status = 'PLANNED';
            where.due_at = { lt: startOfToday() };
        }

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

    /* ---------------------------------------------------------------- */
    /*  Stubs replaced in Tasks 4-6                                      */
    /* ---------------------------------------------------------------- */

    async update(_tenantId: string, _id: string, _dto: UpdateCrmActivityDto): Promise<any> {
        return Promise.reject(new Error('not implemented'));
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

    private async rescoreLead(_tx: any, _tenantId: string, _leadId?: string | null) {}

    async cancel(_tenantId: string, _id: string): Promise<any> {
        return Promise.reject(new Error('not implemented'));
    }

    async remove(_tenantId: string, _id: string): Promise<any> {
        return Promise.reject(new Error('not implemented'));
    }

    async summary(_tenantId: string): Promise<any> {
        return Promise.reject(new Error('not implemented'));
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
