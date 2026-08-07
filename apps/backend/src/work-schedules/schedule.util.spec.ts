import {
    assessDay,
    buildDefaultScheduleDays,
    deriveStatus,
    formatMinutes,
    minutesFromMidnight,
    scheduleInForce,
    scheduledMinutes,
    type ScheduleDay,
} from './schedule.util';

/** A 9:00–18:00 day with an hour's break — 8 working hours. */
const WORKING: ScheduleDay = {
    weekday: 1, is_working: true, start_minute: 540, end_minute: 1080, break_minutes: 60,
};
const OFF: ScheduleDay = {
    weekday: 5, is_working: false, start_minute: null, end_minute: null, break_minutes: 0,
};

/** Local-time Date on an arbitrary day — only the clock part matters here. */
const at = (hours: number, minutes = 0) => new Date(2026, 7, 10, hours, minutes);

describe('schedule.util', () => {
    describe('buildDefaultScheduleDays', () => {
        it('covers all seven weekdays', () => {
            const days = buildDefaultScheduleDays();
            expect(days).toHaveLength(7);
            expect(days.map((d) => d.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
        });

        it('works Sunday to Thursday and rests Friday and Saturday', () => {
            const days = buildDefaultScheduleDays();
            expect(days.filter((d) => d.is_working).map((d) => d.weekday)).toEqual([0, 1, 2, 3, 4]);
            expect(days[5].is_working).toBe(false);
            expect(days[6].is_working).toBe(false);
        });

        it('leaves non-working days with no hours at all', () => {
            // A rest day carrying 9-to-6 would make every downstream sum wrong
            // in a way that looks like data rather than a bug.
            const friday = buildDefaultScheduleDays()[5];
            expect(friday.start_minute).toBeNull();
            expect(friday.end_minute).toBeNull();
            expect(friday.break_minutes).toBe(0);
        });
    });

    describe('scheduledMinutes', () => {
        it('excludes the break', () => {
            expect(scheduledMinutes(WORKING)).toBe(480); // 9 hours minus 1
        });

        it('is zero for a rest day', () => {
            expect(scheduledMinutes(OFF)).toBe(0);
        });

        it('is zero rather than negative when the break swallows the day', () => {
            expect(scheduledMinutes({ ...WORKING, break_minutes: 10_000 })).toBe(0);
        });

        it('is zero for a missing day', () => {
            expect(scheduledMinutes(null)).toBe(0);
            expect(scheduledMinutes(undefined)).toBe(0);
        });
    });

    describe('assessDay', () => {
        it('counts nothing for an on-time full day', () => {
            const result = assessDay(WORKING, at(9), at(18));
            expect(result.lateMinutes).toBe(0);
            expect(result.earlyLeaveMinutes).toBe(0);
            expect(result.workedMinutes).toBe(480);
            expect(result.overtimeMinutes).toBe(0);
        });

        it('forgives arrival inside the grace period', () => {
            // 09:14 with a 15-minute grace is on time; the point of the grace
            // period is that a status nobody can act on is noise.
            expect(assessDay(WORKING, at(9, 14), at(18)).lateMinutes).toBe(0);
        });

        it('counts lateness only beyond the grace period', () => {
            expect(assessDay(WORKING, at(9, 30), at(18)).lateMinutes).toBe(15);
        });

        it('honours a custom grace period', () => {
            expect(assessDay(WORKING, at(9, 30), at(18), 0).lateMinutes).toBe(30);
        });

        it('counts an early departure', () => {
            expect(assessDay(WORKING, at(9), at(17)).earlyLeaveMinutes).toBe(60);
        });

        it('counts overtime past the scheduled end', () => {
            expect(assessDay(WORKING, at(9), at(20)).overtimeMinutes).toBe(120);
        });

        it('records lateness but nothing else when the clock-out is missing', () => {
            // Forgetting to clock out is common; it must not take the whole
            // day's assessment down with it.
            const result = assessDay(WORKING, at(10), null);
            expect(result.lateMinutes).toBe(45);
            expect(result.workedMinutes).toBe(0);
            expect(result.overtimeMinutes).toBe(0);
        });

        it('returns zeroes on a rest day even with clock times', () => {
            const result = assessDay(OFF, at(9), at(18));
            expect(result).toEqual({
                lateMinutes: 0, earlyLeaveMinutes: 0, workedMinutes: 0, overtimeMinutes: 0,
            });
        });

        it('returns zeroes with no clock-in', () => {
            expect(assessDay(WORKING, null, null).workedMinutes).toBe(0);
        });
    });

    describe('deriveStatus', () => {
        const assess = (clockIn: Date | null, clockOut: Date | null) => assessDay(WORKING, clockIn, clockOut);

        it('is PRESENT for an on-time full day', () => {
            expect(deriveStatus(WORKING, assess(at(9), at(18)), { hasClockIn: true })).toBe('PRESENT');
        });

        it('is ABSENT with no clock-in', () => {
            expect(deriveStatus(WORKING, assess(null, null), { hasClockIn: false })).toBe('ABSENT');
        });

        it('is HOLIDAY on a declared holiday, whatever the schedule says', () => {
            expect(deriveStatus(WORKING, assess(at(9), at(18)), { isHoliday: true, hasClockIn: true }))
                .toBe('HOLIDAY');
        });

        it('is HOLIDAY on a non-working weekday', () => {
            expect(deriveStatus(OFF, assess(null, null), { hasClockIn: false })).toBe('HOLIDAY');
        });

        it('is LATE for a late arrival', () => {
            expect(deriveStatus(WORKING, assess(at(10), at(18)), { hasClockIn: true })).toBe('LATE');
        });

        it('is EARLY_LEAVE for an on-time arrival and early departure', () => {
            expect(deriveStatus(WORKING, assess(at(9), at(17)), { hasClockIn: true })).toBe('EARLY_LEAVE');
        });

        it('is HALF_DAY when less than half the schedule was worked', () => {
            // 12:00–15:00 is 3h against an 8h day — under half, so it has a pay
            // consequence that outranks the lateness.
            expect(deriveStatus(WORKING, assess(at(12), at(15)), { hasClockIn: true })).toBe('HALF_DAY');
        });

        it('prefers LATE over EARLY_LEAVE when both apply', () => {
            // Documented precedence: lateness is what a manager acts on. The
            // early-leave minutes are still recorded on the row.
            const assessment = assess(at(10), at(17));
            expect(assessment.lateMinutes).toBeGreaterThan(0);
            expect(assessment.earlyLeaveMinutes).toBeGreaterThan(0);
            expect(deriveStatus(WORKING, assessment, { hasClockIn: true })).toBe('LATE');
        });

        it('prefers HALF_DAY over LATE', () => {
            expect(deriveStatus(WORKING, assess(at(14), at(16)), { hasClockIn: true })).toBe('HALF_DAY');
        });
    });

    describe('scheduleInForce', () => {
        const d = (iso: string) => new Date(iso);
        // Newest first, as the service's `orderBy: { effective_from: 'desc' }` returns them.
        const assignments = [
            { effective_from: d('2026-06-01'), id: 'newest' },
            { effective_from: d('2026-01-01'), id: 'middle' },
            { effective_from: d('2025-01-01'), id: 'oldest' },
        ];

        it('picks the newest assignment not in the future', () => {
            expect(scheduleInForce(assignments, d('2026-08-01'))?.id).toBe('newest');
        });

        it('picks the one in force at a past date, not the current one', () => {
            // The whole reason assignments are dated: recomputing March must use
            // March's schedule, or a payroll rerun silently changes history.
            expect(scheduleInForce(assignments, d('2026-03-01'))?.id).toBe('middle');
        });

        it('includes an assignment effective exactly on the date', () => {
            expect(scheduleInForce(assignments, d('2026-06-01'))?.id).toBe('newest');
        });

        it('returns null before the first assignment', () => {
            expect(scheduleInForce(assignments, d('2024-01-01'))).toBeNull();
        });

        it('returns null with no assignments', () => {
            expect(scheduleInForce([], d('2026-08-01'))).toBeNull();
        });
    });

    describe('minute helpers', () => {
        it('converts a clock time to minutes from midnight', () => {
            expect(minutesFromMidnight(at(9, 30))).toBe(570);
            expect(minutesFromMidnight(at(0, 0))).toBe(0);
        });

        it('formats minutes back to a padded clock time', () => {
            expect(formatMinutes(540)).toBe('09:00');
            expect(formatMinutes(1080)).toBe('18:00');
            expect(formatMinutes(5)).toBe('00:05');
        });
    });
});
