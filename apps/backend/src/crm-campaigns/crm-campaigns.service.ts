import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { validateCampaignRows } from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';
import { AppLogger } from '../common/app-logger.service';
import { CreateCampaignDto, UpdateCampaignDto } from './crm-campaigns.dto';
import { paginate } from '../common/pagination.dto';
import { createdAtRange } from '../common/created-range.util';
import { CampaignRecipientsService } from './campaign-recipients.service';
import { CampaignDispatchService } from './campaign-dispatch.service';

/** How many recipient rows the campaign detail view carries. */
const RECIPIENT_PREVIEW_LIMIT = 100;

@Injectable()
export class CrmCampaignsService {
    constructor(
        private db: DatabaseService,
        private recipients: CampaignRecipientsService,
        private dispatch: CampaignDispatchService,
        private readonly logger: AppLogger,
    ) {}

    async create(tenantId: string, userId: string, dto: CreateCampaignDto) {
        const source = dto.recipient_source ?? 'SEGMENT';

        if (source === 'UPLOAD') {
            return this.createFromUpload(tenantId, userId, dto);
        }

        if (!dto.message) {
            throw new BadRequestException('message is required.');
        }
        if (dto.channel === 'EMAIL' && !dto.subject) {
            throw new BadRequestException('subject is required for EMAIL campaigns.');
        }

        return this.db.crmCampaign.create({
            data: {
                tenant_id: tenantId,
                name: dto.name,
                description: dto.description,
                channel: dto.channel,
                recipient_source: 'SEGMENT',
                body_format: dto.body_format ?? 'TEXT',
                subject: dto.subject,
                message: dto.message,
                target_segment: dto.target_segment ?? 'ALL',
                target_group_id: dto.target_group_id,
                scheduled_at: dto.scheduled_at ? new Date(dto.scheduled_at) : null,
                created_by: userId,
                status: dto.scheduled_at ? 'SCHEDULED' : 'DRAFT',
            },
            include: { creator: { select: { id: true, name: true, email: true } } },
        });
    }

    /**
     * An uploaded list is validated with the same rules the browser previewed
     * with, then materialised into recipients straight away — so the detail
     * view can show exactly who will be emailed before anything is sent.
     */
    private async createFromUpload(tenantId: string, userId: string, dto: CreateCampaignDto) {
        if (dto.channel !== 'EMAIL') {
            throw new BadRequestException('An uploaded recipient list can only be sent by email.');
        }

        const { rows, fileError } = validateCampaignRows(dto.rows ?? []);
        if (fileError) throw new BadRequestException(fileError);

        // One transaction, because the three writes are only meaningful
        // together: a failure between them would leave a DRAFT campaign holding
        // a partial list with recipient_count 0, which then sends to a silently
        // truncated subset.
        const { campaign, written } = await this.db.$transaction(async (tx) => {
            const created = await tx.crmCampaign.create({
                data: {
                    tenant_id: tenantId,
                    name: dto.name,
                    description: dto.description,
                    channel: 'EMAIL',
                    recipient_source: 'UPLOAD',
                    body_format: dto.body_format ?? 'TEXT',
                    subject: null,
                    message: null,
                    target_segment: null,
                    target_group_id: null,
                    scheduled_at: dto.scheduled_at ? new Date(dto.scheduled_at) : null,
                    created_by: userId,
                    status: dto.scheduled_at ? 'SCHEDULED' : 'DRAFT',
                },
                include: { creator: { select: { id: true, name: true, email: true } } },
            });

            const count = await this.recipients.writeUploadedRecipients(
                tenantId,
                created.id,
                rows,
                userId,
                tx,
            );
            await tx.crmCampaign.update({
                where: { id: created.id },
                data: { recipient_count: count },
            });

            return { campaign: created, written: count };
        });

        return { ...campaign, recipient_count: written };
    }

    async findAll(tenantId: string, opts?: { page?: number; limit?: number; createdFrom?: string; createdTo?: string }) {
        const page = opts?.page ?? 1;
        const limit = Math.min(opts?.limit ?? 20, 100);
        const skip = (page - 1) * limit;
        const created = createdAtRange(opts?.createdFrom, opts?.createdTo);
        const where = { tenant_id: tenantId, ...(created ? { created_at: created } : {}) };

        const [items, total] = await Promise.all([
            this.db.crmCampaign.findMany({
                where,
                include: {
                    creator: { select: { id: true, name: true } },
                    _count: { select: { recipients: true } },
                },
                orderBy: { created_at: 'desc' },
                skip,
                take: limit,
            }),
            this.db.crmCampaign.count({ where }),
        ]);

        return paginate(items, total, page, limit);
    }

    async findOne(tenantId: string, id: string) {
        const campaign = await this.db.crmCampaign.findFirst({
            where: { id, tenant_id: tenantId },
            include: { creator: { select: { id: true, name: true, email: true } } },
        });
        if (!campaign) throw new NotFoundException('Campaign not found');

        const [recipients, progress] = await Promise.all([
            this.recipientPreview(id),
            this.progressOf(id),
        ]);
        return { ...campaign, recipients, progress };
    }

    /**
     * The recipients the detail modal shows, most interesting first.
     *
     * `orderBy: { status: 'asc' }` sorted alphabetically, so CANCELLED and
     * FAILED led and SENT trailed — on a 1,000-row campaign the visible 100
     * were all the cancelled ones. Prisma has no CASE ordering, so the priority
     * is walked one group at a time and the walk stops as soon as the page is
     * full; @@index([campaign_id, status]) makes each group a keyed lookup.
     * Failures lead because they are the only rows anyone opens this for; the
     * progress line carries the totals, so nothing is lost by truncating tail
     * groups.
     */
    private async recipientPreview(campaignId: string) {
        const groups = [['FAILED'], ['SENDING', 'PENDING'], ['SENT'], ['CANCELLED']];
        const rows: any[] = [];

        for (const statuses of groups) {
            if (rows.length >= RECIPIENT_PREVIEW_LIMIT) break;
            const page = await this.db.crmCampaignRecipient.findMany({
                where: { campaign_id: campaignId, status: { in: statuses } },
                select: {
                    id: true,
                    email: true,
                    name: true,
                    phone: true,
                    subject: true,
                    status: true,
                    sent_at: true,
                    error: true,
                },
                orderBy: [{ sent_at: 'desc' }, { id: 'asc' }],
                take: RECIPIENT_PREVIEW_LIMIT - rows.length,
            });
            rows.push(...page);
        }

        return rows;
    }

    async update(tenantId: string, id: string, dto: UpdateCampaignDto) {
        const existing = await this.db.crmCampaign.findFirst({ where: { id, tenant_id: tenantId } });
        if (!existing) throw new NotFoundException('Campaign not found');
        if (!['DRAFT', 'SCHEDULED'].includes(existing.status)) {
            throw new BadRequestException('Only DRAFT/SCHEDULED campaigns can be edited');
        }
        if (
            existing.channel === 'EMAIL' &&
            existing.recipient_source === 'SEGMENT' &&
            dto.subject !== undefined &&
            !dto.subject
        ) {
            throw new BadRequestException('subject is required for EMAIL campaigns.');
        }

        const data: any = { ...dto };
        if (dto.scheduled_at !== undefined) {
            data.scheduled_at = dto.scheduled_at ? new Date(dto.scheduled_at) : null;
            data.status = dto.scheduled_at ? 'SCHEDULED' : 'DRAFT';
        }

        return this.db.crmCampaign.update({
            where: { id },
            data,
            include: { creator: { select: { id: true, name: true } } },
        });
    }

    async remove(tenantId: string, id: string) {
        const existing = await this.db.crmCampaign.findFirst({ where: { id, tenant_id: tenantId } });
        if (!existing) throw new NotFoundException('Campaign not found');
        if (existing.status === 'SENDING') {
            throw new BadRequestException('Cannot delete a campaign that is currently sending');
        }
        await this.db.crmCampaign.delete({ where: { id } });
        return { success: true };
    }

    /**
     * Stops a campaign before, or part-way through, its send. Emails already
     * out cannot be recalled, so the counts of what did go are kept.
     */
    async cancel(tenantId: string, id: string) {
        const campaign = await this.db.crmCampaign.findFirst({ where: { id, tenant_id: tenantId } });
        if (!campaign) throw new NotFoundException('Campaign not found');
        if (!['SCHEDULED', 'SENDING'].includes(campaign.status)) {
            throw new BadRequestException(`Campaign is ${campaign.status} and cannot be cancelled`);
        }

        if (campaign.status === 'SCHEDULED') {
            await this.db.crmCampaign.update({ where: { id }, data: { status: 'CANCELLED' } });
            return { success: true };
        }

        // SENDING as well as PENDING: a batch the drain has already claimed is
        // exactly the batch a user cancelling an in-flight send wants stopped.
        // Rows are flipped before the campaign so that by the time the drain
        // notices the campaign is CANCELLED, its remaining rows already are.
        await this.db.crmCampaignRecipient.updateMany({
            where: { campaign_id: id, status: { in: ['PENDING', 'SENDING'] } },
            data: { status: 'CANCELLED' },
        });
        const progress = await this.progressOf(id);
        await this.db.crmCampaign.update({
            where: { id },
            data: { status: 'CANCELLED', delivered_count: progress.sent, failed_count: progress.failed },
        });
        this.logger.log(`Campaign ${id} cancelled after ${progress.sent} sent`);
        return { success: true };
    }

    async previewRecipients(tenantId: string, id: string) {
        const campaign = await this.db.crmCampaign.findFirst({ where: { id, tenant_id: tenantId } });
        if (!campaign) throw new NotFoundException('Campaign not found');

        if (campaign.recipient_source === 'UPLOAD') {
            const progress = await this.progressOf(id);
            return { count: progress.total, sample: [] };
        }

        const customers = await this.recipients.resolveTargetCustomers(
            tenantId,
            campaign.target_segment,
            campaign.target_group_id,
        );
        return {
            count: customers.length,
            sample: customers.slice(0, 10).map((c) => ({ id: c.id, name: c.name, phone: c.phone })),
        };
    }

    send(tenantId: string, id: string) {
        return this.dispatch.queue(tenantId, id);
    }

    /** Called by SalesService after a sale to attribute revenue to recent campaigns. */
    async attributeSale(tenantId: string, customerId: string, amount: number): Promise<void> {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const recipient = await this.db.crmCampaignRecipient.findFirst({
            where: {
                customer_id: customerId,
                status: 'SENT',
                campaign: {
                    tenant_id: tenantId,
                    status: 'COMPLETED',
                    sent_at: { gte: thirtyDaysAgo },
                },
            },
            orderBy: { sent_at: 'desc' },
        });

        if (!recipient) return;

        await this.db.crmCampaign.update({
            where: { id: recipient.campaign_id },
            data: {
                attributed_revenue: { increment: amount },
                attributed_orders: { increment: 1 },
            },
        });
    }

    private async progressOf(campaignId: string) {
        const grouped = await this.db.crmCampaignRecipient.groupBy({
            by: ['status'],
            where: { campaign_id: campaignId },
            _count: { _all: true },
        });
        const countOf = (status: string) =>
            grouped.find((g: any) => g.status === status)?._count?._all ?? 0;
        const sent = countOf('SENT');
        const failed = countOf('FAILED');
        const pending = countOf('PENDING') + countOf('SENDING');
        return { total: sent + failed + pending + countOf('CANCELLED'), sent, failed, pending };
    }
}
