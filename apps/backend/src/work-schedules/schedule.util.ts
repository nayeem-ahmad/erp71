/**
 * Pure schedule arithmetic, kept out of the service so attendance capture
 * (Phase 3) and overtime (Phase 4) can both use it without a database.
 *
 * Everything here works in **minutes from local midnight**, matching how
 * `WorkScheduleDay` stores its times and why — see the model comment.
 */

export interface ScheduleDay {
    weekday: number;
    is_working: boolean;
    start_minute: number | null;
    end_minute: number | null;
    break_minutes: number;
}

/** A standard 9am–6pm Sunday–Thursday week, the Bangladeshi office default. */
export const DEFAULT_SCHEDULE_NAME = 'Standard (Sun–Thu, 9:00–18:00)';
export const DEFAULT_WORKING_WEEKDAYS = [0, 1, 2, 3, 4] as const; // Sun–Thu
export const DEFAULT_START_MINUTE = 9 * 60;
export const DEFAULT_END_MINUTE = 18 * 60;
export const DEFAULT_BREAK_MINUTES = 60;

/**
 * How late an arrival may be before it counts as late.
 *
 * A grace period is not decoration: without one, every clock-in at 09:00:30
 * reads as late and the status becomes noise nobody acts on. Fifteen minutes is
 * the common Bangladeshi office convention; it is a constant rather than a
 * setting until a tenant asks, because a per-tenant knob nobody changes is
 * worse than a documented default.
 */
export const DEFAULT_GRACE_MINUTES = 15;

export function buildDefaultScheduleDays(): ScheduleDay[] {
    return Array.from({ length: 7 }, (_, weekday) => {
        const working = (DEFAULT_WORKING_WEEKDAYS as readonly number[]).includes(weekday);
        return {
            weekday,
            is_working: working,
            start_minute: working ? DEFAULT_START_MINUTE : null,
            end_minute: working ? DEFAULT_END_MINUTE : null,
            break_minutes: working ? DEFAULT_BREAK_MINUTES : 0,
        };
    });
}

/** Minutes from local midnight for a Date, in the server's local zone. */
export function minutesFromMidnight(date: Date): number {
    return date.getHours() * 60 + date.getMinutes();
}

/** `540` → `"09:00"`. For display and for reading a test failure. */
export function formatMinutes(minute: number): string {
    const hours = Math.floor(minute / 60);
    const mins = minute % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/** Scheduled working minutes for a day, break excluded. */
export function scheduledMinutes(day: ScheduleDay | null | undefined): number {
    if (!day?.is_working || day.start_minute == null || day.end_minute == null) return 0;
    return Math.max(0, day.end_minute - day.start_minute - day.break_minutes);
}

export interface DayAssessment {
    /** Minutes past the scheduled start, after the grace period. 0 if on time. */
    lateMinutes: number;
    /** Minutes before the scheduled end. 0 if they stayed. */
    earlyLeaveMinutes: number;
    /** Actual minutes between clock-in and clock-out, break excluded. */
    workedMinutes: number;
    /** Worked beyond the scheduled end. Raw — approval is Phase 4's job. */
    overtimeMinutes: number;
}

/**
 * Compare an actual in/out pair against the day's schedule.
 *
 * Returns zeroes rather than throwing on a non-working day or a missing
 * clock-out: an attendance row with no clock-out is a real and common state
 * (someone forgot), and it must not take the day's assessment down with it.
 */
export function assessDay(
    day: ScheduleDay | null | undefined,
    clockIn: Date | null | undefined,
    clockOut: Date | null | undefined,
    graceMinutes: number = DEFAULT_GRACE_MINUTES,
): DayAssessment {
    const empty: DayAssessment = {
        lateMinutes: 0, earlyLeaveMinutes: 0, workedMinutes: 0, overtimeMinutes: 0,
    };
    if (!day?.is_working || day.start_minute == null || day.end_minute == null) return empty;
    if (!clockIn) return empty;

    const inMinute = minutesFromMidnight(clockIn);
    const lateBy = inMinute - (day.start_minute + graceMinutes);
    const lateMinutes = Math.max(0, lateBy);

    if (!clockOut) {
        return { ...empty, lateMinutes };
    }

    const outMinute = minutesFromMidnight(clockOut);
    const earlyLeaveMinutes = Math.max(0, day.end_minute - outMinute);
    const workedMinutes = Math.max(0, outMinute - inMinute - day.break_minutes);
    const overtimeMinutes = Math.max(0, outMinute - day.end_minute);

    return { lateMinutes, earlyLeaveMinutes, workedMinutes, overtimeMinutes };
}

export type DerivedStatus = 'PRESENT' | 'LATE' | 'EARLY_LEAVE' | 'HALF_DAY' | 'ABSENT' | 'HOLIDAY';

/**
 * The status a day earns from its schedule and its clock times.
 *
 * Precedence is deliberate and worth stating because it is a policy, not a
 * detail: a holiday beats everything (it is not a working day at all), then a
 * half day (worked less than half the schedule — a pay consequence), then
 * lateness, then early leaving. Late-*and*-early resolves to LATE because
 * arriving late is the thing a manager acts on; the early-leave minutes are
 * still recorded on the row either way.
 */
export function deriveStatus(
    day: ScheduleDay | null | undefined,
    assessment: DayAssessment,
    opts: { isHoliday?: boolean; hasClockIn?: boolean } = {},
): DerivedStatus {
    if (opts.isHoliday) return 'HOLIDAY';
    if (!day?.is_working) return 'HOLIDAY';
    if (!opts.hasClockIn) return 'ABSENT';

    const expected = scheduledMinutes(day);
    if (expected > 0 && assessment.workedMinutes > 0 && assessment.workedMinutes < expected / 2) {
        return 'HALF_DAY';
    }
    if (assessment.lateMinutes > 0) return 'LATE';
    if (assessment.earlyLeaveMinutes > 0) return 'EARLY_LEAVE';
    return 'PRESENT';
}

/**
 * Pick the schedule in force on `date` from an employee's assignment history,
 * newest effective date that is not in the future.
 *
 * Assignments are expected sorted by `effective_from` descending; this does not
 * re-sort so the caller's `orderBy` stays the single source of that ordering.
 */
export function scheduleInForce<T extends { effective_from: Date }>(
    assignments: T[],
    date: Date,
): T | null {
    for (const assignment of assignments) {
        if (assignment.effective_from <= date) return assignment;
    }
    return null;
}
