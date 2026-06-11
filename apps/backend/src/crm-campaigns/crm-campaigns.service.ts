import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { SmsService } from '../sms/sms.service';
import { AppLogger } from '../common/app-logger.service';
import { CreateCampaignDto, UpdateCampaignDto } from './crm-campaigns.dto';
import { paginate } from '../common/pagination.dto';

@Injectable()
export class CrmCampaignsService {
    constructor(
        private db: DatabaseService,
        private sms: SmsService,
        private readonly logger: AppLogger,
    ) {}

    async create(tenantId: string, userId: string, dto: CreateCampaignDto) {
        return this.db.crmCampaign.create({
            data: {
                tenant_id: tenantId,
                name: dto.name,
                description: dto.description,
                channel: dto.channel,
                message: dto.message,
                target_segment: dto.target_segment ?? 'ALL',
                target_group_id: dto.target_group_id,
                scheduled_at: dto.scheduled_at ? new Date(dto.scheduled_at) : null,
                created_by: userId,
                status: 'DRAFT',
            },
            include: { creator: { select: { id: true, name: true, email: true } } },
        });
    }

    async findAll(tenantId: string, opts?: { page?: number; limit?: number }) {
        const page = opts?.page ?? 1;
        const limit = Math.min(opts?.limit ?? 20, 100);
        const skip = (page - 1) * limit;

        const [items, total] = await Promise.all([
            this.db.crmCampaign.findMany({
                where: { tenant_id: tenantId },
                include: {
                    creator: { select: { id: true, name: true } },
                    _count: { select: { recipients: true } },
                },
                orderBy: { created_at: 'desc' },
                skip,
                take: limit,
            }),
            this.db.crmCampaign.count({ where: { tenant_id: tenantId } }),
        ]);

        return paginate(items, total, page, limit);
    }

    async findOne(tenantId: string, id: string) {
        const campaign = await this.db.crmCampaign.findFirst({
            where: { id, tenant_id: tenantId },
            include: {
                creator: { select: { id: true, name: true, email: true } },
                recipients: {
                    include: { customer: { select: { id: true, name: true, phone: true } } },
                    orderBy: { sent_at: 'desc' },
                    take: 100,
                },
            },
        });
        if (!campaign) throw new NotFoundException('Campaign not found');
        return campaign;
    }

    async update(tenantId: string, id: string, dto: UpdateCampaignDto) {
        const existing = await this.db.crmCampaign.findFirst({ where: { id, tenant_id: tenantId } });
        if (!existing) throw new NotFoundException('Campaign not found');
        if (existing.status !== 'DRAFT') throw new BadRequestException('Only DRAFT campaigns can be edited');

        const data: any = { ...dto };
        if (dto.scheduled_at) data.scheduled_at = new Date(dto.scheduled_at);

        return this.db.crmCampaign.update({
            where: { id },
            data,
            include: { creator: { select: { id: true, name: true } } },
        });
    }

    async remove(tenantId: string, id: string) {
        const existing = await this.db.crmCampaign.findFirst({ where: { id, tenant_id: tenantId } });
        if (!existing) throw new NotFoundException('Campaign not found');
        if (existing.status === 'SENDING') throw new BadRequestException('Cannot delete a campaign that is currently sending');
        await this.db.crmCampaign.delete({ where: { id } });
        return { success: true };
    }

    async previewRecipients(tenantId: string, id: string) {
        const campaign = await this.db.crmCampaign.findFirst({ where: { id, tenant_id: tenantId } });
        if (!campaign) throw new NotFoundException('Campaign not found');

        const customers = await this.resolveTargetCustomers(tenantId, campaign.target_segment, campaign.target_group_id);
        return {
            count: customers.length,
            sample: customers.slice(0, 10).map((c) => ({ id: c.id, name: c.name, phone: c.phone })),
        };
    }

    async send(tenantId: string, id: string) {
        const campaign = await this.db.crmCampaign.findFirst({ where: { id, tenant_id: tenantId } });
        if (!campaign) throw new NotFoundException('Campaign not found');
        if (!['DRAFT', 'SCHEDULED'].includes(campaign.status)) {
            throw new BadRequestException(`Campaign is ${campaign.status} and cannot be sent`);
        }

        const customers = await this.resolveTargetCustomers(tenantId, campaign.target_segment, campaign.target_group_id);
        if (customers.length === 0) throw new BadRequestException('No eligible recipients found');

        // Mark as SENDING
        await this.db.crmCampaign.update({
            where: { id },
            data: { status: 'SENDING', recipient_count: customers.length },
        });

        // Create recipient rows
        await this.db.crmCampaignRecipient.createMany({
            data: customers.map((c) => ({
                id: require('crypto').randomUUID(),
                campaign_id: id,
                customer_id: c.id,
                phone: c.phone,
                status: 'PENDING',
            })),
            skipDuplicates: true,
        });

        // Fire-and-forget delivery
        void this.dispatchCampaign(id, campaign.message, campaign.channel, customers).catch((err) =>
            this.logger.error(`Campaign ${id} dispatch error: ${err}`),
        );

        return { queued: customers.length };
    }

    private async dispatchCampaign(
        campaignId: string,
        message: string,
        channel: string,
        customers: Array<{ id: string; phone: string }>,
    ) {
        let delivered = 0;
        let failed = 0;

        for (const customer of customers) {
            try {
                if (channel === 'SMS') {
                    await this.sms.sendSms(customer.phone, message);
                }
                await this.db.crmCampaignRecipient.updateMany({
                    where: { campaign_id: campaignId, customer_id: customer.id },
                    data: { status: 'SENT', sent_at: new Date() },
                });
                delivered++;
            } catch (err) {
                await this.db.crmCampaignRecipient.updateMany({
                    where: { campaign_id: campaignId, customer_id: customer.id },
                    data: { status: 'FAILED', error: String(err) },
                });
                failed++;
            }
        }

        await this.db.crmCampaign.update({
            where: { id: campaignId },
            data: {
                status: 'COMPLETED',
                sent_at: new Date(),
                delivered_count: delivered,
                failed_count: failed,
            },
        });

        this.logger.log(`Campaign ${campaignId} completed: ${delivered} sent, ${failed} failed`);
    }

    private async resolveTargetCustomers(
        tenantId: string,
        targetSegment: string | null,
        targetGroupId: string | null,
    ) {
        const where: any = { tenant_id: tenantId, deleted_at: null };

        if (targetSegment && targetSegment !== 'ALL') {
            where.segment_category = targetSegment;
        }
        if (targetGroupId) {
            where.customer_group_id = targetGroupId;
        }

        return this.db.customer.findMany({
            where,
            select: { id: true, name: true, phone: true },
        });
    }
}
