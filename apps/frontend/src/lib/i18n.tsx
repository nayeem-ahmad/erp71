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
import { getStoredLocalePreference, persistLocalePreference } from './localization/preference';

type I18nContextValue = {
    locale: Locale;
    setLocale: (l: Locale) => void;
    locales: typeof AVAILABLE_LOCALES;
    localeInfo: ReturnType<typeof getLocaleConfig>;
    t: MessageDictionary;
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

export type { Locale };
