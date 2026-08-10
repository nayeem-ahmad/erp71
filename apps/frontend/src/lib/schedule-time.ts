// ERP71 serves Bangladeshi retailers. Campaign schedules are always picked in
// Dhaka wall-clock time, and Bangladesh has no daylight saving, so a fixed
// +06:00 offset is exact rather than an approximation.
const DHAKA_OFFSET = '+06:00';
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

/**
 * Turns a `datetime-local` value into an unambiguous instant.
 *
 * Without this the browser posts a bare wall-clock string, which the UTC
 * server reads as UTC — putting every scheduled campaign six hours out.
 */
export function dhakaLocalToIso(localValue: string): string | null {
    if (!localValue) return null;
    const withSeconds = localValue.length === 16 ? `${localValue}:00` : localValue;
    return `${withSeconds}${DHAKA_OFFSET}`;
}

/** The inverse: an instant rendered for a `datetime-local` input, in Dhaka time. */
export function isoToDhakaLocal(iso: string | null): string {
    if (!iso) return '';
    const shifted = new Date(new Date(iso).getTime() + DHAKA_OFFSET_MS);
    return shifted.toISOString().slice(0, 16);
}
