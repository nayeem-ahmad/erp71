'use client';

import React, { createContext, use, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';

import {
    AVAILABLE_LOCALES,
    DEFAULT_LOCALE,
    getLocaleConfig,
    getLocaleFromHtmlLang,
    isLocale,
    type Locale,
} from './localization/config';
import { getLoadedMessages, loadMessages } from './localization/load-messages';
import { enMessages, type MessageDictionary } from './localization/messages';
import { resolvePlurals } from './localization/plural';
import {
    applyLocaleToDocument,
    getStoredLocalePreference,
    persistLocalePreference,
} from './localization/preference';

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
    t: enMessages,
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

    /*
     * Only the first render can find the dictionary missing — `setLocale`
     * never commits a locale before its dictionary has arrived. That render is
     * hydration, and it must use the dictionary the server rendered with, so
     * for any language but English it suspends until the chunk is here.
     *
     * There is deliberately no <Suspense> around this. Suspending outside every
     * boundary holds the root instead of showing a fallback: the server's shell
     * waits for its local chunk rather than streaming an empty page with the
     * app behind it, and the browser leaves the server's HTML — already in the
     * right language — on screen, untouched, until hydration can finish. No
     * flash of English, no mismatch. The cost is that a first-time Bangla
     * visitor's page turns interactive one chunk later.
     */
    const messages = getLoadedMessages(locale) ?? use(loadMessages(locale));

    // English back for another language means its chunk failed (an offline
    // till). Say English throughout, so plurals, dates and text direction match
    // the words actually on screen.
    const activeLocale = messages === enMessages ? DEFAULT_LOCALE : locale;

    // The locale a switch is waiting on, so a slow load that a later choice
    // has overtaken does not land on top of it.
    const pendingLocale = useRef<Locale | null>(null);
    useEffect(
        () => () => {
            pendingLocale.current = null;
        },
        [],
    );

    const setLocale = useCallback((l: Locale) => {
        if (!isLocale(l)) return;
        pendingLocale.current = l;

        if (getLoadedMessages(l)) {
            setLocaleState(l);
            persistLocalePreference(l);
            return;
        }

        // Load first, switch after: committing a locale whose dictionary has
        // not arrived would suspend the whole app mid-session.
        void loadMessages(l).then(() => {
            if (pendingLocale.current !== l) return;
            // Its chunk failed, and `loadMessages` has said so. Staying in the
            // current language beats claiming Bangla while showing English, and
            // leaves the saved preference for the next page load to retry.
            if (!getLoadedMessages(l)) return;
            setLocaleState(l);
            persistLocalePreference(l);
        });
    }, []);

    useEffect(() => {
        setLocale(getInitialClientLocale(initialLocale));
    }, [initialLocale, setLocale]);

    // The server marked <html> with a language whose chunk then failed here.
    // Mark it English to match — without persisting, so the preference survives.
    useEffect(() => {
        if (activeLocale !== locale) applyLocaleToDocument(activeLocale);
    }, [activeLocale, locale]);

    const value = useMemo(
        () => ({
            locale: activeLocale,
            setLocale,
            locales: AVAILABLE_LOCALES,
            localeInfo: getLocaleConfig(activeLocale),
            t: messages,
            fmt: (template: string, values: Record<string, string | number>) =>
                formatMessage(template, values, activeLocale),
        }),
        [activeLocale, messages, setLocale]
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
