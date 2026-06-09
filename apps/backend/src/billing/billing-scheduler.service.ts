import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { AuditService } from '../audit/audit.service';

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
    ) {}

    // Run daily at 09:00 — cancel subscriptions that have been PAST_DUE beyond the grace period
    @Cron('0 9 * * *')
    async performDunning(): Promise<void> {
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
