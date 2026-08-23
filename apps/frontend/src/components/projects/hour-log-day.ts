/**
 * The arithmetic behind the day-grouped hour log.
 *
 * Kept out of the page component because this is the part that is quietly
 * wrong if it is wrong at all: which entries fold into one row, what a day's
 * total is, and what span a folded row covers. A component test can only see
 * the rendered result of these; a unit test can see the rules.
 */

import { COVER_CLASS, type ProjectLabelColor } from './board-tasks';
import {
    dayHeading,
    dayKeyOfDate,
    formatDuration,
    groupRowsByDay,
    localDayKey,
} from '@/lib/day-ledger';

// Re-exported so the hour-log screens keep importing their day helpers from one
// place; the definitions live in `lib/day-ledger` because HR attendance groups
// its rows exactly the same way and must not reach into `components/projects`.
export { dayHeading, formatDuration, localDayKey };

export interface HourLogTag {
    id: string;
    name: string;
    color: string;
}

export interface HourLogEntry {
    id: string;
    work_date: string;
    hours: string | number;
    note?: string | null;
    /** ISO instants. Present together or not at all. */
    started_at?: string | null;
    ended_at?: string | null;
    /** The same span as the `HH:mm` Dhaka wall clock, resolved by the server. */
    start_time?: string | null;
    end_time?: string | null;
    created_at?: string | null;
    tags?: HourLogTag[];
    task?: { id: string; title: string } | null;
    project?: { id: string; code: string; name: string } | null;
    user?: { id: string; name?: string | null; email: string } | null;
}

/**
 * One line on screen. Usually one entry; more when the same task was logged
 * several times in a day with the same note, which is the ordinary shape of a
 * day worked in sittings.
 */
export interface HourLogRow {
    key: string;
    entries: HourLogEntry[];
    hours: number;
    /** The envelope of the folded entries' spans, as `HH:mm`, or nulls. */
    startTime: string | null;
    endTime: string | null;
}

export interface HourLogDay {
    /** `YYYY-MM-DD`, the work date these rows share. */
    key: string;
    hours: number;
    /** Entries, not rows: a folded row of three counts as three. */
    entries: number;
    rows: HourLogRow[];
}

export const hoursOf = (entry: HourLogEntry): number => Number(entry.hours ?? 0);

/** `YYYY-MM-DD` from either a date-only string or a full timestamp. */
export const dayKeyOf = (entry: HourLogEntry): string => dayKeyOfDate(entry.work_date);

/**
 * `1:04:09` for the clock that is currently running — the one place seconds
 * are worth showing, because a number that does not move does not read as
 * running.
 */
export function formatElapsed(totalSeconds: number): string {
    const seconds = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const pad = (value: number) => String(value).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * The palette position a project's dot takes.
 *
 * Derived from the project code rather than stored, because a project has no
 * colour column and inventing one is a settings screen nobody asked for. The
 * hash is stable, so a project keeps its colour between sessions and between
 * people — which is the entire point of a dot you scan for.
 *
 * It is deliberately never the only thing carrying the identity: the code sits
 * beside it, so a collision between two projects that hash alike costs a glance
 * rather than a misreading, and the row stays legible to anyone who cannot
 * distinguish the colours at all.
 */
const DOT_COLORS: ProjectLabelColor[] = ['BLUE', 'EMERALD', 'AMBER', 'PURPLE', 'RED', 'GRAY'];

export function projectDotClass(code: string | null | undefined): string {
    if (!code) return COVER_CLASS.GRAY;
    let hash = 0;
    for (let i = 0; i < code.length; i += 1) {
        hash = (hash * 31 + code.charCodeAt(i)) >>> 0;
    }
    return COVER_CLASS[DOT_COLORS[hash % DOT_COLORS.length]];
}

/**
 * What decides that two entries are the same line of work: the same task, said
 * the same way. Two sittings on one task with different notes stay apart —
 * they are what somebody wrote down separately on purpose, and folding them
 * would throw away the only thing distinguishing them.
 */
const foldKey = (entry: HourLogEntry): string =>
    `${entry.task?.id ?? 'no-task'}|${(entry.note ?? '').trim()}`;

/** Newest first, by when the work happened rather than when it was typed. */
const sortStamp = (entry: HourLogEntry): number => {
    const source = entry.started_at ?? entry.created_at;
    const parsed = source ? Date.parse(source) : Number.NaN;
    return Number.isNaN(parsed) ? 0 : parsed;
};

/**
 * The envelope of a folded row's spans, taken over the real instants and only
 * then formatted. Comparing the `HH:mm` strings instead would put a sitting
 * that ran to 01:00 *before* one that started at 22:00 on the same evening.
 *
 * Entries with no span are ignored rather than treated as zero — a folded row
 * of one timed and one hand-typed entry still shows the span it does know.
 */
function spanEnvelope(entries: HourLogEntry[]): { startTime: string | null; endTime: string | null } {
    let earliest: HourLogEntry | null = null;
    let latest: HourLogEntry | null = null;
    for (const entry of entries) {
        if (!entry.started_at || !entry.ended_at) continue;
        if (!earliest || Date.parse(entry.started_at) < Date.parse(earliest.started_at!)) {
            earliest = entry;
        }
        if (!latest || Date.parse(entry.ended_at) > Date.parse(latest.ended_at!)) {
            latest = entry;
        }
    }
    return {
        startTime: earliest?.start_time ?? null,
        endTime: latest?.end_time ?? null,
    };
}

/**
 * Entries into days, each day into rows.
 *
 * Day order follows the order the entries arrived in, which is the order the
 * server sorted them by — so clicking a column header still changes what the
 * page shows rather than being quietly re-sorted here. Only *within* a day are
 * rows put in time order, where "newest sitting first" is the only reading
 * that makes sense.
 */
export function groupByDay(entries: HourLogEntry[]): HourLogDay[] {
    return groupRowsByDay(entries, dayKeyOf).map(({ key, rows: dayEntries }) => {
        const folded = new Map<string, HourLogEntry[]>();
        for (const entry of dayEntries) {
            const fold = foldKey(entry);
            const bucket = folded.get(fold);
            if (bucket) bucket.push(entry);
            else folded.set(fold, [entry]);
        }

        const rows: HourLogRow[] = [...folded.entries()].map(([fold, rowEntries]) => {
            const ordered = [...rowEntries].sort((a, b) => sortStamp(b) - sortStamp(a));
            return {
                key: `${key}|${fold}`,
                entries: ordered,
                hours: ordered.reduce((sum, entry) => sum + hoursOf(entry), 0),
                ...spanEnvelope(ordered),
            };
        });
        rows.sort((a, b) => sortStamp(b.entries[0]) - sortStamp(a.entries[0]));

        return {
            key,
            rows,
            hours: dayEntries.reduce((sum, entry) => sum + hoursOf(entry), 0),
            entries: dayEntries.length,
        };
    });
}

