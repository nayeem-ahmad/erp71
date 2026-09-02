import { tenantLocalToIso, isoToTenantLocal } from './schedule-time';
import { setActiveTimeZone } from './format';

// The workspace zone is ambient; every test that does not set one gets the
// platform default, which is what an unauthenticated render sees too.
afterEach(() => setActiveTimeZone(undefined));

describe('tenantLocalToIso', () => {
    it('stamps a datetime-local value with the default zone when none is set', () => {
        expect(tenantLocalToIso('2026-08-10T14:30')).toBe('2026-08-10T14:30:00+06:00');
    });

    it('keeps seconds when the picker supplies them', () => {
        expect(tenantLocalToIso('2026-08-10T14:30:45')).toBe('2026-08-10T14:30:45+06:00');
    });


    it('stamps it with the workspace zone rather than a fixed Dhaka offset', () => {
        setActiveTimeZone('Asia/Kolkata');
        expect(tenantLocalToIso('2026-08-10T14:30')).toBe('2026-08-10T14:30:00+05:30');

        setActiveTimeZone('America/New_York');
        expect(tenantLocalToIso('2026-08-10T14:30')).toBe('2026-08-10T14:30:00-04:00');
    });

    it('reads the offset for the picked date, not for today', () => {
        // New York is -04:00 in August and -05:00 in January. A constant offset
        // would put a January campaign an hour out.
        setActiveTimeZone('America/New_York');
        expect(tenantLocalToIso('2026-01-10T14:30')).toBe('2026-01-10T14:30:00-05:00');
    });

    it('falls back to the default rather than throwing on a zone this build cannot use', () => {
        setActiveTimeZone('Mars/Olympus');
        expect(tenantLocalToIso('2026-08-10T14:30')).toBe('2026-08-10T14:30:00+06:00');
    });

    it('returns null for an empty value', () => {
        expect(tenantLocalToIso('')).toBeNull();
    });

    it('resolves to the right instant', () => {
        expect(new Date(tenantLocalToIso('2026-08-10T14:30')!).toISOString()).toBe(
            '2026-08-10T08:30:00.000Z',
        );
    });
});

describe('isoToTenantLocal', () => {
    it('renders an instant as a Dhaka datetime-local value', () => {
        expect(isoToTenantLocal('2026-08-10T08:30:00.000Z')).toBe('2026-08-10T14:30');
    });

    it('rolls over the date when Dhaka is already tomorrow', () => {
        expect(isoToTenantLocal('2026-08-10T20:00:00.000Z')).toBe('2026-08-11T02:00');
    });

    it('returns an empty string for null', () => {
        expect(isoToTenantLocal(null)).toBe('');
    });

    it.each(['not a date', '2026-13-45T99:99', ''])(
        'returns an empty string rather than throwing on %p',
        (bad) => {
            expect(() => isoToTenantLocal(bad)).not.toThrow();
            expect(isoToTenantLocal(bad)).toBe('');
        },
    );
});
