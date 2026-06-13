import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { CircuitBreakerRegistry } from '../system-health/resilience/circuit-breaker.registry';

@Injectable()
export class EmailService {
    private readonly logger = new Logger(EmailService.name);

    constructor(
        private readonly platformSettings: PlatformSettingsService,
        private readonly breakers: CircuitBreakerRegistry,
    ) {}

    private async getTransportConfig() {
        const [smtpHost, smtpPort, smtpUser, smtpPass, emailFrom, frontendUrl] = await Promise.all([
            this.platformSettings.getRawValue('email', 'smtp_host'),
            this.platformSettings.getRawValue('email', 'smtp_port'),
            this.platformSettings.getRawValue('email', 'smtp_user'),
            this.platformSettings.getRawValue('email', 'smtp_pass'),
            this.platformSettings.getRawValue('email', 'email_from'),
            this.platformSettings.getRawValue('email', 'frontend_url'),
        ]);

        return {
            host: smtpHost ?? process.env.SMTP_HOST ?? 'smtp-relay.brevo.com',
            port: parseInt(smtpPort ?? process.env.SMTP_PORT ?? '587', 10),
            user: smtpUser ?? process.env.SMTP_USER ?? null,
            pass: smtpPass ?? process.env.SMTP_PASS ?? null,
            from: emailFrom ?? process.env.EMAIL_FROM ?? 'noreply@retailsaas.app',
            frontendUrl: frontendUrl ?? process.env.FRONTEND_URL ?? 'http://localhost:3000',
        };
    }

    async sendWelcome(to: string, name: string): Promise<void> {
        const { frontendUrl } = await this.getTransportConfig();
        await this.send({
            to,
            subject: 'Welcome to RetailSaaS',
            html: `<h2>Welcome, ${name || to}!</h2>
<p>Your account is ready. <a href="${frontendUrl}/login">Sign in</a> to get started.</p>`,
        });
    }

    async sendEmailVerification(to: string, token: string): Promise<void> {
        const { frontendUrl } = await this.getTransportConfig();
        const link = `${frontendUrl}/verify-email?token=${token}`;
        await this.send({
            to,
            subject: 'Verify your email address',
            html: `<h2>Verify Your Email</h2>
<p>Click the link below to verify your email address. This link expires in 24 hours.</p>
<p><a href="${link}">Verify Email</a></p>
<p>If you did not create an account, you can ignore this email.</p>`,
        });
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

    async sendInvitation(to: string, tenantName: string, inviterName: string, token: string): Promise<void> {
        const { frontendUrl } = await this.getTransportConfig();
        const link = `${frontendUrl}/accept-invitation?token=${token}`;
        await this.send({
            to,
            subject: `You've been invited to join ${tenantName} on RetailSaaS`,
            html: `<h2>You're invited!</h2>
<p><strong>${inviterName}</strong> has invited you to join <strong>${tenantName}</strong> on RetailSaaS.</p>
<p><a href="${link}">Accept Invitation</a></p>
<p>This invitation expires in 7 days.</p>`,
        });
    }

    async sendSubscriptionExpiryWarning(to: string, tenantName: string, daysLeft: number, expiresAt: Date): Promise<void> {
        const { frontendUrl } = await this.getTransportConfig();
        await this.send({
            to,
            subject: `Your RetailSaaS subscription expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
            html: `<h2>Subscription Expiry Notice</h2>
<p>Your subscription for <strong>${tenantName}</strong> expires on <strong>${expiresAt.toDateString()}</strong> (${daysLeft} day${daysLeft === 1 ? '' : 's'} remaining).</p>
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
            subject: `Invoice for ${tenantName} — RetailSaaS`,
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

    async sendPaymentRetryReminder(to: string, tenantName: string, amount: number, currency: string, graceDays: number): Promise<void> {
        const { frontendUrl } = await this.getTransportConfig();
        await this.send({
            to,
            subject: `Retry payment for ${tenantName}`,
            html: `<h2>Payment Retry Reminder</h2>
<p>Your subscription payment of <strong>${currency} ${amount.toFixed(2)}</strong> for <strong>${tenantName}</strong> is still outstanding.</p>
<p>Please <a href="${frontendUrl}/dashboard/billing">retry payment</a> within ${graceDays} days to avoid downgrade to the Free plan.</p>`,
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
            ?? 'support@retailsaas.app';
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

    /**
     * Sends a platform-operational alert (e.g. system-health degradation) to
     * one or more recipients. Public wrapper around the internal transport.
     */
    async sendSystemAlert(to: string | string[], subject: string, html: string): Promise<void> {
        const recipients = Array.isArray(to) ? to : [to];
        await Promise.all(recipients.map((addr) => this.send({ to: addr, subject, html })));
    }

    private async send(opts: { to: string; subject: string; html: string }): Promise<void> {
        const config = await this.getTransportConfig();

        if (!config.user || !config.pass) {
            this.logger.log(`[EMAIL] To: ${opts.to} | Subject: ${opts.subject}`);
            return;
        }

        try {
            const transporter = nodemailer.createTransport({
                host: config.host,
                port: config.port,
                secure: false,
                auth: { user: config.user, pass: config.pass },
                connectionTimeout: 10_000,
                greetingTimeout: 10_000,
                socketTimeout: 30_000,
            });
            await this.breakers
                .get('email-smtp', { timeoutMs: 35_000 })
                .execute(() => transporter.sendMail({ from: config.from, ...opts }));
        } catch (err) {
            this.logger.error(`Failed to send email to ${opts.to}: ${err}`);
        }
    }
}
