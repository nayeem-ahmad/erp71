import {
    DEFAULT_TENANT_TIMEZONE,
    addCalendarDays,
    isValidTimeZone,
    parseTenantDateTime,
    resolveZone,
    startOfNextZonedDay,
    startOfZonedToday,
    zoneOffsetMinutes,
    zonedDateString,
    zonedDayRange,
    zonedDayStart,
    zonedParts,
    zonedTodayWindow,
} from './tenant-time.util';

describe('tenant-time.util', () => {
    describe('isValidTimeZone / resolveZone', () => {
        it('accepts IANA names and rejects anything else', () => {
            expect(isValidTimeZone('Asia/Dhaka')).toBe(true);
            expect(isValidTimeZone('America/New_York')).toBe(true);
            expect(isValidTimeZone('UTC')).toBe(true);
            expect(isValidTimeZone('Mars/Olympus')).toBe(false);
            expect(isValidTimeZone('+06:00')).toBe(false);
            expect(isValidTimeZone('')).toBe(false);
            expect(isValidTimeZone(null)).toBe(false);
        });

        it('falls back to Dhaka rather than throwing on a bad stored zone', () => {
            expect(resolveZone('Mars/Olympus')).toBe(DEFAULT_TENANT_TIMEZONE);
            expect(resolveZone(undefined)).toBe(DEFAULT_TENANT_TIMEZONE);
            expect(resolveZone('Europe/Berlin')).toBe('Europe/Berlin');
        });
    });

    describe('zoneOffsetMinutes', () => {
        it('reads Dhaka as a flat UTC+6 all year', () => {
            expect(zoneOffsetMinutes('Asia/Dhaka', new Date('2026-01-15T00:00:00Z'))).toBe(360);
            expect(zoneOffsetMinutes('Asia/Dhaka', new Date('2026-07-15T00:00:00Z'))).toBe(360);
        });

        it('tracks DST where the zone observes it', () => {
            // The whole reason the stored-offset design was rejected.
            expect(zoneOffsetMinutes('Europe/Berlin', new Date('2026-01-15T12:00:00Z'))).toBe(60);
            expect(zoneOffsetMinutes('Europe/Berlin', new Date('2026-07-15T12:00:00Z'))).toBe(120);
            expect(zoneOffsetMinutes('America/New_York', new Date('2026-01-15T12:00:00Z'))).toBe(-300);
            expect(zoneOffsetMinutes('America/New_York', new Date('2026-07-15T12:00:00Z'))).toBe(-240);
        });

        it('handles half-hour and three-quarter-hour zones', () => {
            expect(zoneOffsetMinutes('Asia/Kolkata', new Date('2026-07-15T12:00:00Z'))).toBe(330);
            expect(zoneOffsetMinutes('Asia/Kathmandu', new Date('2026-07-15T12:00:00Z'))).toBe(345);
        });
    });

    describe('zonedDayStart', () => {
        it('maps a Dhaka calendar day to 18:00 UTC the day before', () => {
            expect(zonedDayStart('2026-08-19', 'Asia/Dhaka')).toEqual(
                new Date('2026-08-18T18:00:00.000Z'),
            );
        });

        it('maps the same day differently in another zone', () => {
            expect(zonedDayStart('2026-08-19', 'America/New_York')).toEqual(
                new Date('2026-08-19T04:00:00.000Z'),
            );
            expect(zonedDayStart('2026-01-19', 'America/New_York')).toEqual(
                new Date('2026-01-19T05:00:00.000Z'),
            );
        });

        it('rejects impossible calendar dates rather than rolling them forward', () => {
            expect(zonedDayStart('2026-02-31', 'Asia/Dhaka')).toBeNull();
            expect(zonedDayStart('yesterday', 'Asia/Dhaka')).toBeNull();
            expect(zonedDayStart(undefined, 'Asia/Dhaka')).toBeNull();
        });

        it('resolves a day whose local midnight DST skips to the instant clocks jump to', () => {
            // Chile springs forward at midnight: 2026-09-06 00:00 does not exist.
            const start = zonedDayStart('2026-09-06', 'America/Santiago');
            expect(start).toEqual(new Date('2026-09-06T04:00:00.000Z'));
        });
    });

    describe('zonedDayRange', () => {
        it('returns undefined when neither bound parses', () => {
            expect(zonedDayRange(undefined, undefined, 'Asia/Dhaka')).toBeUndefined();
            expect(zonedDayRange('', '', 'Asia/Dhaka')).toBeUndefined();
            expect(zonedDayRange('yesterday', 'nope', 'Asia/Dhaka')).toBeUndefined();
        });

        it('covers both chosen days end to end in Dhaka', () => {
            expect(zonedDayRange('2026-08-12', '2026-08-19', 'Asia/Dhaka')).toEqual({
                gte: new Date('2026-08-11T18:00:00.000Z'),
                lte: new Date('2026-08-19T17:59:59.999Z'),
            });
        });

        it('honours a lone valid bound when the other is garbage', () => {
            expect(zonedDayRange('2026-08-19', 'nope', 'Asia/Dhaka')).toEqual({
                gte: new Date('2026-08-18T18:00:00.000Z'),
            });
        });

        it('keeps a DST day exactly one day long, not exactly 24 hours', () => {
            // 2026-03-29 is 23 hours in Berlin. A `start + 24h - 1ms` end would
            // spill an hour into the 30th.
            expect(zonedDayRange('2026-03-29', '2026-03-29', 'Europe/Berlin')).toEqual({
                gte: new Date('2026-03-28T23:00:00.000Z'),
                lte: new Date('2026-03-29T21:59:59.999Z'),
            });
            // 2026-10-25 is 25 hours. A 24-hour end would drop the last hour.
            expect(zonedDayRange('2026-10-25', '2026-10-25', 'Europe/Berlin')).toEqual({
                gte: new Date('2026-10-24T22:00:00.000Z'),
                lte: new Date('2026-10-25T22:59:59.999Z'),
            });
        });
    });

    describe('startOfZonedToday / zonedTodayWindow', () => {
        it('anchors on the tenant day, not the UTC day', () => {
            // 05:00 UTC on the 1st is 11am on the 1st in Dhaka but still 1am on
            // the 1st in New York — same UTC date, two different day starts.
            const now = new Date('2026-09-01T05:00:00Z');
            expect(startOfZonedToday('Asia/Dhaka', now)).toEqual(
                new Date('2026-08-31T18:00:00.000Z'),
            );
            expect(startOfZonedToday('America/New_York', now)).toEqual(
                new Date('2026-09-01T04:00:00.000Z'),
            );
        });

        it('rolls the tenant day over before UTC does', () => {
            // 20:00 UTC on the 1st is already 2am on the 2nd in Dhaka.
            const now = new Date('2026-09-01T20:00:00Z');
            expect(startOfZonedToday('Asia/Dhaka', now)).toEqual(
                new Date('2026-09-01T18:00:00.000Z'),
            );
            expect(zonedDateString(now, 'Asia/Dhaka')).toBe('2026-09-02');
        });

        it('produces a half-open window covering exactly the tenant day', () => {
            const now = new Date('2026-09-01T05:00:00Z');
            expect(zonedTodayWindow('Asia/Dhaka', now)).toEqual({
                gte: new Date('2026-08-31T18:00:00.000Z'),
                lt: new Date('2026-09-01T18:00:00.000Z'),
            });
        });

        it('spans 25 hours across a fall-back transition', () => {
            const now = new Date('2026-10-25T12:00:00Z');
            const window = zonedTodayWindow('Europe/Berlin', now);
            expect(window.lt.getTime() - window.gte.getTime()).toBe(25 * 60 * 60 * 1000);
        });
    });

    describe('startOfNextZonedDay', () => {
        it('crosses a month boundary correctly', () => {
            expect(startOfNextZonedDay(new Date('2026-08-31T12:00:00Z'), 'Asia/Dhaka')).toEqual(
                new Date('2026-08-31T18:00:00.000Z'),
            );
        });
    });

    describe('addCalendarDays', () => {
        it('does month and year arithmetic on the string', () => {
            expect(addCalendarDays('2026-08-31', 1)).toBe('2026-09-01');
            expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
            expect(addCalendarDays('2026-03-01', -1)).toBe('2026-02-28');
            expect(addCalendarDays('nope', 1)).toBe('nope');
        });
    });

    describe('zonedParts', () => {
        it('reads the local hour and weekday, not the UTC ones', () => {
            // 2026-09-01 is a Tuesday. 20:00 UTC is 02:00 Wednesday in Dhaka.
            expect(zonedParts(new Date('2026-09-01T20:00:00Z'), 'Asia/Dhaka')).toEqual({
                hour: 2,
                weekday: 3,
                date: '2026-09-02',
            });
        });
    });

    describe('parseTenantDateTime', () => {
        it('reads a naked datetime-local value as tenant wall clock', () => {
            // The write-path bug: 8pm in Dhaka, not 8pm UTC (= 2am the next day).
            expect(parseTenantDateTime('2026-09-01T20:00', 'Asia/Dhaka')).toEqual(
                new Date('2026-09-01T14:00:00.000Z'),
            );
            expect(parseTenantDateTime('2026-09-01T20:00:30', 'Asia/Dhaka')).toEqual(
                new Date('2026-09-01T14:00:30.000Z'),
            );
        });

        it('leaves an instant that already names its offset alone', () => {
            expect(parseTenantDateTime('2026-09-01T20:00:00Z', 'Asia/Dhaka')).toEqual(
                new Date('2026-09-01T20:00:00.000Z'),
            );
            expect(parseTenantDateTime('2026-09-01T20:00:00+05:30', 'Asia/Dhaka')).toEqual(
                new Date('2026-09-01T14:30:00.000Z'),
            );
        });

        it('treats a bare date as the start of that tenant day', () => {
            expect(parseTenantDateTime('2026-09-01', 'Asia/Dhaka')).toEqual(
                new Date('2026-08-31T18:00:00.000Z'),
            );
        });

        it('passes Dates through and maps empty and unparseable input to null', () => {
            const instant = new Date('2026-09-01T20:00:00Z');
            expect(parseTenantDateTime(instant, 'Asia/Dhaka')).toBe(instant);
            expect(parseTenantDateTime('', 'Asia/Dhaka')).toBeNull();
            expect(parseTenantDateTime(null, 'Asia/Dhaka')).toBeNull();
            expect(parseTenantDateTime(undefined, 'Asia/Dhaka')).toBeNull();
            expect(parseTenantDateTime('not a date', 'Asia/Dhaka')).toBeNull();
        });
    });
});
