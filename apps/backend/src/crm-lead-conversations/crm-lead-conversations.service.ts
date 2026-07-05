import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateLeadConversationDto, UpdateLeadConversationDto } from './crm-lead-conversations.dto';
import { paginate } from '../common/pagination.dto';
import { computeLeadScore } from '../crm-leads/lead-scoring.util';

@Injectable()
export class CrmLeadConversationsService {
    constructor(private db: DatabaseService) {}

    async create(tenantId: string, userId: string, dto: CreateLeadConversationDto) {
        const lead = await this.db.lead.findFirst({
            where: { id: dto.lead_id, tenant_id: tenantId },
        });
        if (!lead) throw new NotFoundException('Lead not found');

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
                source: lead.source,
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
                    type: dto.type,
                    direction: dto.direction ?? 'OUTBOUND',
                    summary: dto.summary,
                    outcome: dto.outcome,
                    store_id: dto.store_id,
                    created_by: userId,
                },
                include: { creator: { select: { id: true, name: true, email: true } } },
            }),
            this.db.lead.update({
                where: { id: dto.lead_id },
                data: leadUpdate,
            }),
        ]);

        return conversation;
    }

    async findAll(
        tenantId: string,
        opts: { leadId?: string; page?: number; limit?: number },
    ) {
        const page = opts.page ?? 1;
        const limit = Math.min(opts.limit ?? 20, 100);
        const skip = (page - 1) * limit;

        const where: any = { tenant_id: tenantId };
        if (opts.leadId) where.lead_id = opts.leadId;

        const [items, total] = await Promise.all([
            this.db.leadConversation.findMany({
                where,
                include: {
                    lead: { select: { id: true, name: true, mobile: true } },
                    creator: { select: { id: true, name: true, email: true } },
                },
                orderBy: { created_at: 'desc' },
                skip,
                take: limit,
            }),
            this.db.leadConversation.count({ where }),
        ]);

        return paginate(items, total, page, limit);
    }

    async findOne(tenantId: string, id: string) {
        const item = await this.db.leadConversation.findFirst({
            where: { id, tenant_id: tenantId },
            include: {
                lead: { select: { id: true, name: true, mobile: true } },
                creator: { select: { id: true, name: true, email: true } },
            },
        });
        if (!item) throw new NotFoundException('Lead conversation not found');
        return item;
    }

    async update(tenantId: string, id: string, dto: UpdateLeadConversationDto) {
        const existing = await this.db.leadConversation.findFirst({ where: { id, tenant_id: tenantId } });
        if (!existing) throw new NotFoundException('Lead conversation not found');

        return this.db.leadConversation.update({
            where: { id },
            data: dto,
            include: {
                lead: { select: { id: true, name: true, mobile: true } },
                creator: { select: { id: true, name: true, email: true } },
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