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

/**
 * How long a row may sit claimed (SENDING) before a later pass assumes the
 * worker that claimed it died and re-queues it. Long enough that a slow SMTP
 * or SMS provider working through a batch is never mistaken for a corpse,
 * short enough that a redeploy does not strand a campaign for an hour.
 */
export const STALE_CLAIM_MS = 15 * 60 * 1000;

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
                      campaign.channel,
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

        await this.requeueStaleClaims(campaignId);

        // orderBy is load-bearing, not cosmetic: without it Postgres can hand two
        // concurrent passes two different subsets of the same PENDING rows, and
        // the claim below only guards whole overlapping sets, not partial ones.
        // A deterministic order makes racing reads-before-either-claims see the
        // identical set (so the claim is all-or-nothing) and a read-after-a-claim
        // see a disjoint set (claimed rows are no longer PENDING) — do not remove.
        const queued: Array<{ id: string }> = await this.db.crmCampaignRecipient.findMany({
            where: { campaign_id: campaignId, status: 'PENDING' },
            select: { id: true },
            orderBy: { id: 'asc' },
            take: CAMPAIGN_BATCH_SIZE,
        });

        if (queued.length === 0) {
            await this.complete(campaignId);
            return;
        }

        // Claim before sending. A concurrent pass that reads the same rows will
        // update zero of them and back off, so nobody is emailed twice.
        // claimed_at is what lets a later pass tell this claim from an orphan.
        const claimedAt = new Date();
        const claimed = await this.db.crmCampaignRecipient.updateMany({
            where: { id: { in: queued.map((r) => r.id) }, status: 'PENDING' },
            data: { status: 'SENDING', claimed_at: claimedAt },
        });
        if (claimed.count === 0) return;

        // Send what we claimed, not what we read. Today those are the same set
        // — every reader uses an identical where/orderBy/take — but that is an
        // argument, not an invariant: a second batch size or a per-channel
        // filter would make a partial claim reachable, and the symptom would be
        // a duplicate email with nothing to detect it. Matching on our own
        // claimedAt makes the set we iterate provably the set we own.
        const batch: PendingRecipient[] = await this.db.crmCampaignRecipient.findMany({
            where: { id: { in: queued.map((r) => r.id) }, status: 'SENDING', claimed_at: claimedAt },
            select: { id: true, email: true, phone: true, subject: true, message: true },
            orderBy: { id: 'asc' },
        });

        for (const recipient of batch) {
            // Cancelling flips the campaign and its rows, but a batch already
            // claimed is in this loop's hands — without re-reading, "Send then
            // Cancel" on a campaign that fits in one batch sends the lot. A
            // keyed status read is negligible next to a network send.
            if (!(await this.isStillSending(campaignId))) {
                this.logger.log(`Campaign ${campaignId} drain stopped: no longer SENDING`);
                return;
            }

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
        if (queued.length < CAMPAIGN_BATCH_SIZE) {
            await this.complete(campaignId);
        }
    }

    /** True while the campaign is still SENDING — i.e. not cancelled underneath us. */
    private async isStillSending(campaignId: string): Promise<boolean> {
        const row = await this.db.crmCampaign.findFirst({
            where: { id: campaignId },
            select: { status: true },
        });
        return row?.status === 'SENDING';
    }

    /**
     * Returns rows orphaned mid-batch to the queue.
     *
     * A crash or redeploy between the claim and the send leaves rows stuck on
     * SENDING: the next pass sees no PENDING, completes the campaign, and those
     * recipients are counted as neither delivered nor failed. Anything claimed
     * longer ago than STALE_CLAIM_MS goes back to PENDING so the drain really
     * is resumable. A null claimed_at on a SENDING row predates this column and
     * can only be such an orphan, so it is recovered too.
     */
    private async requeueStaleClaims(campaignId: string): Promise<void> {
        const cutoff = new Date(Date.now() - STALE_CLAIM_MS);
        const recovered = await this.db.crmCampaignRecipient.updateMany({
            where: {
                campaign_id: campaignId,
                status: 'SENDING',
                OR: [{ claimed_at: null }, { claimed_at: { lt: cutoff } }],
            },
            data: { status: 'PENDING', claimed_at: null },
        });
        if (recovered.count > 0) {
            this.logger.log(
                `Campaign ${campaignId}: re-queued ${recovered.count} stale claimed recipient(s)`,
            );
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
        // Never declare a campaign done while work is outstanding. A row still
        // PENDING or claimed would be counted as neither delivered nor failed,
        // so the totals would silently not add up.
        const outstanding = await this.db.crmCampaignRecipient.count({
            where: { campaign_id: campaignId, status: { in: ['PENDING', 'SENDING'] } },
        });
        if (outstanding > 0) return;

        const grouped = await this.db.crmCampaignRecipient.groupBy({
            by: ['status'],
            where: { campaign_id: campaignId },
            _count: { _all: true },
        });
        const countOf = (status: string) =>
            grouped.find((g: any) => g.status === status)?._count?._all ?? 0;

        // Guarded on SENDING so completion can never resurrect a terminal
        // state: a cancel that landed while this pass was mid-batch stands.
        const finished = await this.db.crmCampaign.updateMany({
            where: { id: campaignId, status: 'SENDING' },
            data: {
                status: 'COMPLETED',
                sent_at: new Date(),
                delivered_count: countOf('SENT'),
                failed_count: countOf('FAILED'),
            },
        });
        if (finished.count === 0) return;

        this.logger.log(
            `Campaign ${campaignId} completed: ${countOf('SENT')} sent, ${countOf('FAILED')} failed`,
        );
    }
}
