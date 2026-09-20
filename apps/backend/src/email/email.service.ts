import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { CircuitBreakerRegistry } from '../system-health/resilience/circuit-breaker.registry';
import { TenantMessagingIdentityService } from '../tenant-messaging/tenant-messaging-identity.service';
import { formatEmailAddress, parseEmailAddress } from './address.util';
import { formatZonedDate } from '../common/tenant-time.util';
import { getPlatformAdminEmails } from '../auth/platform-admin.util';
import {
    renderRefereeInviteEmail,
    resolveEmailLocale,
    type EmailLocale,
} from './templates/referee-invite';

interface TransportConfig {
    from: string;
    fromEmail: string;
    fromName: string | null;
    replyTo: string | null;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export interface SendEmailOptions {
    throwOnError?: boolean;
    /**
     * Sends under this tenant's own sender identity when a platform admin has
     * configured and enabled one. Omit for platform mail (password resets,
     * billing, verification) — those must stay on the platform address.
     */
    tenantId?: string | null;
}

@Injectable()
export class EmailService {
    private readonly logger = new Logger(EmailService.name);

    constructor(
        private readonly platformSettings: PlatformSettingsService,
        private readonly breakers: CircuitBreakerRegistry,
        private readonly tenantIdentity: TenantMessagingIdentityService,
    ) {}

    /** Prefer an explicit DB value; otherwise fall back to env, then schema default. */
    private pickEmailSetting(
        raw: Record<string, string | null>,
        key: string,
        envValue: string | undefined,
        fallback: string | null,
    ): string | null {
        if (Object.prototype.hasOwnProperty.call(raw, key)) {
            const value = raw[key];
            if (value != null && value !== '') {
                return value;
            }
        }
        return envValue ?? fallback;
    }

    private resolveBrevoApiKey(smtpPass: string | null): string | null {
        const explicit = process.env.BREVO_API_KEY?.trim();
        if (explicit) return explicit;
        if (smtpPass?.startsWith('xkeysib-')) return smtpPass;
        return null;
    }

    private async getTransportConfig(tenantId?: string | null) {
        const rawEmail = await this.platformSettings.getRawGroup('email');

        const host = this.pickEmailSetting(rawEmail, 'smtp_host', process.env.SMTP_HOST, 'smtp-relay.brevo.com');
        const portRaw = this.pickEmailSetting(rawEmail, 'smtp_port', process.env.SMTP_PORT, '587');
        const user = this.pickEmailSetting(rawEmail, 'smtp_user', process.env.SMTP_USER, null);
        const pass = this.pickEmailSetting(rawEmail, 'smtp_pass', process.env.SMTP_PASS, null);
        const from = this.pickEmailSetting(rawEmail, 'email_from', process.env.EMAIL_FROM, 'notify@erp71.com');
        const frontendUrl = this.pickEmailSetting(
            rawEmail,
            'frontend_url',
            process.env.FRONTEND_URL,
            'http://localhost:3000',
        );

        // The platform address is the default for every workspace; only a tenant
        // a platform admin has explicitly onboarded overrides it.
        const platformSender = parseEmailAddress(from!);
        const identity = await this.tenantIdentity.resolveEmailIdentity(tenantId);
        const sender = identity
            ? { email: identity.from, name: identity.fromName }
            : platformSender;

        return {
            host: host!,
            port: parseInt(portRaw ?? '587', 10),
            user,
            pass,
            /** Header-ready value, e.g. `Shop Name <hello@shop.com>`. */
            from: formatEmailAddress(sender.email, sender.name),
            /** Bare address, for providers that take the name separately. */
            fromEmail: sender.email,
            fromName: sender.name,
            replyTo: identity?.replyTo ?? null,
            frontendUrl: frontendUrl!,
        };
    }

    /**
     * The public base URL links are built against. Exposed because SMS needs the
     * same value the emails use, and it is resolved from platform settings with an
     * env fallback rather than being readable from `process.env` alone.
     */
    async getFrontendUrl(): Promise<string> {
        const { frontendUrl } = await this.getTransportConfig();
        return frontendUrl;
    }

    async sendWelcome(to: string, name: string): Promise<void> {
        const { frontendUrl } = await this.getTransportConfig();
        await this.send({
            to,
            subject: 'Welcome to ERP71',
            html: `<h2>Welcome, ${name || to}!</h2>
<p>Your account is ready. <a href="${frontendUrl}/login">Sign in</a> to get started.</p>`,
        });
    }

    async sendEmailVerification(to: string, token: string, options?: { throwOnError?: boolean }): Promise<void> {
        const { frontendUrl } = await this.getTransportConfig();
        const link = `${frontendUrl}/verify-email?token=${token}`;
        await this.send({
            to,
            subject: 'Verify your email address',
            html: `<h2>Verify Your Email</h2>
<p>Click the link below to verify your email address. This link expires in 24 hours.</p>
<p><a href="${link}">Verify Email</a></p>
<p>If you did not create an account, you can ignore this email.</p>`,
        }, options);
    }

    async sendPasswordReset(to: string, token: string): Promise<void> {
        const { frontendUrl } = await this.getTransportConfig();
        const link = `${frontendUrl}/reset-password?token=${token}`;
        await this.send({
            to,
            subject: 'Reset your password',
            html: `<h2>Password Reset</h2>
<p>Click the link below to reset your password. This link expires in 1 hour.</p>
<p><a href="${link}">Reset Password</a></p>
<p>If you did not request this, you can ignore this email.</p>`,
        });
    }

    /**
     * The partner's invite, in their own language.
     *
     * `expiryHours` is passed rather than hard-coded so the sentence in the email
     * cannot drift from the TTL the token was actually issued with — the previous
     * copy said "expires in 1 hour" because that was true of the reset tokens it
     * borrowed, and it stayed true only by accident.
     */
    async sendRefereeLoginInvite(
        to: string,
        name: string,
        token: string,
        referralCode: string,
        options: { locale?: string | null; expiryHours: number },
    ): Promise<void> {
        const { frontendUrl } = await this.getTransportConfig();
        const locale: EmailLocale = resolveEmailLocale(options.locale);
        const { subject, html } = renderRefereeInviteEmail(locale, {
            name: name?.trim() ? name.trim() : to,
            referralCode,
            setupLink: `${frontendUrl}/reset-password?token=${token}`,
            loginLink: `${frontendUrl}/login`,
            signupLink: `${frontendUrl}/r/${encodeURIComponent(referralCode)}`,
            expiryHours: options.expiryHours,
        });
        await this.send({ to, subject, html });
    }

    /** A partner asked to be paid; tell them it landed and what happens next. */
    async sendRefereePayoutRequested(
        to: string,
        name: string,
        amount: number,
    ): Promise<void> {
        const { frontendUrl } = await this.getTransportConfig();
        const portalLink = `${frontendUrl}/referrals/payouts`;
        const greeting = name?.trim() ? name.trim() : to;
        await this.send({
            to,
            subject: 'We have received your ERP71 payout request',
            html: `<h2>Payout request received</h2>
<p>Hi ${greeting},</p>
<p>Your request for <strong>BDT ${amount.toFixed(2)}</strong> has been received and is awaiting review.</p>
<p>You will get another email when it is approved and paid. Your balance stays as it is until the payment is actually recorded.</p>
<p><a href="${portalLink}">View your payout requests</a></p>`,
        });
    }

    /** The request cleared review. The money has not moved yet — say so plainly. */
    async sendRefereePayoutApproved(
        to: string,
        name: string,
        amount: number,
    ): Promise<void> {
        const { frontendUrl } = await this.getTransportConfig();
        const portalLink = `${frontendUrl}/referrals/payouts`;
        const greeting = name?.trim() ? name.trim() : to;
        await this.send({
            to,
            subject: 'Your ERP71 payout request has been approved',
            html: `<h2>Payout approved</h2>
<p>Hi ${greeting},</p>
<p>Your request for <strong>BDT ${amount.toFixed(2)}</strong> has been approved and is being sent to the account on file.</p>
<p>You will get a final confirmation once the payment is recorded against your commissions.</p>
<p><a href="${portalLink}">View your payout requests</a></p>`,
        });
    }

    /** Declined. The reason is the whole point of the email. */
    async sendRefereePayoutRejected(
        to: string,
        name: string,
        amount: number,
        reason?: string | null,
    ): Promise<void> {
        const { frontendUrl } = await this.getTransportConfig();
        const portalLink = `${frontendUrl}/referrals/payouts`;
        const greeting = name?.trim() ? name.trim() : to;
        const why = reason?.trim()
            ? `<p><strong>Reason:</strong> ${escapeHtml(reason.trim())}</p>`
            : '';
        await this.send({
            to,
            subject: 'Your ERP71 payout request was not approved',
            html: `<h2>Payout request declined</h2>
<p>Hi ${greeting},</p>
<p>Your request for <strong>BDT ${amount.toFixed(2)}</strong> was not approved.</p>
${why}
<p>Your commission balance is unchanged — nothing has been deducted. You can raise a new request once the issue above is resolved.</p>
<p><a href="${portalLink}">View your payout requests</a></p>`,
        });
    }

    /** A referred business paid, so the partner has earned a commission. */
    async sendRefereeCommissionEarned(
        to: string,
        name: string,
        tenantName: string,
        amount: number,
    ): Promise<void> {
        const { frontendUrl } = await this.getTransportConfig();
        const portalLink = `${frontendUrl}/referrals`;
        const greeting = name?.trim() ? name.trim() : to;
        await this.send({
            to,
            subject: 'You have earned a new ERP71 referral commission',
            html: `<h2>You have earned a commission</h2>
<p>Hi ${greeting},</p>
<p><strong>${tenantName}</strong> has started a paid ERP71 subscription through your referral.</p>
<p><strong>Commission earned:</strong> BDT ${amount.toFixed(2)}</p>
<p>This is now showing as earned on your ledger and will be included in your next payout.</p>
<p><a href="${portalLink}">View your referral ledger</a></p>`,
        });
    }

    /** A payout has been recorded against the partner's earned commissions. */
    async sendRefereePaymentRecorded(
        to: string,
        name: string,
        amount: number,
        method?: string | null,
        reference?: string | null,
    ): Promise<void> {
        const { frontendUrl } = await this.getTransportConfig();
        const portalLink = `${frontendUrl}/referrals`;
        const greeting = name?.trim() ? name.trim() : to;
        const details = [
            method ? `<p><strong>Method:</strong> ${method}</p>` : '',
            reference ? `<p><strong>Reference:</strong> ${reference}</p>` : '',
        ].join('');
        await this.send({
            to,
            subject: 'An ERP71 referral payment has been recorded',
            html: `<h2>Payment recorded</h2>
<p>Hi ${greeting},</p>
<p>A payment of <strong>BDT ${amount.toFixed(2)}</strong> has been recorded against your referral commissions.</p>
${details}
<p>If you have not received this payment, reply to this email and we will look into it.</p>
<p><a href="${portalLink}">View your referral ledger</a></p>`,
        });
    }

    async sendInvitation(to: string, tenantName: string, inviterName: string, token: string): Promise<void> {
        const { frontendUrl } = await this.getTransportConfig();
        const link = `${frontendUrl}/accept-invitation?token=${token}`;
        await this.send({
            to,
            subject: `You've been invited to join ${tenantName} on ERP71`,
            html: `<h2>You're invited!</h2>
<p><strong>${inviterName}</strong> has invited you to join <strong>${tenantName}</strong> on ERP71.</p>
<p><a href="${link}">Accept Invitation</a></p>
<p>This invitation expires in 7 days.</p>`,
        });
    }

    async sendSubscriptionExpiryWarning(to: string, tenantName: string, daysLeft: number, expiresAt: Date): Promise<void> {
        const { frontendUrl } = await this.getTransportConfig();
        await this.send({
            to,
            subject: `Your ERP71 subscription expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
            html: `<h2>Subscription Expiry Notice</h2>
<p>Your subscription for <strong>${tenantName}</strong> expires on <strong>${formatZonedDate(expiresAt)}</strong> (${daysLeft} day${daysLeft === 1 ? '' : 's'} remaining).</p>
<p><a href="${frontendUrl}/dashboard/billing">Renew Now</a></p>`,
        });
    }

    async sendLowStockAlert(to: string, tenantName: string, items: Array<{ name: string; sku: string; quantity: number; reorderPoint: number }>): Promise<void> {
        const { frontendUrl } = await this.getTransportConfig();
        const rows = items
            .map((i) => `<tr><td>${i.name}</td><td>${i.sku}</td><td>${i.quantity}</td><td>${i.reorderPoint}</td></tr>`)
            .join('');
        await this.send({
            to,
            subject: `Low stock alert for ${tenantName}`,
            html: `<h2>Low Stock Alert</h2>
<p>The following products in <strong>${tenantName}</strong> are at or below their reorder point:</p>
<table border="1" cellpadding="6" style="border-collapse:collapse">
  <thead><tr><th>Product</th><th>SKU</th><th>Qty</th><th>Reorder Point</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<p><a href="${frontendUrl}/dashboard/inventory">View Inventory</a></p>`,
        });
    }

    async sendBillingInvoice(to: string, tenantName: string, amount: number, currency: string, invoiceUrl?: string): Promise<void> {
        await this.send({
            to,
            subject: `Invoice for ${tenantName} — ERP71`,
            html: `<h2>Invoice</h2>
<p>A payment of <strong>${currency} ${amount.toFixed(2)}</strong> has been processed for <strong>${tenantName}</strong>.</p>
${invoiceUrl ? `<p><a href="${invoiceUrl}">View Invoice</a></p>` : ''}`,
        });
    }

    async sendPaymentFailure(to: string, tenantName: string, amount: number, currency: string): Promise<void> {
        const { frontendUrl } = await this.getTransportConfig();
        await this.send({
            to,
            subject: `Payment failed for ${tenantName}`,
            html: `<h2>Payment Failed</h2>
<p>We were unable to process a payment of <strong>${currency} ${amount.toFixed(2)}</strong> for <strong>${tenantName}</strong>.</p>
<p>Please <a href="${frontendUrl}/dashboard/billing">update your payment method</a> to avoid service interruption.</p>`,
        });
    }

    /**
     * The recurring overdue knock. `daysUntilSuspension` counts down to the
     * workspace freeze, so the same template sharpens as the deadline nears
     * rather than repeating one fixed warning.
     */
    async sendPaymentRetryReminder(to: string, tenantName: string, amount: number, currency: string, daysUntilSuspension: number): Promise<void> {
        const { frontendUrl } = await this.getTransportConfig();
        const consequence = daysUntilSuspension > 0
            ? `<p>Please <a href="${frontendUrl}/billing">settle the balance</a> within <strong>${daysUntilSuspension} day${daysUntilSuspension === 1 ? '' : 's'}</strong>. After that the workspace is suspended — your data stays safe and readable, but new entries cannot be added until payment is received.</p>`
            : `<p><strong>This workspace is now suspended.</strong> Your data is safe and readable, but new entries cannot be added until the balance is settled. <a href="${frontendUrl}/billing">Settle the balance</a> to restore full access immediately.</p>`;

        await this.send({
            to,
            subject: daysUntilSuspension > 0
                ? `Payment overdue for ${escapeHtml(tenantName)} — ${daysUntilSuspension} day${daysUntilSuspension === 1 ? '' : 's'} to settle`
                : `${escapeHtml(tenantName)} is suspended — payment required`,
            html: `<h2>Payment Overdue</h2>
<p>Your outstanding balance of <strong>${currency} ${amount.toFixed(2)}</strong> for <strong>${escapeHtml(tenantName)}</strong> has not yet been received.</p>
${consequence}`,
        });
    }

    /**
     * Sent once, when the workspace is actually frozen for non-payment. The
     * reminder above warns; this one confirms it has happened and says plainly
     * that the data is intact.
     */
    async sendWorkspaceSuspended(
        to: string,
        tenantName: string,
        amount: number,
        currency: string,
        suspensionDays: number,
    ): Promise<void> {
        const { frontendUrl } = await this.getTransportConfig();
        await this.send({
            to,
            subject: `${escapeHtml(tenantName)} has been suspended`,
            html: `<h2>Workspace Suspended</h2>
<p><strong>${escapeHtml(tenantName)}</strong> has been suspended after ${suspensionDays} days with an unpaid balance of <strong>${currency} ${amount.toFixed(2)}</strong>.</p>
<p><strong>Your data has not been deleted.</strong> Everyone on the workspace can still sign in, view records and export reports — but sales, purchases, vouchers and other new entries are blocked until the balance is settled.</p>
<p><a href="${frontendUrl}/billing">Settle the balance</a> to restore full access. Access returns as soon as the payment is recorded.</p>`,
        });
    }

    /**
     * The positive half of the reminder cycle — sent to a tenant who owes nothing,
     * in place of a payment reminder. Deliberately carries no amount and no
     * "pay now" call to action.
     */
    async sendSubscriptionGoodStanding(to: string, tenantName: string, planName: string, renewsAt: Date): Promise<void> {
        const { frontendUrl } = await this.getTransportConfig();
        await this.send({
            to,
            subject: `${tenantName} is all set — nothing due`,
            html: `<h2>You're all paid up</h2>
<p>Thank you for staying with ERP71. There is nothing outstanding on <strong>${escapeHtml(tenantName)}</strong> — your <strong>${escapeHtml(planName)}</strong> plan is active and renews on <strong>${formatZonedDate(renewsAt)}</strong>.</p>
<p>Nothing to do here. If it helps, here are a few places to get more out of your workspace:</p>
<ul>
  <li><a href="${frontendUrl}/dashboard">Today's sales and stock at a glance</a></li>
  <li><a href="${frontendUrl}/sales/reports">Sales reports — see how the month is tracking</a></li>
  <li><a href="${frontendUrl}/billing">Your plan and billing history</a></li>
</ul>
<p>Questions or ideas? Just reply to this email — we read every one.</p>`,
        });
    }

    async sendSubscriptionFeePosted(
        to: string,
        tenantName: string,
        amount: number,
        currency: string,
        periodEnd: Date,
    ): Promise<void> {
        const { frontendUrl } = await this.getTransportConfig();
        await this.send({
            to,
            subject: `Subscription fee posted for ${tenantName}`,
            html: `<h2>Subscription Fee</h2>
<p>Your subscription fee of <strong>${currency} ${amount.toFixed(2)}</strong> for <strong>${tenantName}</strong> has been posted to your account for the period ending <strong>${formatZonedDate(periodEnd)}</strong>.</p>
<p><a href="${frontendUrl}/billing">View billing &amp; ledger</a></p>`,
        });
    }

    async sendSubscriptionCancelled(to: string, tenantName: string, graceDays: number): Promise<void> {
        const { frontendUrl } = await this.getTransportConfig();
        await this.send({
            to,
            subject: `Your ${tenantName} subscription has been cancelled`,
            html: `<h2>Subscription Cancelled</h2>
<p>Your subscription for <strong>${tenantName}</strong> has been cancelled after ${graceDays} days without a successful payment.</p>
<p>Your account has been downgraded to the Free plan. To restore access to premium features, <a href="${frontendUrl}/dashboard/billing">update your payment method and resubscribe</a>.</p>`,
        });
    }

    async sendContactForm(from: string, name: string, subject: string, message: string): Promise<void> {
        const supportEmail = await this.platformSettings.getRawValue('general', 'support_email')
            ?? process.env.SUPPORT_EMAIL
            ?? 'support@erp71.com';
        this.send({
            to: supportEmail,
            subject: `[Contact] ${subject}`,
            html: `<h2>New Contact Form Submission</h2>
<p><strong>Name:</strong> ${name}</p>
<p><strong>Email:</strong> ${from}</p>
<p><strong>Subject:</strong> ${subject}</p>
<p><strong>Message:</strong></p>
<blockquote>${message.replace(/\n/g, '<br>')}</blockquote>`,
        }).catch((err) => this.logger.error(`Failed to send contact form email: ${err}`));
    }

    async sendFeedbackNotification(to: string, id: string, type: string, message: string, page?: string): Promise<void> {
        const typeLabel = type === 'bug' ? 'Bug' : type === 'feature' ? 'Feature Request' : 'General';
        await this.send({
            to,
            subject: `[Feedback] ${typeLabel}`,
            html: `<h2>New Feedback Submitted</h2>
<p><strong>ID:</strong> ${id}</p>
<p><strong>Type:</strong> ${typeLabel}</p>
${page ? `<p><strong>Page:</strong> ${page}</p>` : ''}
<p><strong>Message:</strong></p>
<blockquote>${message.replace(/\n/g, '<br>')}</blockquote>`,
        });
    }

    // ── Manual activation ──────────────────────────────────────────────────────
    //
    // The window before a payment gateway is live: a workspace is provisioned
    // unpaid, the owner sends money by bKash/Nagad, and the team verifies it by
    // hand. These four mails are the whole conversation, so between them they
    // have to answer "what happens now?" at every step — a customer who has paid
    // and heard nothing will phone instead, which is the cost this avoids.

    /**
     * Sent at signup, in place of the bare welcome, when the workspace still
     * needs activating. Names the turnaround so the wait has an edge to it.
     */
    async sendActivationPending(
        to: string,
        options: { name: string; tenantName: string; slaHours: number; supportPhone?: string | null },
    ): Promise<void> {
        const { frontendUrl } = await this.getTransportConfig();
        const phoneLine = options.supportPhone
            ? `<p>In a hurry? Call us on <strong>${escapeHtml(options.supportPhone)}</strong>.</p>`
            : '';

        await this.send({
            to,
            subject: `Activating ${options.tenantName} on ERP71`,
            html: `<h2>Welcome, ${escapeHtml(options.name || to)}!</h2>
<p>Your workspace <strong>${escapeHtml(options.tenantName)}</strong> has been created and you can sign in now to set it up — add your store details, products and staff.</p>
<p>Before the full workspace unlocks, we need to activate your subscription. You can pay right away and we will switch everything on within <strong>${options.slaHours} hours</strong>:</p>
<p><a href="${frontendUrl}/billing">Activate your workspace</a></p>
${phoneLine}
<p>Our team will also reach out to help you get started.</p>`,
        });
    }

    /** Confirms a submitted bKash/Nagad payment is queued for verification. */
    async sendActivationPaymentReceived(
        to: string,
        options: { tenantName: string; transactionId: string; amount: number; slaHours: number },
    ): Promise<void> {
        await this.send({
            to,
            subject: `We received your payment details for ${options.tenantName}`,
            html: `<h2>Thank you — we are checking your payment</h2>
<p>We have your transaction <strong>${escapeHtml(options.transactionId)}</strong> for <strong>৳${options.amount.toFixed(2)}</strong>.</p>
<p>Our team verifies payments by hand and will activate <strong>${escapeHtml(options.tenantName)}</strong> within <strong>${options.slaHours} hours</strong>. You will get an email the moment it is live.</p>
<p>You can keep setting up your workspace in the meantime.</p>`,
        });
    }

    /** The good news: the workspace is on. */
    async sendWorkspaceActivated(to: string, tenantName: string): Promise<void> {
        const { frontendUrl } = await this.getTransportConfig();
        await this.send({
            to,
            subject: `${tenantName} is now active on ERP71`,
            html: `<h2>Your workspace is live</h2>
<p>We have confirmed your payment and activated <strong>${escapeHtml(tenantName)}</strong>. Every feature on your plan is now unlocked.</p>
<p><a href="${frontendUrl}/dashboard">Open your workspace</a></p>
<p>Thank you for choosing ERP71.</p>`,
        });
    }

    /**
     * A payment we could not find. Carries the admin's reason verbatim, because
     * "rejected" with no reason sends the customer back to the same form with
     * nothing to change.
     */
    async sendActivationRequestRejected(to: string, tenantName: string, reason: string): Promise<void> {
        const { frontendUrl } = await this.getTransportConfig();
        const reasonBlock = reason.trim()
            ? `<p><strong>Why:</strong> ${escapeHtml(reason.trim())}</p>`
            : '';

        await this.send({
            to,
            subject: `We could not verify your payment for ${tenantName}`,
            html: `<h2>We could not confirm that payment</h2>
<p>We checked the transaction you sent for <strong>${escapeHtml(tenantName)}</strong> and could not match it to a payment we received.</p>
${reasonBlock}
<p>Please check the transaction ID and <a href="${frontendUrl}/billing">submit it again</a>, or reply to this email and we will sort it out with you.</p>`,
        });
    }

    /**
     * Tells the platform team a workspace signed up. Without this the promise
     * that "our team will activate your account" is one nothing keeps: there is
     * no other trigger, and a dashboard someone remembers to check is not one.
     */
    async sendNewSignupAlert(options: {
        tenantName: string;
        ownerName: string;
        ownerEmail: string;
        ownerMobile?: string | null;
        planName: string;
        billingCycle: string;
        referralCode?: string | null;
    }): Promise<void> {
        const recipients = getPlatformAdminEmails();
        if (recipients.length === 0) return;

        const { frontendUrl } = await this.getTransportConfig();
        const row = (label: string, value: string) =>
            `<tr><td style="padding:4px 12px 4px 0"><strong>${label}</strong></td><td style="padding:4px 0">${escapeHtml(value)}</td></tr>`;

        await this.sendSystemAlert(
            recipients,
            `New signup: ${options.tenantName} (${options.planName})`,
            `<h2>A new workspace needs activating</h2>
<table>
${row('Business', options.tenantName)}
${row('Contact', options.ownerName || options.ownerEmail)}
${row('Email', options.ownerEmail)}
${row('Mobile', options.ownerMobile || '—')}
${row('Plan', `${options.planName} (${options.billingCycle})`)}
${options.referralCode ? row('Referral', options.referralCode) : ''}
</table>
<p><a href="${frontendUrl}/admin/tenants">Open Admin › Tenants</a></p>`,
        );
    }

    /** Tells the platform team a tenant has submitted a payment to verify. */
    async sendActivationRequestAlert(options: {
        tenantName: string;
        method: string;
        transactionId: string;
        senderNumber?: string | null;
        amount: number;
        reviewUrl?: string | null;
    }): Promise<void> {
        const recipients = getPlatformAdminEmails();
        if (recipients.length === 0) return;

        const link = options.reviewUrl
            ? `<p><a href="${options.reviewUrl}">Review activation requests</a></p>`
            : '';

        await this.sendSystemAlert(
            recipients,
            `Payment to verify: ${options.tenantName} — ৳${options.amount.toFixed(2)}`,
            `<h2>A workspace has submitted a payment</h2>
<p><strong>${escapeHtml(options.tenantName)}</strong> says they sent <strong>৳${options.amount.toFixed(2)}</strong> by <strong>${escapeHtml(options.method)}</strong>.</p>
<p>Transaction ID: <strong>${escapeHtml(options.transactionId)}</strong><br>
From: ${escapeHtml(options.senderNumber || '—')}</p>
<p>Check it against the merchant app before approving — approving posts the payment and activates the workspace.</p>
${link}`,
        );
    }

    /**
     * Sends a platform-operational alert (e.g. system-health degradation) to
     * one or more recipients. Public wrapper around the internal transport.
     */
    async sendSystemAlert(to: string | string[], subject: string, html: string): Promise<void> {
        const recipients = Array.isArray(to) ? to : [to];
        await Promise.all(recipients.map((addr) => this.send({ to: addr, subject, html })));
    }

    /** Sends an arbitrary subject/body email, e.g. a CRM campaign blast. Surfaces send failures to the caller. */
    async sendCustom(
        to: string,
        subject: string,
        html: string,
        options?: { tenantId?: string | null },
    ): Promise<void> {
        await this.send({ to, subject, html }, { throwOnError: true, tenantId: options?.tenantId });
    }

    /** Sends a test message and surfaces SMTP errors to the caller (admin UI). */
    async sendTestEmail(to: string, options?: { tenantId?: string | null }): Promise<void> {
        const { from } = await this.getTransportConfig(options?.tenantId);
        await this.send(
            {
                to,
                subject: 'ERP71 test email',
                html: `<p>If you received this, outbound email is configured correctly for <strong>${escapeHtml(from)}</strong>.</p>`,
            },
            { throwOnError: true, tenantId: options?.tenantId },
        );
    }

    private async sendViaResend(
        config: TransportConfig,
        opts: { to: string; subject: string; html: string },
    ): Promise<void> {
        const apiKey = process.env.RESEND_API_KEY?.trim();
        if (!apiKey) {
            throw new Error('RESEND_API_KEY is not set');
        }

        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                from: config.from,
                to: [opts.to],
                ...(config.replyTo ? { reply_to: config.replyTo } : {}),
                subject: opts.subject,
                html: opts.html,
            }),
        });

        if (!response.ok) {
            const detail = await response.text();
            throw new Error(`Resend API ${response.status}: ${detail}`);
        }
    }

    private async sendViaBrevoApi(
        config: TransportConfig,
        opts: { to: string; subject: string; html: string },
        apiKey: string,
    ): Promise<void> {
        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'api-key': apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                sender: { email: config.fromEmail, name: config.fromName ?? 'ERP71' },
                to: [{ email: opts.to }],
                ...(config.replyTo ? { replyTo: { email: config.replyTo } } : {}),
                subject: opts.subject,
                htmlContent: opts.html,
            }),
        });

        if (!response.ok) {
            const detail = await response.text();
            throw new Error(`Brevo API ${response.status}: ${detail}`);
        }
    }

    private async send(
        opts: { to: string; subject: string; html: string },
        options?: SendEmailOptions,
    ): Promise<void> {
        const config = await this.getTransportConfig(options?.tenantId);
        const resendKey = process.env.RESEND_API_KEY?.trim();
        const brevoKey = this.resolveBrevoApiKey(config.pass);
        const hasSmtpCredentials = Boolean(config.user && config.pass && !brevoKey);

        if (!resendKey && !brevoKey && !hasSmtpCredentials) {
            const msg = 'Email is not configured — set RESEND_API_KEY, BREVO_API_KEY, or SMTP_USER and SMTP_PASS.';
            if (options?.throwOnError) {
                throw new Error(msg);
            }
            this.logger.log(`[EMAIL] To: ${opts.to} | Subject: ${opts.subject}`);
            return;
        }

        try {
            if (resendKey) {
                await this.breakers
                    .get('email-resend', { timeoutMs: 20_000 })
                    .execute(() => this.sendViaResend(config, opts));
                return;
            }

            if (brevoKey) {
                await this.breakers
                    .get('email-brevo-api', { timeoutMs: 20_000 })
                    .execute(() => this.sendViaBrevoApi(config, opts, brevoKey));
                return;
            }

            const transporter = nodemailer.createTransport({
                host: config.host,
                port: config.port,
                secure: false,
                auth: { user: config.user!, pass: config.pass! },
                connectionTimeout: 10_000,
                greetingTimeout: 10_000,
                socketTimeout: 30_000,
            });
            await this.breakers
                .get('email-smtp', { timeoutMs: 35_000 })
                .execute(() =>
                    transporter.sendMail({
                        from: config.from,
                        ...(config.replyTo ? { replyTo: config.replyTo } : {}),
                        ...opts,
                    }),
                );
        } catch (err) {
            this.logger.error(`Failed to send email to ${opts.to}: ${err}`);
            if (options?.throwOnError) {
                const detail = err instanceof Error ? err.message : String(err);
                throw new Error(detail);
            }
        }
    }
}
