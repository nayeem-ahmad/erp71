import {
    dayHeading,
    formatDuration,
    formatElapsed,
    groupByDay,
    projectDotClass,
    spanEndDayKey,
    type HourLogEntry,
} from './hour-log-day';

const entry = (overrides: Partial<HourLogEntry> & { id: string }): HourLogEntry => ({
    work_date: '2026-08-18',
    hours: 1,
    task: { id: 'task-1', title: 'Rewire the counter' },
    project: { id: 'project-1', code: 'BS23', name: 'Bashundhara fit-out' },
    created_at: '2026-08-18T10:00:00.000Z',
    ...overrides,
});

describe('formatDuration', () => {
    it.each([
        [0, '0m'],
        [0.25, '15m'],
        [1, '1h'],
        [4.38, '4h 23m'],
        [8.5, '8h 30m'],
    ])('renders %p as %s', (hours, expected) => {
        expect(formatDuration(hours)).toBe(expected);
    });

    it('never shows seconds — the form steps in quarter hours', () => {
        expect(formatDuration(4.3825)).not.toMatch(/:/);
    });

    it('clamps a negative to zero rather than rendering a minus', () => {
        expect(formatDuration(-2)).toBe('0m');
    });
});

describe('formatElapsed', () => {
    it.each([
        [0, '0:00'],
        [9, '0:09'],
        [65, '1:05'],
        [3849, '1:04:09'],
    ])('renders %i seconds as %s', (seconds, expected) => {
        expect(formatElapsed(seconds)).toBe(expected);
    });

    it('shows seconds, unlike a logged duration — a still number reads as stopped', () => {
        expect(formatElapsed(125)).toBe('2:05');
    });
});

describe('projectDotClass', () => {
    it('is stable for the same code', () => {
        expect(projectDotClass('BS23')).toBe(projectDotClass('BS23'));
    });

    it('separates codes that differ', () => {
        const codes = ['BS23', 'GUL7', 'MIRP', 'DHK1'];
        expect(new Set(codes.map(projectDotClass)).size).toBeGreaterThan(1);
    });

    it('falls back to grey with no code rather than throwing', () => {
        expect(projectDotClass(null)).toBe(projectDotClass(undefined));
    });

    it('only ever returns a class from the fixed palette', () => {
        expect(projectDotClass('ANYTHING')).toMatch(/^bg-(gray|blue|emerald|amber|red|purple)-[45]00$/);
    });
});

describe('groupByDay', () => {
    it('puts entries under their work date and totals the day', () => {
        const days = groupByDay([
            entry({ id: 'a', work_date: '2026-08-18', hours: 4.38 }),
            entry({ id: 'b', work_date: '2026-08-17', hours: 3.2 }),
            entry({ id: 'c', work_date: '2026-08-17', hours: 1.17, note: 'second sitting' }),
        ]);

        expect(days.map((day) => day.key)).toEqual(['2026-08-18', '2026-08-17']);
        expect(days[0].hours).toBeCloseTo(4.38, 2);
        expect(days[1].hours).toBeCloseTo(4.37, 2);
        expect(days[1].entries).toBe(2);
    });

    it('reads a full timestamp work_date as its calendar day', () => {
        const days = groupByDay([entry({ id: 'a', work_date: '2026-08-18T00:00:00.000Z' })]);
        expect(days[0].key).toBe('2026-08-18');
    });

    it('keeps the order the server sent the days in, rather than re-sorting', () => {
        const days = groupByDay([
            entry({ id: 'a', work_date: '2026-08-15' }),
            entry({ id: 'b', work_date: '2026-08-19' }),
        ]);
        expect(days.map((day) => day.key)).toEqual(['2026-08-15', '2026-08-19']);
    });

    describe('folding repeats', () => {
        it('folds the same task logged twice with the same note into one row', () => {
            const days = groupByDay([
                entry({ id: 'a', hours: 3.2 }),
                entry({ id: 'b', hours: 1.17 }),
            ]);

            expect(days[0].rows).toHaveLength(1);
            expect(days[0].rows[0].entries).toHaveLength(2);
            expect(days[0].rows[0].hours).toBeCloseTo(4.37, 2);
            // The day count still reports the real number of entries.
            expect(days[0].entries).toBe(2);
        });

        it('keeps sittings apart when the notes differ — that is what a note is for', () => {
            const days = groupByDay([
                entry({ id: 'a', note: 'wiring' }),
                entry({ id: 'b', note: 'testing' }),
            ]);

            expect(days[0].rows).toHaveLength(2);
        });

        it('treats a blank note and a whitespace note as the same thing', () => {
            const days = groupByDay([
                entry({ id: 'a', note: null }),
                entry({ id: 'b', note: '   ' }),
            ]);

            expect(days[0].rows).toHaveLength(1);
        });

        it('keeps different tasks apart even with the same note', () => {
            const days = groupByDay([
                entry({ id: 'a', note: 'wiring' }),
                entry({ id: 'b', note: 'wiring', task: { id: 'task-2', title: 'Shelving' } }),
            ]);

            expect(days[0].rows).toHaveLength(2);
        });
    });

    describe('the span of a folded row', () => {
        it('is the envelope of the entries it folds', () => {
            const days = groupByDay([
                entry({
                    id: 'a',
                    hours: 3.2,
                    started_at: '2026-08-18T08:00:00.000Z',
                    ended_at: '2026-08-18T11:11:00.000Z',
                    start_time: '14:00',
                    end_time: '17:11',
                }),
                entry({
                    id: 'b',
                    hours: 1.17,
                    started_at: '2026-08-18T11:30:00.000Z',
                    ended_at: '2026-08-18T12:40:00.000Z',
                    start_time: '17:30',
                    end_time: '18:40',
                }),
            ]);

            expect(days[0].rows[0].startTime).toBe('14:00');
            expect(days[0].rows[0].endTime).toBe('18:40');
        });

        it('is ordered by the real instants, so a sitting past midnight still ends last', () => {
            const days = groupByDay([
                entry({
                    id: 'late',
                    started_at: '2026-08-18T17:00:00.000Z',
                    ended_at: '2026-08-18T19:30:00.000Z',
                    start_time: '23:00',
                    end_time: '01:30',
                }),
                entry({
                    id: 'evening',
                    started_at: '2026-08-18T14:00:00.000Z',
                    ended_at: '2026-08-18T16:00:00.000Z',
                    start_time: '20:00',
                    end_time: '22:00',
                }),
            ]);

            // Lexicographic on `HH:mm` would have made 01:30 the earliest end.
            expect(days[0].rows[0].startTime).toBe('20:00');
            expect(days[0].rows[0].endTime).toBe('01:30');
        });

        it('ignores entries with no span rather than counting them as midnight', () => {
            const days = groupByDay([
                entry({ id: 'typed' }),
                entry({
                    id: 'timed',
                    started_at: '2026-08-18T08:00:00.000Z',
                    ended_at: '2026-08-18T10:00:00.000Z',
                    start_time: '14:00',
                    end_time: '16:00',
                }),
            ]);

            expect(days[0].rows[0].startTime).toBe('14:00');
            expect(days[0].rows[0].endTime).toBe('16:00');
        });

        it('is null when nothing in the row has a span', () => {
            const days = groupByDay([entry({ id: 'a' })]);
            expect(days[0].rows[0]).toMatchObject({ startTime: null, endTime: null });
        });
    });

    it('puts the newest sitting first within a day', () => {
        const days = groupByDay([
            entry({ id: 'old', note: 'a', created_at: '2026-08-18T06:00:00.000Z' }),
            entry({ id: 'new', note: 'b', created_at: '2026-08-18T09:00:00.000Z' }),
        ]);

        expect(days[0].rows.map((row) => row.entries[0].id)).toEqual(['new', 'old']);
    });

    it('is empty for no entries rather than producing an empty day', () => {
        expect(groupByDay([])).toEqual([]);
    });
});

describe('dayHeading', () => {
    const labels = { today: 'Today', yesterday: 'Yesterday', locale: 'en-GB' };
    const now = new Date(2026, 7, 18, 15, 0, 0); // 18 Aug 2026, local

    it('names today and yesterday', () => {
        expect(dayHeading('2026-08-18', labels, now)).toBe('Today');
        expect(dayHeading('2026-08-17', labels, now)).toBe('Yesterday');
    });

    it('gives an older day its weekday and date', () => {
        expect(dayHeading('2026-08-15', labels, now)).toMatch(/Sat/);
        expect(dayHeading('2026-08-15', labels, now)).toMatch(/15/);
    });

    it('does not shift the date through the local timezone', () => {
        // The key is a calendar day. Formatted in local time it could render as
        // the 14th for anyone west of UTC.
        expect(dayHeading('2026-08-15', labels, now)).not.toMatch(/14/);
    });

    it('handles a month boundary crossing backwards', () => {
        const firstOfMonth = new Date(2026, 8, 1, 9, 0, 0);
        expect(dayHeading('2026-08-31', labels, firstOfMonth)).toBe('Yesterday');
    });
});

describe('spanEndDayKey', () => {
    it('says nothing when the span stays inside its own day', () => {
        expect(spanEndDayKey('2026-08-18', '09:00', '17:30')).toBeNull();
    });

    it('names the next day when the sitting ran past midnight', () => {
        expect(spanEndDayKey('2026-08-18', '22:00', '02:00')).toBe('2026-08-19');
    });

    it('steps over a month end', () => {
        expect(spanEndDayKey('2026-08-31', '23:00', '01:00')).toBe('2026-09-01');
    });

    it('says nothing for half a span', () => {
        expect(spanEndDayKey('2026-08-18', '22:00', null)).toBeNull();
        expect(spanEndDayKey('2026-08-18', null, '02:00')).toBeNull();
    });
});
