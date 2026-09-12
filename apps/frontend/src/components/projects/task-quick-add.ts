/**
 * The grammar behind the one-line task composer.
 *
 * Pure on purpose: the awkward parts here are all "what counts as a token", and
 * those are worth deciding against a test rather than against a rendered page.
 *
 * **The governing rule is that nothing is ever silently swallowed.** A word that
 * looks like a token but resolves to nothing stays in the title, exactly as
 * typed. "Email @bkash about the refund" is a task title, not a task assigned
 * to a person called bkash with the word "Email" on it, and `#f3f4f6` is a
 * colour somebody is telling you about rather than a label. Only a token that
 * matched something real is removed from the title.
 */

export interface QuickAddLabel {
    id: string;
    name: string;
}

/** `user:<id>` / `employee:<id>`, the key space the whole module already uses. */
export interface QuickAddAssignee {
    key: string;
    name: string;
}

export interface QuickAddVocabulary {
    labels: QuickAddLabel[];
    assignees: QuickAddAssignee[];
    /** The locale whose weekday names `>friday` is matched against. */
    locale: string;
    /** Translated `today` / `tomorrow`, lowercased by the caller's catalogue. */
    today: string;
    tomorrow: string;
    /** Injected so "next Friday" is testable without mocking the clock. */
    now?: Date;
}

export interface QuickAddResult {
    title: string;
    assigneeId?: string;
    assigneeEmployeeId?: string;
    labelIds?: string[];
    priority?: string;
    estimateHours?: number;
    /** `YYYY-MM-DD`. */
    dueDate?: string;
    /** Tokens that were recognised and applied, for the composer's hint row. */
    applied: string[];
}

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

/**
 * Both sides of a name comparison go through this, so `#clientwaiting` finds
 * "Client waiting" — a token cannot contain a space, and a label name can.
 */
const fold = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * For anything numeric. `fold` is for *names* — it strips punctuation, which
 * turns `1.5h` into `15h` and `-2` into `2`, so a figure must never go through
 * it.
 */
const lower = (value: string): string => value.trim().toLowerCase();

const pad = (value: number): string => String(value).padStart(2, '0');

/** Local calendar date, not UTC: a due date is a day on somebody's wall. */
const dateKey = (date: Date): string =>
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/**
 * The seven weekday names for a locale, long and short, folded. Generated
 * rather than listed, so `>jumaat` works in Malay and `>freitag` in German
 * without a translation table to keep in step with the catalogues.
 */
function weekdayNames(locale: string): Map<string, number> {
    const names = new Map<string, number>();
    for (const width of ['long', 'short'] as const) {
        const format = new Intl.DateTimeFormat(locale, { weekday: width });
        for (let day = 0; day < 7; day += 1) {
            // 2026-02-01 was a Sunday, so this walks Sunday..Saturday.
            const date = new Date(Date.UTC(2026, 1, 1 + day));
            const folded = fold(format.format(date));
            if (folded) names.set(folded, day);
        }
    }
    return names;
}

/** The next occurrence of a weekday, always in the future — never today. */
function nextWeekday(from: Date, weekday: number): Date {
    const out = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    const ahead = (weekday - out.getDay() + 7) % 7 || 7;
    out.setDate(out.getDate() + ahead);
    return out;
}

function parseDue(raw: string, vocab: QuickAddVocabulary): string | null {
    const now = vocab.now ?? new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const value = raw.trim();
    if (!value) return null;

    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const parsed = new Date(`${value}T00:00:00`);
        return Number.isNaN(parsed.getTime()) ? null : value;
    }

    const folded = fold(value);
    if (folded === fold(vocab.today)) return dateKey(today);
    if (folded === fold(vocab.tomorrow)) {
        const out = new Date(today);
        out.setDate(out.getDate() + 1);
        return dateKey(out);
    }

    // `>3d` — three days out. Useful where a weekday name is ambiguous.
    const days = /^(\d{1,3})d$/.exec(lower(value));
    if (days) {
        const out = new Date(today);
        out.setDate(out.getDate() + Number(days[1]));
        return dateKey(out);
    }

    const weekday = weekdayNames(vocab.locale).get(folded);
    return weekday === undefined ? null : dateKey(nextWeekday(today, weekday));
}

function parseEstimate(raw: string): number | null {
    const value = lower(raw);
    // `~90m` is an hour and a half; `~3h` and a bare `~3` are three hours.
    const minutes = /^(\d+(?:\.\d+)?)m$/.exec(value);
    if (minutes) {
        const hours = Number(minutes[1]) / 60;
        return hours > 0 && hours <= 9999 ? Math.round(hours * 100) / 100 : null;
    }
    const hours = /^(\d+(?:\.\d+)?)h?$/.exec(value);
    if (!hours) return null;
    const parsed = Number(hours[1]);
    return parsed > 0 && parsed <= 9999 ? parsed : null;
}

function parsePriority(raw: string): string | null {
    const value = lower(raw);
    if (!value) return null;
    const exact = PRIORITIES.find((priority) => fold(priority) === value);
    if (exact) return exact;
    // A single letter is enough, and unambiguous across the four.
    const initials = PRIORITIES.filter((priority) => fold(priority).startsWith(value));
    return initials.length === 1 ? initials[0] : null;
}

/**
 * Resolves a `@name` or `#name` against a vocabulary by prefix.
 *
 * An ambiguous prefix resolves to nothing rather than to the first match: two
 * people called Rafi means the composer cannot know which, and quietly picking
 * one would put the task on a stranger.
 */
function resolveByPrefix<T>(raw: string, items: T[], nameOf: (item: T) => string): T | null {
    const value = fold(raw);
    if (!value) return null;
    const exact = items.filter((item) => fold(nameOf(item)) === value);
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) return null;
    const prefixed = items.filter((item) => fold(nameOf(item)).startsWith(value));
    return prefixed.length === 1 ? prefixed[0] : null;
}

/**
 * Splits an input line into a task, leaving every unresolved token in the title.
 */
export function parseQuickAdd(input: string, vocab: QuickAddVocabulary): QuickAddResult {
    const result: QuickAddResult = { title: '', applied: [] };
    const labelIds: string[] = [];
    const kept: string[] = [];

    for (const word of input.split(/\s+/)) {
        if (!word) continue;
        const sigil = word[0];
        const rest = word.slice(1);
        let matched = false;

        if (sigil === '@' && rest) {
            const person = resolveByPrefix(rest, vocab.assignees, (a) => a.name);
            if (person) {
                if (person.key.startsWith('user:')) {
                    result.assigneeId = person.key.slice('user:'.length);
                    result.assigneeEmployeeId = undefined;
                } else if (person.key.startsWith('employee:')) {
                    result.assigneeEmployeeId = person.key.slice('employee:'.length);
                    result.assigneeId = undefined;
                }
                matched = true;
            }
        } else if (sigil === '#' && rest) {
            const label = resolveByPrefix(rest, vocab.labels, (l) => l.name);
            if (label && !labelIds.includes(label.id)) {
                labelIds.push(label.id);
                matched = true;
            } else if (label) {
                matched = true;
            }
        } else if (sigil === '!' && rest) {
            const priority = parsePriority(rest);
            if (priority) {
                result.priority = priority;
                matched = true;
            }
        } else if (sigil === '~' && rest) {
            const estimate = parseEstimate(rest);
            if (estimate != null) {
                result.estimateHours = estimate;
                matched = true;
            }
        } else if (sigil === '>' && rest) {
            const due = parseDue(rest, vocab);
            if (due) {
                result.dueDate = due;
                matched = true;
            }
        }

        if (matched) result.applied.push(word);
        else kept.push(word);
    }

    result.title = kept.join(' ');
    if (labelIds.length > 0) result.labelIds = labelIds;
    return result;
}
