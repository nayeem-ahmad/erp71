/**
 * Frontend view of the platform locale registry.
 *
 * The registry itself lives in `@erp71/shared-types` so the backend validates
 * against the same list. This module adds the browser-only concerns (storage
 * keys) and keeps the historical helper names the app already imports.
 */

import {
    DEFAULT_LOCALE_CODE,
    ENABLED_LOCALE_CODES,
    getLocaleConfig,
    getLocaleFromHtmlLang,
    isEnabledLocaleCode,
    isSupportedLocaleCode,
    localeRegistry,
    type LocaleConfig,
    type SupportedLocaleCode,
} from '@erp71/shared-types';

export const LOCALE_STORAGE_KEY = 'locale';
export const LOCALE_COOKIE_NAME = 'locale';

export { localeRegistry, getLocaleConfig, getLocaleFromHtmlLang };
export type { LocaleConfig, SupportedLocaleCode };

export const DEFAULT_LOCALE: Extract<SupportedLocaleCode, 'en'> = DEFAULT_LOCALE_CODE;

export const AVAILABLE_LOCALES = ENABLED_LOCALE_CODES.map(
    (locale) => localeRegistry[locale],
) as readonly LocaleConfig[];

export type Locale = SupportedLocaleCode;

export function isSupportedLocale(value: unknown): value is SupportedLocaleCode {
    return isSupportedLocaleCode(value);
}

export function isLocale(value: unknown): value is Locale {
    return isEnabledLocaleCode(value);
}

export function resolveSupportedLocale(value: unknown): SupportedLocaleCode {
    return isSupportedLocaleCode(value) ? value : DEFAULT_LOCALE;
}

export function resolveLocale(value: unknown): Locale {
    return isLocale(value) ? value : DEFAULT_LOCALE;
}
