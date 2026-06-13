import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { AuditService } from '../audit/audit.service';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';
import { JOB_NAMES } from '../system-health/jobs/job-names';

@Injectable()
export class BillingSchedulerService {
    private readonly logger = new Logger(BillingSchedulerService.name);

    private get graceDays(): number {
        return parseInt(process.env.DUNNING_GRACE_DAYS ?? '7', 10);
    }

    constructor(
        private readonly db: DatabaseService,
        private readonly email: EmailService,
        private readonly audit: AuditService,
        private readonly jobTracker: JobTrackerService,
    ) {}

    // Run daily at 08:00 — remind PAST_DUE tenants to retry payment before dunning cancels them
    @Cron('0 8 * * *')
    async retryFailedPayments(): Promise<void> {
        await this.jobTracker.track(JOB_NAMES.BILLING_RETRY, () => this.retryFailedPaymentsImpl());
    }

    private async retryFailedPaymentsImpl(): Promise<void> {
        const graceCutoff = new Date();
        graceCutoff.setDate(graceCutoff.getDate() - this.graceDays);

        const retryCandidates = await this.db.tenantSubscription.findMany({
            where: {
                status: 'PAST_DUE',
                current_period_end: { gte: graceCutoff },
            },
            include: {
                tenant: { include: { owner: true } },
                plan: true,
            },
        });

        for (const sub of retryCandidates) {
            try {
                const recentReminder = await this.db.billingEvent.findFirst({
                    where: {
                        tenant_id: sub.tenant_id,
                        event_type: 'PAYMENT_RETRY_REMINDER',
                        created_at: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
                    },
                });

                if (recentReminder) {
                    continue;
                }

                const amount = Number(sub.plan?.monthly_price ?? 0);
                const ownerEmail = sub.tenant?.owner?.email;

                await this.db.billingEvent.create({
                    data: {
                        tenant_id: sub.tenant_id,
                        provider_name: sub.provider_name ?? 'manual',
                        external_event_id: `retry:${sub.tenant_id}:${new Date().toISOString().slice(0, 10)}`,
                        event_type: 'PAYMENT_RETRY_REMINDER',
                        status: 'SENT',
                        reference_id: sub.provider_subscription_ref,
                        amount,
                        currency: 'BDT',
                        payload: { grace_days: this.graceDays },
                    },
                });

                if (ownerEmail && amount > 0) {
                    await this.email.sendPaymentRetryReminder(
                        ownerEmail,
                        sub.tenant.name,
                        amount,
                        'BDT',
                        this.graceDays,
                    );
                }

                this.logger.log(`Payment retry reminder sent for tenant ${sub.tenant_id}`);
            } catch (err) {
                this.logger.error(`Payment retry reminder failed for tenant ${sub.tenant_id}: ${err}`);
            }
        }
    }

    // Run daily at 09:00 — cancel subscriptions that have been PAST_DUE beyond the grace period
    @Cron('0 9 * * *')
    async performDunning(): Promise<void> {
        await this.jobTracker.track(JOB_NAMES.BILLING_DUNNING, () => this.performDunningImpl());
    }

    private async performDunningImpl(): Promise<void> {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - this.graceDays);

        const overdueSubscriptions = await this.db.tenantSubscription.findMany({
            where: {
                status: 'PAST_DUE',
                current_period_end: { lt: cutoff },
            },
            include: {
                tenant: { include: { owner: true } },
                plan: true,
            },
        });

        if (overdueSubscriptions.length === 0) return;

        const freePlan = await this.db.subscriptionPlan.findUnique({
            where: { code: 'FREE' },
        });

        if (!freePlan) {
            this.logger.error('Dunning aborted: FREE plan not found in database');
            return;
        }

        for (const sub of overdueSubscriptions) {
            try {
                await this.db.tenantSubscription.update({
                    where: { tenant_id: sub.tenant_id },
                    data: {
                        status: 'CANCELLED',
                        plan_id: freePlan.id,
                        cancel_at_period_end: false,
                    },
                });

                this.audit.log(
                    'SUBSCRIPTION_CANCELLED_DUNNING',
                    'TenantSubscription',
                    { tenantId: sub.tenant_id },
                    sub.tenant_id,
                    { previousPlan: sub.plan?.code, graceDays: this.graceDays },
                ).catch(() => {});

                const owner = sub.tenant?.owner;
                if (owner?.email) {
                    await this.email.sendSubscriptionCancelled(
                        owner.email,
                        sub.tenant.name,
                        this.graceDays,
                    );
                }

                this.logger.log(
                    `Dunning: cancelled subscription for tenant ${sub.tenant_id} (was ${sub.plan?.code}, PAST_DUE since ${sub.current_period_end.toISOString()})`,
                );
            } catch (err) {
                this.logger.error(`Dunning: failed to process tenant ${sub.tenant_id}: ${err}`);
            }
        }
    }
}
