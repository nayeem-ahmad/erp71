import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.service';
import { AppLogger } from '../common/app-logger.service';
import { CreateCrmTaskDto, UpdateCrmTaskDto } from './crm-tasks.dto';
import { paginate } from '../common/pagination.dto';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';
import { JOB_NAMES } from '../system-health/jobs/job-names';

@Injectable()
export class CrmTasksService {
    constructor(
        private db: DatabaseService,
        private readonly logger: AppLogger,
        private readonly jobTracker: JobTrackerService,
    ) {}

    private async validateTaskTarget(
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
            throw new BadRequestException('Tasks cannot be created for lost or converted leads.');
        }
        return { lead_id: leadId };
    }

    async create(tenantId: string, userId: string, dto: CreateCrmTaskDto) {
        const target = await this.validateTaskTarget(tenantId, dto.customer_id, dto.lead_id);

        return this.db.crmTask.create({
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
                lead: { select: { id: true, name: true, phone: true } },
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
            this.db.crmTask.findMany({
                where,
                include: {
                    customer: { select: { id: true, name: true, phone: true } },
                    lead: { select: { id: true, name: true, phone: true } },
                    assignee: { select: { id: true, name: true, email: true } },
                },
                orderBy: { due_at: 'asc' },
                skip,
                take: limit,
            }),
            this.db.crmTask.count({ where }),
        ]);

        return paginate(items, total, page, limit);
    }

    async findOne(tenantId: string, id: string) {
        const task = await this.db.crmTask.findFirst({
            where: { id, tenant_id: tenantId },
            include: {
                customer: { select: { id: true, name: true, phone: true } },
                lead: { select: { id: true, name: true, phone: true } },
                assignee: { select: { id: true, name: true, email: true } },
            },
        });
        if (!task) throw new NotFoundException('Task not found');
        return task;
    }

    async update(tenantId: string, id: string, dto: UpdateCrmTaskDto) {
        const existing = await this.db.crmTask.findFirst({ where: { id, tenant_id: tenantId } });
        if (!existing) throw new NotFoundException('Task not found');

        const data: any = { ...dto };
        if (dto.due_at) data.due_at = new Date(dto.due_at);
        if (dto.status === 'DONE') data.completed_at = new Date();

        return this.db.crmTask.update({
            where: { id },
            data,
            include: {
                customer: { select: { id: true, name: true, phone: true } },
                lead: { select: { id: true, name: true, phone: true } },
                assignee: { select: { id: true, name: true, email: true } },
            },
        });
    }

    async remove(tenantId: string, id: string) {
        const existing = await this.db.crmTask.findFirst({ where: { id, tenant_id: tenantId } });
        if (!existing) throw new NotFoundException('Task not found');
        await this.db.crmTask.delete({ where: { id } });
        return { success: true };
    }

    async getTodaySummary(tenantId: string) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const [dueToday, overdue, total] = await Promise.all([
            this.db.crmTask.count({
                where: {
                    tenant_id: tenantId,
                    status: 'PENDING',
                    due_at: { gte: today, lt: tomorrow },
                },
            }),
            this.db.crmTask.count({
                where: {
                    tenant_id: tenantId,
                    status: 'PENDING',
                    due_at: { lt: today },
                },
            }),
            this.db.crmTask.count({
                where: { tenant_id: tenantId, status: 'PENDING' },
            }),
        ]);

        return { dueToday, overdue, total };
    }

    @Cron(CronExpression.EVERY_DAY_AT_8AM)
    async autoCreateBirthdayTasks() {
        return this.jobTracker.track(JOB_NAMES.CRM_BIRTHDAY_TASKS, () => this.autoCreateBirthdayTasksImpl());
    }

    private async autoCreateBirthdayTasksImpl() {
        const today = new Date();
        const month = today.getMonth() + 1;
        const day = today.getDate();

        const customers = await this.db.customer.findMany({
            where: { deleted_at: null },
            select: { id: true, tenant_id: true, name: true, birthday: true },
        });

        const birthdayCustomers = customers.filter(c => {
            if (!c.birthday) return false;
            const bd = new Date(c.birthday);
            return bd.getMonth() + 1 === month && bd.getDate() === day;
        });

        for (const c of birthdayCustomers) {
            const existingToday = await this.db.crmTask.findFirst({
                where: {
                    tenant_id: c.tenant_id,
                    customer_id: c.id,
                    type: 'BIRTHDAY',
                    due_at: { gte: today },
                },
            });
            if (existingToday) continue;

            await this.db.crmTask.create({
                data: {
                    tenant_id: c.tenant_id,
                    customer_id: c.id,
                    type: 'BIRTHDAY',
                    title: `Birthday greeting for ${c.name}`,
                    due_at: today,
                    status: 'PENDING',
                },
            });
        }

        this.logger.debug(`Birthday tasks created: ${birthdayCustomers.length}`);
    }

    @Cron(CronExpression.EVERY_DAY_AT_8AM)
    async autoCreateReorderReminders() {
        return this.jobTracker.track(JOB_NAMES.CRM_REORDER_TASKS, () => this.autoCreateReorderRemindersImpl());
    }

    private async autoCreateReorderRemindersImpl() {
        const sixtyDaysAgo = new Date();
        sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

        const atRiskCustomers = await this.db.customer.findMany({
            where: {
                deleted_at: null,
                last_contacted_at: { lt: sixtyDaysAgo },
            },
            select: { id: true, tenant_id: true, name: true },
        });

        for (const c of atRiskCustomers) {
            const existing = await this.db.crmTask.findFirst({
                where: {
                    tenant_id: c.tenant_id,
                    customer_id: c.id,
                    type: 'REORDER_REMINDER',
                    status: 'PENDING',
                },
            });
            if (existing) continue;

            await this.db.crmTask.create({
                data: {
                    tenant_id: c.tenant_id,
                    customer_id: c.id,
                    type: 'REORDER_REMINDER',
                    title: `Follow up with ${c.name} — no contact in 60+ days`,
                    due_at: new Date(),
                    status: 'PENDING',
                },
            });
        }

        this.logger.debug(`Reorder reminders created: ${atRiskCustomers.length}`);
    }
}
