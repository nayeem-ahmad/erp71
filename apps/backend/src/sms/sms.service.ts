import { Injectable, Logger } from '@nestjs/common';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { SmsCreditService } from './sms-credit.service';
import { CircuitBreakerRegistry } from '../system-health/resilience/circuit-breaker.registry';

export interface SendSmsOptions {
    /** When set, the send is billed against this tenant's prepaid SMS credits. */
    tenantId?: string;
    /** Short label stored on the usage ledger entry (e.g. "Sale receipt"). */
    purpose?: string;
}

export interface SendSmsResult {
    sent: boolean;
    reason?: 'INSUFFICIENT_SMS_CREDITS';
}

@Injectable()
export class SmsService {
    private readonly logger = new Logger(SmsService.name);

    constructor(
        private readonly platformSettings: PlatformSettingsService,
        private readonly smsCredits: SmsCreditService,
        private readonly breakers: CircuitBreakerRegistry,
    ) {}

    private normalizePhone(phone: string): string {
        const digits = phone.replace(/\D/g, '');
        return digits.startsWith('0') ? '880' + digits.slice(1) : digits;
    }

    private async getCredentials() {
        const [apiKey, senderId, baseUrl] = await Promise.all([
            this.platformSettings.getRawValue('sms', 'api_key'),
            this.platformSettings.getRawValue('sms', 'sender_id'),
            this.platformSettings.getRawValue('sms', 'base_url'),
        ]);
        return {
            apiKey: apiKey ?? process.env.SMS_API_KEY ?? null,
            senderId: senderId ?? process.env.SMS_SENDER_ID ?? '8809617621294',
            baseUrl: baseUrl ?? 'http://bulksmsbd.net/api/smsapi',
        };
    }

    async sendSms(
        to: string | string[],
        message: string,
        options: SendSmsOptions = {},
    ): Promise<SendSmsResult> {
        const recipients = (Array.isArray(to) ? to : [to]).map((n) => this.normalizePhone(n));
        const numbers = recipients.join(',');

        // Bill the tenant's prepaid balance before sending. If they're out of
        // credits the message is skipped so they are never charged externally.
        if (options.tenantId) {
            const credits = this.smsCredits.creditsForSend(message, recipients.length);
            const { allowed } = await this.smsCredits.consume(options.tenantId, credits, {
                recipient: numbers,
                description: options.purpose ?? 'SMS sent',
            });
            if (!allowed) {
                this.logger.warn(
                    `Skipping SMS to ${numbers} for tenant ${options.tenantId}: insufficient SMS credits.`,
                );
                return { sent: false, reason: 'INSUFFICIENT_SMS_CREDITS' };
            }
        }

        const { apiKey, senderId, baseUrl } = await this.getCredentials();

        if (!apiKey) {
            this.logger.log(`[SMS] To: ${numbers} | Message: ${message}`);
            return { sent: true };
        }

        try {
            const params = new URLSearchParams({
                api_key: apiKey,
                type: 'text',
                number: numbers,
                senderid: senderId,
                message,
            });

            const response = await this.breakers
                .get('bulksmsbd', { timeoutMs: 10_000 })
                .execute(() => fetch(`${baseUrl}?${params.toString()}`));

            if (!response.ok) {
                const body = await response.text().catch(() => '');
                this.logger.error(`SMS API returned ${response.status} for ${numbers}: ${body}`);
                return { sent: true };
            }

            const result = await response.text().catch(() => '');
            this.logger.debug(`SMS sent to ${numbers}: ${result}`);
            return { sent: true };
        } catch (err) {
            this.logger.error(`Failed to send SMS to ${numbers}: ${err}`);
            return { sent: true };
        }
    }

    async sendSaleReceipt(
        phone: string,
        customerName: string,
        saleTotal: number,
        saleRef: string,
        tenantId?: string,
    ): Promise<void> {
        const message =
            `Dear ${customerName}, your purchase of BDT ${saleTotal.toFixed(2)} ` +
            `(Ref: ${saleRef}) has been confirmed. Thank you!`;
        await this.sendSms(phone, message, { tenantId, purpose: 'Sale receipt' });
    }

    async sendLowStockAlert(
        phone: string,
        productName: string,
        currentStock: number,
        tenantId?: string,
    ): Promise<void> {
        const message = `Low stock alert: ${productName} has only ${currentStock} units remaining.`;
        await this.sendSms(phone, message, { tenantId, purpose: 'Low stock alert' });
    }

    async sendSubscriptionExpiry(
        phone: string,
        tenantName: string,
        daysLeft: number,
    ): Promise<void> {
        const message =
            `Your ERP71 subscription for ${tenantName} expires in ${daysLeft} day(s). ` +
            `Renew now to avoid interruption.`;
        await this.sendSms(phone, message);
    }
}
