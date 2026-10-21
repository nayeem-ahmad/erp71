import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { TenantMessagingIdentityService } from '../tenant-messaging/tenant-messaging-identity.service';
import { SmsCreditService } from '../sms/sms-credit.service';
import { customerUpdatePayload } from './customer-update-template';
import { ownerDailySummaryPayload } from './owner-daily-summary-template';

export interface SendWhatsAppOptions {
    /**
     * The tenant sending. Sends from its own WhatsApp Business number when a
     * platform admin has configured and enabled one, otherwise the platform
     * number — and either way bills one credit to its WhatsApp balance.
     */
    tenantId?: string | null;
    /** Short label stored on the usage ledger entry (e.g. "CRM campaign"). */
    purpose?: string;
    /** Customer name for the {{1}} variable of erp71_customer_update. */
    recipientName?: string | null;
}

export interface SendWhatsAppResult {
    sent: boolean;
    reason?: 'INSUFFICIENT_WHATSAPP_CREDITS' | 'WHATSAPP_REJECTED';
    /** Meta's error, when the send was rejected. */
    error?: string;
}

@Injectable()
export class WhatsAppService {
    private readonly logger = new Logger(WhatsAppService.name);

    constructor(
        private readonly platformSettings: PlatformSettingsService,
        private readonly tenantIdentity: TenantMessagingIdentityService,
        private readonly credits: SmsCreditService,
    ) {}

    private normalizePhone(phone: string): string {
        const digits = phone.replace(/\D/g, '');
        // Ensure international format: BD numbers → 8801...
        if (digits.startsWith('0')) return '880' + digits.slice(1);
        if (!digits.startsWith('880') && digits.length === 10) return '880' + digits;
        return digits;
    }

    private async getCredentials(tenantId?: string | null) {
        const [accessToken, phoneNumberId, apiVersion, identity] = await Promise.all([
            this.platformSettings.getRawValue('whatsapp', 'access_token'),
            this.platformSettings.getRawValue('whatsapp', 'phone_number_id'),
            this.platformSettings.getRawValue('whatsapp', 'api_version'),
            this.tenantIdentity.resolveWhatsAppIdentity(tenantId),
        ]);
        const platformApiVersion = apiVersion ?? 'v18.0';

        // A tenant identity is all-or-nothing: its own number sends with its own
        // token, never the platform token, which is scoped to a different WABA.
        if (identity) {
            return {
                accessToken: identity.accessToken,
                phoneNumberId: identity.phoneNumberId,
                apiVersion: identity.apiVersion ?? platformApiVersion,
            };
        }

        return {
            accessToken: accessToken ?? process.env.WHATSAPP_ACCESS_TOKEN ?? null,
            phoneNumberId: phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID ?? null,
            apiVersion: platformApiVersion,
        };
    }

    async sendMessage(to: string, message: string, options?: SendWhatsAppOptions): Promise<SendWhatsAppResult> {
        const phone = this.normalizePhone(to);

        // Metered like SMS: one credit per message, taken before sending, and
        // no credit means no message rather than a send the platform pays for.
        if (options?.tenantId) {
            const { allowed } = await this.credits.consume(options.tenantId, 1, {
                channel: 'WHATSAPP',
                recipient: phone,
                description: options.purpose ?? 'WhatsApp sent',
            });
            if (!allowed) {
                this.logger.warn(`Skipping WhatsApp to ${phone} for tenant ${options.tenantId}: insufficient WhatsApp credits.`);
                return { sent: false, reason: 'INSUFFICIENT_WHATSAPP_CREDITS' };
            }
        }

        const { accessToken, phoneNumberId, apiVersion } = await this.getCredentials(options?.tenantId);

        if (!accessToken || !phoneNumberId) {
            this.logger.log(`[WhatsApp] To: ${phone} | Message: ${message}`);
            return { sent: true };
        }

        try {
            const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
            const body = JSON.stringify(
                customerUpdatePayload(phone, options?.recipientName, message),
            );

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body,
            });

            if (!response.ok) {
                const errBody = await response.text().catch(() => '');
                this.logger.error(`WhatsApp API ${response.status} for ${phone}: ${errBody}`);
                const detail = errBody ? `: ${errBody.slice(0, 500)}` : '';
                return {
                    sent: false,
                    reason: 'WHATSAPP_REJECTED',
                    error: `WhatsApp API ${response.status}${detail}`,
                };
            }

            const result: any = await response.json().catch(() => ({}));
            this.logger.debug(`WhatsApp sent to ${phone}: messageId=${result?.messages?.[0]?.id}`);
        } catch (err) {
            this.logger.error(`Failed to send WhatsApp to ${phone}: ${err}`);
            return { sent: false, reason: 'WHATSAPP_REJECTED', error: 'WhatsApp could not be reached' };
        }
        return { sent: true };
    }

    /**
     * Nightly owner summary through `erp71_tenant_owner_daily_summary`. One
     * WhatsApp credit, same as any other send. A rejection has already spent
     * that credit, so the caller must not retry it.
     */
    async sendOwnerDailySummary(
        to: string,
        input: { name?: string | null; day: string; summary: string },
        options?: { tenantId?: string | null },
    ): Promise<SendWhatsAppResult> {
        const phone = this.normalizePhone(to);

        if (options?.tenantId) {
            const { allowed } = await this.credits.consume(options.tenantId, 1, {
                channel: 'WHATSAPP',
                recipient: phone,
                description: 'Daily business summary',
            });
            if (!allowed) {
                this.logger.warn(`Skipping WhatsApp to ${phone} for tenant ${options.tenantId}: insufficient WhatsApp credits.`);
                return { sent: false, reason: 'INSUFFICIENT_WHATSAPP_CREDITS' };
            }
        }

        const { accessToken, phoneNumberId, apiVersion } = await this.getCredentials(options?.tenantId);
        if (!accessToken || !phoneNumberId) {
            this.logger.log(`[WhatsApp] To: ${phone} | Daily summary for ${input.day}`);
            return { sent: true };
        }

        try {
            const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(ownerDailySummaryPayload(phone, input.name, input.day, input.summary)),
            });

            if (!response.ok) {
                const errBody = await response.text().catch(() => '');
                this.logger.error(`WhatsApp API ${response.status} for ${phone}: ${errBody}`);
                const detail = errBody ? `: ${errBody.slice(0, 500)}` : '';
                return {
                    sent: false,
                    reason: 'WHATSAPP_REJECTED',
                    error: `WhatsApp API ${response.status}${detail}`,
                };
            }

            const result: any = await response.json().catch(() => ({}));
            this.logger.debug(`WhatsApp sent to ${phone}: messageId=${result?.messages?.[0]?.id}`);
        } catch (err) {
            this.logger.error(`Failed to send WhatsApp to ${phone}: ${err}`);
            return { sent: false, reason: 'WHATSAPP_REJECTED', error: 'WhatsApp could not be reached' };
        }
        return { sent: true };
    }

    async sendBulk(recipients: Array<{ phone: string; message: string }>): Promise<void> {
        for (const r of recipients) {
            await this.sendMessage(r.phone, r.message);
        }
    }

    /** Throws on missing credentials or API failure — for admin test sends only. */
    async sendTestMessage(to: string, options?: SendWhatsAppOptions): Promise<void> {
        const phone = this.normalizePhone(to);
        const { accessToken, phoneNumberId, apiVersion } = await this.getCredentials(options?.tenantId);

        if (!accessToken || !phoneNumberId) {
            throw new BadRequestException('WhatsApp credentials are not configured');
        }

        const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
        const body = JSON.stringify(
            customerUpdatePayload(
                phone,
                'Customer',
                'Test message from ERP71. Your WhatsApp Cloud API is configured correctly.',
            ),
        );

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body,
        });

        if (!response.ok) {
            const errBody = await response.text().catch(() => '');
            throw new BadRequestException(
                `WhatsApp API ${response.status}${errBody ? `: ${errBody}` : ''}`,
            );
        }
    }
}
