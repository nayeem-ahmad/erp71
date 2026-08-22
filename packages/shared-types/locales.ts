/**
 * Canonical locale registry for the whole platform.
 *
 * Both `apps/frontend` (message catalogs, `<html lang dir>`, language switcher)
 * and `apps/backend` (DTO validation) derive their locale lists from here, so
 * adding a language is a change to this file plus its message catalog — not a
 * hunt through hardcoded `['en', 'bn', 'ms']` arrays in three packages.
 *
 * `enabled: false` keeps a locale in the type system while hiding it from every
 * user-facing list, which is how a language ships incrementally: register it,
 * translate its catalog, then flip the flag.
 *
 * `dir` is consumed by `<html dir>` (server render) and by
 * `persistLocalePreference` (client switch), so a locale registered `rtl` gets
 * the mirrored layout for free — provided the UI uses logical Tailwind
 * utilities (`ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`/`text-start`/`text-end`)
 * rather than physical ones. See `docs/rtl-guidelines.md`.
 */

export const localeRegistry = {
    en: {
        code: 'en',
        label: 'English',
        nativeLabel: 'English',
        htmlLang: 'en',
        dir: 'ltr',
        numberLocale: 'en-US',
        dateLocale: 'en-GB',
        enabled: true,
    },
    bn: {
        code: 'bn',
        label: 'Bangla',
        nativeLabel: 'বাংলা',
        htmlLang: 'bn',
        dir: 'ltr',
        numberLocale: 'bn-BD',
        dateLocale: 'bn-BD',
        enabled: true,
    },
    ms: {
        code: 'ms',
        label: 'Malay',
        nativeLabel: 'Bahasa Melayu',
        htmlLang: 'ms',
        dir: 'ltr',
        numberLocale: 'ms-MY',
        dateLocale: 'ms-MY',
        enabled: true,
    },
    hi: {
        code: 'hi',
        label: 'Hindi',
        nativeLabel: 'हिन्दी',
        htmlLang: 'hi',
        dir: 'ltr',
        // hi-IN groups in lakh/crore (1,23,456) and uses Latin digits by
        // default, which is what financial tables want.
        numberLocale: 'hi-IN',
        dateLocale: 'hi-IN',
        enabled: true,
    },
    de: {
        code: 'de',
        label: 'German',
        nativeLabel: 'Deutsch',
        htmlLang: 'de',
        dir: 'ltr',
        numberLocale: 'de-DE',
        dateLocale: 'de-DE',
        enabled: true,
    },
    fr: {
        code: 'fr',
        label: 'French',
        nativeLabel: 'Français',
        htmlLang: 'fr',
        dir: 'ltr',
        numberLocale: 'fr-FR',
        dateLocale: 'fr-FR',
        enabled: true,
    },
    es: {
        code: 'es',
        label: 'Spanish',
        nativeLabel: 'Español',
        htmlLang: 'es',
        dir: 'ltr',
        numberLocale: 'es-ES',
        dateLocale: 'es-ES',
        enabled: true,
    },
    ur: {
        code: 'ur',
        label: 'Urdu',
        nativeLabel: 'اردو',
        htmlLang: 'ur',
        dir: 'rtl',
        // ur-PK, not ur-IN: Pakistan uses Latin digits and the Gregorian
        // calendar by default, which is what an accounting table needs.
        numberLocale: 'ur-PK',
        dateLocale: 'ur-PK',
        enabled: true,
    },
    ar: {
        code: 'ar',
        label: 'Arabic',
        nativeLabel: 'العربية',
        htmlLang: 'ar',
        dir: 'rtl',
        // The `-u-nu-latn` extension pins Latin digits. Without it `ar` renders
        // Eastern Arabic numerals (١٢٣), which are correct Arabic but make a
        // ledger unreadable next to the Latin-digit amounts the API returns and
        // break any copy-paste into a spreadsheet.
        numberLocale: 'ar-EG-u-nu-latn',
        dateLocale: 'ar-EG-u-nu-latn',
        enabled: true,
    },
} as const;

export type SupportedLocaleCode = keyof typeof localeRegistry;
export type LocaleConfig = (typeof localeRegistry)[SupportedLocaleCode];
export type LocaleDirection = LocaleConfig['dir'];

export const DEFAULT_LOCALE_CODE = 'en' satisfies SupportedLocaleCode;
export type DefaultLocaleCode = typeof DEFAULT_LOCALE_CODE;

/** Every registered locale, enabled or not. */
export const SUPPORTED_LOCALE_CODES = Object.keys(localeRegistry) as SupportedLocaleCode[];

/** Locales users may actually select right now. */
export const ENABLED_LOCALE_CODES = SUPPORTED_LOCALE_CODES.filter(
    (code) => localeRegistry[code].enabled,
);

/**
 * Enabled locales a tenant can pick as its non-English workspace language.
 * English is always available, so it is never a "secondary" choice.
 */
export const SECONDARY_LOCALE_CODES = ENABLED_LOCALE_CODES.filter(
    (code) => code !== DEFAULT_LOCALE_CODE,
);

export function isSupportedLocaleCode(value: unknown): value is SupportedLocaleCode {
    return typeof value === 'string' && value in localeRegistry;
}

export function isEnabledLocaleCode(value: unknown): value is SupportedLocaleCode {
    return isSupportedLocaleCode(value) && localeRegistry[value].enabled;
}

export function getLocaleConfig(
    locale: SupportedLocaleCode | string | null | undefined = DEFAULT_LOCALE_CODE,
): LocaleConfig {
    return localeRegistry[isSupportedLocaleCode(locale) ? locale : DEFAULT_LOCALE_CODE];
}

/**
 * Maps an `Accept-Language` / `navigator.language` style tag onto a registered
 * locale: exact match first, then the base subtag, so `de-AT` resolves to `de`.
 */
export function getLocaleFromHtmlLang(
    value: string | null | undefined,
): SupportedLocaleCode | null {
    if (!value) return null;

    const normalized = value.toLowerCase();

    for (const locale of Object.values(localeRegistry)) {
        if (normalized === locale.htmlLang || normalized.startsWith(`${locale.htmlLang}-`)) {
            return locale.code;
        }
    }

    return null;
}
