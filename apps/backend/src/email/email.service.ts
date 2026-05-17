import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
    private readonly resend: Resend | null;
    private readonly from: string;
    private readonly logger = new Logger(EmailService.name);

    constructor() {
        const apiKey = process.env.RESEND_API_KEY;
        this.from = process.env.EMAIL_FROM ?? 'noreply@example.com';
        this.resend = apiKey ? new Resend(apiKey) : null;

        if (!this.resend) {
            this.logger.warn('RESEND_API_KEY not set — emails will be logged only');
        }
    }

    async sendWelcome(to: string, name: string) {
        await this.send({
            to,
            subject: 'Welcome to Retail SaaS',
            html: `<p>Hi ${name},</p><p>Your account is ready. Start managing your store today.</p>`,
        });
    }

    async sendPasswordReset(to: string, resetUrl: string) {
        await this.send({
            to,
            subject: 'Reset your password',
            html: `<p>Click the link below to reset your password. It expires in 1 hour.</p>
<p><a href="${resetUrl}">Reset password</a></p>
<p>If you didn't request this, ignore this email.</p>`,
        });
    }

    async sendSubscriptionExpiry(to: string, tenantName: string, daysLeft: number) {
        await this.send({
            to,
            subject: `Your subscription expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
            html: `<p>Hi,</p><p>The subscription for <strong>${tenantName}</strong> expires in <strong>${daysLeft} day${daysLeft === 1 ? '' : 's'}</strong>.</p><p>Renew now to avoid service interruption.</p>`,
        });
    }

    async sendLowStockAlert(to: string, items: Array<{ name: string; quantity: number }>) {
        const rows = items.map((i) => `<li>${i.name} — ${i.quantity} remaining</li>`).join('');
        await this.send({
            to,
            subject: `Low stock alert: ${items.length} product${items.length === 1 ? '' : 's'}`,
            html: `<p>The following products are at or below their reorder level:</p><ul>${rows}</ul>`,
        });
    }

    async sendInvoice(to: string, invoiceNumber: string, totalAmount: string, period: string) {
        await this.send({
            to,
            subject: `Invoice ${invoiceNumber}`,
            html: `<p>Your invoice <strong>${invoiceNumber}</strong> for <strong>${totalAmount}</strong> covering ${period} is ready.</p>`,
        });
    }

    async sendUserInvitation(to: string, tenantName: string, inviteUrl: string) {
        await this.send({
            to,
            subject: `You've been invited to ${tenantName}`,
            html: `<p>You have been invited to join <strong>${tenantName}</strong> on Retail SaaS.</p>
<p><a href="${inviteUrl}">Accept invitation</a></p>`,
        });
    }

    private async send(params: { to: string; subject: string; html: string }) {
        if (!this.resend) {
            this.logger.log(`[EMAIL SUPPRESSED] to=${params.to} subject="${params.subject}"`);
            return;
        }

        const { error } = await this.resend.emails.send({
            from: this.from,
            to: params.to,
            subject: params.subject,
            html: params.html,
        });

        if (error) {
            this.logger.error(`Failed to send email to ${params.to}: ${error.message}`);
        }
    }
}
