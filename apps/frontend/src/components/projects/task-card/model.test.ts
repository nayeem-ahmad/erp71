import { daysUntil, relativeDay, relativeTime, taskKeyOf } from './model';

describe('taskKeyOf', () => {
    it('composes the key the way the backend does', () => {
        expect(taskKeyOf(14, { code: 'PRJ-0002' })).toBe('PRJ-0002-14');
    });

    // A half-key like `PRJ-0002-undefined` is worse than none: it gets copied.
    it('gives nothing while either half is missing', () => {
        expect(taskKeyOf(undefined, { code: 'PRJ-0002' })).toBeNull();
        expect(taskKeyOf(14, null)).toBeNull();
    });
});

describe('daysUntil', () => {
    const today = new Date(2026, 8, 25, 9, 30);

    it('counts calendar days, not instants', () => {
        expect(daysUntil('2026-09-25', today)).toBe(0);
        expect(daysUntil('2026-09-26', today)).toBe(1);
        expect(daysUntil('2026-09-22', today)).toBe(-3);
    });

    /**
     * A `@db.Date` arrives as UTC midnight. Read as an instant it is the
     * previous evening anywhere west of UTC and "already past" late at night
     * anywhere east of it — the trap `dueStateOf` documents.
     */
    it('reads a serialised date by its day, whatever the hour', () => {
        const lateEvening = new Date(2026, 8, 25, 23, 59);
        expect(daysUntil('2026-09-25T00:00:00.000Z', lateEvening)).toBe(0);
    });

    it('crosses a month end', () => {
        expect(daysUntil('2026-10-02', today)).toBe(7);
    });
});

describe('relativeDay', () => {
    const today = new Date(2026, 8, 25, 9, 30);

    it('speaks in days, in the reader’s language', () => {
        expect(relativeDay('2026-09-25', 'en-GB', today)).toBe('today');
        expect(relativeDay('2026-09-26', 'en-GB', today)).toBe('tomorrow');
        expect(relativeDay('2026-09-30', 'en-GB', today)).toBe('in 5 days');
        expect(relativeDay('2026-09-22', 'en-GB', today)).toBe('3 days ago');
    });
});

describe('relativeTime', () => {
    const now = Date.UTC(2026, 8, 25, 12, 0, 0);

    it('picks the unit a person would', () => {
        expect(relativeTime(new Date(now - 30_000).toISOString(), 'en-GB', now)).toBe('now');
        expect(relativeTime(new Date(now - 5 * 60_000).toISOString(), 'en-GB', now)).toBe('5 minutes ago');
        expect(relativeTime(new Date(now - 2 * 3_600_000).toISOString(), 'en-GB', now)).toBe('2 hours ago');
        expect(relativeTime(new Date(now - 3 * 86_400_000).toISOString(), 'en-GB', now)).toBe('3 days ago');
        expect(relativeTime(new Date(now - 60 * 86_400_000).toISOString(), 'en-GB', now)).toBe('2 months ago');
    });

    it('says nothing for a missing or unreadable time', () => {
        expect(relativeTime(null, 'en-GB', now)).toBe('');
        expect(relativeTime('not a date', 'en-GB', now)).toBe('');
    });
});
