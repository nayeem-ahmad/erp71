export const LOCALE_STORAGE_KEY = 'locale';
export const LOCALE_COOKIE_NAME = 'locale';

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
} as const;

export type SupportedLocaleCode = keyof typeof localeRegistry;
export type LocaleConfig = (typeof localeRegistry)[SupportedLocaleCode];

export const DEFAULT_LOCALE: Extract<SupportedLocaleCode, 'en'> = 'en';

const enabledLocaleCodes = Object.keys(localeRegistry).filter((locale) => localeRegistry[locale as SupportedLocaleCode].enabled) as SupportedLocaleCode[];

export const AVAILABLE_LOCALES = enabledLocaleCodes.map((locale) => localeRegistry[locale]) as readonly LocaleConfig[];
export type Locale = (typeof enabledLocaleCodes)[number];

export function isSupportedLocale(value: unknown): value is SupportedLocaleCode {
    return typeof value === 'string' && value in localeRegistry;
}

export function isLocale(value: unknown): value is Locale {
    return isSupportedLocale(value) && localeRegistry[value].enabled;
}

export function resolveSupportedLocale(value: unknown): SupportedLocaleCode {
    return isSupportedLocale(value) ? value : DEFAULT_LOCALE;
}

export function resolveLocale(value: unknown): Locale {
    return isLocale(value) ? value : DEFAULT_LOCALE;
}

export function getLocaleConfig(locale: SupportedLocaleCode | Locale = DEFAULT_LOCALE): LocaleConfig {
    return localeRegistry[resolveSupportedLocale(locale)];
}

export function getLocaleFromHtmlLang(value: string | null | undefined): SupportedLocaleCode | null {
    if (!value) return null;

    const normalized = value.toLowerCase();

    for (const locale of Object.values(localeRegistry)) {
        if (normalized === locale.htmlLang || normalized.startsWith(`${locale.htmlLang}-`)) {
            return locale.code;
        }
    }

    return null;
}