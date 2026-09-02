/**
 * The timezone choices offered in workspace settings.
 *
 * A shortlist rather than the ~400 zones `Intl.supportedValuesOf` knows about:
 * this is a picker a shopkeeper uses once, and scrolling a full IANA list to
 * find your own city is worse than a curated one that covers the markets the
 * product actually serves. The backend validates against the runtime's real zone
 * database, so a zone missing here is a UI gap, never a correctness one.
 */
export const TIMEZONE_OPTIONS = [
    { value: 'Asia/Dhaka', label: 'Dhaka (Bangladesh)' },
    { value: 'Asia/Kolkata', label: 'Kolkata (India)' },
    { value: 'Asia/Karachi', label: 'Karachi (Pakistan)' },
    { value: 'Asia/Kathmandu', label: 'Kathmandu (Nepal)' },
    { value: 'Asia/Colombo', label: 'Colombo (Sri Lanka)' },
    { value: 'Asia/Yangon', label: 'Yangon (Myanmar)' },
    { value: 'Asia/Bangkok', label: 'Bangkok (Thailand)' },
    { value: 'Asia/Singapore', label: 'Singapore' },
    { value: 'Asia/Kuala_Lumpur', label: 'Kuala Lumpur (Malaysia)' },
    { value: 'Asia/Jakarta', label: 'Jakarta (Indonesia)' },
    { value: 'Asia/Manila', label: 'Manila (Philippines)' },
    { value: 'Asia/Hong_Kong', label: 'Hong Kong' },
    { value: 'Asia/Shanghai', label: 'Shanghai (China)' },
    { value: 'Asia/Tokyo', label: 'Tokyo (Japan)' },
    { value: 'Asia/Dubai', label: 'Dubai (UAE)' },
    { value: 'Asia/Riyadh', label: 'Riyadh (Saudi Arabia)' },
    { value: 'Asia/Qatar', label: 'Doha (Qatar)' },
    { value: 'Asia/Kuwait', label: 'Kuwait' },
    { value: 'Europe/London', label: 'London (UK)' },
    { value: 'Europe/Berlin', label: 'Berlin (Germany)' },
    { value: 'Europe/Paris', label: 'Paris (France)' },
    { value: 'Europe/Madrid', label: 'Madrid (Spain)' },
    { value: 'Europe/Istanbul', label: 'Istanbul (Türkiye)' },
    { value: 'Africa/Cairo', label: 'Cairo (Egypt)' },
    { value: 'America/New_York', label: 'New York (US Eastern)' },
    { value: 'America/Chicago', label: 'Chicago (US Central)' },
    { value: 'America/Los_Angeles', label: 'Los Angeles (US Pacific)' },
    { value: 'America/Toronto', label: 'Toronto (Canada)' },
    { value: 'Australia/Sydney', label: 'Sydney (Australia)' },
    { value: 'UTC', label: 'UTC' },
] as const;

/** What the platform assumes until a workspace says otherwise. */
export const DEFAULT_TIMEZONE = 'Asia/Dhaka';

/**
 * The current wall clock in a zone, so the picker can show the consequence of
 * the choice rather than just its name — "17:42" is a far better check that you
 * picked the right zone than "Asia/Dhaka" is.
 */
export function currentTimeInZone(timeZone: string, locale?: string): string | null {
    try {
        return new Intl.DateTimeFormat(locale, {
            timeZone,
            hour: '2-digit',
            minute: '2-digit',
            weekday: 'short',
        }).format(new Date());
    } catch {
        return null;
    }
}
