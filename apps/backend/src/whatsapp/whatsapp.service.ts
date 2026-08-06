import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { TenantMessagingIdentityService } from '../tenant-messaging/tenant-messaging-identity.service';

export interface SendWhatsAppOptions {
    /**
     * Sends from this tenant's own WhatsApp Business number when a platform
     * admin has configured and enabled one; otherwise the platform number.
     */
    tenantId?: string | null;
}

@Injectable()
export class WhatsAppService {
    private readonly logger = new Logger(WhatsAppService.name);

    constructor(
        private readonly platformSettings: PlatformSettingsService,
        private readonly tenantIdentity: TenantMessagingIdentityService,
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

    async sendMessage(to: string, message: string, options?: SendWhatsAppOptions): Promise<void> {
        const phone = this.normalizePhone(to);
        const { accessToken, phoneNumberId, apiVersion } = await this.getCredentials(options?.tenantId);

        if (!accessToken || !phoneNumberId) {
            this.logger.log(`[WhatsApp] To: ${phone} | Message: ${message}`);
            return;
        }

        try {
            const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
            const body = JSON.stringify({
                messaging_product: 'whatsapp',
                to: phone,
                type: 'text',
                text: { body: message },
            });

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
                return;
            }

            const result: any = await response.json().catch(() => ({}));
            this.logger.debug(`WhatsApp sent to ${phone}: messageId=${result?.messages?.[0]?.id}`);
        } catch (err) {
            this.logger.error(`Failed to send WhatsApp to ${phone}: ${err}`);
        }
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
        const body = JSON.stringify({
            messaging_product: 'whatsapp',
            to: phone,
            type: 'text',
            text: { body: 'Test message from ERP71. Your WhatsApp Cloud API is configured correctly.' },
        });

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
