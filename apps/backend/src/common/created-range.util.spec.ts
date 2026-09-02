import { createdAtRange } from './created-range.util';

/**
 * The exhaustive day-boundary and DST cases live in `tenant-time.util.spec.ts`,
 * which owns the arithmetic. What matters here is that the `created_at` filter
 * every list endpoint uses really is measured in the tenant's zone rather than
 * the server's, and that a junk bound cannot widen a query by accident.
 */
describe('createdAtRange', () => {
    it('returns undefined when neither bound is set', () => {
        expect(createdAtRange(undefined, undefined, 'Asia/Dhaka')).toBeUndefined();
        expect(createdAtRange('', '', 'Asia/Dhaka')).toBeUndefined();
    });

    it('ignores unparseable dates rather than throwing', () => {
        expect(createdAtRange('yesterday', 'nope', 'Asia/Dhaka')).toBeUndefined();
        expect(createdAtRange('2026-02-31', undefined, 'Asia/Dhaka')).toBeUndefined();
    });

    it('covers both chosen days end to end in the tenant zone', () => {
        expect(createdAtRange('2026-08-12', '2026-08-19', 'Asia/Dhaka')).toEqual({
            gte: new Date('2026-08-11T18:00:00.000Z'),
            lte: new Date('2026-08-19T17:59:59.999Z'),
        });
    });

    it('places the same calendar day differently for a tenant in another zone', () => {
        // The whole point of the column: one date string, two different windows.
        expect(createdAtRange('2026-08-19', '2026-08-19', 'America/New_York')).toEqual({
            gte: new Date('2026-08-19T04:00:00.000Z'),
            lte: new Date('2026-08-20T03:59:59.999Z'),
        });
    });

    it('honours a lone valid bound when the other is garbage', () => {
        expect(createdAtRange('2026-08-19', 'nope', 'Asia/Dhaka')).toEqual({
            gte: new Date('2026-08-18T18:00:00.000Z'),
        });
    });

    it('falls back to the platform zone rather than throwing on a bad stored zone', () => {
        expect(createdAtRange('2026-08-19', undefined, 'Mars/Olympus')).toEqual({
            gte: new Date('2026-08-18T18:00:00.000Z'),
        });
        expect(createdAtRange('2026-08-19', undefined, undefined)).toEqual({
            gte: new Date('2026-08-18T18:00:00.000Z'),
        });
    });
});
