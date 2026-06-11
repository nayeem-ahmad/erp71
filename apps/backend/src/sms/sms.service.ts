import { Injectable, Logger } from '@nestjs/common';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';

@Injectable()
export class SmsService {
    private readonly logger = new Logger(SmsService.name);

    constructor(private readonly platformSettings: PlatformSettingsService) {}

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

    async sendSms(to: string | string[], message: string): Promise<void> {
        const numbers = (Array.isArray(to) ? to : [to])
            .map((n) => this.normalizePhone(n))
            .join(',');

        const { apiKey, senderId, baseUrl } = await this.getCredentials();

        if (!apiKey) {
            this.logger.log(`[SMS] To: ${numbers} | Message: ${message}`);
            return;
        }

        try {
            const params = new URLSearchParams({
                api_key: apiKey,
                type: 'text',
                number: numbers,
                senderid: senderId,
                message,
            });

            const response = await fetch(`${baseUrl}?${params.toString()}`);

            if (!response.ok) {
                const body = await response.text().catch(() => '');
                this.logger.error(`SMS API returned ${response.status} for ${numbers}: ${body}`);
                return;
            }

            const result = await response.text().catch(() => '');
            this.logger.debug(`SMS sent to ${numbers}: ${result}`);
        } catch (err) {
            this.logger.error(`Failed to send SMS to ${numbers}: ${err}`);
        }
    }

    async sendSaleReceipt(
        phone: string,
        customerName: string,
        saleTotal: number,
        saleRef: string,
    ): Promise<void> {
        const message =
            `Dear ${customerName}, your purchase of BDT ${saleTotal.toFixed(2)} ` +
            `(Ref: ${saleRef}) has been confirmed. Thank you!`;
        await this.sendSms(phone, message);
    }

    async sendLowStockAlert(
        phone: string,
        productName: string,
        currentStock: number,
    ): Promise<void> {
        const message = `Low stock alert: ${productName} has only ${currentStock} units remaining.`;
        await this.sendSms(phone, message);
    }

    async sendSubscriptionExpiry(
        phone: string,
        tenantName: string,
        daysLeft: number,
    ): Promise<void> {
        const message =
            `Your RetailSaaS subscription for ${tenantName} expires in ${daysLeft} day(s). ` +
            `Renew now to avoid interruption.`;
        await this.sendSms(phone, message);
    }
}
