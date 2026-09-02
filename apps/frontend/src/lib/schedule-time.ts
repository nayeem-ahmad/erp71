import { DEFAULT_TIMEZONE, zoneOffsetMinutes } from '@/lib/timezones';
import { getActiveTimeZone, toDatetimeLocal } from '@/lib/format';

function activeZone(): string {
    const zone = getActiveTimeZone() ?? DEFAULT_TIMEZONE;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: zone });
        return zone;
    } catch {
        return DEFAULT_TIMEZONE;
    }
}

/** `+06:00` / `-04:30` for a zone at an instant. */
function offsetSuffix(at: Date): string {
    const minutes = zoneOffsetMinutes(activeZone(), at);
    const sign = minutes < 0 ? '-' : '+';
    const abs = Math.abs(minutes);
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/**
 * Turns a `datetime-local` value into an unambiguous instant.
 *
 * Without this the browser posts a bare wall-clock string. The server now reads
 * an offsetless datetime in `Tenant.timezone` rather than its own, so that is no
 * longer six hours out on its own — but stamping the offset here keeps the wire
 * format explicit, which is what makes the value survive a proxy, a log, or a
 * client that is not this one.
 *
 * The offset is read for the picked instant rather than fixed at `+06:00`: a
 * workspace outside Bangladesh may observe DST, where a constant is wrong for
 * an hour twice a year, and picking a time on the far side of a transition needs
 * that day's offset rather than today's.
 */
export function tenantLocalToIso(localValue: string): string | null {
    if (!localValue) return null;
    const withSeconds = localValue.length === 16 ? `${localValue}:00` : localValue;
    // Read once as if UTC purely to land near the right instant for the offset
    // lookup; the returned string is the wall clock the user picked plus that
    // zone's offset, so the value they typed is preserved exactly.
    const near = new Date(`${withSeconds}Z`);
    return `${withSeconds}${offsetSuffix(Number.isNaN(near.getTime()) ? new Date() : near)}`;
}

/** The inverse: an instant rendered for a `datetime-local` input, in workspace time. */
export function isoToTenantLocal(iso: string | null): string {
    if (!iso) return '';
    const parsed = new Date(iso);
    // An unparseable timestamp is an empty picker, not a crash: formatting an
    // invalid Date throws RangeError, which would take the whole modal down
    // over one bad row of data.
    if (Number.isNaN(parsed.getTime())) return '';
    return toDatetimeLocal(parsed);
}
