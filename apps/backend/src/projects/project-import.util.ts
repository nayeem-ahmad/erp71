/**
 * Turning a spreadsheet cell into something the project services can take.
 *
 * Import files are written by people, not by the API: a column holds a project
 * code, a board column's name, someone's email, `12/03/2026`, `3.5`. These
 * helpers are the narrow layer that turns that into ids, ISO dates and numbers,
 * and — just as importantly — fails a row with a sentence naming the value that
 * could not be read. `runImport` prefixes it with the row number, so a bad cell
 * reads as `Row 7: no project matches "ACME-2"` in the import report rather
 * than as a Prisma dump.
 */

/** A trimmed cell, or `null` for one that is blank in any of the ways a sheet can be blank. */
export function importText(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    return text === '' ? null : text;
}

/**
 * A cell that has to be there. Used for the fields `runImport`'s
 * `requiredFields` already guards, so this is the cast rather than the check.
 */
export function requiredText(value: unknown, label: string): string {
    const text = importText(value);
    if (text === null) throw new Error(`${label} is required`);
    return text;
}

export function importNumber(value: unknown, label: string): number | null {
    const text = importText(value);
    if (text === null) return null;
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) throw new Error(`${label} must be a number (got "${text}")`);
    return parsed;
}

/**
 * A date cell as `YYYY-MM-DD`. Anything `Date` can read is accepted, because a
 * sheet exports a date in whatever format the machine that wrote it prefers,
 * and the day is all any of these fields store.
 */
export function importDate(value: unknown, label: string): string | null {
    const text = importText(value);
    if (text === null) return null;
    // A bare `YYYY-MM-DD` is kept as written. Parsing it would read it as UTC
    // midnight, which is the previous day in any timezone west of Greenwich.
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) throw new Error(`${label} is not a date (got "${text}")`);
    return parsed.toISOString().slice(0, 10);
}

/** A `HH:mm` cell. `9:05` is accepted and normalised; `9am` is not a time. */
export function importTimeOfDay(value: unknown, label: string): string | null {
    const text = importText(value);
    if (text === null) return null;
    const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(text);
    const hour = match ? Number(match[1]) : NaN;
    const minute = match ? Number(match[2]) : NaN;
    if (!match || hour > 23 || minute > 59) {
        throw new Error(`${label} must be a time as HH:mm (got "${text}")`);
    }
    return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

/** A cell holding one of a fixed set of words, matched without regard to case. */
export function importEnum<T extends string>(
    value: unknown,
    allowed: readonly T[],
    label: string,
): T | null {
    const text = importText(value);
    if (text === null) return null;
    const match = allowed.find((option) => option.toLowerCase() === text.toLowerCase());
    if (!match) throw new Error(`${label} must be one of ${allowed.join(', ')} (got "${text}")`);
    return match;
}

/** A cell holding several names, comma or semicolon separated. */
export function importList(value: unknown): string[] {
    const text = importText(value);
    if (text === null) return [];
    return text
        .split(/[;,]/)
        .map((part) => part.trim())
        .filter(Boolean);
}

/**
 * A case-insensitive lookup built from however many names a record answers to
 * — a project is findable by its code, its short name or its full name.
 *
 * Earlier entries win, so callers pass the names in order of authority: two
 * projects sharing a name must not let the second one shadow the first's code.
 */
export function nameIndex<T>(
    records: readonly T[],
    keysOf: (record: T) => (string | null | undefined)[],
    idOf: (record: T) => string,
): Map<string, string> {
    const index = new Map<string, string>();
    // One pass per key position rather than per record, so every code is
    // indexed before any short name, and every short name before any name.
    const width = Math.max(0, ...records.map((record) => keysOf(record).length));
    for (let position = 0; position < width; position++) {
        for (const record of records) {
            const key = keysOf(record)[position];
            if (!key) continue;
            const normalised = key.trim().toLowerCase();
            if (normalised && !index.has(normalised)) index.set(normalised, idOf(record));
        }
    }
    return index;
}

/** A lookup hit, or a row failure naming what could not be found. */
export function lookup(index: Map<string, string>, text: string, missing: string): string {
    const id = index.get(text.trim().toLowerCase());
    if (!id) throw new Error(`${missing} "${text}"`);
    return id;
}
