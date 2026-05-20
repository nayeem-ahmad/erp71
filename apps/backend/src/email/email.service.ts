import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
    private readonly logger = new Logger(EmailService.name);
    private readonly resend: Resend | null;
    private readonly from: string;
    private readonly frontendUrl: string;

    constructor() {
        const apiKey = process.env.RESEND_API_KEY;
        this.resend = apiKey ? new Resend(apiKey) : null;
        this.from = process.env.EMAIL_FROM || 'noreply@yourdomain.com';
        this.frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

        if (!apiKey) {
            this.logger.warn('RESEND_API_KEY not set — emails will be logged only');
        }
    }

    async sendWelcome(to: string, name: string): Promise<void> {
        await this.send({
            to,
            subject: 'Welcome to RetailSaaS',
            html: `<h2>Welcome, ${name || to}!</h2>
<p>Your account is ready. <a href="${this.frontendUrl}/login">Sign in</a> to get started.</p>`,
        });
    }

    async sendPasswordReset(to: string, token: string): Promise<void> {
        const link = `${this.frontendUrl}/reset-password?token=${token}`;
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
        const link = `${this.frontendUrl}/accept-invitation?token=${token}`;
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
        await this.send({
            to,
            subject: `Your RetailSaaS subscription expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
            html: `<h2>Subscription Expiry Notice</h2>
<p>Your subscription for <strong>${tenantName}</strong> expires on <strong>${expiresAt.toDateString()}</strong> (${daysLeft} day${daysLeft === 1 ? '' : 's'} remaining).</p>
<p><a href="${this.frontendUrl}/dashboard/billing">Renew Now</a></p>`,
        });
    }

    async sendLowStockAlert(to: string, tenantName: string, items: Array<{ name: string; sku: string; quantity: number; reorderPoint: number }>): Promise<void> {
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
<p><a href="${this.frontendUrl}/dashboard/inventory">View Inventory</a></p>`,
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
        await this.send({
            to,
            subject: `Payment failed for ${tenantName}`,
            html: `<h2>Payment Failed</h2>
<p>We were unable to process a payment of <strong>${currency} ${amount.toFixed(2)}</strong> for <strong>${tenantName}</strong>.</p>
<p>Please <a href="${this.frontendUrl}/dashboard/billing">update your payment method</a> to avoid service interruption.</p>`,
        });
    }

    private async send(opts: { to: string; subject: string; html: string }): Promise<void> {
        if (!this.resend) {
            this.logger.log(`[EMAIL] To: ${opts.to} | Subject: ${opts.subject}`);
            return;
        }
        try {
            await this.resend.emails.send({ from: this.from, ...opts });
        } catch (err) {
            this.logger.error(`Failed to send email to ${opts.to}: ${err}`);
        }
    }
}
