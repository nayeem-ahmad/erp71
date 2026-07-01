import {
    DEFAULT_LOCALE,
    isLocale,
    resolveSupportedLocale,
    type Locale,
    type SupportedLocaleCode,
} from './localization/config';

export type TenantLocaleConfig = {
    localization_enabled?: boolean | null;
    secondary_locale?: string | null;
};

const SECONDARY_LOCALE_CODES = new Set<SupportedLocaleCode>(['bn', 'ms']);

export function resolveSecondaryLocale(value: unknown): SupportedLocaleCode | null {
    const code = resolveSupportedLocale(value);
    if (code === DEFAULT_LOCALE) return null;
    return SECONDARY_LOCALE_CODES.has(code) ? code : null;
}

/** Locales available to a tenant workspace. Defaults to English only. */
export function getTenantEnabledLocales(tenant: TenantLocaleConfig | null | undefined): Locale[] {
    if (!tenant?.localization_enabled) return [DEFAULT_LOCALE];

    const secondary = resolveSecondaryLocale(tenant.secondary_locale);
    if (!secondary) return [DEFAULT_LOCALE];

    return [DEFAULT_LOCALE, secondary];
}

export function shouldShowLanguageSwitcher(tenant: TenantLocaleConfig | null | undefined): boolean {
    return getTenantEnabledLocales(tenant).length > 1;
}

export function clampLocaleToTenant(
    locale: unknown,
    tenant: TenantLocaleConfig | null | undefined,
): Locale {
    const resolved = isLocale(locale) ? locale : DEFAULT_LOCALE;
    const allowed = getTenantEnabledLocales(tenant);
    return allowed.includes(resolved) ? resolved : DEFAULT_LOCALE;
}