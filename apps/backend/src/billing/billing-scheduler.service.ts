import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { AuditService } from '../audit/audit.service';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';
import { JOB_NAMES } from '../system-health/jobs/job-names';
import { NotificationsService } from '../notifications/notifications.service';
import { applySubscriptionDiscount } from './discount.util';
import { elapsedPeriods, normalizeBillingCycle } from './billing-cycle.util';
import { computeLedgerBalance } from '../admin-tenants/ledger-balance.util';

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

    /**
     * How long a tenant may stay unpaid before the workspace is frozen. Measured
     * from `past_due_since` — the first unpaid fee of the current run — not from
     * the period end, which keeps moving forward as renewals post.
     */
    private get suspensionDays(): number {
        return parseInt(process.env.BILLING_SUSPENSION_DAYS ?? '30', 10);
    }

    /** How often an overdue tenant is reminded, once the initial grace window has passed. */
    private get reminderIntervalDays(): number {
        return parseInt(process.env.DUNNING_REMINDER_INTERVAL_DAYS ?? '3', 10);
    }

    /**
     * What the tenant owes right now: the sum of every ledger-affecting billing
     * event. Negative means money is due (fees outweigh payments), which is the
     * sign convention `ledgerEventDelta` uses.
     *
     * One query per overdue tenant per nightly run, served by the existing
     * `@@index([tenant_id, created_at])`. Bounded by the number of PAST_DUE
     * tenants rather than all of them, which is small by construction — if that
     * ever stops being true, batch it the way
     * `AdminTenantsService.computeLedgerBalancesByTenant` already does.
     */
    private async outstandingBalance(tenantId: string): Promise<number> {
        const events = await this.db.billingEvent.findMany({
            where: { tenant_id: tenantId },
            select: { event_type: true, amount: true },
        });

        return computeLedgerBalance(
            events.map((event) => ({
                event_type: event.event_type,
                amount: event.amount != null ? Number(event.amount) : 0,
            })),
        );
    }

    /**
     * Starts the dunning clock if the tenant now owes money and isn't already
     * counting. Idempotent: an existing `past_due_since` is left alone so the
     * 30-day suspension window measures from the *first* missed payment rather
     * than restarting with every renewal that posts on top of it.
     */
    private async markPastDueIfUnsettled(tenantId: string, now: Date): Promise<void> {
        const balance = await this.outstandingBalance(tenantId);
        if (balance >= 0) return;

        const subscription = await this.db.tenantSubscription.findUnique({
            where: { tenant_id: tenantId },
            select: { status: true, past_due_since: true },
        });
        if (!subscription) return;

        await this.db.tenantSubscription.update({
            where: { tenant_id: tenantId },
            data: {
                status: subscription.status === 'CANCELLED' ? subscription.status : 'PAST_DUE',
                past_due_since: subscription.past_due_since ?? now,
            },
        });
    }

    /**
     * The settled-up counterpart of `markPastDueIfUnsettled`: stops the dunning
     * clock and unfreezes the workspace. Called wherever a balance is observed to
     * be clear, so a tenant who pays is restored by the next reminder pass even if
     * the payment arrived through a path that did not lift the suspension itself.
     */
    private async clearPastDue(tenantId: string): Promise<void> {
        await this.db.tenantSubscription.updateMany({
            where: { tenant_id: tenantId, status: 'PAST_DUE' },
            data: { status: 'ACTIVE', past_due_since: null, last_reminder_at: null },
        });

        await this.db.tenant.updateMany({
            where: { id: tenantId, billing_suspended_at: { not: null } },
            data: { billing_suspended_at: null, billing_suspension_reason: null },
        });
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
        const now = new Date();
        const graceCutoff = new Date();
        graceCutoff.setDate(graceCutoff.getDate() - this.graceDays);

        await this.retryFailedAddonPaymentsImpl(graceCutoff);

        // Every overdue tenant, with no upper bound on how long they have been
        // overdue. The old query stopped at the grace cutoff, so a tenant who did
        // not pay within `graceDays` simply stopped hearing from us — the reminders
        // went quiet exactly when they mattered most. Reminding continues until the
        // balance is settled or the workspace is suspended.
        const retryCandidates = await this.db.tenantSubscription.findMany({
            where: {
                status: 'PAST_DUE',
                tenant: { deleted_at: null },
            },
            include: {
                tenant: { include: { owner: true } },
                plan: true,
            },
        });

        for (const sub of retryCandidates) {
            try {
                // What the tenant actually owes overall, from the ledger — not one
                // cycle's list price. After the renewal fix an overdue tenant can be
                // several unpaid periods deep, and the reminder should name the real
                // total rather than understating it.
                const balance = await this.outstandingBalance(sub.tenant_id);
                const amount = balance < 0 ? Math.abs(balance) : 0;

                // Nothing is owed (a fully discounted plan, or they have paid since
                // the status was set) — thank them instead of knocking for a payment
                // that isn't due, and stop the dunning clock.
                if (amount <= 0) {
                    await this.clearPastDue(sub.tenant_id);
                    await this.sendGoodStandingNote(sub);
                    continue;
                }

                const overdueSince = sub.past_due_since ?? sub.current_period_end;
                const daysOverdue = Math.max(
                    0,
                    Math.floor((now.getTime() - overdueSince.getTime()) / (24 * 60 * 60 * 1000)),
                );
                const daysUntilSuspension = Math.max(0, this.suspensionDays - daysOverdue);

                // Daily while inside the initial grace window, then every
                // `reminderIntervalDays` — persistent without becoming spam.
                const intervalDays = daysOverdue <= this.graceDays ? 1 : this.reminderIntervalDays;
                const nextReminderDue = new Date(
                    now.getTime() - intervalDays * 24 * 60 * 60 * 1000,
                );

                if (sub.last_reminder_at && sub.last_reminder_at > nextReminderDue) {
                    continue;
                }

                const ownerEmail = sub.tenant?.owner?.email;

                await this.db.billingEvent.create({
                    data: {
                        tenant_id: sub.tenant_id,
                        provider_name: sub.provider_name ?? 'manual',
                        external_event_id: `retry:${sub.tenant_id}:${now.toISOString().slice(0, 10)}`,
                        event_type: 'PAYMENT_RETRY_REMINDER',
                        status: 'SENT',
                        reference_id: sub.provider_subscription_ref,
                        amount,
                        currency: 'BDT',
                        payload: {
                            grace_days: this.graceDays,
                            days_overdue: daysOverdue,
                            days_until_suspension: daysUntilSuspension,
                        },
                    },
                });

                await this.db.tenantSubscription.update({
                    where: { tenant_id: sub.tenant_id },
                    data: { last_reminder_at: now },
                });

                if (ownerEmail) {
                    await this.email.sendPaymentRetryReminder(
                        ownerEmail,
                        sub.tenant.name,
                        amount,
                        'BDT',
                        daysUntilSuspension,
                    );
                }

                const owner = sub.tenant?.owner;
                if (owner?.id) {
                    const formattedAmount = amount.toFixed(2);
                    // The warning sharpens as the suspension date approaches, so the
                    // last few reminders read differently from the first.
                    const consequence = daysUntilSuspension > 0
                        ? `Your workspace will be suspended in ${daysUntilSuspension} day${daysUntilSuspension === 1 ? '' : 's'} if payment is not received.`
                        : 'Your workspace has been suspended pending payment.';
                    await this.notifications.create(
                        sub.tenant_id,
                        owner.id,
                        'PAYMENT_RETRY_REMINDER',
                        'Payment overdue',
                        `Your ${sub.tenant.name} subscription has an outstanding balance of ৳${formattedAmount}, overdue for ${daysOverdue} day${daysOverdue === 1 ? '' : 's'}. ${consequence}`,
                        '/billing',
                    );
                }

                this.logger.log(
                    `Payment reminder sent for tenant ${sub.tenant_id} (৳${amount.toFixed(2)} outstanding, ${daysOverdue}d overdue)`,
                );
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

    // Run daily at 09:00 — suspend workspaces that have gone unpaid past the
    // suspension window, and cancel add-ons past their own grace period.
    @Cron('0 9 * * *')
    async performDunning(): Promise<void> {
        await this.jobTracker.track(JOB_NAMES.BILLING_DUNNING, () => this.performDunningImpl());
    }

    private async performDunningImpl(): Promise<void> {
        const now = new Date();
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - this.graceDays);

        await this.performAddonDunningImpl(cutoff);

        // Overdue for longer than the suspension window. Measured from
        // `past_due_since` — the first unpaid fee — because `current_period_end`
        // now moves forward with every renewal and no longer marks when the
        // tenant fell behind.
        const suspensionCutoff = new Date(
            now.getTime() - this.suspensionDays * 24 * 60 * 60 * 1000,
        );

        const overdueSubscriptions = await this.db.tenantSubscription.findMany({
            where: {
                status: 'PAST_DUE',
                past_due_since: { not: null, lt: suspensionCutoff },
                tenant: { deleted_at: null, billing_suspended_at: null },
            },
            include: {
                tenant: { include: { owner: true } },
                plan: true,
            },
        });

        if (overdueSubscriptions.length === 0) return;

        for (const sub of overdueSubscriptions) {
            try {
                // Re-check the ledger rather than trusting the status column: a
                // payment recorded between the last reminder pass and now must not
                // be suspended on stale state.
                const balance = await this.outstandingBalance(sub.tenant_id);
                if (balance >= 0) {
                    await this.clearPastDue(sub.tenant_id);
                    continue;
                }

                const outstanding = Math.abs(balance);
                const reason = `Unpaid subscription balance of ৳${outstanding.toFixed(2)} after ${this.suspensionDays} days.`;

                // Freeze the workspace: reads stay open so the owner can settle up
                // and export, but `BillingSuspensionGuard` rejects every write. The
                // plan is deliberately left in place — this is recoverable on
                // payment, unlike the old downgrade-to-FREE, which silently
                // stripped entitlements the tenant had been paying for.
                await this.db.tenant.update({
                    where: { id: sub.tenant_id },
                    data: {
                        billing_suspended_at: now,
                        billing_suspension_reason: reason,
                    },
                });

                this.audit.log(
                    'TENANT_SUSPENDED_NONPAYMENT',
                    'Tenant',
                    { tenantId: sub.tenant_id },
                    sub.tenant_id,
                    {
                        plan: sub.plan?.code,
                        outstanding,
                        suspensionDays: this.suspensionDays,
                        pastDueSince: sub.past_due_since?.toISOString() ?? null,
                    },
                ).catch(() => {});

                const owner = sub.tenant?.owner;
                if (owner?.email) {
                    await this.email.sendWorkspaceSuspended(
                        owner.email,
                        sub.tenant.name,
                        outstanding,
                        'BDT',
                        this.suspensionDays,
                    );
                }

                if (owner?.id) {
                    await this.notifications.create(
                        sub.tenant_id,
                        owner.id,
                        'TENANT_SUSPENDED',
                        'Workspace suspended',
                        `${sub.tenant.name} has been suspended after ${this.suspensionDays} days with an unpaid balance of ৳${outstanding.toFixed(2)}. Your data is safe and read-only — settle the balance to restore full access.`,
                        '/billing',
                    );
                }

                this.logger.warn(
                    `Dunning: suspended tenant ${sub.tenant_id} (${sub.plan?.code}, ৳${outstanding.toFixed(2)} outstanding since ${sub.past_due_since?.toISOString()})`,
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
                const cycle = normalizeBillingCycle(sub.billing_cycle);
                const baseAmount = cycle === 'YEARLY'
                    ? Number(sub.plan?.yearly_price ?? Number(sub.plan?.monthly_price ?? 0) * 12)
                    : Number(sub.plan?.monthly_price ?? 0);

                // Every period the subscription has run past without renewing. Normally
                // exactly one; more when the cron missed days, or for the tenants left
                // frozen by the bug where nothing advanced `current_period_end`.
                const periods = elapsedPeriods(sub.current_period_end, cycle, now);
                if (periods.length === 0) continue;

                // A zero-price plan still renews — it just posts no charge. Advancing the
                // period regardless is what keeps a free/fully-discounted subscription
                // from being re-selected by this query on every single run.
                const amount = baseAmount > 0
                    ? applySubscriptionDiscount(
                        baseAmount,
                        sub.discount_type,
                        sub.discount_value != null ? Number(sub.discount_value) : null,
                    )
                    : 0;

                let postedCount = 0;

                for (const period of periods) {
                    if (amount <= 0) continue;

                    const periodKey = period.periodStart.toISOString().slice(0, 10);
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
                                period_end: period.periodStart.toISOString(),
                                next_period_end: period.periodEnd.toISOString(),
                                billing_cycle: cycle,
                                plan_code: sub.plan?.code ?? null,
                                plan_name: sub.plan?.name ?? null,
                                base_amount: baseAmount,
                                discount_type: sub.discount_type ?? null,
                                discount_value: sub.discount_value != null ? Number(sub.discount_value) : null,
                            },
                        },
                    });
                    postedCount += 1;
                }

                // Advance the subscription to the period that is still running. This is
                // the step whose absence froze billing: without it the query above
                // re-selects the same subscription forever and the idempotency key above
                // suppresses every fee after the first.
                const finalPeriod = periods[periods.length - 1];
                await this.db.tenantSubscription.update({
                    where: { tenant_id: sub.tenant_id },
                    data: {
                        current_period_start: finalPeriod.periodStart,
                        current_period_end: finalPeriod.periodEnd,
                    },
                });

                if (postedCount === 0) continue;

                // An unpaid fee starts (or continues) the dunning clock the reminder
                // cadence and the suspension sweep both read.
                await this.markPastDueIfUnsettled(sub.tenant_id, now);

                const owner = sub.tenant?.owner;
                const formattedAmount = amount.toFixed(2);
                const title = 'Subscription fee posted';
                const periodLabel = postedCount > 1
                    ? `${postedCount} periods ending ${finalPeriod.periodStart.toDateString()}`
                    : `the period ending ${finalPeriod.periodStart.toDateString()}`;
                const body = `Your ${sub.plan?.name ?? 'subscription'} fee of ৳${formattedAmount} for ${sub.tenant.name} has been posted for ${periodLabel}.`;

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
                        finalPeriod.periodStart,
                    );
                }

                this.logger.log(
                    `Posted ${postedCount} subscription fee(s) for tenant ${sub.tenant_id} (৳${formattedAmount} each); period now ends ${finalPeriod.periodEnd.toISOString()}`,
                );
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
