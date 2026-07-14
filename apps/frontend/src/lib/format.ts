import {
    DEFAULT_LOCALE,
    LOCALE_STORAGE_KEY,
    getLocaleConfig,
    getLocaleFromHtmlLang,
    isSupportedLocale,
    resolveSupportedLocale,
    type SupportedLocaleCode,
} from './localization/config';

type CurrencyCode = 'BDT' | 'MYR' | 'USD' | string;

type FormatOptions = {
    locale?: SupportedLocaleCode | string | null;
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
};

type CurrencyFormatOptions = FormatOptions & {
    currency?: CurrencyCode;
};

const currencySymbols: Record<string, string> = {
    BDT: '৳',
    MYR: 'RM',
    USD: '$',
};

function getCurrentLocale(): SupportedLocaleCode {
    if (typeof document !== 'undefined') {
        const htmlLocale = getLocaleFromHtmlLang(document.documentElement.lang);
        if (htmlLocale) return htmlLocale;
    }

    if (typeof window !== 'undefined') {
        const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
        if (isSupportedLocale(stored)) return stored;
    }

    return DEFAULT_LOCALE;
}

function resolveFormatterLocale(locale?: SupportedLocaleCode | string | null): SupportedLocaleCode {
    if (isSupportedLocale(locale)) return locale;

    if (typeof locale === 'string') {
        const htmlLocale = getLocaleFromHtmlLang(locale);
        if (htmlLocale) return htmlLocale;
    }

    return getCurrentLocale();
}

function getCurrencySymbol(currency: CurrencyCode): string {
    return currencySymbols[currency] || currency;
}

export function formatCurrency(
    amount: number | null | undefined,
    {
        locale,
        currency = 'BDT',
        minimumFractionDigits = 2,
        maximumFractionDigits = 2,
    }: CurrencyFormatOptions = {}
): string {
    const resolvedLocale = resolveFormatterLocale(locale);
    const localeConfig = getLocaleConfig(resolvedLocale);
    const value = amount == null ? 0 : Number(amount);

    return `${getCurrencySymbol(currency)} ${new Intl.NumberFormat(localeConfig.numberLocale, {
        minimumFractionDigits,
        maximumFractionDigits,
    }).format(value)}`;
}

export function formatBDT(
    amount: number | null | undefined,
    options: Omit<CurrencyFormatOptions, 'currency'> = {}
): string {
    return formatCurrency(amount, { ...options, currency: 'BDT' });
}

export function formatDate(
    date: string | Date | null | undefined,
    locale?: SupportedLocaleCode | string | null
): string {
    if (!date) return '—';

    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) return '—';

    const localeConfig = getLocaleConfig(resolveFormatterLocale(locale));

    return d.toLocaleDateString(localeConfig.dateLocale, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    });
}

export function formatNumber(
    n: number,
    locale?: SupportedLocaleCode | string | null
): string {
    const localeConfig = getLocaleConfig(resolveFormatterLocale(locale));
    return new Intl.NumberFormat(localeConfig.numberLocale).format(n);
}

export function resolveLocaleForFormatting(locale?: SupportedLocaleCode | string | null): SupportedLocaleCode {
    return resolveSupportedLocale(resolveFormatterLocale(locale));
}

// Formats a Date as a `datetime-local` input value (`yyyy-MM-ddTHH:mm`) in local time.
export function toDatetimeLocal(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
