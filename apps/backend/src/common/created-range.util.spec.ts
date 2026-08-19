import { createdAtRange } from './created-range.util';

/**
 * Dhaka is UTC+6 with no DST. A shopkeeper who picks 19 Aug means the
 * calendar day in Bangladesh, not the UTC midnight that `new Date('2026-08-19')`
 * would produce (which is already 6am locally).
 */
describe('createdAtRange', () => {
    it('returns undefined when neither bound is set', () => {
        expect(createdAtRange()).toBeUndefined();
        expect(createdAtRange(undefined, undefined)).toBeUndefined();
        expect(createdAtRange('', '')).toBeUndefined();
    });

    it('ignores unparseable dates rather than throwing', () => {
        expect(createdAtRange('yesterday', 'nope')).toBeUndefined();
        expect(createdAtRange('2026-02-31')).toBeUndefined();
    });

    it('maps a from date to Dhaka midnight (inclusive)', () => {
        const range = createdAtRange('2026-08-19');
        // 19 Aug 00:00 Dhaka = 18 Aug 18:00 UTC
        expect(range).toEqual({ gte: new Date('2026-08-18T18:00:00.000Z') });
    });

    it('maps a to date to the last millisecond of that Dhaka day', () => {
        const range = createdAtRange(undefined, '2026-08-19');
        // 19 Aug 23:59:59.999 Dhaka = 19 Aug 17:59:59.999 UTC
        expect(range).toEqual({ lte: new Date('2026-08-19T17:59:59.999Z') });
    });

    it('keeps both ends inclusive of the chosen calendar days', () => {
        const range = createdAtRange('2026-08-12', '2026-08-19');
        expect(range).toEqual({
            gte: new Date('2026-08-11T18:00:00.000Z'),
            lte: new Date('2026-08-19T17:59:59.999Z'),
        });
    });

    it('honours a lone valid bound when the other is garbage', () => {
        expect(createdAtRange('2026-08-19', 'nope')).toEqual({
            gte: new Date('2026-08-18T18:00:00.000Z'),
        });
    });
});
