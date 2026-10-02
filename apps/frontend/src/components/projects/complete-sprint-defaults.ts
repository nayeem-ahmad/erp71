/**
 * What the Complete dialog offers for the sprint that carries the unfinished
 * work: the old name with its last number moved on, starting the day after the
 * old sprint ends and running as long as it did.
 */

/**
 * "Sprint 7" → "Sprint 8", "Release 2.1" → "Release 2.2", "Sprint 09" →
 * "Sprint 10". Only a number the name *ends* with moves, keeping its zero
 * padding where it still fits — "Q3 sprint" is a label, not a sequence — and
 * any other name gets " 2".
 */
export function nextSprintName(name: string): string {
    const trimmed = name.trim();
    const match = /(\d+)$/.exec(trimmed);
    if (!match) return `${trimmed} 2`;
    const digits = match[1];
    const next = String(Number(digits) + 1).padStart(digits.length, '0');
    return `${trimmed.slice(0, match.index)}${next}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const toTime = (value: string) => Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
const toKey = (time: number) => new Date(time).toISOString().slice(0, 10);

/** `YYYY-MM-DD` dates for the next sprint: the day after `end`, same length. */
export function nextSprintDates(start: string, end: string): { startDate: string; endDate: string } {
    const length = Math.max(Math.round((toTime(end) - toTime(start)) / DAY_MS), 0);
    const nextStart = toTime(end) + DAY_MS;
    return { startDate: toKey(nextStart), endDate: toKey(nextStart + length * DAY_MS) };
}
