import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { encryptValue, decryptValue } from './crypto.util';

type SettingMeta = { isSecret: boolean; default?: string };

const SETTINGS_SCHEMA: Record<string, Record<string, SettingMeta>> = {
    sms: {
        provider:   { isSecret: false, default: 'bulksmsbd' },
        api_key:    { isSecret: true },
        sender_id:  { isSecret: false, default: '8809617621294' },
        base_url:   { isSecret: false, default: 'http://bulksmsbd.net/api/smsapi' },
    },
    email: {
        smtp_host:    { isSecret: false, default: 'smtp-relay.brevo.com' },
        smtp_port:    { isSecret: false, default: '587' },
        smtp_user:    { isSecret: false },
        smtp_pass:    { isSecret: true },
        email_from:   { isSecret: false, default: 'noreply@retailsaas.app' },
        frontend_url: { isSecret: false, default: 'http://localhost:3000' },
    },
    payment_ssl: {
        store_id:       { isSecret: false },
        store_password: { isSecret: true },
        is_sandbox:     { isSecret: false, default: 'true' },
    },
    payment_bkash: {
        app_key:    { isSecret: false },
        app_secret: { isSecret: true },
        username:   { isSecret: false },
        password:   { isSecret: true },
        is_sandbox: { isSecret: false, default: 'true' },
    },
    payment_nagad: {
        merchant_id:          { isSecret: false },
        merchant_private_key: { isSecret: true },
        merchant_public_key:  { isSecret: false },
        is_sandbox:           { isSecret: false, default: 'true' },
    },
    whatsapp: {
        access_token:    { isSecret: true },
        phone_number_id: { isSecret: false },
        api_version:     { isSecret: false, default: 'v18.0' },
    },
    ai: {
        api_key: { isSecret: true },
        default_model: { isSecret: false, default: 'claude-haiku-4-5-20251001' },
    },
    general: {
        platform_name:    { isSecret: false, default: 'RetailSaaS' },
        support_email:    { isSecret: false, default: 'support@retailsaas.app' },
        maintenance_mode: { isSecret: false, default: 'false' },
    },
};

export const VALID_GROUPS = Object.keys(SETTINGS_SCHEMA);

@Injectable()
export class PlatformSettingsService {
    private readonly logger = new Logger(PlatformSettingsService.name);
    private readonly cache = new Map<string, { settings: Record<string, string | null>; expiresAt: number }>();
    private readonly TTL_MS = 60_000;

    constructor(private readonly db: DatabaseService) {}

    /** Returns masked settings for API responses (secrets shown as ••••••••) */
    async getGroup(group: string): Promise<Record<string, string | null>> {
        const schema = SETTINGS_SCHEMA[group] ?? {};
        const raw = await this.getRawGroup(group);
        const result: Record<string, string | null> = {};

        for (const key of Object.keys(schema)) {
            const value = raw[key] ?? schema[key].default ?? null;
            result[key] = schema[key].isSecret && value ? '••••••••' : value;
        }
        return result;
    }

    /** Returns decrypted settings for internal service use */
    async getRawGroup(group: string): Promise<Record<string, string | null>> {
        const cached = this.cache.get(group);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.settings;
        }

        const rows = await this.db.platformSetting.findMany({ where: { group } });
        const settings: Record<string, string | null> = {};
        for (const row of rows) {
            settings[row.key] = row.is_secret && row.value ? decryptValue(row.value) : row.value;
        }

        this.cache.set(group, { settings, expiresAt: Date.now() + this.TTL_MS });
        return settings;
    }

    /** Returns a single raw (decrypted) value; falls back to env var, then schema default */
    async getRawValue(group: string, key: string): Promise<string | null> {
        const groupSettings = await this.getRawGroup(group);
        return groupSettings[key] ?? SETTINGS_SCHEMA[group]?.[key]?.default ?? null;
    }

    /** Upserts a batch of settings for a group; skip null values to leave existing unchanged */
    async upsertSettings(
        group: string,
        settings: Record<string, string | null>,
        updatedBy?: string,
    ): Promise<void> {
        this.cache.delete(group);
        const schema = SETTINGS_SCHEMA[group] ?? {};

        for (const [key, value] of Object.entries(settings)) {
            if (value === null) continue;
            const isSecret = schema[key]?.isSecret ?? false;
            const storedValue = isSecret ? encryptValue(value) : value;

            await this.db.platformSetting.upsert({
                where: { group_key: { group, key } },
                create: { group, key, value: storedValue, is_secret: isSecret, updated_by: updatedBy },
                update: { value: storedValue, updated_by: updatedBy },
            });
        }
    }

    /** Invalidates the in-memory cache for a group (e.g. after an external update) */
    invalidate(group: string): void {
        this.cache.delete(group);
    }
}
