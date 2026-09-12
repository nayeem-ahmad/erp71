import { eachDate, replayDailyTotals, type RemainingLogEntry } from './burndown.util';

const at = (iso: string) => new Date(`${iso}T10:00:00.000Z`);
const entry = (taskId: string, hours: number, iso: string): RemainingLogEntry => ({
    taskId,
    hours,
    changedAt: at(iso),
});

describe('replayDailyTotals', () => {
    const days = eachDate(new Date('2026-09-01T00:00:00Z'), new Date('2026-09-05T00:00:00Z'));

    it('carries a figure forward across days with no writes', () => {
        const totals = replayDailyTotals([entry('t1', 8, '2026-09-01')], days);

        expect(totals.get('2026-09-01')?.remaining).toBe(8);
        expect(totals.get('2026-09-04')?.remaining).toBe(8);
    });

    it('says nothing about days before the first write', () => {
        const totals = replayDailyTotals([entry('t1', 8, '2026-09-03')], days);

        expect(totals.has('2026-09-02')).toBe(false);
        expect(totals.get('2026-09-03')?.remaining).toBe(8);
    });

    it('sums across tasks', () => {
        const totals = replayDailyTotals(
            [entry('t1', 8, '2026-09-01'), entry('t2', 4, '2026-09-01')],
            days,
        );

        expect(totals.get('2026-09-01')?.remaining).toBe(12);
    });

    it('replaces a task figure rather than adding to it', () => {
        const totals = replayDailyTotals(
            [entry('t1', 8, '2026-09-01'), entry('t1', 5, '2026-09-03')],
            days,
        );

        expect(totals.get('2026-09-02')?.remaining).toBe(8);
        expect(totals.get('2026-09-03')?.remaining).toBe(5);
    });

    /** Scope added later has to raise the committed line, not flatten the slope. */
    it('counts a task added later towards committed from the day it appears', () => {
        const totals = replayDailyTotals(
            [entry('t1', 8, '2026-09-01'), entry('t2', 6, '2026-09-04')],
            days,
        );

        expect(totals.get('2026-09-01')?.committed).toBe(8);
        expect(totals.get('2026-09-04')?.committed).toBe(14);
    });

    it('never lowers committed when a task burns down', () => {
        const totals = replayDailyTotals(
            [entry('t1', 8, '2026-09-01'), entry('t1', 0, '2026-09-05')],
            days,
        );

        expect(totals.get('2026-09-05')).toEqual({ remaining: 0, committed: 8 });
    });

    it('takes writes in time order however the rows arrive', () => {
        const totals = replayDailyTotals(
            [entry('t1', 5, '2026-09-03'), entry('t1', 8, '2026-09-01')],
            days,
        );

        expect(totals.get('2026-09-01')?.remaining).toBe(8);
        expect(totals.get('2026-09-03')?.remaining).toBe(5);
    });

    // A write at 23:50 Dhaka belongs to the day it happened, not the next one.
    it('counts a late write towards its own day', () => {
        const late: RemainingLogEntry = {
            taskId: 't1',
            hours: 3,
            changedAt: new Date('2026-09-02T23:50:00.000Z'),
        };
        const totals = replayDailyTotals([entry('t1', 8, '2026-09-01'), late], days);

        expect(totals.get('2026-09-02')?.remaining).toBe(3);
    });

    it('returns nothing at all for an empty log', () => {
        expect(replayDailyTotals([], days).size).toBe(0);
    });
});
