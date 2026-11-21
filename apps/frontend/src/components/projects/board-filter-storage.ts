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
 * reader; a filter is about *this* board's contents. `assignees` holds user
 * ids who may hold no card on the next board, and `labelIds`, `projectIds`,
 * `sprintIds` and `storyIds` are ids with the same problem — carrying any of
 * them across would silently empty a board the reader had not filtered.
 *
 * **The search box is deliberately not stored.** The others are choices picked
 * off a list of what the board holds, and a stored one shows in the control
 * that made it. Free text is a question asked once; restored three days later
 * it reads as a board that has lost most of its cards, and the four-letter
 * string that explains why is easy to miss in a header row.
 *
 * Pure on purpose — no React — so the merge and prune rules can be tested
 * directly. The hook that owns the state is `use-board-filters.ts`.
 */

import {
    BOARD_DUE_PRESETS,
    NO_FILTERS,
    PRIORITIES,
    STATUS_CATEGORIES,
    TIME_FLAGS,
    UPDATED_PRESETS,
    type BoardDuePreset,
    type BoardFilters,
    type TimeFlag,
    type UpdatedPreset,
} from './board-tasks';
import type { NumberCondition, NumberConditionOp } from '@/lib/number-condition';

/** What is actually written: the whole filter set bar the free-text query. */
export type StoredBoardFilters = Omit<BoardFilters, 'text'>;

/** What a remembered id is checked against: the ids each id-valued filter can name today. */
export interface BoardFilterOptionIds {
    assignees: ReadonlySet<string>;
    labels: ReadonlySet<string>;
    projects: ReadonlySet<string>;
    sprints: ReadonlySet<string>;
    stories: ReadonlySet<string>;
}

export const BOARD_FILTERS_STORAGE_PREFIX = 'board-filters:';

/**
 * How many boards' filters are kept. Someone who touches fifty boards over a
 * year should not carry fifty dead entries for the rest of it, and the ones
 * worth remembering are the handful they are actually working. Entries are
 * dropped oldest-used first — see `pruneEntries`.
 */
export const MAX_REMEMBERED_BOARDS = 20;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

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

function strings(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

/** Only the values the filter's own control can offer, so nothing can be stored that it cannot clear. */
function closedSet<T extends string>(value: unknown, allowed: readonly T[]): T[] {
    return strings(value).filter((item): item is T => (allowed as readonly string[]).includes(item));
}

function day(value: unknown): string {
    return typeof value === 'string' && DAY.test(value.slice(0, 10)) ? value.slice(0, 10) : '';
}

/**
 * A stored number condition, shape-checked. A `between` needs its upper end to
 * mean anything, and a bare `{op, value}` of an op the panel cannot draw would
 * leave a filter on with no control able to clear it.
 */
function numberCondition(value: unknown): NumberCondition | null {
    if (!isPlainObject(value)) return null;
    const op = value.op;
    if (op !== 'gt' && op !== 'lt' && op !== 'eq' && op !== 'between') return null;
    const amount = typeof value.value === 'number' && Number.isFinite(value.value) ? value.value : null;
    if (amount === null) return null;
    if (op === 'between') {
        const to = typeof value.to === 'number' && Number.isFinite(value.to) ? value.to : amount;
        return { op, value: amount, to };
    }
    return { op: op as NumberConditionOp, value: amount };
}

/**
 * A stored entry, merged key by key over "no filter at all".
 *
 * Anything unrecognised falls back to empty rather than being passed through:
 * a hand-edited or stale entry must not be able to put a value into
 * `matchesFilters` that no control can then clear. The free-form ids
 * (`assignees`, `labelIds`, `projectIds`, `sprintIds`, `storyIds`) can only be
 * type-checked here, which is the point of `pruneMissingOptions` below — a
 * filter naming someone who has since left the board is well-formed and still
 * worth dropping.
 */
export function mergeStoredFilters(stored: unknown): StoredBoardFilters {
    const base: StoredBoardFilters = {
        assignees: NO_FILTERS.assignees,
        statusCategories: NO_FILTERS.statusCategories,
        hideDone: NO_FILTERS.hideDone,
        priorities: NO_FILTERS.priorities,
        due: NO_FILTERS.due,
        dueFrom: NO_FILTERS.dueFrom,
        dueTo: NO_FILTERS.dueTo,
        projectIds: NO_FILTERS.projectIds,
        sprintIds: NO_FILTERS.sprintIds,
        storyIds: NO_FILTERS.storyIds,
        labelIds: NO_FILTERS.labelIds,
        time: NO_FILTERS.time,
        hours: NO_FILTERS.hours,
        updated: NO_FILTERS.updated,
        updatedFrom: NO_FILTERS.updatedFrom,
        updatedTo: NO_FILTERS.updatedTo,
        createdFrom: NO_FILTERS.createdFrom,
        createdTo: NO_FILTERS.createdTo,
    };
    if (!isPlainObject(stored)) return base;

    return {
        assignees: strings(stored.assignees),
        statusCategories: closedSet(stored.statusCategories, STATUS_CATEGORIES),
        hideDone: stored.hideDone === true,
        priorities: closedSet(stored.priorities, PRIORITIES),
        due: closedSet(stored.due, BOARD_DUE_PRESETS) as BoardDuePreset[],
        dueFrom: day(stored.dueFrom),
        dueTo: day(stored.dueTo),
        projectIds: strings(stored.projectIds),
        sprintIds: strings(stored.sprintIds),
        storyIds: strings(stored.storyIds),
        labelIds: strings(stored.labelIds),
        time: closedSet(stored.time, TIME_FLAGS) as TimeFlag[],
        hours: numberCondition(stored.hours),
        updated: closedSet(stored.updated, UPDATED_PRESETS) as UpdatedPreset[],
        updatedFrom: day(stored.updatedFrom),
        updatedTo: day(stored.updatedTo),
        createdFrom: day(stored.createdFrom),
        createdTo: day(stored.createdTo),
    };
}

export function hasStoredFilter(filters: StoredBoardFilters): boolean {
    return (
        filters.assignees.length > 0 ||
        filters.statusCategories.length > 0 ||
        filters.hideDone ||
        filters.priorities.length > 0 ||
        filters.due.length > 0 ||
        filters.dueFrom !== '' ||
        filters.dueTo !== '' ||
        filters.projectIds.length > 0 ||
        filters.sprintIds.length > 0 ||
        filters.storyIds.length > 0 ||
        filters.labelIds.length > 0 ||
        filters.time.length > 0 ||
        filters.hours !== null ||
        filters.updated.length > 0 ||
        filters.updatedFrom !== '' ||
        filters.updatedTo !== '' ||
        filters.createdFrom !== '' ||
        filters.createdTo !== ''
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
 * Clearing rather than storing an all-empty entry matters twice: an unfiltered
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
 * selected option is not in its own list — so the board shows nothing selected
 * in the chip and nothing is filtered, which does not match what is on screen.
 * Such a choice is dropped instead.
 *
 * The closed-set filters (`status`, `hideDone`, `priority`, `due`, `time`,
 * `updated`, the dates and the hours condition) are checked by
 * `mergeStoredFilters` already and left alone here; only the id-valued ones
 * need the board to say whether they still name anyone. `none` names no id, so
 * it is always kept. A story is not offered as an option on the board today,
 * so a stored one is kept only while a card on the board carries it.
 */
export function pruneMissingOptions(
    filters: StoredBoardFilters,
    available: BoardFilterOptionIds,
): StoredBoardFilters {
    const kept = (ids: readonly string[], known: ReadonlySet<string>) =>
        ids.filter((id) => id === 'none' || known.has(id));
    const assignees = filters.assignees.filter(
        (id) => id === 'me' || id === 'unassigned' || id === 'none' || available.assignees.has(id),
    );

    return {
        ...filters,
        assignees,
        labelIds: kept(filters.labelIds, available.labels),
        projectIds: kept(filters.projectIds, available.projects),
        sprintIds: kept(filters.sprintIds, available.sprints),
        storyIds: kept(filters.storyIds, available.stories),
    };
}
