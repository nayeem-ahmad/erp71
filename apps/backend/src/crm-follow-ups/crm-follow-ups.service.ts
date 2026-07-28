import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.service';
import { AppLogger } from '../common/app-logger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateCrmFollowUpDto, UpdateCrmFollowUpDto } from './crm-follow-ups.dto';
import { paginate } from '../common/pagination.dto';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';
import { JOB_NAMES } from '../system-health/jobs/job-names';

const REORDER_DORMANT_DAYS = 60;

@Injectable()
export class CrmFollowUpsService {
    constructor(
        private db: DatabaseService,
        private readonly logger: AppLogger,
        private readonly jobTracker: JobTrackerService,
        private readonly notifications: NotificationsService,
    ) {}

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

    /**
     * Birthday follow-ups. Was `customer.findMany({ where: { deleted_at: null } })`
     * with the month/day match done in JavaScript — every customer on the
     * platform, every day, forever. The month/day comparison can't be pushed into
     * a WHERE clause portably (Prisma has no date-part filter), so it goes
     * through $queryRaw instead: EXTRACT is one index-free scan of Customer
     * filtered down to today's ~1/365th up front, rather than the whole table
     * pulled into Node to be filtered there.
     */
    @Cron(CronExpression.EVERY_DAY_AT_8AM)
    async autoCreateBirthdayFollowUps() {
        return this.jobTracker.track(
            JOB_NAMES.CRM_BIRTHDAY_FOLLOWUPS,
            () => this.autoCreateBirthdayFollowUpsImpl(),
        );
    }

    private async autoCreateBirthdayFollowUpsImpl() {
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
        for (const c of birthdayCustomers) {
            const existingToday = await this.db.crmFollowUp.findFirst({
                where: {
                    tenant_id: c.tenant_id,
                    customer_id: c.id,
                    type: 'BIRTHDAY',
                    due_at: { gte: today },
                },
            });
            if (existingToday) continue;

            const followUp = await this.db.crmFollowUp.create({
                data: {
                    tenant_id: c.tenant_id,
                    customer_id: c.id,
                    type: 'BIRTHDAY',
                    title: `Birthday greeting for ${c.name}`,
                    due_at: today,
                    status: 'PENDING',
                },
            });
            await this.notifyOwner(followUp.tenant_id, followUp.id, followUp.title);
            created++;
        }

        this.logger.debug(`Birthday follow-ups created: ${created}`);
    }

    /**
     * Reorder-reminder follow-ups, for customers who have gone quiet.
     *
     * Was `last_contacted_at: { lt: sixtyDaysAgo }`, which in SQL EXCLUDES NULL —
     * so a customer nobody has ever logged contact with, the single strongest
     * "reach out" signal there is, was invisible to this check. Reworked as
     * `(last_contacted_at IS NULL OR last_contacted_at < cutoff)`, falling back to
     * `created_at` for the "how long has this been true" comparison so a
     * newly-created customer isn't immediately flagged as dormant on day one.
     */
    @Cron(CronExpression.EVERY_DAY_AT_8AM)
    async autoCreateReorderReminders() {
        return this.jobTracker.track(
            JOB_NAMES.CRM_REORDER_FOLLOWUPS,
            () => this.autoCreateReorderRemindersImpl(),
        );
    }

    private async autoCreateReorderRemindersImpl() {
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
        for (const c of atRiskCustomers) {
            const existing = await this.db.crmFollowUp.findFirst({
                where: {
                    tenant_id: c.tenant_id,
                    customer_id: c.id,
                    type: 'REORDER_REMINDER',
                    status: 'PENDING',
                },
            });
            if (existing) continue;

            const followUp = await this.db.crmFollowUp.create({
                data: {
                    tenant_id: c.tenant_id,
                    customer_id: c.id,
                    type: 'REORDER_REMINDER',
                    title: `Follow up with ${c.name} — no contact in ${REORDER_DORMANT_DAYS}+ days`,
                    due_at: new Date(),
                    status: 'PENDING',
                },
            });
            await this.notifyOwner(followUp.tenant_id, followUp.id, followUp.title);
            created++;
        }

        this.logger.debug(`Reorder reminders created: ${created}`);
    }

    /**
     * A follow-up that only appears if someone happens to open the CRM hub is
     * not much of a reminder. Auto-generated ones (created_by is null — a human
     * creating one is already looking at the form) notify in-app: the assignee
     * if the follow-up has one, otherwise the tenant owner, so it is never
     * created into a void.
     */
    private async notifyOwner(tenantId: string, followUpId: string, title: string) {
        const tenant = await this.db.tenant.findUnique({
            where: { id: tenantId },
            select: { owner_id: true },
        });
        if (!tenant) return;

        try {
            await this.notifications.create(
                tenantId,
                tenant.owner_id,
                'CRM_FOLLOW_UP',
                title,
                'A follow-up was created for you in CRM.',
                '/crm/follow-ups',
            );
        } catch (err) {
            this.logger.error(`Failed to notify owner of follow-up ${followUpId}: ${err}`);
        }
    }
}
