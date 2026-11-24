/**
 * Online payment for storefront orders.
 *
 * Money moves **straight into the tenant's own merchant account**: the platform
 * stores each shop's gateway credentials and creates the gateway session with
 * them, but never acts as the merchant of record and never settles funds. That
 * is why there is no marketplace/split-payment layer here — every provider row
 * is the tenant's own account with the provider.
 */

/**
 * Where the money on one order stands.
 *
 * `UNPAID` is the state of every cash-on-delivery order and of an online order
 * before the shopper is handed to the gateway. `PENDING` is an online order the
 * shopper has been sent to pay for but whose callback has not confirmed yet.
 */
export const STOREFRONT_PAYMENT_STATUSES = ['UNPAID', 'PENDING', 'PAID', 'FAILED', 'REFUNDED'] as const;

export type StorefrontPaymentStatus = (typeof STOREFRONT_PAYMENT_STATUSES)[number];

/**
 * The order's chosen payment option. `CASH_ON_DELIVERY` is always available;
 * anything else is the `code` of a `StorefrontPaymentProvider` row, so the
 * platform can add a provider without a new value here.
 */
export const CASH_ON_DELIVERY = 'CASH_ON_DELIVERY';

export type StorefrontPaymentMethod = typeof CASH_ON_DELIVERY | (string & {});

export const PAYMENT_PROVIDER_ADAPTERS = ['SSLCOMMERZ', 'HOSTED_REDIRECT'] as const;

/**
 * How the platform talks to a provider.
 *
 * `SSLCOMMERZ` is the built-in adapter. `HOSTED_REDIRECT` covers the common
 * "form POST → hosted page → callback with a reference → server-to-server
 * validate" shape that most hosted gateways in this market speak, driven
 * entirely by the provider's `config` JSON — so a provider using that shape is
 * onboarded from the admin panel with no code. A provider with a bespoke
 * handshake (token grants, request signing, RSA keys) still needs an adapter.
 */
export type PaymentProviderAdapter = (typeof PAYMENT_PROVIDER_ADAPTERS)[number];

export function isPaymentProviderAdapter(value: unknown): value is PaymentProviderAdapter {
    return typeof value === 'string' && (PAYMENT_PROVIDER_ADAPTERS as readonly string[]).includes(value);
}

export function isStorefrontPaymentStatus(value: unknown): value is StorefrontPaymentStatus {
    return typeof value === 'string' && (STOREFRONT_PAYMENT_STATUSES as readonly string[]).includes(value);
}

/** One credential the shop types in for its provider account. */
export interface PaymentProviderCredentialField {
    /** Key stored in the gateway's `credentials` JSON. */
    key: string;
    label: string;
    /** Encrypted at rest and masked on read. */
    secret?: boolean;
    required?: boolean;
    placeholder?: string;
    help?: string;
}

/**
 * The admin-defined shape of a `HOSTED_REDIRECT` provider.
 *
 * Tokens in templates: `{amount}`, `{currency}`, `{orderId}`, `{orderRef}`,
 * `{paymentId}`, `{customerName}`, `{customerEmail}`, `{customerPhone}`,
 * `{successUrl}`, `{failUrl}`, `{cancelUrl}`.
 */
export interface HostedRedirectProviderConfig {
    /** Where the shopper's browser is sent to pay. */
    initiate_url: string;
    /** Defaults to POST. */
    method?: 'GET' | 'POST';
    /** Gateway parameter name → template. */
    field_map: Record<string, string>;
    /** `json` reads the redirect URL out of the response body; `redirect` follows Location. */
    response_type?: 'json' | 'redirect';
    /** Dot path in the JSON response that holds the redirect URL. */
    response_url_path?: string;
    /** Server-to-server validation URL; `{paymentRef}` is filled from `reference_param`. */
    validation_url?: string;
    /** Callback body/query field carrying the provider's reference. */
    reference_param?: string;
    /** Dot paths into the validation response. */
    validation_status_path?: string;
    validation_success_values?: string[];
    validation_amount_path?: string;
    validation_currency_path?: string;
    validation_reference_path?: string;
}

/** What the tenant-facing settings page may display about a provider. */
export interface StorefrontPaymentProviderSummary {
    id: string;
    code: string;
    name: string;
    description: string | null;
    logo_url: string | null;
    adapter: PaymentProviderAdapter;
    currency: string;
    is_active: boolean;
    sort_order: number;
    credential_fields: PaymentProviderCredentialField[];
    /** Adapter configuration. Never contains credentials. */
    config: Record<string, unknown>;
}

/** A tenant's own account with one provider, as the settings page sees it. */
export interface TenantStorefrontGatewayView {
    id: string | null;
    provider_id: string;
    provider_code: string;
    provider_name: string;
    /** What the shop must fill in, as defined by the provider's catalog row. */
    credential_fields: PaymentProviderCredentialField[];
    enabled: boolean;
    mode: 'sandbox' | 'live';
    /** Values as stored, with secrets replaced by the mask. */
    credentials: Record<string, string>;
    verified_at: string | null;
    last_error: string | null;
    last_error_at: string | null;
}
