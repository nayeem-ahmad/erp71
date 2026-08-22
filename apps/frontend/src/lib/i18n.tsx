'use client';

import React, { createContext, useContext, useEffect, useMemo, useReducer } from 'react';

import {
    AVAILABLE_LOCALES,
    DEFAULT_LOCALE,
    getLocaleConfig,
    getLocaleFromHtmlLang,
    isLocale,
    type Locale,
} from './localization/config';
import { messageCatalog, type MessageDictionary } from './localization/messages';
import { resolvePlurals } from './localization/plural';
import { getStoredLocalePreference, persistLocalePreference } from './localization/preference';

type I18nContextValue = {
    locale: Locale;
    setLocale: (l: Locale) => void;
    locales: typeof AVAILABLE_LOCALES;
    localeInfo: ReturnType<typeof getLocaleConfig>;
    t: MessageDictionary;
    /**
     * `formatMessage` already bound to the active locale, so a component never
     * has to remember to pass it. Plural branches select against the wrong
     * language silently if it is omitted, which is exactly the kind of bug that
     * only shows up in Arabic — prefer this over the bare export inside
     * components.
     */
    fmt: (template: string, values: Record<string, string | number>) => string;
};

function getBrowserPreferredLocale(): Locale {
    if (typeof navigator === 'undefined') return DEFAULT_LOCALE;

    const candidates = [...(navigator.languages || []), navigator.language];
    for (const candidate of candidates) {
        const match = getLocaleFromHtmlLang(candidate);
        if (match && isLocale(match)) {
            return match;
        }
    }

    return DEFAULT_LOCALE;
}

function getInitialClientLocale(fallback: Locale): Locale {
    if (globalThis.window === undefined) return fallback;

    const stored = getStoredLocalePreference();
    if (stored) return stored;

    const htmlLocale = getLocaleFromHtmlLang(document.documentElement.lang);
    if (htmlLocale && isLocale(htmlLocale)) return htmlLocale;

    return getBrowserPreferredLocale();
}

const I18nContext = createContext<I18nContextValue>({
    locale: DEFAULT_LOCALE,
    setLocale: () => undefined,
    locales: AVAILABLE_LOCALES,
    localeInfo: getLocaleConfig(DEFAULT_LOCALE),
    t: messageCatalog[DEFAULT_LOCALE],
    fmt: (template, values) => formatMessage(template, values, DEFAULT_LOCALE),
});

export function I18nProvider({
    children,
    initialLocale = DEFAULT_LOCALE,
}: Readonly<{
    children: React.ReactNode;
    initialLocale?: Locale;
}>) {
    const [locale, setLocaleState] = useReducer((_: Locale, nextLocale: Locale) => nextLocale, initialLocale);

    useEffect(() => {
        const resolved = getInitialClientLocale(initialLocale);
        setLocaleState(resolved);
        persistLocalePreference(resolved);
    }, [initialLocale]);

    const setLocale = (l: Locale) => {
        if (!isLocale(l)) return;
        setLocaleState(l);
        persistLocalePreference(l);
    };

    const value = useMemo(
        () => ({
            locale,
            setLocale,
            locales: AVAILABLE_LOCALES,
            localeInfo: getLocaleConfig(locale),
            t: messageCatalog[locale],
            fmt: (template: string, values: Record<string, string | number>) =>
                formatMessage(template, values, locale),
        }),
        [locale]
    );

    return (
        <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
    );
}

export function useI18n() {
    return useContext(I18nContext);
}

/**
 * Interpolates `{token}` placeholders, resolving any `{n, plural, …}` block
 * first so the chosen branch's own placeholders are substituted in the same
 * pass.
 *
 * `locale` is optional for backward compatibility with the many call sites that
 * predate plural support and interpolate strings with no plural block, where it
 * cannot matter. It does matter the moment a string grows one, and the failure
 * is silent — English rules applied to Arabic pick `other` for 2 and for 15,
 * both of which are wrong. Inside a component prefer `fmt` from `useI18n()`,
 * which is already bound to the active locale.
 */
export function formatMessage(
    template: string,
    values: Record<string, string | number>,
    locale?: Locale,
) {
    if (
        process.env.NODE_ENV !== 'production' &&
        locale === undefined &&
        template.includes(', plural,')
    ) {
        // English rules on an Arabic string pick `other` for 2 and for 15, both
        // wrong, and nothing about the rendered output says so. Loud here beats
        // silently mis-pluralised there.
        console.warn(
            `formatMessage: plural template resolved with the default locale. Use \`fmt\` from useI18n() instead: ${template}`,
        );
    }

    const resolved = resolvePlurals(template, values, getLocaleConfig(locale ?? DEFAULT_LOCALE).htmlLang);

    return Object.entries(values).reduce(
        (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
        resolved,
    );
}

export type { Locale };
