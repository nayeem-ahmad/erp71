'use client';

import {
    DEFAULT_LOCALE,
    LOCALE_COOKIE_NAME,
    LOCALE_STORAGE_KEY,
    getLocaleConfig,
    getLocaleFromHtmlLang,
    isLocale,
    type Locale,
} from './config';

type TenantPreference = {
    default_locale?: unknown;
};

type SessionPreference = {
    preferred_locale?: unknown;
    user?: {
        preferred_locale?: unknown;
    };
    tenants?: TenantPreference[];
};

export function applyLocaleToDocument(locale: Locale) {
    if (typeof document === 'undefined') return;

    const localeInfo = getLocaleConfig(locale);
    document.documentElement.lang = localeInfo.htmlLang;
    document.documentElement.dir = localeInfo.dir;
    document.documentElement.dataset.locale = locale;
}

export function persistLocalePreference(locale: Locale) {
    if (typeof globalThis.window === 'undefined') return;

    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    document.cookie = `${LOCALE_COOKIE_NAME}=${locale}; path=/; max-age=31536000; samesite=lax`;
    applyLocaleToDocument(locale);
}

export function getStoredLocalePreference(): Locale | null {
    if (typeof globalThis.window === 'undefined') return null;

    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(stored)) return stored;

    const htmlLocale = getLocaleFromHtmlLang(document.documentElement.lang);
    if (htmlLocale && isLocale(htmlLocale)) return htmlLocale;

    return null;
}

export function resolveLocalePreference(session: SessionPreference | null | undefined): Locale {
    const candidates = [
        session?.preferred_locale,
        session?.user?.preferred_locale,
        ...(session?.tenants?.map((tenant) => tenant.default_locale) ?? []),
    ];

    for (const candidate of candidates) {
        if (isLocale(candidate)) {
            return candidate;
        }
    }

    return DEFAULT_LOCALE;
}

export function syncLocalePreferenceFromSession(
    session: SessionPreference | null | undefined,
    options: { overwrite?: boolean } = {},
) {
    const current = getStoredLocalePreference();
    if (current && !options.overwrite) {
        applyLocaleToDocument(current);
        return current;
    }

    const resolved = resolveLocalePreference(session);
    persistLocalePreference(resolved);
    return resolved;
}