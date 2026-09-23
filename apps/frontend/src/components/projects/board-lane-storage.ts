/**
 * Which swimlanes this browser has folded away, per board.
 *
 * Per board rather than one entry for all of them, unlike `board-view.ts`: a
 * lane is a person or a story on *this* board, and "Rafi's row is folded"
 * means nothing on a board Rafi has no cards on.
 *
 * Keyed by grouping as well as lane — `none` is "Unassigned" when grouped by
 * person and "No user story" when grouped by story, and folding one must not
 * fold the other. Kept in `localStorage` because a folded lane is a standing
 * choice about what one reads on a board, not a view of the moment.
 *
 * Pure apart from storage access, and every access is guarded: a private window
 * or blocked storage gets a board with every lane open, which is the default.
 */

import type { BoardSwimlanes } from './board-view';

export const BOARD_LANES_STORAGE_PREFIX = 'board-lanes:';

/** Same cap and reasoning as remembered filters: old boards should not pile up. */
export const MAX_REMEMBERED_LANE_BOARDS = 20;

interface StoredLanes {
    collapsed: string[];
    savedAt: number;
}

export function boardLanesKey(boardId: string): string {
    return `${BOARD_LANES_STORAGE_PREFIX}${boardId}`;
}

/** One lane's identity within a board, across both groupings. */
export function laneStorageId(mode: BoardSwimlanes, laneKey: string): string {
    return `${mode}|${laneKey}`;
}

export function parseStoredLanes(raw: unknown): string[] {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const collapsed = (raw as { collapsed?: unknown }).collapsed;
    return Array.isArray(collapsed) ? collapsed.filter((id): id is string => typeof id === 'string') : [];
}

export function readCollapsedLanes(boardId: string): string[] {
    try {
        const raw = localStorage.getItem(boardLanesKey(boardId));
        return raw ? parseStoredLanes(JSON.parse(raw)) : [];
    } catch {
        return [];
    }
}

function prune(): void {
    const entries: { key: string; savedAt: number }[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key?.startsWith(BOARD_LANES_STORAGE_PREFIX)) continue;
        let savedAt = 0;
        try {
            const parsed = JSON.parse(localStorage.getItem(key) ?? '');
            if (typeof parsed?.savedAt === 'number') savedAt = parsed.savedAt;
        } catch {
            // Unreadable: savedAt 0 puts it first in line to go.
        }
        entries.push({ key, savedAt });
    }
    entries
        .sort((a, b) => b.savedAt - a.savedAt)
        .slice(MAX_REMEMBERED_LANE_BOARDS)
        .forEach((entry) => localStorage.removeItem(entry.key));
}

/** Writes the folded set, or clears the entry once nothing is folded. */
export function writeCollapsedLanes(boardId: string, collapsed: string[]): void {
    try {
        if (collapsed.length === 0) {
            localStorage.removeItem(boardLanesKey(boardId));
            return;
        }
        const entry: StoredLanes = { collapsed, savedAt: Date.now() };
        localStorage.setItem(boardLanesKey(boardId), JSON.stringify(entry));
        prune();
    } catch {
        // Not remembering the fold is better than failing to make it.
    }
}
