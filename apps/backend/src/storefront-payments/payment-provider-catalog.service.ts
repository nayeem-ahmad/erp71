import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
    OnModuleInit,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { encryptValue, decryptValue } from '../platform-settings/crypto.util';
import {
    isPaymentProviderAdapter,
    type PaymentProviderCredentialField,
    type PaymentProviderAdapter,
    type StorefrontPaymentProviderSummary,
    type TenantStorefrontGatewayView,
} from '@erp71/shared-types';
import {
    CreatePaymentProviderDto,
    UpdatePaymentProviderDto,
    UpdateTenantGatewayDto,
} from './storefront-payments.dto';

export const SECRET_MASK = '••••••••';

/** Shown to shoppers at checkout: what they can pay with, not how the shop is set up. */
const SSLCOMMERZ_DESCRIPTION = 'Pay securely by card, bKash, Nagad or bank transfer.';
/** The merchant-facing wording the first release shipped; replaced on startup. */
const LEGACY_SSLCOMMERZ_DESCRIPTION =
    'Cards, bKash, Nagad and bank payments through your own SSLCommerz merchant account.';

interface ProviderRow {
    id: string;
    code: string;
    name: string;
    description: string | null;
    logo_url: string | null;
    adapter: string;
    currency: string;
    is_active: boolean;
    sort_order: number;
    credential_fields: unknown;
    config: unknown;
}

interface GatewayRow {
    id: string;
    enabled: boolean;
    mode: string;
    credentials: unknown;
    verified_at: Date | null;
    last_error: string | null;
    last_error_at: Date | null;
}

/** What the payment service needs to open a session, secrets already decrypted. */
export interface ResolvedGateway {
    providerId: string;
    providerCode: string;
    providerName: string;
    adapter: PaymentProviderAdapter;
    currency: string;
    config: Record<string, unknown>;
    credentials: Record<string, string>;
    mode: 'sandbox' | 'live';
}

export function credentialFieldsOf(row: { credential_fields: unknown }): PaymentProviderCredentialField[] {
    return Array.isArray(row.credential_fields)
        ? (row.credential_fields as PaymentProviderCredentialField[])
        : [];
}

export function configOf(row: { config: unknown }): Record<string, unknown> {
    return row.config && typeof row.config === 'object' && !Array.isArray(row.config)
        ? (row.config as Record<string, unknown>)
        : {};
}

/**
 * The platform-defined catalog of payment providers and each shop's own account
 * with them.
 *
 * The catalog lives in the database rather than in code so the operator can add
 * a provider, correct a name, change an endpoint or pause a broken gateway from
 * the admin console. The adapter a provider names is the only code involved;
 * `HOSTED_REDIRECT` is configured entirely by the row's `config`.
 */
@Injectable()
export class PaymentProviderCatalogService implements OnModuleInit {
    private readonly logger = new Logger(PaymentProviderCatalogService.name);

    constructor(private readonly db: DatabaseService) {}

    async onModuleInit() {
        await this.bootstrapDefaults().catch((error) => {
            this.logger.warn(`Could not seed the default payment provider: ${error?.message ?? error}`);
        });
    }

    /**
     * SSLCommerz ships enabled as the first provider, so a shop that switches
     * online payment on has something to configure. Created once; an operator's
     * later edits are never overwritten.
     *
     * The description is shown to *shoppers* under the payment option, so it
     * says what they can pay with — not how the shop's merchant account works.
     */
    async bootstrapDefaults() {
        const existing = await this.db.storefrontPaymentProvider.findUnique({ where: { code: 'sslcommerz' } });
        if (existing) {
            // The first release shipped merchant-facing copy to the checkout.
            // Replace exactly that string; any wording an operator has chosen
            // since is left alone.
            if (existing.description === LEGACY_SSLCOMMERZ_DESCRIPTION) {
                return this.db.storefrontPaymentProvider.update({
                    where: { id: existing.id },
                    data: { description: SSLCOMMERZ_DESCRIPTION },
                });
            }
            return existing;
        }

        return this.db.storefrontPaymentProvider.create({
            data: {
                code: 'sslcommerz',
                name: 'SSLCommerz',
                description: SSLCOMMERZ_DESCRIPTION,
                adapter: 'SSLCOMMERZ',
                currency: 'BDT',
                is_active: true,
                sort_order: 10,
                credential_fields: [
                    { key: 'store_id', label: 'Store ID', required: true },
                    {
                        key: 'store_password',
                        label: 'Store Password',
                        secret: true,
                        required: true,
                        help: 'Your SSLCommerz merchant panel password for the store, not your login password.',
                    },
                ] as unknown as object,
                config: {},
            },
        });
    }

    // ── Admin catalog ─────────────────────────────────────────────────────────

    async listProviders() {
        const rows = await this.db.storefrontPaymentProvider.findMany({
            orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
        });
        return rows.map((row) => this.toProviderView(row as ProviderRow));
    }

    async createProvider(dto: CreatePaymentProviderDto) {
        const code = this.normalizeCode(dto.code);
        this.assertAdapter(dto.adapter);
        this.assertConfig(dto.adapter, dto.config);

        const existing = await this.db.storefrontPaymentProvider.findUnique({ where: { code } });
        if (existing) throw new ConflictException(`A provider with the code "${code}" already exists.`);

        const row = await this.db.storefrontPaymentProvider.create({
            data: {
                code,
                name: dto.name.trim(),
                description: dto.description?.trim() || null,
                logo_url: dto.logo_url?.trim() || null,
                adapter: dto.adapter,
                currency: (dto.currency || 'BDT').toUpperCase(),
                is_active: dto.is_active ?? true,
                sort_order: dto.sort_order ?? 0,
                credential_fields: dto.credential_fields as unknown as object,
                config: dto.config as object,
            },
        });
        return this.toProviderView(row as ProviderRow);
    }

    async updateProvider(id: string, dto: UpdatePaymentProviderDto) {
        const existing = await this.db.storefrontPaymentProvider.findUnique({ where: { id } });
        if (!existing) throw new NotFoundException('Payment provider not found');

        const adapter = dto.adapter ?? existing.adapter;
        this.assertAdapter(adapter);
        if (dto.config !== undefined) this.assertConfig(adapter, dto.config);
        if (dto.code !== undefined) {
            const code = this.normalizeCode(dto.code);
            if (code !== existing.code) {
                const clash = await this.db.storefrontPaymentProvider.findUnique({ where: { code } });
                if (clash) throw new ConflictException(`A provider with the code "${code}" already exists.`);
            }
        }

        const row = await this.db.storefrontPaymentProvider.update({
            where: { id },
            data: {
                ...(dto.code !== undefined ? { code: this.normalizeCode(dto.code) } : {}),
                ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
                ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
                ...(dto.logo_url !== undefined ? { logo_url: dto.logo_url?.trim() || null } : {}),
                ...(dto.adapter !== undefined ? { adapter } : {}),
                ...(dto.currency !== undefined ? { currency: dto.currency.toUpperCase() } : {}),
                ...(dto.is_active !== undefined ? { is_active: dto.is_active } : {}),
                ...(dto.sort_order !== undefined ? { sort_order: dto.sort_order } : {}),
                ...(dto.credential_fields !== undefined
                    ? { credential_fields: dto.credential_fields as unknown as object }
                    : {}),
                ...(dto.config !== undefined ? { config: dto.config as object } : {}),
            },
        });
        return this.toProviderView(row as ProviderRow);
    }

    async deleteProvider(id: string) {
        const existing = await this.db.storefrontPaymentProvider.findUnique({ where: { id } });
        if (!existing) throw new NotFoundException('Payment provider not found');
        await this.db.storefrontPaymentProvider.delete({ where: { id } });
        return { deleted: true };
    }

    // ── Tenant view and configuration ─────────────────────────────────────────

    /**
     * The gateways a shopper may choose at checkout: active providers whose
     * account this shop has switched on and filled in.
     */
    async listEnabledForShopper(tenantId: string) {
        const providers = (await this.db.storefrontPaymentProvider.findMany({
            where: { is_active: true },
            orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
            include: { gateways: { where: { tenant_id: tenantId, enabled: true } } },
        })) as (ProviderRow & { gateways: GatewayRow[] })[];

        return providers
            .filter((provider) => provider.gateways.length > 0)
            .filter((provider) =>
                credentialFieldsOf(provider)
                    .filter((field) => field.required)
                    .every((field) => Boolean(this.readCredential(provider, provider.gateways[0].credentials, field.key))),
            )
            .map((provider) => ({
                code: provider.code,
                name: provider.name,
                logo_url: provider.logo_url,
                description: provider.description,
            }));
    }

    /** Active providers, each with this shop's own account (credentials masked). */
    async listForTenant(tenantId: string): Promise<TenantStorefrontGatewayView[]> {
        const providers = (await this.db.storefrontPaymentProvider.findMany({
            where: { is_active: true },
            orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
        })) as ProviderRow[];
        if (providers.length === 0) return [];

        const gateways = await this.db.tenantStorefrontGateway.findMany({
            where: { tenant_id: tenantId, provider_id: { in: providers.map((p) => p.id) } },
        });
        const byProvider = new Map(gateways.map((gateway) => [gateway.provider_id, gateway]));

        return providers.map((provider) => {
            const gateway = byProvider.get(provider.id);
            return {
                id: gateway?.id ?? null,
                provider_id: provider.id,
                provider_code: provider.code,
                provider_name: provider.name,
                credential_fields: credentialFieldsOf(provider),
                enabled: gateway?.enabled ?? false,
                mode: gateway?.mode === 'live' ? 'live' : 'sandbox',
                credentials: this.maskCredentials(provider, gateway),
                verified_at: gateway?.verified_at?.toISOString() ?? null,
                last_error: gateway?.last_error ?? null,
                last_error_at: gateway?.last_error_at?.toISOString() ?? null,
            };
        });
    }

    async updateTenantGateway(tenantId: string, providerId: string, dto: UpdateTenantGatewayDto) {
        const provider = await this.requireProvider(providerId);
        const existing = await this.db.tenantStorefrontGateway.findUnique({
            where: { tenant_id_provider_id: { tenant_id: tenantId, provider_id: providerId } },
        });

        const fields = credentialFieldsOf(provider);
        const stored = this.storeCredentials(provider, existing?.credentials, dto.credentials ?? {});
        const missing = fields
            .filter((field) => field.required)
            .filter((field) => !this.readCredential(provider, stored, field.key));
        if (missing.length > 0) {
            throw new BadRequestException(`Fill in ${missing.map((field) => field.label).join(', ')} before saving.`);
        }

        const credentialsChanged =
            dto.credentials !== undefined &&
            Object.keys(dto.credentials).some((key) => dto.credentials![key] !== SECRET_MASK);

        const row = await this.db.tenantStorefrontGateway.upsert({
            where: { tenant_id_provider_id: { tenant_id: tenantId, provider_id: providerId } },
            create: {
                tenant_id: tenantId,
                provider_id: providerId,
                enabled: dto.enabled ?? false,
                mode: dto.mode ?? 'sandbox',
                credentials: stored as unknown as object,
            },
            update: {
                ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
                ...(dto.mode !== undefined ? { mode: dto.mode } : {}),
                ...(dto.credentials !== undefined ? { credentials: stored as unknown as object } : {}),
                ...(credentialsChanged ? { verified_at: null } : {}),
            },
        });

        return this.toTenantView(provider, row);
    }

    /**
     * Structural check of everything the adapter will need. A hosted gateway has
     * no cheap "who am I" call, and opening a real session to test would leave
     * noise in the shop's merchant panel, so this confirms the values are all
     * present and well-formed rather than charging ৳1.
     */
    async testTenantGateway(tenantId: string, providerId: string) {
        const provider = await this.requireProvider(providerId);
        const gateway = await this.db.tenantStorefrontGateway.findUnique({
            where: { tenant_id_provider_id: { tenant_id: tenantId, provider_id: providerId } },
        });
        if (!gateway) throw new BadRequestException('Save the account details first.');

        const credentials = this.decryptCredentials(provider, gateway.credentials);
        const fields = credentialFieldsOf(provider);
        const missing = fields.filter((field) => field.required && !credentials[field.key]?.trim());
        if (missing.length > 0) {
            throw new BadRequestException(`Missing: ${missing.map((field) => field.label).join(', ')}.`);
        }
        this.assertConfig(provider.adapter, configOf(provider));

        const verified = await this.db.tenantStorefrontGateway.update({
            where: { id: gateway.id },
            data: { verified_at: new Date(), last_error: null, last_error_at: null },
        });
        return this.toTenantView(provider, verified);
    }

    /** Clears an enable flag when the shop's details stop working (e.g. a callback failure). */
    async recordGatewayError(tenantId: string, providerCode: string, message: string) {
        const provider = await this.db.storefrontPaymentProvider.findUnique({ where: { code: providerCode } });
        if (!provider) return;
        await this.db.tenantStorefrontGateway.updateMany({
            where: { tenant_id: tenantId, provider_id: provider.id },
            data: { last_error: message.slice(0, 500), last_error_at: new Date() },
        });
    }

    /**
     * The credentials and configuration for one shop's enabled account. Throws
     * when the shop has not switched the provider on, so a shopper is never sent
     * to a gateway the shop cannot complete a payment with.
     */
    async resolveGateway(tenantId: string, providerCode: string): Promise<ResolvedGateway> {
        const provider = await this.db.storefrontPaymentProvider.findUnique({
            where: { code: providerCode },
        });
        if (!provider || !provider.is_active) {
            throw new BadRequestException('This payment method is not available.');
        }

        const gateway = await this.db.tenantStorefrontGateway.findUnique({
            where: { tenant_id_provider_id: { tenant_id: tenantId, provider_id: provider.id } },
        });
        if (!gateway?.enabled) {
            throw new BadRequestException('This payment method is not enabled for this shop.');
        }

        const credentials = this.decryptCredentials(provider, gateway.credentials);
        const missing = credentialFieldsOf(provider)
            .filter((field) => field.required)
            .filter((field) => !credentials[field.key]?.trim());
        if (missing.length > 0) {
            throw new BadRequestException('This shop has not finished configuring this payment method.');
        }

        return {
            providerId: provider.id,
            providerCode: provider.code,
            providerName: provider.name,
            adapter: this.adapterOf(provider.adapter),
            currency: provider.currency,
            config: configOf(provider),
            credentials,
            mode: gateway.mode === 'live' ? 'live' : 'sandbox',
        };
    }

    /** The gateway used to verify a callback, even if the provider was since paused. */
    async resolveGatewayForCallback(tenantId: string, providerCode: string): Promise<ResolvedGateway> {
        const provider = await this.db.storefrontPaymentProvider.findUnique({ where: { code: providerCode } });
        if (!provider) throw new NotFoundException('Payment provider not found');
        const gateway = await this.db.tenantStorefrontGateway.findUnique({
            where: { tenant_id_provider_id: { tenant_id: tenantId, provider_id: provider.id } },
        });
        if (!gateway) throw new NotFoundException('This shop has no account for that payment provider.');

        return {
            providerId: provider.id,
            providerCode: provider.code,
            providerName: provider.name,
            adapter: this.adapterOf(provider.adapter),
            currency: provider.currency,
            config: configOf(provider),
            credentials: this.decryptCredentials(provider, gateway.credentials),
            mode: gateway.mode === 'live' ? 'live' : 'sandbox',
        };
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private async requireProvider(id: string): Promise<ProviderRow> {
        const provider = await this.db.storefrontPaymentProvider.findUnique({ where: { id } });
        if (!provider) throw new NotFoundException('Payment provider not found');
        return provider as ProviderRow;
    }

    private adapterOf(value: string): PaymentProviderAdapter {
        this.assertAdapter(value);
        return value as PaymentProviderAdapter;
    }

    private assertAdapter(value: string): void {
        if (!isPaymentProviderAdapter(value)) {
            throw new BadRequestException(`Unknown payment adapter "${value}".`);
        }
    }

    private assertConfig(adapter: string, config: Record<string, unknown> | undefined) {
        if (adapter !== 'HOSTED_REDIRECT') return;
        const value = config ?? {};
        if (typeof value.initiate_url !== 'string' || !value.initiate_url.trim()) {
            throw new BadRequestException('A hosted-redirect provider needs an initiate URL.');
        }
        if (typeof value.validation_url !== 'string' || !value.validation_url.trim()) {
            throw new BadRequestException('A hosted-redirect provider needs a validation URL.');
        }
        if (!value.field_map || typeof value.field_map !== 'object' || Array.isArray(value.field_map)) {
            throw new BadRequestException('A hosted-redirect provider needs a field map.');
        }
    }

    private normalizeCode(value: string): string {
        return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    }

    private toProviderView(row: ProviderRow): StorefrontPaymentProviderSummary {
        return {
            id: row.id,
            code: row.code,
            name: row.name,
            description: row.description,
            logo_url: row.logo_url,
            adapter: this.adapterOf(row.adapter),
            currency: row.currency,
            is_active: row.is_active,
            sort_order: row.sort_order,
            credential_fields: credentialFieldsOf(row),
            config: configOf(row),
        };
    }

    private toTenantView(
        provider: ProviderRow,
        gateway: {
            id: string;
            enabled: boolean;
            mode: string;
            credentials: unknown;
            verified_at: Date | null;
            last_error: string | null;
            last_error_at: Date | null;
        },
    ): TenantStorefrontGatewayView {
        return {
            id: gateway.id,
            provider_id: provider.id,
            provider_code: provider.code,
            provider_name: provider.name,
            credential_fields: credentialFieldsOf(provider),
            enabled: gateway.enabled,
            mode: gateway.mode === 'live' ? 'live' : 'sandbox',
            credentials: this.maskStoredCredentials(provider, gateway.credentials),
            verified_at: gateway.verified_at?.toISOString() ?? null,
            last_error: gateway.last_error,
            last_error_at: gateway.last_error_at?.toISOString() ?? null,
        };
    }

    private maskCredentials(provider: ProviderRow, gateway: GatewayRow | undefined): Record<string, string> {
        if (!gateway) return {};
        return this.maskStoredCredentials(provider, gateway.credentials);
    }

    private maskStoredCredentials(provider: ProviderRow, stored: unknown): Record<string, string> {
        const values = this.readStored(stored);
        const masked: Record<string, string> = {};
        for (const field of credentialFieldsOf(provider)) {
            const value = values[field.key];
            if (value === undefined) continue;
            masked[field.key] = field.secret && value ? SECRET_MASK : value;
        }
        return masked;
    }

    private readStored(stored: unknown): Record<string, string> {
        if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
        const values: Record<string, string> = {};
        for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
            if (typeof value === 'string') values[key] = value;
        }
        return values;
    }

    private readCredential(provider: ProviderRow, stored: unknown, key: string): string {
        return this.decryptCredentials(provider, stored)[key] ?? '';
    }

    private decryptCredentials(provider: ProviderRow, stored: unknown): Record<string, string> {
        const values = this.readStored(stored);
        const fields = new Map(credentialFieldsOf(provider).map((field) => [field.key, field]));
        const decrypted: Record<string, string> = {};
        for (const [key, value] of Object.entries(values)) {
            const secret = fields.get(key)?.secret === true;
            decrypted[key] = secret ? decryptValue(value) : value;
        }
        return decrypted;
    }

    /**
     * Merges incoming values over the stored ones, keeping a stored secret when
     * the form sent back the mask (the settings page never sends secrets back in
     * the clear), and encrypting secrets as they are written.
     */
    private storeCredentials(
        provider: ProviderRow,
        stored: unknown,
        incoming: Record<string, string>,
    ): Record<string, string> {
        const previous = this.decryptCredentials(provider, stored);
        const next = { ...previous };
        const fields = credentialFieldsOf(provider);

        for (const field of fields) {
            if (!(field.key in incoming)) continue;
            const value = typeof incoming[field.key] === 'string' ? incoming[field.key].trim() : '';
            if (field.secret && (!value || value === SECRET_MASK)) continue;
            if (value) next[field.key] = value;
            else delete next[field.key];
        }

        const toStore: Record<string, string> = {};
        for (const field of fields) {
            const value = next[field.key];
            if (!value) continue;
            toStore[field.key] = field.secret ? encryptValue(value) : value;
        }
        return toStore;
    }
}
