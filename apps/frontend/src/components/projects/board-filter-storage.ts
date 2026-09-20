/**
 * A board's filters, remembered for this browser between visits.
 *
 * Someone who works one lane of a shared board — "my cards, overdue" — picks
 * the same two filters every time they open it. Re-picking them on every visit
 * is the small tax that makes a board feel like it is not paying attention, and
 * on a board of two hundred cards it is the difference between opening onto
 * work and opening onto a wall.
 *
 * **One entry per board**, unlike `board-view`, which keeps one entry for every
 * board. Appearance is a fact about eyesight and screen and travels with the
 * reader; a filter is about *this* board's contents. `assignee` is a user id
 * who may hold no card on the next board, and `label` is a label id — carrying
 * either across would silently empty a board the reader had not filtered.
 *
 * **The search box is deliberately not stored.** The other four are choices
 * picked off a list of what the board holds, and a stored one shows in the
 * control that made it. Free text is a question asked once; restored three days
 * later it reads as a board that has lost most of its cards, and the four-letter
 * string that explains why is easy to miss in a header row.
 *
 * Pure on purpose — no React — so the merge and prune rules can be tested
 * directly. The hook that owns the state is `use-board-filters.ts`.
 */

import { NO_FILTERS, type BoardFilters, type DueFilter } from './board-tasks';

/** What is actually written: the whole filter set bar the free-text query. */
export type StoredBoardFilters = Omit<BoardFilters, 'text'>;

export const BOARD_FILTERS_STORAGE_PREFIX = 'board-filters:';

/**
 * How many boards' filters are kept. Someone who touches fifty boards over a
 * year should not carry fifty dead entries for the rest of it, and the ones
 * worth remembering are the handful they are actually working. Entries are
 * dropped oldest-used first — see `pruneEntries`.
 */
export const MAX_REMEMBERED_BOARDS = 20;

const DUE_FILTERS: DueFilter[] = ['all', 'overdue', 'today', 'week', 'none'];

/** The stored shape: the filters, plus when they were last written. */
interface StoredEntry extends StoredBoardFilters {
    /** Epoch ms. Only used to decide what to drop when the cap is reached. */
    savedAt: number;
}

export function boardFiltersKey(boardId: string): string {
    return `${BOARD_FILTERS_STORAGE_PREFIX}${boardId}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * A stored entry, merged key by key over "no filter at all".
 *
 * Anything unrecognised falls back to `all` rather than being passed through:
 * a hand-edited or stale entry must not be able to put a value into
 * `matchesFilters` that no control can then clear. `assignee` and `label` are
 * free-form ids and so can only be type-checked, which is the point of
 * `isKnownFilter` below — a filter naming someone who has since left the board
 * is well-formed and still worth dropping.
 */
export function mergeStoredFilters(stored: unknown): StoredBoardFilters {
    const base: StoredBoardFilters = {
        assignee: NO_FILTERS.assignee,
        priority: NO_FILTERS.priority,
        due: NO_FILTERS.due,
        label: NO_FILTERS.label,
    };
    if (!isPlainObject(stored)) return base;

    const str = (value: unknown, fallback: string) =>
        typeof value === 'string' && value.trim() !== '' ? value : fallback;

    return {
        assignee: str(stored.assignee, base.assignee),
        priority: str(stored.priority, base.priority),
        label: str(stored.label, base.label),
        due:
            typeof stored.due === 'string' && (DUE_FILTERS as string[]).includes(stored.due)
                ? (stored.due as DueFilter)
                : base.due,
    };
}

export function hasStoredFilter(filters: StoredBoardFilters): boolean {
    return (
        filters.assignee !== 'all' ||
        filters.priority !== 'all' ||
        filters.due !== 'all' ||
        filters.label !== 'all'
    );
}

export function readStoredFilters(boardId: string): StoredBoardFilters {
    try {
        const raw = localStorage.getItem(boardFiltersKey(boardId));
        return raw ? mergeStoredFilters(JSON.parse(raw)) : mergeStoredFilters(null);
    } catch {
        // Storage blocked, or the entry is not JSON. An unfiltered board is a
        // board.
        return mergeStoredFilters(null);
    }
}

/**
 * Every remembered board, newest-written first. Exported for the pruning below
 * and for tests; callers want `readStoredFilters`.
 */
function storedBoardKeys(): { key: string; savedAt: number }[] {
    const entries: { key: string; savedAt: number }[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key?.startsWith(BOARD_FILTERS_STORAGE_PREFIX)) continue;
        let savedAt = 0;
        try {
            const parsed = JSON.parse(localStorage.getItem(key) ?? '');
            if (isPlainObject(parsed) && typeof parsed.savedAt === 'number') savedAt = parsed.savedAt;
        } catch {
            // Unreadable entry. `savedAt` 0 sorts it to the front of the queue
            // to be dropped, which is the right place for it.
        }
        entries.push({ key, savedAt });
    }
    return entries.sort((a, b) => b.savedAt - a.savedAt);
}

/** Drops the least recently written entries once the cap is exceeded. */
function pruneEntries(): void {
    const entries = storedBoardKeys();
    for (const entry of entries.slice(MAX_REMEMBERED_BOARDS)) {
        localStorage.removeItem(entry.key);
    }
}

/**
 * Writes the board's filters, or clears the entry when nothing is filtered.
 *
 * Clearing rather than storing an all-`all` entry matters twice: an unfiltered
 * board is the default anyway, so the entry would say nothing, and leaving it
 * would let a board the reader has explicitly cleared go on occupying one of
 * the twenty slots.
 */
export function writeStoredFilters(boardId: string, filters: StoredBoardFilters): void {
    try {
        if (!hasStoredFilter(filters)) {
            localStorage.removeItem(boardFiltersKey(boardId));
            return;
        }
        const entry: StoredEntry = { ...filters, savedAt: Date.now() };
        localStorage.setItem(boardFiltersKey(boardId), JSON.stringify(entry));
        pruneEntries();
    } catch {
        // Not remembering the choice is better than failing to make it.
    }
}

/**
 * Whether a remembered choice still names something the board has.
 *
 * A filter is stored as an id, and the thing it names can be gone by the next
 * visit: the colleague it filtered to has left the project, or the label was
 * deleted. Restoring it would open the board on zero cards with a control whose
 * selected option is not in its own list — so the board shows `all` in the
 * select and nothing is filtered, which does not match what is on screen. Such
 * a choice is dropped back to `all` instead.
 *
 * `priority` and `due` are closed sets that `mergeStoredFilters` has already
 * checked, so only the two id-valued filters are pruned here.
 */
export function pruneMissingOptions(
    filters: StoredBoardFilters,
    available: { assignees: ReadonlySet<string>; labels: ReadonlySet<string> },
): StoredBoardFilters {
    const assigneeOk =
        filters.assignee === 'all' ||
        // "Unassigned" names no id, so nothing can remove it from the board.
        filters.assignee === 'none' ||
        available.assignees.has(filters.assignee);
    const labelOk =
        filters.label === 'all' || filters.label === 'none' || available.labels.has(filters.label);

    if (assigneeOk && labelOk) return filters;
    return {
        ...filters,
        assignee: assigneeOk ? filters.assignee : 'all',
        label: labelOk ? filters.label : 'all',
    };
}
