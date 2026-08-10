import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.service';
import { SmsService } from '../sms/sms.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { EmailService } from '../email/email.service';
import { AppLogger } from '../common/app-logger.service';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';
import { JOB_NAMES } from '../system-health/jobs/job-names';
import { CampaignRecipientsService } from './campaign-recipients.service';
import { renderCampaignBody } from './campaign-body.util';

/** How many recipients one drain pass sends before yielding. */
export const CAMPAIGN_BATCH_SIZE = 200;

interface PendingRecipient {
    id: string;
    email: string | null;
    phone: string | null;
    subject: string | null;
    message: string | null;
}

/**
 * Sending is a drain, not a loop: a campaign is marked SENDING and its
 * recipients are worked through a batch at a time. A restart mid-send resumes
 * on the next cron tick instead of stranding the campaign forever, and a large
 * uploaded list is paced rather than fired at the provider all at once.
 */
@Injectable()
export class CampaignDispatchService {
    constructor(
        private db: DatabaseService,
        private recipients: CampaignRecipientsService,
        private sms: SmsService,
        private whatsapp: WhatsAppService,
        private email: EmailService,
        private readonly logger: AppLogger,
        private readonly jobTracker: JobTrackerService,
    ) {}

    /**
     * Moves a campaign into SENDING and starts the first pass. SEGMENT
     * campaigns resolve their recipients here; UPLOAD campaigns already have
     * theirs from when they were created.
     */
    async queue(tenantId: string, campaignId: string): Promise<{ queued: number }> {
        const campaign = await this.db.crmCampaign.findFirst({
            where: { id: campaignId, tenant_id: tenantId },
        });
        if (!campaign) throw new NotFoundException('Campaign not found');
        if (!['DRAFT', 'SCHEDULED'].includes(campaign.status)) {
            throw new BadRequestException(`Campaign is ${campaign.status} and cannot be sent`);
        }

        const queued =
            campaign.recipient_source === 'UPLOAD'
                ? await this.db.crmCampaignRecipient.count({ where: { campaign_id: campaignId } })
                : await this.recipients.writeSegmentRecipients(
                      tenantId,
                      campaignId,
                      campaign.target_segment,
                      campaign.target_group_id,
                  );

        if (queued === 0) throw new BadRequestException('No eligible recipients found');

        await this.db.crmCampaign.update({
            where: { id: campaignId },
            data: { status: 'SENDING', recipient_count: queued },
        });

        // Small campaigns should not wait for the next tick.
        void this.drainCampaign(campaignId).catch((err) =>
            this.logger.error(`Campaign ${campaignId} drain error: ${err}`),
        );

        return { queued };
    }

    /** One pass: claim up to CAMPAIGN_BATCH_SIZE pending recipients and send them. */
    async drainCampaign(campaignId: string): Promise<void> {
        const campaign = await this.db.crmCampaign.findFirst({ where: { id: campaignId } });
        if (!campaign || campaign.status !== 'SENDING') return;

        // orderBy is load-bearing, not cosmetic: without it Postgres can hand two
        // concurrent passes two different subsets of the same PENDING rows, and
        // the claim below only guards whole overlapping sets, not partial ones.
        // A deterministic order makes racing reads-before-either-claims see the
        // identical set (so the claim is all-or-nothing) and a read-after-a-claim
        // see a disjoint set (claimed rows are no longer PENDING) — do not remove.
        const batch: PendingRecipient[] = await this.db.crmCampaignRecipient.findMany({
            where: { campaign_id: campaignId, status: 'PENDING' },
            select: { id: true, email: true, phone: true, subject: true, message: true },
            orderBy: { id: 'asc' },
            take: CAMPAIGN_BATCH_SIZE,
        });

        if (batch.length === 0) {
            await this.complete(campaignId);
            return;
        }

        // Claim before sending. A concurrent pass that reads the same rows will
        // update zero of them and back off, so nobody is emailed twice.
        const claimed = await this.db.crmCampaignRecipient.updateMany({
            where: { id: { in: batch.map((r) => r.id) }, status: 'PENDING' },
            data: { status: 'SENDING' },
        });
        if (claimed.count === 0) return;

        for (const recipient of batch) {
            try {
                await this.deliver(campaign, recipient);
                await this.db.crmCampaignRecipient.update({
                    where: { id: recipient.id },
                    data: { status: 'SENT', sent_at: new Date() },
                });
            } catch (err) {
                await this.db.crmCampaignRecipient.update({
                    where: { id: recipient.id },
                    data: { status: 'FAILED', error: String(err) },
                });
            }
        }

        // A short batch was the last one. Finishing here rather than waiting for
        // the next tick is what keeps a small campaign from sitting on SENDING
        // for five minutes after its last email has already gone.
        if (batch.length < CAMPAIGN_BATCH_SIZE) {
            await this.complete(campaignId);
        }
    }

    /** Cron: fire due scheduled campaigns, then push in-flight ones forward. */
    @Cron('*/5 * * * *')
    async processScheduledCampaigns(): Promise<void> {
        await this.jobTracker.track(JOB_NAMES.CRM_CAMPAIGNS, () => this.processCampaigns());
    }

    async processCampaigns(): Promise<void> {
        const due = await this.db.crmCampaign.findMany({
            where: { status: 'SCHEDULED', scheduled_at: { lte: new Date() } },
            select: { id: true, tenant_id: true },
        });
        for (const campaign of due) {
            try {
                await this.queue(campaign.tenant_id, campaign.id);
            } catch (err) {
                this.logger.error(`Scheduled campaign ${campaign.id} dispatch failed: ${err}`);
            }
        }

        const inFlight = await this.db.crmCampaign.findMany({
            where: { status: 'SENDING' },
            select: { id: true },
        });
        for (const campaign of inFlight) {
            try {
                await this.drainCampaign(campaign.id);
            } catch (err) {
                this.logger.error(`Campaign ${campaign.id} drain failed: ${err}`);
            }
        }
    }

    private async deliver(campaign: any, recipient: PendingRecipient): Promise<void> {
        const message = recipient.message ?? campaign.message ?? '';
        const subject = recipient.subject ?? campaign.subject ?? '';

        if (campaign.channel === 'SMS') {
            if (!recipient.phone) throw new Error('Recipient has no phone number');
            const result = await this.sms.sendSms(recipient.phone, message, {
                tenantId: campaign.tenant_id,
                purpose: 'CRM campaign',
            });
            if (!result.sent) throw new Error('Insufficient SMS credits');
            return;
        }

        if (campaign.channel === 'WHATSAPP') {
            if (!recipient.phone) throw new Error('Recipient has no phone number');
            await this.whatsapp.sendMessage(recipient.phone, message, { tenantId: campaign.tenant_id });
            return;
        }

        if (!recipient.email) throw new Error('Recipient has no email address');
        await this.email.sendCustom(
            recipient.email,
            subject,
            renderCampaignBody(message, campaign.body_format),
            { tenantId: campaign.tenant_id },
        );
    }

    private async complete(campaignId: string): Promise<void> {
        const grouped = await this.db.crmCampaignRecipient.groupBy({
            by: ['status'],
            where: { campaign_id: campaignId },
            _count: { _all: true },
        });
        const countOf = (status: string) =>
            grouped.find((g: any) => g.status === status)?._count?._all ?? 0;

        await this.db.crmCampaign.update({
            where: { id: campaignId },
            data: {
                status: 'COMPLETED',
                sent_at: new Date(),
                delivered_count: countOf('SENT'),
                failed_count: countOf('FAILED'),
            },
        });
        this.logger.log(
            `Campaign ${campaignId} completed: ${countOf('SENT')} sent, ${countOf('FAILED')} failed`,
        );
    }
}
