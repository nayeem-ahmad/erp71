import {
    buildSpan,
    dhakaDateKey,
    dhakaDayStart,
    dhakaTimeOfDay,
    hoursBetween,
    parseTimeOfDay,
    workDateFor,
    spanTimes,
    spansOverlap,
} from './project-time-span.util';

/** Dhaka is UTC+6, so 09:00 local on a day is 03:00Z on that same day. */
const utc = (iso: string) => new Date(iso);

describe('project time spans', () => {
    describe('parseTimeOfDay', () => {
        it.each([
            ['00:00', 0],
            ['09:05', 545],
            ['23:59', 1439],
        ])('reads %s as %i minutes', (value, minutes) => {
            expect(parseTimeOfDay(value)).toBe(minutes);
        });

        it.each(['', '24:00', '9:05', '09:60', 'noon', null, undefined])(
            'refuses %p',
            (value) => {
                expect(parseTimeOfDay(value as string)).toBeNull();
            },
        );
    });

    describe('dhakaDayStart', () => {
        it('is the instant Dhaka midnight begins, which is 18:00Z the day before', () => {
            expect(dhakaDayStart('2026-08-18')?.toISOString()).toBe('2026-08-17T18:00:00.000Z');
        });

        it('accepts a full timestamp by reading only its date part', () => {
            expect(dhakaDayStart('2026-08-18T00:00:00.000Z')?.toISOString()).toBe(
                '2026-08-17T18:00:00.000Z',
            );
        });

        it('rejects a day that does not exist rather than rolling it forward', () => {
            expect(dhakaDayStart('2026-02-31')).toBeNull();
        });

        it.each(['', 'yesterday', '18-08-2026', null, undefined])('rejects %p', (value) => {
            expect(dhakaDayStart(value as string)).toBeNull();
        });
    });

    describe('dhakaDateKey / dhakaTimeOfDay', () => {
        it('reads an instant as the Dhaka wall clock, not the UTC one', () => {
            // 20:30Z is already 02:30 the next morning in Dhaka.
            const instant = utc('2026-08-18T20:30:00.000Z');
            expect(dhakaDateKey(instant)).toBe('2026-08-19');
            expect(dhakaTimeOfDay(instant)).toBe('02:30');
        });

        it('keeps a Dhaka afternoon on its own day', () => {
            const instant = utc('2026-08-18T07:45:00.000Z');
            expect(dhakaDateKey(instant)).toBe('2026-08-18');
            expect(dhakaTimeOfDay(instant)).toBe('13:45');
        });
    });

    describe('hoursBetween', () => {
        it('rounds to the two decimals a timesheet is read in', () => {
            // 13:45 → 18:08 is the 4h23m from the screen this was modelled on.
            expect(
                hoursBetween(utc('2026-08-18T07:45:00Z'), utc('2026-08-18T12:08:00Z')),
            ).toBe(4.38);
        });

        it('is negative when the ends are the wrong way round, rather than absolute', () => {
            expect(
                hoursBetween(utc('2026-08-18T12:00:00Z'), utc('2026-08-18T10:00:00Z')),
            ).toBe(-2);
        });
    });

    describe('buildSpan', () => {
        it('returns no span and no error when neither end is given', () => {
            expect(buildSpan('2026-08-18', undefined, undefined)).toEqual({
                error: null,
                span: null,
            });
        });

        it.each([
            ['13:45', undefined],
            [undefined, '18:08'],
            ['13:45', ''],
        ])('refuses half a span (%p, %p)', (start, end) => {
            expect(buildSpan('2026-08-18', start, end).error).toBe('HALF_SPAN');
        });

        it('resolves a Dhaka wall clock to UTC instants and derives the hours', () => {
            const { span, error } = buildSpan('2026-08-18', '13:45', '18:08');
            expect(error).toBeNull();
            expect(span?.startedAt.toISOString()).toBe('2026-08-18T07:45:00.000Z');
            expect(span?.endedAt.toISOString()).toBe('2026-08-18T12:08:00.000Z');
            expect(span?.hours).toBe(4.38);
        });

        it('reads an end before the start as crossing midnight, not as a mistake', () => {
            const { span } = buildSpan('2026-08-18', '22:00', '02:00');
            expect(span?.hours).toBe(4);
            // Still the 18th's work, even though it finished on the 19th.
            expect(span?.startedAt.toISOString()).toBe('2026-08-18T16:00:00.000Z');
            expect(span?.endedAt.toISOString()).toBe('2026-08-18T20:00:00.000Z');
        });

        it('refuses identical ends — zero and twenty-four hours are equally likely', () => {
            expect(buildSpan('2026-08-18', '09:00', '09:00').error).toBe('ZERO_LENGTH');
        });

        it('reads a reversed typo as a long crossing rather than an error', () => {
            // 18:00 → 08:00 means 08:00 the next morning. The span is on the row
            // precisely so a 14-hour entry is visible as wrong.
            expect(buildSpan('2026-08-18', '18:00', '08:00').span?.hours).toBe(14);
        });

        it('accepts the shortest and longest spans the shape allows', () => {
            expect(buildSpan('2026-08-18', '00:00', '00:01').span?.hours).toBe(0.02);
            // 23h59m is the ceiling by construction, so nothing can exceed a day.
            expect(buildSpan('2026-08-18', '00:01', '00:00').span?.hours).toBe(23.98);
        });

        it('refuses a bad date and a bad time distinctly', () => {
            expect(buildSpan('2026-02-31', '09:00', '10:00').error).toBe('BAD_DATE');
            expect(buildSpan('2026-08-18', '9:00', '10:00').error).toBe('BAD_TIME');
        });
    });

    describe('workDateFor', () => {
        it('is UTC midnight of the Dhaka day, which is what a @db.Date reads back', () => {
            // 17:30Z on the 18th is 23:30 in Dhaka — still the 18th's work.
            expect(workDateFor(utc('2026-08-18T17:30:00Z')).toISOString()).toBe(
                '2026-08-18T00:00:00.000Z',
            );
        });

        it('rolls to the next day once Dhaka has, even though UTC has not', () => {
            // 19:00Z on the 18th is 01:00 on the 19th in Dhaka.
            expect(workDateFor(utc('2026-08-18T19:00:00Z')).toISOString()).toBe(
                '2026-08-19T00:00:00.000Z',
            );
        });

        it('is not the instant the Dhaka day began — that would file it a day early', () => {
            expect(workDateFor(utc('2026-08-18T07:45:00Z')).toISOString()).not.toBe(
                dhakaDayStart('2026-08-18')?.toISOString(),
            );
        });
    });

    describe('spansOverlap', () => {
        const a = [utc('2026-08-18T09:00:00Z'), utc('2026-08-18T11:00:00Z')] as const;

        it('is false for back-to-back spans — the normal way a day is logged', () => {
            expect(
                spansOverlap(
                    a[0],
                    a[1],
                    utc('2026-08-18T11:00:00Z'),
                    utc('2026-08-18T13:00:00Z'),
                ),
            ).toBe(false);
        });

        it('is true for a span that starts inside another', () => {
            expect(
                spansOverlap(
                    a[0],
                    a[1],
                    utc('2026-08-18T10:59:00Z'),
                    utc('2026-08-18T13:00:00Z'),
                ),
            ).toBe(true);
        });

        it('is true for a span wholly containing another, either way round', () => {
            const outer = [utc('2026-08-18T08:00:00Z'), utc('2026-08-18T12:00:00Z')] as const;
            expect(spansOverlap(a[0], a[1], outer[0], outer[1])).toBe(true);
            expect(spansOverlap(outer[0], outer[1], a[0], a[1])).toBe(true);
        });
    });

    describe('spanTimes', () => {
        it('reads a stored span back as the Dhaka clock it was typed as', () => {
            expect(
                spanTimes(utc('2026-08-18T07:45:00Z'), utc('2026-08-18T12:08:00Z')),
            ).toEqual({ start_time: '13:45', end_time: '18:08' });
        });

        it('is two nulls for the entries that have no span, which is most of them', () => {
            expect(spanTimes(null, null)).toEqual({ start_time: null, end_time: null });
        });
    });

    describe('round trip', () => {
        it('a span typed, stored and read back is the same clock', () => {
            const { span } = buildSpan('2026-08-18', '13:45', '18:08');
            expect(spanTimes(span!.startedAt, span!.endedAt)).toEqual({
                start_time: '13:45',
                end_time: '18:08',
            });
        });

        it('an evening that runs past midnight still belongs to the day it began', () => {
            const { span } = buildSpan('2026-08-18', '23:30', '01:30');
            expect(dhakaDateKey(span!.startedAt)).toBe('2026-08-18');
            expect(dhakaDateKey(span!.endedAt)).toBe('2026-08-19');
            expect(span!.hours).toBe(2);
        });
    });
});
