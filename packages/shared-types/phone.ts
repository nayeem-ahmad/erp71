export const DEFAULT_MOBILE_COUNTRY_CODE = 'BD';

export interface MobileCountryOption {
    code: string;
    dial: string;
    label: string;
    /** Max national digits (excluding country code). */
    nationalLength: number;
}

export const MOBILE_COUNTRY_OPTIONS: MobileCountryOption[] = [
    { code: 'BD', dial: '+880', label: 'Bangladesh', nationalLength: 11 },
    { code: 'IN', dial: '+91', label: 'India', nationalLength: 10 },
    { code: 'MY', dial: '+60', label: 'Malaysia', nationalLength: 10 },
    { code: 'SG', dial: '+65', label: 'Singapore', nationalLength: 8 },
    { code: 'US', dial: '+1', label: 'United States', nationalLength: 10 },
    { code: 'GB', dial: '+44', label: 'United Kingdom', nationalLength: 10 },
    { code: 'AE', dial: '+971', label: 'UAE', nationalLength: 9 },
    { code: 'SA', dial: '+966', label: 'Saudi Arabia', nationalLength: 9 },
];

const E164_REGEX = /^\+[1-9]\d{7,14}$/;

export function getMobileCountryOption(code: string): MobileCountryOption | undefined {
    return MOBILE_COUNTRY_OPTIONS.find((entry) => entry.code === code);
}

export function isValidE164Mobile(value: string): boolean {
    return E164_REGEX.test(value.trim());
}

/** Normalize national digits + ISO country into E.164, or null if invalid. */
export function normalizeMobileToE164(countryCode: string, rawNational: string): string | null {
    const country = getMobileCountryOption(countryCode);
    if (!country) return null;

    const digits = rawNational.replace(/\D/g, '');
    if (!digits) return null;

    let national = digits;
    if (country.code === 'BD' && national.startsWith('880')) {
        national = national.slice(3);
    }
    if (national.startsWith('0')) {
        national = national.slice(1);
    }

    if (national.length < 7 || national.length > country.nationalLength) {
        return null;
    }

    const e164 = `${country.dial}${national}`;
    return isValidE164Mobile(e164) ? e164 : null;
}

/**
 * Best-effort reverse of `normalizeMobileToE164`: which of the supported
 * countries does this E.164 number belong to? Used when a number arrives
 * already in E.164 (a verified Firebase phone identity, say) and the account
 * still needs a `mobile_country_code` to store alongside it.
 *
 * Longest dial prefix wins, so `+1` never shadows a longer code that starts
 * with the same digits.
 */
export function countryCodeFromE164(e164: string | null | undefined): string | null {
    const value = (e164 ?? '').trim();
    if (!isValidE164Mobile(value)) return null;

    let match: MobileCountryOption | null = null;
    for (const country of MOBILE_COUNTRY_OPTIONS) {
        if (!value.startsWith(country.dial)) continue;
        if (!match || country.dial.length > match.dial.length) {
            match = country;
        }
    }
    return match?.code ?? null;
}

export function formatMobileForDisplay(e164: string | null | undefined, countryCode = DEFAULT_MOBILE_COUNTRY_CODE): string {
    if (!e164) return '—';
    const country = getMobileCountryOption(countryCode);
    if (!country || !e164.startsWith(country.dial)) return e164;
    return `${country.dial} ${e164.slice(country.dial.length)}`;
}