import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateCrmFollowUpDto, UpdateCrmFollowUpDto } from './crm-follow-ups.dto';
import { paginate } from '../common/pagination.dto';
import { touchLeadActivity } from '../crm-leads/lead-activity.util';

/**
 * Legacy CRM follow-ups. The birthday and reorder crons that used to live here
 * moved onto CrmActivity in R1 — see CrmActivitiesService. Everything below is
 * read/write against the old table and stays registered through R2 so existing
 * clients keep working; the module is deleted in R3.
 */
@Injectable()
export class CrmFollowUpsService {
    constructor(private db: DatabaseService) {}

    private async validateFollowUpTarget(
        tenantId: string,
        customerId?: string,
        leadId?: string,
    ): Promise<{ customer_id?: string; lead_id?: string }> {
        const hasCustomer = Boolean(customerId);
        const hasLead = Boolean(leadId);
        if (hasCustomer === hasLead) {
            throw new BadRequestException('Provide exactly one of customer_id or lead_id.');
        }

        if (customerId) {
            const customer = await this.db.customer.findFirst({
                where: { id: customerId, tenant_id: tenantId, deleted_at: null },
                select: { id: true },
            });
            if (!customer) throw new NotFoundException('Customer not found');
            return { customer_id: customerId };
        }

        const lead = await this.db.lead.findFirst({
            where: { id: leadId, tenant_id: tenantId },
            select: { id: true, status: true },
        });
        if (!lead) throw new NotFoundException('Lead not found');
        if (lead.status === 'LOST' || lead.status === 'CONVERTED') {
            throw new BadRequestException('Follow-ups cannot be created for lost or converted leads.');
        }
        return { lead_id: leadId };
    }

    async create(tenantId: string, userId: string, dto: CreateCrmFollowUpDto) {
        const target = await this.validateFollowUpTarget(tenantId, dto.customer_id, dto.lead_id);

        // Scheduling the next touch is working the lead, so the neglected-leads
        // tile has to see it — even from this legacy table, which stays writable
        // through R2 and so can still be the only trace of a lead being worked.
        await touchLeadActivity(this.db, target.lead_id);

        return this.db.crmFollowUp.create({
            data: {
                tenant_id: tenantId,
                ...target,
                type: dto.type,
                title: dto.title,
                due_at: new Date(dto.due_at),
                assigned_to: dto.assigned_to,
                notes: dto.notes,
                store_id: dto.store_id,
                created_by: userId,
                status: 'PENDING',
            },
            include: {
                customer: { select: { id: true, name: true, phone: true } },
                lead: { select: { id: true, name: true, mobile: true } },
                assignee: { select: { id: true, name: true, email: true } },
            },
        });
    }

    async findAll(
        tenantId: string,
        opts: {
            customerId?: string;
            leadId?: string;
            target?: 'customer' | 'lead';
            status?: string;
            page?: number;
            limit?: number;
            dueToday?: boolean;
        },
    ) {
        const page = opts.page ?? 1;
        const limit = Math.min(opts.limit ?? 20, 100);
        const skip = (page - 1) * limit;

        const where: any = { tenant_id: tenantId };
        if (opts.customerId) where.customer_id = opts.customerId;
        if (opts.leadId) where.lead_id = opts.leadId;
        if (opts.target === 'customer') where.customer_id = { not: null };
        if (opts.target === 'lead') where.lead_id = { not: null };
        if (opts.status) where.status = opts.status;
        if (opts.dueToday) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            where.due_at = { gte: today, lt: tomorrow };
            where.status = 'PENDING';
        }

        const [items, total] = await Promise.all([
            this.db.crmFollowUp.findMany({
                where,
                include: {
                    customer: { select: { id: true, name: true, phone: true } },
                    lead: { select: { id: true, name: true, mobile: true } },
                    assignee: { select: { id: true, name: true, email: true } },
                },
                orderBy: { due_at: 'asc' },
                skip,
                take: limit,
            }),
            this.db.crmFollowUp.count({ where }),
        ]);

        return paginate(items, total, page, limit);
    }

    async findOne(tenantId: string, id: string) {
        const followUp = await this.db.crmFollowUp.findFirst({
            where: { id, tenant_id: tenantId },
            include: {
                customer: { select: { id: true, name: true, phone: true } },
                lead: { select: { id: true, name: true, mobile: true } },
                assignee: { select: { id: true, name: true, email: true } },
            },
        });
        if (!followUp) throw new NotFoundException('Follow-up not found');
        return followUp;
    }

    async update(tenantId: string, id: string, dto: UpdateCrmFollowUpDto) {
        const existing = await this.db.crmFollowUp.findFirst({ where: { id, tenant_id: tenantId } });
        if (!existing) throw new NotFoundException('Follow-up not found');

        const data: any = { ...dto };
        if (dto.due_at) data.due_at = new Date(dto.due_at);
        if (dto.status === 'DONE') data.completed_at = new Date();

        // Rescheduling or closing it is activity too. Not contact, even on DONE:
        // this table records only that the prompt was cleared, never whether
        // anyone was actually reached — CrmActivity.complete() is the path that
        // knows that, and it is the one that stamps `last_contacted_at`.
        await touchLeadActivity(this.db, existing.lead_id);

        return this.db.crmFollowUp.update({
            where: { id },
            data,
            include: {
                customer: { select: { id: true, name: true, phone: true } },
                lead: { select: { id: true, name: true, mobile: true } },
                assignee: { select: { id: true, name: true, email: true } },
            },
        });
    }

    async remove(tenantId: string, id: string) {
        const existing = await this.db.crmFollowUp.findFirst({ where: { id, tenant_id: tenantId } });
        if (!existing) throw new NotFoundException('Follow-up not found');
        await this.db.crmFollowUp.delete({ where: { id } });
        return { success: true };
    }

    async getTodaySummary(tenantId: string) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const [dueToday, overdue, total] = await Promise.all([
            this.db.crmFollowUp.count({
                where: {
                    tenant_id: tenantId,
                    status: 'PENDING',
                    due_at: { gte: today, lt: tomorrow },
                },
            }),
            this.db.crmFollowUp.count({
                where: {
                    tenant_id: tenantId,
                    status: 'PENDING',
                    due_at: { lt: today },
                },
            }),
            this.db.crmFollowUp.count({
                where: { tenant_id: tenantId, status: 'PENDING' },
            }),
        ]);

        return { dueToday, overdue, total };
    }

}
