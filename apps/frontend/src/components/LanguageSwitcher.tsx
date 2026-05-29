'use client';

import type { ChangeEvent } from 'react';

import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';

export default function LanguageSwitcher() {
    const { locale, locales, setLocale, t } = useI18n();

    const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
        const selectedLocale = locales.find((entry) => entry.code === event.target.value);
        if (selectedLocale) {
            setLocale(selectedLocale.code);
            if (globalThis.window !== undefined && localStorage.getItem('access_token')) {
                void api.updateProfile({ preferred_locale: selectedLocale.code }).catch(() => null);
            }
        }
    };

    return (
        <label
            title={t.localeSwitcher.title}
            className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-600 transition-colors hover:bg-gray-50"
        >
            <span className="hidden sm:inline">{t.localeSwitcher.label}</span>
            <select
                value={locale}
                aria-label={t.localeSwitcher.label}
                onChange={handleChange}
                className="bg-transparent text-xs font-bold text-gray-700 outline-none"
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
