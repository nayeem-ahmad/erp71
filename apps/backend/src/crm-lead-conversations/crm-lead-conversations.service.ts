import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
    CreateLeadConversationDto,
    UpdateLeadConversationDto,
} from './crm-lead-conversations.dto';
import { paginate } from '../common/pagination.dto';
import { computeLeadScore, DEFAULT_SOURCE_WEIGHT } from '../crm-leads/lead-scoring.util';
import { resolveOrderBy, SortableMap } from '../common/sort.util';
import { CrmLeadTaxonomyService } from '../crm-lead-taxonomy/crm-lead-taxonomy.service';
import { LeadTaxonomyKind } from '../crm-lead-taxonomy/lead-taxonomy.dto';

const conversationIncludes = {
    lead: { select: { id: true, name: true, mobile: true, status: true, assigned_to: true } },
    creator: { select: { id: true, name: true, email: true } },
    channel: { select: { id: true, code: true, name: true, icon: true } },
} as const;

/**
 * Sort allowlist. Keys MUST match the TanStack column ids on the conversations page —
 * DataTable sends the column id as `sort.id` and resolveOrderBy silently falls back for
 * anything unlisted, which reads as a dead header rather than an error. Deliberately no
 * `summary`/`outcome` key: sorting free text alphabetically is not a useful operation, so
 * those columns set `enableSorting: false` instead.
 */
const CONVERSATION_SORTABLE: SortableMap = {
    created_at: (dir) => ({ created_at: dir }),
    type: (dir) => ({ type: dir }),
    direction: (dir) => ({ direction: dir }),
    // Relation sorts go through the relation's scalar, which Prisma supports for to-one
    // relations. `lead` is required on this model, so there are no null-ordering concerns.
    lead: (dir) => ({ lead: { name: dir } }),
    creator: (dir) => ({ creator: { name: dir } }),
};
// Module-level, so resolveOrderBy's by-reference fallback is a stable identity.
// Not a copy of LEAD_DEFAULT_ORDER — LeadConversation has no updated_at/next_step_date.
const CONVERSATION_DEFAULT_ORDER = { created_at: 'desc' as const };

/** Parses a `YYYY-MM-DD` (or full ISO) query value into a Date, or undefined when unusable. */
function parseBoundary(value: string | undefined): Date | undefined {
    if (!value) return undefined;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Turns the `dateFrom`/`dateTo` query pair into a Prisma `created_at` filter, or undefined
 * when neither is usable. `dateTo` is inclusive of the whole day the user picked: a date-only
 * value parses to 00:00Z, so `lte` would exclude everything logged during that day.
 */
function buildCreatedAtFilter(dateFrom?: string, dateTo?: string): Record<string, Date> | undefined {
    const from = parseBoundary(dateFrom);
    const to = parseBoundary(dateTo);
    if (!from && !to) return undefined;

    const filter: Record<string, Date> = {};
    if (from) filter.gte = from;
    if (to) {
        if (DATE_ONLY.test(dateTo!)) {
            const end = new Date(to);
            end.setUTCDate(end.getUTCDate() + 1);
            filter.lt = end;
        } else {
            filter.lte = to;
        }
    }
    return filter;
}

export interface FindAllConversationsOpts {
    leadId?: string;
    search?: string;
    type?: string;
    direction?: string;
    createdBy?: string;
    dateFrom?: string;
    dateTo?: string;
    leadStatus?: string;
    leadAssignedTo?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortDir?: string;
}

@Injectable()
export class CrmLeadConversationsService {
    constructor(
        private db: DatabaseService,
        private readonly taxonomy: CrmLeadTaxonomyService,
    ) {}

    /**
     * Turns the client's `type` — a channel id or its `code` — into the row to
     * write. Kept here rather than in the DTO because the valid set is per-tenant
     * data, not a compile-time enum.
     */
    private async resolveChannel(tenantId: string, value: string) {
        const channel = await this.taxonomy.resolveByIdOrCode(
            tenantId,
            LeadTaxonomyKind.CHANNEL,
            value,
        );
        if (!channel) {
            throw new BadRequestException(`Unknown conversation channel "${value}".`);
        }
        if (!channel.is_active) {
            throw new BadRequestException(`Conversation channel "${channel.name}" is retired.`);
        }
        return channel;
    }

    async create(tenantId: string, userId: string, dto: CreateLeadConversationDto) {
        const lead = await this.db.lead.findFirst({
            where: { id: dto.lead_id, tenant_id: tenantId },
            include: { sourceOption: { select: { score_weight: true } } },
        });
        if (!lead) throw new NotFoundException('Lead not found');

        const channel = await this.resolveChannel(tenantId, dto.type);

        const now = new Date();
        const leadUpdate: Record<string, unknown> = { last_contacted_at: now };
        if (dto.next_step !== undefined) leadUpdate.next_step = dto.next_step;
        if (dto.next_step_date !== undefined) {
            leadUpdate.next_step_date = dto.next_step_date ? new Date(dto.next_step_date) : null;
        }
        if (dto.next_step_assigned_to !== undefined) {
            leadUpdate.next_step_assigned_to = dto.next_step_assigned_to;
        }

        const conversationCount = await this.db.leadConversation.count({ where: { lead_id: dto.lead_id } });
        leadUpdate.score = computeLeadScore(
            {
                status: lead.status,
                sourceWeight: lead.sourceOption?.score_weight ?? DEFAULT_SOURCE_WEIGHT,
                priority: lead.priority,
                last_contacted_at: now,
                next_step_date:
                    'next_step_date' in leadUpdate
                        ? (leadUpdate.next_step_date as Date | null)
                        : lead.next_step_date,
            },
            conversationCount + 1,
        );

        const [conversation] = await this.db.$transaction([
            this.db.leadConversation.create({
                data: {
                    tenant_id: tenantId,
                    lead_id: dto.lead_id,
                    // Always the resolved code, never the raw input: a client may have
                    // sent an id, and `type` is what the list filters read.
                    type: channel.code,
                    channel_id: channel.id,
                    direction: dto.direction ?? 'OUTBOUND',
                    summary: dto.summary,
                    outcome: dto.outcome,
                    store_id: dto.store_id,
                    created_by: userId,
                },
                include: {
                    creator: { select: { id: true, name: true, email: true } },
                    channel: { select: { id: true, code: true, name: true, icon: true } },
                },
            }),
            this.db.lead.update({
                where: { id: dto.lead_id },
                data: leadUpdate,
            }),
        ]);

        return conversation;
    }

    /**
     * Builds the tenant-scoped `where` clause shared by findAll and getSummary, so a
     * filtered list and its stat tiles can never disagree about what is being counted.
     */
    private buildWhere(tenantId: string, opts: FindAllConversationsOpts): any {
        const where: any = { tenant_id: tenantId };
        if (opts.leadId) where.lead_id = opts.leadId;
        if (opts.type) where.type = opts.type;
        if (opts.direction) where.direction = opts.direction;
        if (opts.createdBy) where.created_by = opts.createdBy;

        const createdAt = buildCreatedAtFilter(opts.dateFrom, opts.dateTo);
        if (createdAt) where.created_at = createdAt;

        // Filters on the parent lead. Nested under `lead` rather than denormalised, so
        // reassigning a lead immediately changes which conversations match.
        const leadWhere: any = {};
        if (opts.leadStatus) leadWhere.status = opts.leadStatus;
        if (opts.leadAssignedTo) leadWhere.assigned_to = opts.leadAssignedTo;
        if (Object.keys(leadWhere).length > 0) where.lead = leadWhere;

        if (opts.search) {
            where.OR = [
                { summary: { contains: opts.search, mode: 'insensitive' } },
                { outcome: { contains: opts.search, mode: 'insensitive' } },
                { lead: { name: { contains: opts.search, mode: 'insensitive' } } },
                { lead: { mobile: { contains: opts.search, mode: 'insensitive' } } },
            ];
        }

        return where;
    }

    async findAll(tenantId: string, opts: FindAllConversationsOpts) {
        const page = opts.page ?? 1;
        const limit = Math.min(opts.limit ?? 20, 100);
        const skip = (page - 1) * limit;

        const where = this.buildWhere(tenantId, opts);

        const [items, total] = await Promise.all([
            this.db.leadConversation.findMany({
                where,
                include: conversationIncludes,
                orderBy: resolveOrderBy(opts.sortBy, opts.sortDir, CONVERSATION_SORTABLE, CONVERSATION_DEFAULT_ORDER),
                skip,
                take: limit,
            }),
            this.db.leadConversation.count({ where }),
        ]);

        return paginate(items, total, page, limit);
    }

    /**
     * Stat tiles for the conversations list. Honours the same filters as findAll, so the
     * tiles describe the filtered set the user is actually looking at rather than the
     * tenant as a whole.
     */
    async getSummary(tenantId: string, opts: FindAllConversationsOpts) {
        const where = this.buildWhere(tenantId, opts);

        const weekStart = new Date();
        weekStart.setHours(0, 0, 0, 0);
        weekStart.setDate(weekStart.getDate() - 6);

        const [total, thisWeek, byType, leadsTouched] = await Promise.all([
            this.db.leadConversation.count({ where }),
            this.db.leadConversation.count({
                where: {
                    ...where,
                    // Intersect rather than overwrite: an explicit date filter must still bound
                    // this count, or "last 7 days" could exceed the total above it.
                    AND: [...(where.AND ?? []), { created_at: { gte: weekStart } }],
                },
            }),
            this.db.leadConversation.groupBy({ by: ['type'], where, _count: { _all: true } }),
            // groupBy, not findMany+distinct: Prisma applies `distinct` in memory after
            // fetching every matching row, so this would pull the whole conversation table
            // to count leads. GROUP BY returns one row per lead instead.
            this.db.leadConversation.groupBy({ by: ['lead_id'], where }),
        ]);

        // Only channels that actually occur are keyed. There is no fixed set to
        // zero-fill any more, and the caller already renders its own channel list —
        // a missing key reads as zero there.
        const countsByType: Record<string, number> = {};
        for (const row of byType) {
            countsByType[row.type] = row._count?._all ?? 0;
        }

        return { total, thisWeek, countsByType, leadsTouched: leadsTouched.length };
    }

    async findOne(tenantId: string, id: string) {
        const item = await this.db.leadConversation.findFirst({
            where: { id, tenant_id: tenantId },
            include: {
                lead: { select: { id: true, name: true, mobile: true } },
                creator: { select: { id: true, name: true, email: true } },
                channel: { select: { id: true, code: true, name: true, icon: true } },
            },
        });
        if (!item) throw new NotFoundException('Lead conversation not found');
        return item;
    }

    async update(tenantId: string, id: string, dto: UpdateLeadConversationDto) {
        const existing = await this.db.leadConversation.findFirst({ where: { id, tenant_id: tenantId } });
        if (!existing) throw new NotFoundException('Lead conversation not found');

        const channel = dto.type ? await this.resolveChannel(tenantId, dto.type) : null;

        return this.db.leadConversation.update({
            where: { id },
            data: {
                ...(dto.summary !== undefined ? { summary: dto.summary } : {}),
                ...(dto.outcome !== undefined ? { outcome: dto.outcome } : {}),
                ...(channel ? { type: channel.code, channel_id: channel.id } : {}),
            },
            include: {
                lead: { select: { id: true, name: true, mobile: true } },
                creator: { select: { id: true, name: true, email: true } },
                channel: { select: { id: true, code: true, name: true, icon: true } },
            },
        });
    }

    async remove(tenantId: string, id: string) {
        const existing = await this.db.leadConversation.findFirst({ where: { id, tenant_id: tenantId } });
        if (!existing) throw new NotFoundException('Lead conversation not found');
        await this.db.leadConversation.delete({ where: { id } });
        return { success: true };
    }
}