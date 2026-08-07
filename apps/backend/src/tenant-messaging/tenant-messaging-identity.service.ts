import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { encryptValue, decryptValue } from '../platform-settings/crypto.util';
import { UpdateTenantMessagingIdentityDto } from './tenant-messaging-identity.dto';

/** What the mailer needs to stamp on a tenant-branded message. */
export interface TenantEmailIdentity {
    from: string;
    fromName: string | null;
    replyTo: string | null;
}

/** What the WhatsApp Cloud API call needs to send from a tenant's own number. */
export interface TenantWhatsAppIdentity {
    phoneNumberId: string;
    accessToken: string;
    apiVersion: string | null;
}

export const SECRET_MASK = '••••••••';

/**
 * Resolves the sender identity for one tenant's outbound messages.
 *
 * The platform sender stays the default for every workspace; this only answers
 * "does *this* tenant have its own, and is it switched on?". A null return means
 * "use the platform sender", which is the answer for all but a handful of
 * tenants — so the negative result is cached just as eagerly as a positive one.
 */
@Injectable()
export class TenantMessagingIdentityService {
    private readonly logger = new Logger(TenantMessagingIdentityService.name);
    private readonly cache = new Map<string, { row: IdentityRow | null; expiresAt: number }>();
    private readonly TTL_MS = 60_000;

    constructor(private readonly db: DatabaseService) {}

    private async getRow(tenantId: string): Promise<IdentityRow | null> {
        const cached = this.cache.get(tenantId);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.row;
        }
        const row = (await this.db.tenantMessagingIdentity.findUnique({
            where: { tenant_id: tenantId },
        })) as IdentityRow | null;
        this.cache.set(tenantId, { row, expiresAt: Date.now() + this.TTL_MS });
        return row;
    }

    invalidate(tenantId: string): void {
        this.cache.delete(tenantId);
    }

    /**
     * The tenant's own email sender, or null to fall back to the platform one.
     * `email_enabled` without a from-address is treated as not configured rather
     * than as an error: a message going out from the platform address beats a
     * message not going out at all.
     */
    async resolveEmailIdentity(tenantId?: string | null): Promise<TenantEmailIdentity | null> {
        if (!tenantId) return null;
        const row = await this.getRow(tenantId);
        if (!row?.email_enabled) return null;

        const from = row.email_from?.trim();
        if (!from) {
            this.logger.warn(
                `Tenant ${tenantId} has email identity enabled but no from-address — falling back to the platform sender.`,
            );
            return null;
        }

        return {
            from,
            fromName: row.email_from_name?.trim() || null,
            replyTo: row.email_reply_to?.trim() || null,
        };
    }

    /** The tenant's own WhatsApp number, or null to fall back to the platform one. */
    async resolveWhatsAppIdentity(tenantId?: string | null): Promise<TenantWhatsAppIdentity | null> {
        if (!tenantId) return null;
        const row = await this.getRow(tenantId);
        if (!row?.whatsapp_enabled) return null;

        const phoneNumberId = row.whatsapp_phone_number_id?.trim();
        const accessToken = row.whatsapp_access_token ? decryptValue(row.whatsapp_access_token) : '';
        if (!phoneNumberId || !accessToken) {
            this.logger.warn(
                `Tenant ${tenantId} has WhatsApp identity enabled but incomplete credentials — falling back to the platform number.`,
            );
            return null;
        }

        return {
            phoneNumberId,
            accessToken,
            apiVersion: row.whatsapp_api_version?.trim() || null,
        };
    }

    /** Admin view: the stored identity with the access token masked. */
    async getForAdmin(tenantId: string) {
        const tenant = await this.db.tenant.findFirst({
            where: { id: tenantId, deleted_at: null },
            select: { id: true },
        });
        if (!tenant) throw new NotFoundException('Tenant not found');

        const row = await this.db.tenantMessagingIdentity.findUnique({ where: { tenant_id: tenantId } });

        return {
            email_enabled: row?.email_enabled ?? false,
            email_from: row?.email_from ?? '',
            email_from_name: row?.email_from_name ?? '',
            email_reply_to: row?.email_reply_to ?? '',
            whatsapp_enabled: row?.whatsapp_enabled ?? false,
            whatsapp_phone_number_id: row?.whatsapp_phone_number_id ?? '',
            whatsapp_access_token: row?.whatsapp_access_token ? SECRET_MASK : '',
            whatsapp_api_version: row?.whatsapp_api_version ?? '',
            notes: row?.notes ?? '',
            updated_at: row?.updated_at ?? null,
            updated_by: row?.updated_by ?? null,
        };
    }

    async update(tenantId: string, dto: UpdateTenantMessagingIdentityDto, updatedBy?: string) {
        const tenant = await this.db.tenant.findFirst({
            where: { id: tenantId, deleted_at: null },
            select: { id: true },
        });
        if (!tenant) throw new NotFoundException('Tenant not found');

        const existing = await this.db.tenantMessagingIdentity.findUnique({
            where: { tenant_id: tenantId },
        });

        const emailEnabled = dto.email_enabled ?? existing?.email_enabled ?? false;
        const emailFrom = pick(dto.email_from, existing?.email_from);
        if (emailEnabled && !emailFrom) {
            throw new BadRequestException(
                'A from-address is required before this tenant can send email under its own identity.',
            );
        }

        const whatsappEnabled = dto.whatsapp_enabled ?? existing?.whatsapp_enabled ?? false;
        const phoneNumberId = pick(dto.whatsapp_phone_number_id, existing?.whatsapp_phone_number_id);
        // The mask is what GET hands the admin UI back, so treat it as "unchanged"
        // rather than storing the bullets as a token.
        const tokenInput = dto.whatsapp_access_token === SECRET_MASK ? undefined : dto.whatsapp_access_token;
        const accessToken =
            tokenInput === undefined
                ? (existing?.whatsapp_access_token ?? null)
                : tokenInput.trim()
                  ? encryptValue(tokenInput.trim())
                  : null;
        if (whatsappEnabled && (!phoneNumberId || !accessToken)) {
            throw new BadRequestException(
                'A phone number id and an access token are both required before this tenant can send WhatsApp under its own identity.',
            );
        }

        const data = {
            email_enabled: emailEnabled,
            email_from: emailFrom,
            email_from_name: pick(dto.email_from_name, existing?.email_from_name),
            email_reply_to: pick(dto.email_reply_to, existing?.email_reply_to),
            whatsapp_enabled: whatsappEnabled,
            whatsapp_phone_number_id: phoneNumberId,
            whatsapp_access_token: accessToken,
            whatsapp_api_version: pick(dto.whatsapp_api_version, existing?.whatsapp_api_version),
            notes: pick(dto.notes, existing?.notes),
            updated_by: updatedBy ?? null,
        };

        await this.db.tenantMessagingIdentity.upsert({
            where: { tenant_id: tenantId },
            create: { tenant_id: tenantId, ...data },
            update: data,
        });

        this.invalidate(tenantId);
        return this.getForAdmin(tenantId);
    }
}

type IdentityRow = {
    email_enabled: boolean;
    email_from: string | null;
    email_from_name: string | null;
    email_reply_to: string | null;
    whatsapp_enabled: boolean;
    whatsapp_phone_number_id: string | null;
    whatsapp_access_token: string | null;
    whatsapp_api_version: string | null;
};

/** Omitted field keeps the stored value; an empty string clears it. */
function pick(next: string | undefined, current: string | null | undefined): string | null {
    if (next === undefined) return current ?? null;
    const trimmed = next.trim();
    return trimmed === '' ? null : trimmed;
}
