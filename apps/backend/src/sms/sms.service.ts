import { Injectable, Logger } from '@nestjs/common';
import { roundMoney } from '@erp71/shared-types';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { SmsCreditService } from './sms-credit.service';
import { smsDestination } from './sms-destination';
import { CircuitBreakerRegistry } from '../system-health/resilience/circuit-breaker.registry';

export interface SendSmsOptions {
    /** When set, the send is billed against this tenant's prepaid SMS credits. */
    tenantId?: string;
    /** Short label stored on the usage ledger entry (e.g. "Sale receipt"). */
    purpose?: string;
}

export interface SendSmsResult {
    sent: boolean;
    reason?: 'INSUFFICIENT_SMS_CREDITS' | 'INVALID_MOBILE';
}

export interface CreditSaleSms {
    phone: string;
    customerName: string;
    shopName: string;
    serialNumber: string;
    totalAmount: number;
    paidAmount: number;
    dueAmount: number;
    balanceAfter: number;
    tenantId: string;
}

export interface CustomerPaymentSms {
    phone: string;
    customerName: string;
    shopName: string;
    amount: number;
    paymentNumber: string;
    balanceAfter: number;
    tenantId: string;
    /** Set when the payment was taken with a sale, so the text names that bill. */
    invoiceSerial?: string;
    invoiceTotal?: number;
}

function money(amount: number): string {
    return roundMoney(amount).toFixed(2);
}

/** One line, clipped, so a long name cannot blow the message into extra segments by itself. */
function clip(value: string, fallback: string): string {
    const cleaned = value.replace(/\s+/g, ' ').trim().slice(0, 40);
    return cleaned || fallback;
}

function balancePhrase(balance: number): string {
    if (balance < -0.005) return `Advance BDT ${money(Math.abs(balance))}`;
    return `Balance due BDT ${money(balance)}`;
}

export function creditSaleMessage(input: Omit<CreditSaleSms, 'phone' | 'tenantId'>): string {
    const name = clip(input.customerName, 'Customer');
    const shop = clip(input.shopName, 'us');
    return (
        `Dear ${name}, invoice ${input.serialNumber}: total BDT ${money(input.totalAmount)}, `
        + `paid BDT ${money(input.paidAmount)}, due BDT ${money(input.dueAmount)}. `
        + `${balancePhrase(input.balanceAfter)}. - ${shop}`
    );
}

export function customerPaymentMessage(input: Omit<CustomerPaymentSms, 'phone' | 'tenantId'>): string {
    const name = clip(input.customerName, 'Customer');
    const shop = clip(input.shopName, 'us');
    const received = `Payment of BDT ${money(input.amount)} received (${input.paymentNumber})`;
    const bill = input.invoiceSerial
        ? `invoice ${input.invoiceSerial}: total BDT ${money(input.invoiceTotal ?? 0)}. `
        : '';
    return `Dear ${name}, ${bill}${received}. ${balancePhrase(input.balanceAfter)}. - ${shop}`;
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

    /**
     * Sends only when `phone` is a mobile. Anything else returns without
     * touching SMS credit — the credit is spent inside `sendSms` before the
     * gateway is called, so a landline would pay for a text it cannot receive.
     */
    private async sendToCustomer(
        phone: string,
        message: string,
        tenantId: string | undefined,
        purpose: string,
    ): Promise<SendSmsResult> {
        const to = smsDestination(phone);
        if (!to) {
            this.logger.log(`Skipping SMS (${purpose}): not a valid mobile number.`);
            return { sent: false, reason: 'INVALID_MOBILE' };
        }
        return this.sendSms(to, message, { tenantId, purpose });
    }

    async sendSaleReceipt(
        phone: string,
        customerName: string,
        saleTotal: number,
        saleRef: string,
        tenantId?: string,
    ): Promise<SendSmsResult> {
        const message =
            `Dear ${customerName}, your purchase of BDT ${saleTotal.toFixed(2)} ` +
            `(Ref: ${saleRef}) has been confirmed. Thank you!`;
        return this.sendToCustomer(phone, message, tenantId, 'Sale receipt');
    }

    /** One text for a sale that left a balance due, naming what was paid and what is still owed. */
    async sendCreditSaleNotice(input: CreditSaleSms): Promise<SendSmsResult> {
        return this.sendToCustomer(
            input.phone,
            creditSaleMessage(input),
            input.tenantId,
            'Credit sale',
        );
    }

    /** One text when money is received on the customer's account. */
    async sendCustomerPaymentNotice(input: CustomerPaymentSms): Promise<SendSmsResult> {
        return this.sendToCustomer(
            input.phone,
            customerPaymentMessage(input),
            input.tenantId,
            'Customer payment',
        );
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
