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


/**
 * The workspace's IANA zone, set once by the app shell from the tenant record.
 *
 * Dates are rendered in the workspace's zone rather than the device's so that a
 * list agrees with the filters the server applied to build it. A shopkeeper who
 * opens the app from another country should still see their own shop's days —
 * otherwise "due today" returns rows that render as yesterday.
 *
 * Ambient rather than threaded through every call because these formatters are
 * already ambient: they resolve the locale the same way, and are called from
 * hundreds of components that have no business knowing about either.
 */
let activeTimeZone: string | undefined;

export function setActiveTimeZone(timeZone: string | null | undefined): void {
    activeTimeZone = timeZone ?? undefined;
}

/** Undefined lets `Intl` fall back to the device zone, which is the old behaviour. */
export function getActiveTimeZone(): string | undefined {
    return activeTimeZone;
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
        timeZone: activeTimeZone,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    });
}

/**
 * Date plus time of day, for timelines where "12/08/2026" twice in a row reads
 * as a bug rather than as two updates on the same day.
 */
export function formatDateTime(
    date: string | Date | null | undefined,
    locale?: SupportedLocaleCode | string | null
): string {
    if (!date) return '—';

    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) return '—';

    const localeConfig = getLocaleConfig(resolveFormatterLocale(locale));

    return d.toLocaleString(localeConfig.dateLocale, {
        timeZone: activeTimeZone,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
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

/**
 * Formats a Date as a `datetime-local` input value (`yyyy-MM-ddTHH:mm`).
 *
 * Rendered in the workspace zone, matching how the server reads the value back:
 * an offsetless `datetime-local` is interpreted as the tenant's wall clock, so
 * reopening a follow-up must show the time it was actually scheduled for rather
 * than that instant translated into the device's zone.
 *
 * `timeZone` overrides the ambient one for a caller that has already resolved
 * which zone it means. Without it the fallback is still the device zone, which
 * is what the sales screens have always rendered in.
 */
export function toDatetimeLocal(date: Date, timeZone?: string): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    const zone = timeZone ?? activeTimeZone;

    if (zone) {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: zone,
            hour12: false,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        }).formatToParts(date);
        const read = (type: Intl.DateTimeFormatPartTypes) =>
            parts.find((part) => part.type === type)?.value ?? '00';
        // `hour12: false` emits 24 for midnight in some engines.
        const hour = String(Number(read('hour')) % 24).padStart(2, '0');
        return `${read('year')}-${read('month')}-${read('day')}T${hour}:${read('minute')}`;
    }

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
