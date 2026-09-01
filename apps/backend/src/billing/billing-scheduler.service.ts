import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { AuditService } from '../audit/audit.service';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';
import { JOB_NAMES } from '../system-health/jobs/job-names';
import { NotificationsService } from '../notifications/notifications.service';
import { applySubscriptionDiscount } from './discount.util';

/** The slice of a subscription the good-standing note needs, shared by both passes. */
interface ReminderCycleSubscription {
    tenant_id: string;
    current_period_end: Date;
    plan: { name: string; monthly_price: unknown } | null;
    tenant: { name: string; owner: { id: string; email: string | null } | null } | null;
}

@Injectable()
export class BillingSchedulerService {
    private readonly logger = new Logger(BillingSchedulerService.name);

    private get graceDays(): number {
        return parseInt(process.env.DUNNING_GRACE_DAYS ?? '7', 10);
    }

    /**
     * How often a tenant with nothing outstanding hears the good-standing note.
     * Roughly one per billing cycle by default; 0 (or less) turns the note off.
     */
    private get goodStandingIntervalDays(): number {
        return parseInt(process.env.SUBSCRIPTION_GOOD_STANDING_DAYS ?? '30', 10);
    }

    constructor(
        private readonly db: DatabaseService,
        private readonly email: EmailService,
        private readonly audit: AuditService,
        private readonly jobTracker: JobTrackerService,
        private readonly notifications: NotificationsService,
    ) {}

    // Run daily at 08:00 — the subscription reminder cycle: PAST_DUE tenants are asked to
    // retry payment before dunning cancels them; tenants with nothing due get a
    // good-standing note instead of a payment knock.
    @Cron('0 8 * * *')
    async retryFailedPayments(): Promise<void> {
        await this.jobTracker.track(JOB_NAMES.BILLING_RETRY, () => this.retryFailedPaymentsImpl());
    }

    private async retryFailedPaymentsImpl(): Promise<void> {
        const graceCutoff = new Date();
        graceCutoff.setDate(graceCutoff.getDate() - this.graceDays);

        await this.retryFailedAddonPaymentsImpl(graceCutoff);

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
                // What the tenant actually owes this cycle, after any admin-granted
                // discount — the same figure the period-fee job posted to the ledger.
                const amount = applySubscriptionDiscount(
                    Number(sub.plan?.monthly_price ?? 0),
                    sub.discount_type,
                    sub.discount_value != null ? Number(sub.discount_value) : null,
                );

                // Nothing is owed (a fully discounted plan) — thank them instead of
                // knocking for a payment that isn't due.
                if (amount <= 0) {
                    await this.sendGoodStandingNote(sub);
                    continue;
                }

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

                if (ownerEmail) {
                    await this.email.sendPaymentRetryReminder(
                        ownerEmail,
                        sub.tenant.name,
                        amount,
                        'BDT',
                        this.graceDays,
                    );
                }

                const owner = sub.tenant?.owner;
                if (owner?.id) {
                    const formattedAmount = amount.toFixed(2);
                    await this.notifications.create(
                        sub.tenant_id,
                        owner.id,
                        'PAYMENT_RETRY_REMINDER',
                        'Payment retry reminder',
                        `Your ${sub.tenant.name} subscription payment of ৳${formattedAmount} is overdue. Please retry within ${this.graceDays} days.`,
                        '/billing',
                    );
                }

                this.logger.log(`Payment retry reminder sent for tenant ${sub.tenant_id}`);
            } catch (err) {
                this.logger.error(`Payment retry reminder failed for tenant ${sub.tenant_id}: ${err}`);
            }
        }

        await this.sendGoodStandingNotesImpl();
    }

    /**
     * The other half of the reminder cycle: tenants on a paid plan who are settled up
     * hear something positive — what they're on, when it renews — rather than nothing
     * at all. Free-plan tenants stay out of it; they are never billed, so a
     * “you're all paid up” note would be noise.
     */
    private async sendGoodStandingNotesImpl(): Promise<void> {
        if (this.goodStandingIntervalDays <= 0) return;

        const settledSubscriptions = await this.db.tenantSubscription.findMany({
            where: {
                status: { in: ['ACTIVE', 'TRIALING'] },
                // A subscription winding down gets its own cancellation mail, not a
                // note promising the next renewal.
                cancel_at_period_end: false,
                plan: { monthly_price: { gt: 0 } },
            },
            include: {
                tenant: { include: { owner: true } },
                plan: true,
            },
        });

        for (const sub of settledSubscriptions) {
            try {
                await this.sendGoodStandingNote(sub);
            } catch (err) {
                this.logger.error(`Good-standing note failed for tenant ${sub.tenant_id}: ${err}`);
            }
        }
    }

    /**
     * Sends the positive counterpart of a payment reminder, at most once per
     * `SUBSCRIPTION_GOOD_STANDING_DAYS`. Logged as a BillingEvent like the payment
     * reminders are, both for that dedup and for the admin reminder log — with no
     * amount, because nothing is owed.
     */
    private async sendGoodStandingNote(sub: ReminderCycleSubscription): Promise<void> {
        if (this.goodStandingIntervalDays <= 0) return;
        if (Number(sub.plan?.monthly_price ?? 0) <= 0) return;

        const owner = sub.tenant?.owner;
        if (!owner?.id && !owner?.email) return;

        const sentSince = new Date(Date.now() - this.goodStandingIntervalDays * 24 * 60 * 60 * 1000);
        const recentNote = await this.db.billingEvent.findFirst({
            where: {
                tenant_id: sub.tenant_id,
                event_type: 'SUBSCRIPTION_GOOD_STANDING',
                created_at: { gte: sentSince },
            },
        });
        if (recentNote) return;

        const planName = sub.plan?.name ?? 'subscription';
        const renewsAt = sub.current_period_end;

        await this.db.billingEvent.create({
            data: {
                tenant_id: sub.tenant_id,
                provider_name: 'manual',
                external_event_id: `good_standing:${sub.tenant_id}:${new Date().toISOString().slice(0, 10)}`,
                event_type: 'SUBSCRIPTION_GOOD_STANDING',
                status: 'SENT',
                amount: null,
                currency: 'BDT',
                payload: {
                    plan_name: planName,
                    renews_at: renewsAt.toISOString(),
                    interval_days: this.goodStandingIntervalDays,
                },
            },
        });

        if (owner?.email) {
            await this.email.sendSubscriptionGoodStanding(
                owner.email,
                sub.tenant!.name,
                planName,
                renewsAt,
            );
        }

        if (owner?.id) {
            await this.notifications.create(
                sub.tenant_id,
                owner.id,
                'SUBSCRIPTION_GOOD_STANDING',
                'Your subscription is all set',
                `Nothing is due for ${sub.tenant!.name}. Your ${planName} plan is paid up and renews on ${renewsAt.toDateString()}.`,
                '/billing',
            );
        }

        this.logger.log(`Good-standing note sent for tenant ${sub.tenant_id}`);
    }

    /** Add-on analog of retryFailedPaymentsImpl — reminds tenants with a PAST_DUE add-on subscription. */
    private async retryFailedAddonPaymentsImpl(graceCutoff: Date): Promise<void> {
        const retryCandidates = await this.db.tenantAddonSubscription.findMany({
            where: {
                status: 'PAST_DUE',
                current_period_end: { gte: graceCutoff },
            },
            include: {
                tenant: { include: { owner: true } },
                addon: true,
            },
        });

        for (const sub of retryCandidates) {
            try {
                const recentReminder = await this.db.billingEvent.findFirst({
                    where: {
                        tenant_id: sub.tenant_id,
                        event_type: 'ADDON_PAYMENT_RETRY_REMINDER',
                        reference_id: sub.addon_id,
                        created_at: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
                    },
                });
                if (recentReminder) continue;

                const amount = Number(sub.addon.monthly_price);
                const owner = sub.tenant?.owner;

                await this.db.billingEvent.create({
                    data: {
                        tenant_id: sub.tenant_id,
                        provider_name: sub.provider_name ?? 'manual',
                        external_event_id: `addon_retry:${sub.tenant_id}:${sub.addon_id}:${new Date().toISOString().slice(0, 10)}`,
                        event_type: 'ADDON_PAYMENT_RETRY_REMINDER',
                        status: 'SENT',
                        reference_id: sub.addon_id,
                        amount,
                        currency: 'BDT',
                        payload: { addon_code: sub.addon.code, grace_days: this.graceDays },
                    },
                });

                if (owner?.id && amount > 0) {
                    const formattedAmount = amount.toFixed(2);
                    await this.notifications.create(
                        sub.tenant_id,
                        owner.id,
                        'ADDON_PAYMENT_RETRY_REMINDER',
                        'Add-on payment retry reminder',
                        `Your ${sub.addon.name} add-on payment of ৳${formattedAmount} is overdue. Please retry within ${this.graceDays} days.`,
                        '/billing',
                    );
                }

                this.logger.log(`Add-on payment retry reminder sent for tenant ${sub.tenant_id} (${sub.addon.code})`);
            } catch (err) {
                this.logger.error(`Add-on payment retry reminder failed for tenant ${sub.tenant_id}: ${err}`);
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

        await this.performAddonDunningImpl(cutoff);

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

                if (owner?.id) {
                    await this.notifications.create(
                        sub.tenant_id,
                        owner.id,
                        'SUBSCRIPTION_CANCELLED',
                        'Subscription cancelled',
                        `Your ${sub.tenant.name} subscription has been downgraded to the Free plan after ${this.graceDays} days of non-payment.`,
                        '/billing',
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

    /**
     * Add-on analog of performDunningImpl. Unlike the base plan, there's no fallback
     * plan to downgrade to — an overdue add-on subscription is simply cancelled, which
     * drops its entitlements out of the merged feature set on the next request.
     */
    private async performAddonDunningImpl(cutoff: Date): Promise<void> {
        const overdueAddonSubscriptions = await this.db.tenantAddonSubscription.findMany({
            where: {
                status: 'PAST_DUE',
                current_period_end: { lt: cutoff },
            },
            include: {
                tenant: { include: { owner: true } },
                addon: true,
            },
        });

        for (const sub of overdueAddonSubscriptions) {
            try {
                await this.db.tenantAddonSubscription.update({
                    where: { tenant_id_addon_id: { tenant_id: sub.tenant_id, addon_id: sub.addon_id } },
                    data: { status: 'CANCELLED', cancel_at_period_end: false },
                });

                this.audit.log(
                    'ADDON_SUBSCRIPTION_CANCELLED_DUNNING',
                    'TenantAddonSubscription',
                    { tenantId: sub.tenant_id },
                    sub.tenant_id,
                    { addonCode: sub.addon.code, graceDays: this.graceDays },
                ).catch(() => {});

                const owner = sub.tenant?.owner;
                if (owner?.id) {
                    await this.notifications.create(
                        sub.tenant_id,
                        owner.id,
                        'ADDON_SUBSCRIPTION_CANCELLED',
                        'Add-on subscription cancelled',
                        `Your ${sub.addon.name} add-on was cancelled after ${this.graceDays} days of non-payment.`,
                        '/billing',
                    );
                }

                this.logger.log(
                    `Dunning: cancelled add-on subscription for tenant ${sub.tenant_id} (${sub.addon.code}, PAST_DUE since ${sub.current_period_end.toISOString()})`,
                );
            } catch (err) {
                this.logger.error(`Add-on dunning: failed to process tenant ${sub.tenant_id}: ${err}`);
            }
        }
    }

    // Run daily at 10:00 — post subscription fees to tenant ledger when a billing period ends
    @Cron('0 10 * * *')
    async postSubscriptionPeriodFees(): Promise<void> {
        await this.jobTracker.track(JOB_NAMES.BILLING_PERIOD_FEES, () => this.postSubscriptionPeriodFeesImpl());
    }

    private async postSubscriptionPeriodFeesImpl(): Promise<void> {
        const now = new Date();
        const dueSubscriptions = await this.db.tenantSubscription.findMany({
            where: {
                status: { in: ['ACTIVE', 'PAST_DUE'] },
                cancel_at_period_end: false,
                current_period_end: { lte: now },
            },
            include: {
                tenant: { include: { owner: true } },
                plan: true,
            },
        });

        for (const sub of dueSubscriptions) {
            try {
                const baseAmount = Number(sub.plan?.monthly_price ?? 0);
                if (baseAmount <= 0) continue;

                // Apply any admin-granted discount to this (and every future) cycle.
                const amount = applySubscriptionDiscount(
                    baseAmount,
                    sub.discount_type,
                    sub.discount_value != null ? Number(sub.discount_value) : null,
                );
                if (amount <= 0) continue;

                const periodKey = sub.current_period_end.toISOString().slice(0, 10);
                const externalEventId = `subscription_fee:${sub.tenant_id}:${periodKey}`;

                const existing = await this.db.billingEvent.findUnique({
                    where: {
                        provider_name_external_event_id: {
                            provider_name: 'manual',
                            external_event_id: externalEventId,
                        },
                    },
                });
                if (existing) continue;

                await this.db.billingEvent.create({
                    data: {
                        tenant_id: sub.tenant_id,
                        provider_name: 'manual',
                        external_event_id: externalEventId,
                        event_type: 'subscription_fee',
                        status: 'posted',
                        amount,
                        currency: 'BDT',
                        reference_id: sub.plan?.code ?? null,
                        payload: {
                            period_end: sub.current_period_end.toISOString(),
                            plan_code: sub.plan?.code ?? null,
                            plan_name: sub.plan?.name ?? null,
                            base_amount: baseAmount,
                            discount_type: sub.discount_type ?? null,
                            discount_value: sub.discount_value != null ? Number(sub.discount_value) : null,
                        },
                    },
                });

                const owner = sub.tenant?.owner;
                const formattedAmount = amount.toFixed(2);
                const title = 'Subscription fee posted';
                const body = `Your ${sub.plan?.name ?? 'subscription'} fee of ৳${formattedAmount} for ${sub.tenant.name} has been posted for the period ending ${sub.current_period_end.toDateString()}.`;

                if (owner?.id) {
                    await this.notifications.create(
                        sub.tenant_id,
                        owner.id,
                        'subscription_fee',
                        title,
                        body,
                        '/billing',
                    );
                }

                if (owner?.email) {
                    await this.email.sendSubscriptionFeePosted(
                        owner.email,
                        sub.tenant.name,
                        amount,
                        'BDT',
                        sub.current_period_end,
                    );
                }

                this.logger.log(`Posted subscription fee for tenant ${sub.tenant_id} (৳${formattedAmount})`);
            } catch (err) {
                this.logger.error(`Subscription fee posting failed for tenant ${sub.tenant_id}: ${err}`);
            }
        }

        await this.postAddonPeriodFeesImpl(now);
    }

    /** Add-on analog of postSubscriptionPeriodFeesImpl — posts a ledger fee entry per due add-on. */
    private async postAddonPeriodFeesImpl(now: Date): Promise<void> {
        const dueAddonSubscriptions = await this.db.tenantAddonSubscription.findMany({
            where: {
                status: { in: ['ACTIVE', 'PAST_DUE'] },
                cancel_at_period_end: false,
                current_period_end: { lte: now },
            },
            include: {
                tenant: { include: { owner: true } },
                addon: true,
            },
        });

        for (const sub of dueAddonSubscriptions) {
            try {
                const amount = Number(sub.addon.monthly_price);
                if (amount <= 0) continue;

                const periodKey = sub.current_period_end.toISOString().slice(0, 10);
                const externalEventId = `addon_fee:${sub.tenant_id}:${sub.addon_id}:${periodKey}`;

                const existing = await this.db.billingEvent.findUnique({
                    where: {
                        provider_name_external_event_id: {
                            provider_name: 'manual',
                            external_event_id: externalEventId,
                        },
                    },
                });
                if (existing) continue;

                await this.db.billingEvent.create({
                    data: {
                        tenant_id: sub.tenant_id,
                        provider_name: 'manual',
                        external_event_id: externalEventId,
                        event_type: 'addon_fee',
                        status: 'posted',
                        amount,
                        currency: 'BDT',
                        reference_id: sub.addon_id,
                        payload: {
                            period_end: sub.current_period_end.toISOString(),
                            addon_code: sub.addon.code,
                            addon_name: sub.addon.name,
                        },
                    },
                });

                const owner = sub.tenant?.owner;
                if (owner?.id) {
                    const formattedAmount = amount.toFixed(2);
                    await this.notifications.create(
                        sub.tenant_id,
                        owner.id,
                        'addon_fee',
                        'Add-on fee posted',
                        `Your ${sub.addon.name} add-on fee of ৳${formattedAmount} for ${sub.tenant.name} has been posted for the period ending ${sub.current_period_end.toDateString()}.`,
                        '/billing',
                    );
                }

                this.logger.log(`Posted add-on fee for tenant ${sub.tenant_id} (${sub.addon.code})`);
            } catch (err) {
                this.logger.error(`Add-on fee posting failed for tenant ${sub.tenant_id}: ${err}`);
            }
        }
    }
}
