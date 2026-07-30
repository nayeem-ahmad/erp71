import {
    buildBurndownSeries,
    eachDate,
    isWorkingDay,
    workingDays,
} from './burndown.util';

// 2026-08-02 is a Sunday, so this window runs Sun 2nd → Sat 8th and contains
// exactly one Bangladeshi weekend (Fri 7th, Sat 8th).
const SUNDAY = new Date('2026-08-02T00:00:00.000Z');
const SATURDAY = new Date('2026-08-08T00:00:00.000Z');

describe('burndown working days', () => {
    it('treats Friday and Saturday as the weekend, not Saturday and Sunday', () => {
        expect(isWorkingDay('2026-08-02')).toBe(true); // Sunday — a work day here
        expect(isWorkingDay('2026-08-06')).toBe(true); // Thursday
        expect(isWorkingDay('2026-08-07')).toBe(false); // Friday
        expect(isWorkingDay('2026-08-08')).toBe(false); // Saturday
    });

    it('enumerates every calendar day inclusive of both ends', () => {
        expect(eachDate(SUNDAY, SATURDAY)).toHaveLength(7);
    });

    it('drops the weekend from the working set', () => {
        expect(workingDays(SUNDAY, SATURDAY)).toEqual([
            '2026-08-02',
            '2026-08-03',
            '2026-08-04',
            '2026-08-05',
            '2026-08-06',
        ]);
    });

    it('honours an overridden weekend', () => {
        expect(workingDays(SUNDAY, SATURDAY, [0, 6])).not.toContain('2026-08-02');
    });
});

describe('buildBurndownSeries', () => {
    const snapshots = (entries: Record<string, [number, number]>) =>
        new Map(
            Object.entries(entries).map(([date, [remaining, committed]]) => [
                date,
                { remaining, committed },
            ]),
        );

    it('descends the ideal line only on working days', () => {
        const series = buildBurndownSeries({
            startDate: SUNDAY,
            endDate: SATURDAY,
            snapshots: snapshots({ '2026-08-02': [40, 40] }),
        });

        // Five working days → four intervals → 10h per step.
        expect(series.map((p) => p.ideal)).toEqual([40, 30, 20, 10, 0, 0, 0]);
    });

    it('holds the ideal line flat across the weekend rather than falling through it', () => {
        const series = buildBurndownSeries({
            startDate: SUNDAY,
            endDate: SATURDAY,
            snapshots: snapshots({ '2026-08-02': [40, 40] }),
        });

        const friday = series.find((p) => p.date === '2026-08-07')!;
        const saturday = series.find((p) => p.date === '2026-08-08')!;
        const thursday = series.find((p) => p.date === '2026-08-06')!;

        expect(friday.isWorkingDay).toBe(false);
        expect(friday.ideal).toBe(thursday.ideal);
        expect(saturday.ideal).toBe(thursday.ideal);
    });

    it('reaches zero on the last working day, not a day early', () => {
        const series = buildBurndownSeries({
            startDate: SUNDAY,
            endDate: SATURDAY,
            snapshots: snapshots({ '2026-08-02': [40, 40] }),
        });
        expect(series.find((p) => p.date === '2026-08-06')!.ideal).toBe(0);
    });

    it('anchors the ideal line to the opening commitment so later scope shows as overrun', () => {
        const series = buildBurndownSeries({
            startDate: SUNDAY,
            endDate: SATURDAY,
            // Scope doubles on day three; the ideal line must not follow it.
            snapshots: snapshots({
                '2026-08-02': [40, 40],
                '2026-08-03': [30, 40],
                '2026-08-04': [70, 80],
            }),
        });

        expect(series[0].ideal).toBe(40);
        expect(series.find((p) => p.date === '2026-08-04')!.committed).toBe(80);
        // Actual is above the ideal — exactly the signal the chart exists for.
        expect(series.find((p) => p.date === '2026-08-04')!.actual).toBe(70);
        expect(series.find((p) => p.date === '2026-08-04')!.ideal).toBe(20);
    });

    it('leaves days without a snapshot null rather than carrying the last value forward', () => {
        const series = buildBurndownSeries({
            startDate: SUNDAY,
            endDate: SATURDAY,
            snapshots: snapshots({ '2026-08-02': [40, 40] }),
        });
        expect(series[1].actual).toBeNull();
        expect(series[1].committed).toBeNull();
    });

    it('falls back to the earliest snapshot when day one was missed', () => {
        const series = buildBurndownSeries({
            startDate: SUNDAY,
            endDate: SATURDAY,
            snapshots: snapshots({ '2026-08-04': [25, 30] }),
        });
        expect(series[0].ideal).toBe(30);
    });

    it('returns a zero line rather than NaN for a sprint with no snapshots at all', () => {
        const series = buildBurndownSeries({
            startDate: SUNDAY,
            endDate: SATURDAY,
            snapshots: new Map(),
        });
        expect(series).toHaveLength(7);
        expect(series.every((p) => p.ideal === 0)).toBe(true);
        expect(series.every((p) => p.actual === null)).toBe(true);
    });

    it('does not divide by zero for a single-day sprint', () => {
        const series = buildBurndownSeries({
            startDate: SUNDAY,
            endDate: SUNDAY,
            snapshots: snapshots({ '2026-08-02': [8, 8] }),
        });
        expect(series).toHaveLength(1);
        expect(Number.isFinite(series[0].ideal!)).toBe(true);
    });

    it('survives a sprint that spans only the weekend', () => {
        const series = buildBurndownSeries({
            startDate: new Date('2026-08-07T00:00:00.000Z'),
            endDate: new Date('2026-08-08T00:00:00.000Z'),
            snapshots: snapshots({ '2026-08-07': [10, 10] }),
        });
        expect(series).toHaveLength(2);
        expect(series.every((p) => p.isWorkingDay === false)).toBe(true);
        expect(series.every((p) => p.ideal === null)).toBe(true);
    });
});
