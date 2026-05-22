import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class SmsService {
    private readonly logger = new Logger(SmsService.name);
    private readonly apiUrl: string | null;
    private readonly apiToken: string;
    private readonly senderId: string;

    constructor() {
        this.apiUrl = process.env.SMS_API_URL ?? null;
        this.apiToken = process.env.SMS_API_TOKEN ?? '';
        this.senderId = process.env.SMS_SENDER_ID ?? '';

        if (!this.apiUrl) {
            this.logger.warn('SMS_API_URL not set — SMS messages will be logged only');
        }
    }

    /**
     * Normalize a Bangladeshi phone number to the 880XXXXXXXXXX format.
     * Strips non-digits; if the result starts with 0, replaces with 880.
     */
    private normalizePhone(phone: string): string {
        const digits = phone.replace(/\D/g, '');
        if (digits.startsWith('0')) {
            return '880' + digits.slice(1);
        }
        return digits;
    }

    /**
     * Fire-and-forget SMS send. Catches and logs errors rather than propagating them.
     */
    async sendSms(to: string, message: string): Promise<void> {
        const contact = this.normalizePhone(to);

        if (!this.apiUrl) {
            this.logger.log(`[SMS] To: ${contact} | Message: ${message}`);
            return;
        }

        try {
            const response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    api_token: this.apiToken,
                    senderid: this.senderId,
                    type: 'text',
                    contacts: contact,
                    msg: message,
                }),
            });

            if (!response.ok) {
                const body = await response.text().catch(() => '');
                this.logger.error(
                    `SMS API returned ${response.status} for ${contact}: ${body}`,
                );
            }
        } catch (err) {
            this.logger.error(`Failed to send SMS to ${contact}: ${err}`);
        }
    }

    async sendSaleReceipt(
        phone: string,
        customerName: string,
        saleTotal: number,
        saleRef: string,
    ): Promise<void> {
        const message =
            `Dear ${customerName}, your purchase of ৳${saleTotal.toFixed(2)} ` +
            `(Ref: ${saleRef}) has been confirmed. Thank you!`;
        await this.sendSms(phone, message);
    }

    async sendLowStockAlert(
        phone: string,
        productName: string,
        currentStock: number,
    ): Promise<void> {
        const message =
            `Low stock alert: ${productName} has only ${currentStock} units remaining.`;
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
