'use client';

import { useI18n, type Locale } from '../lib/i18n';

export default function LanguageSwitcher() {
    const { locale, setLocale } = useI18n();

    const toggle = () => setLocale(locale === 'en' ? 'bn' : 'en');

    return (
        <button
            onClick={toggle}
            title={locale === 'en' ? 'Switch to Bangla' : 'Switch to English'}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-gray-200 hover:bg-gray-50 transition-colors text-gray-600"
        >
            <span className="text-base leading-none">{locale === 'en' ? '🇧🇩' : '🇺🇸'}</span>
            <span>{locale === 'en' ? 'বাংলা' : 'English'}</span>
        </button>
    );
}
