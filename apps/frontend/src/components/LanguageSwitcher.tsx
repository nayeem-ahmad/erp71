'use client';

import type { ChangeEvent } from 'react';
import { Languages } from 'lucide-react';

import { useTenantLocales } from '@/contexts/TenantLocaleContext';
import { localeRegistry } from '@/lib/localization/config';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { getAccessToken } from '@/lib/session-store';

/**
 * The language choice, as a row of the avatar menu. It is set once and rarely
 * changed, so it does not earn a control of its own in the header.
 */
export default function LanguageSwitcher() {
    const { locale, setLocale, t } = useI18n();
    const { allowedLocales, showLanguageSwitcher } = useTenantLocales();
    const locales = allowedLocales.map((code) => localeRegistry[code]);

    if (!showLanguageSwitcher) return null;

    const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
        const selectedLocale = locales.find((entry) => entry.code === event.target.value);
        if (selectedLocale) {
            setLocale(selectedLocale.code);
            if (globalThis.window !== undefined && getAccessToken()) {
                void api.updateProfile({ preferred_locale: selectedLocale.code }).catch(() => null);
            }
        }
    };

    return (
        <label
            title={t.localeSwitcher.title}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-gray-700 transition-colors hover:bg-gray-50"
        >
            <Languages className="h-4 w-4 flex-shrink-0 text-gray-400" aria-hidden />
            <span className="flex-1">{t.localeSwitcher.label}</span>
            <select
                value={locale}
                aria-label={t.localeSwitcher.label}
                onChange={handleChange}
                className="max-w-[8rem] truncate bg-transparent text-end text-sm font-medium text-gray-900 outline-none"
            >
                {locales.map((entry) => (
                    <option key={entry.code} value={entry.code}>
                        {entry.nativeLabel}
                    </option>
                ))}
            </select>
        </label>
    );
}
