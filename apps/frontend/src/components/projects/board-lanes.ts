/**
 * Swimlanes: the board's cards split into rows, one per person or per story,
 * each row running across every column.
 *
 * Lanes are derived from the cards, never stored. An assignee or a story is
 * already a field on the task, and a lane table beside it would be a second
 * copy of the same fact that could disagree with the first.
 *
 * Grouping runs on the *filtered* columns, so filters and lanes compose — a
 * filter that empties a lane hides it rather than leaving an empty row behind.
 *
 * Pure on purpose, like `board-tasks.ts`, so the ordering rules can be tested
 * without a board to render.
 */

import { assigneeKeyOf, assigneeNameOf, type BoardColumn, type BoardTask } from './board-tasks';
import type { BoardSwimlanes } from './board-view';

/** The lane for a card with nobody on it, or no story. Always the last row. */
export const NO_LANE = 'none';

/** The cell key Unsorted cards are filed under — never a real column id. */
export const UNSORTED_CELL = '__unsorted';

export interface BoardLane {
    key: string;
    /** The person's name or the story's title. Null for `NO_LANE`, which the page names. */
    title: string | null;
    /** The story's code, `OTB-3`, on a story lane. */
    code?: string;
    /** The lane's cards per column id (and `UNSORTED_CELL`), in the column's own order. */
    cells: Record<string, BoardTask[]>;
    count: number;
    /** Of `count`, how many sit in a DONE column — a story lane's progress. */
    done: number;
    /**
     * The story's project, on a story lane. A task can only join a story of its
     * own project, so this is what a drop or a new card in the lane must match.
     * Read off a card: a story's cards all share its project.
     */
    projectId?: string;
}

export function laneKeyOf(task: BoardTask, mode: BoardSwimlanes): string {
    if (mode === 'story') return task.userStory ? `story:${task.userStory.id}` : NO_LANE;
    // `assigneeKeyOf` already answers `none` for nobody — the same key as NO_LANE.
    return assigneeKeyOf(task);
}

/** `OTB-2` before `OTB-10`, which a plain string compare gets backwards. */
const byCode = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

export function groupIntoLanes(
    columns: BoardColumn[],
    unsorted: BoardTask[],
    mode: BoardSwimlanes,
): BoardLane[] {
    if (mode === 'none') return [];

    const cellIds = [...(unsorted.length > 0 ? [UNSORTED_CELL] : []), ...columns.map((c) => c.id)];
    const lanes = new Map<string, BoardLane>();

    const file = (task: BoardTask, cellId: string) => {
        const key = laneKeyOf(task, mode);
        let lane = lanes.get(key);
        if (!lane) {
            lane = {
                key,
                title:
                    key === NO_LANE
                        ? null
                        : mode === 'story'
                          ? (task.userStory?.title ?? null)
                          : assigneeNameOf(task),
                code: mode === 'story' && key !== NO_LANE ? task.userStory?.code : undefined,
                cells: Object.fromEntries(cellIds.map((id) => [id, [] as BoardTask[]])),
                count: 0,
                done: 0,
            };
            lanes.set(key, lane);
        }
        lane.cells[cellId].push(task);
        lane.count += 1;
        if (mode === 'story' && key !== NO_LANE && !lane.projectId) lane.projectId = task.project?.id;
    };

    for (const task of unsorted) file(task, UNSORTED_CELL);
    for (const column of columns) {
        for (const task of column.tasks) file(task, column.id);
    }
    for (const lane of lanes.values()) {
        lane.done = columns
            .filter((column) => column.category === 'DONE')
            .reduce((sum, column) => sum + (lane.cells[column.id]?.length ?? 0), 0);
    }

    return [...lanes.values()].sort((a, b) => {
        if (a.key === NO_LANE) return 1;
        if (b.key === NO_LANE) return -1;
        if (mode === 'story') return byCode(a.code ?? '', b.code ?? '');
        return (a.title ?? '').localeCompare(b.title ?? '');
    });
}

/**
 * The fields a card takes on when it is dropped into `lane`, so it can be
 * redrawn there before the server answers. Copied off a card already in the
 * lane — the lane key holds an id, and the card needs the name to show.
 */
export function laneFieldsOf(lane: BoardLane, mode: BoardSwimlanes): Partial<BoardTask> {
    const sample = Object.values(lane.cells).flat()[0];
    if (mode === 'story') return { userStory: lane.key === NO_LANE ? null : (sample?.userStory ?? null) };
    if (lane.key === NO_LANE) return { assignee: null, assigneeEmployee: null };
    return { assignee: sample?.assignee ?? null, assigneeEmployee: sample?.assigneeEmployee ?? null };
}

/**
 * Why a card cannot go into `lane`, or null when it can. The one refusal the
 * page can see coming is a story from another project — the server would
 * refuse it too, but only after the card had visibly landed.
 */
export function laneRefusalOf(
    task: BoardTask,
    lane: Pick<BoardLane, 'key' | 'projectId'>,
    mode: BoardSwimlanes,
): 'otherProject' | null {
    if (mode !== 'story' || lane.key === NO_LANE || !lane.projectId) return null;
    return task.project?.id && task.project.id !== lane.projectId ? 'otherProject' : null;
}
