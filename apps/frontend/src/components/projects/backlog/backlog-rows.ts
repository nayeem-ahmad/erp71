/**
 * The Backlog tree as the flat list of rows actually on screen, and every rule
 * about moving one of them.
 *
 * Rendering from a flat list rather than nested groups is what makes the rest
 * tractable: arrow-key focus is "the next row", a drag is "from row a to row
 * b", and selection is a set of row keys — none of which has to walk a
 * component tree. Pure, so the move rules (which drops are legal, where exactly
 * a row lands) are tested against plain data.
 */

import {
    noEpicGroup,
    projectGroup,
    unplannedGroup,
    type BacklogData,
    type BacklogProject,
    type BacklogTree,
    type EpicNode,
    type StoryNode,
    type TaskNode,
} from './backlog-tree';

export type RowKind = 'project' | 'epic' | 'story' | 'task' | 'noEpic' | 'unplanned' | 'addStory' | 'addTask';

/** The three kinds that are rows in the database, and so can move and be selected. */
export type ItemKind = 'epic' | 'story' | 'task';

export interface VisibleRow {
    /** Unique across the list: `epic:<id>`, `noEpic:<projectId>`, `addTask:<storyId|…>`. */
    key: string;
    kind: RowKind;
    depth: number;
    projectId: string;
    /** The row this one sits under, for ← and for the drop rules. */
    parentKey: string | null;
    /**
     * The parent as the API names it: an epic id for a story, a story id for a
     * task, null for the parentless group. Unused on epics and project rows.
     */
    parentId: string | null;
    /** The id in the database, for item rows; the group's expand id otherwise. */
    id: string;
    expandable: boolean;
    expanded: boolean;
    /** The owning epic's colour, carried down its block. */
    edge?: string;
    project?: BacklogProject;
    epic?: EpicNode;
    story?: StoryNode;
    task?: TaskNode;
    /** For the catch-all groups: how many rows are in them. */
    count?: number;
}

export const rowKey = (kind: ItemKind, id: string) => `${kind}:${id}`;

export const isItem = (row: VisibleRow): row is VisibleRow & { kind: ItemKind } =>
    row.kind === 'epic' || row.kind === 'story' || row.kind === 'task';

export interface Section {
    project: BacklogProject;
    tree: BacklogTree;
}

export interface FlattenOptions {
    /** Draw a project heading above each section — the cross-project screens. */
    projectHeadings: boolean;
    /** Draw the "Add story" / "Add task" rows. */
    addRows: boolean;
    /** While filtering, an empty "No epic" group is noise rather than a place to write. */
    filtering: boolean;
}

export function flattenBacklog(sections: Section[], expanded: Set<string>, options: FlattenOptions): VisibleRow[] {
    const rows: VisibleRow[] = [];

    for (const { project, tree } of sections) {
        const projectId = project.id;
        let base = 0;
        let projectKey: string | null = null;
        if (options.projectHeadings) {
            projectKey = `project:${projectId}`;
            const open = expanded.has(projectGroup(projectId));
            rows.push({
                key: projectKey,
                kind: 'project',
                depth: 0,
                projectId,
                parentKey: null,
                parentId: null,
                id: projectGroup(projectId),
                expandable: true,
                expanded: open,
                project,
                count: tree.epics.length + tree.noEpic.length,
            });
            if (!open) continue;
            base = 1;
        }

        const pushStory = (node: StoryNode, depth: number, parentKey: string, epicId: string | null, edge?: string) => {
            const key = rowKey('story', node.id);
            const open = expanded.has(node.id);
            rows.push({
                key,
                kind: 'story',
                depth,
                projectId,
                parentKey,
                parentId: epicId,
                id: node.id,
                expandable: true,
                expanded: open,
                edge,
                story: node,
            });
            if (!open) return;
            for (const task of node.tasks) pushTask(task, depth + 1, key, node.id, edge);
            if (options.addRows) {
                rows.push(addRow('addTask', `addTask:${node.id}`, depth + 1, projectId, key, node.id, edge));
            }
        };

        const pushTask = (node: TaskNode, depth: number, parentKey: string, storyId: string | null, edge?: string) => {
            rows.push({
                key: rowKey('task', node.id),
                kind: 'task',
                depth,
                projectId,
                parentKey,
                parentId: storyId,
                id: node.id,
                expandable: false,
                expanded: false,
                edge,
                task: node,
            });
        };

        for (const epic of tree.epics) {
            const key = rowKey('epic', epic.id);
            const open = expanded.has(epic.id);
            const edge = epic.epic.color;
            rows.push({
                key,
                kind: 'epic',
                depth: base,
                projectId,
                parentKey: projectKey,
                parentId: null,
                id: epic.id,
                expandable: true,
                expanded: open,
                edge,
                epic,
            });
            if (!open) continue;
            for (const story of epic.stories) pushStory(story, base + 1, key, epic.id, edge);
            if (options.addRows) {
                rows.push(addRow('addStory', `addStory:${epic.id}`, base + 1, projectId, key, epic.id, edge));
            }
        }

        if (tree.noEpic.length > 0 || (options.addRows && !options.filtering)) {
            const key = `noEpic:${projectId}`;
            const open = expanded.has(noEpicGroup(projectId));
            rows.push({
                key,
                kind: 'noEpic',
                depth: base,
                projectId,
                parentKey: projectKey,
                parentId: null,
                id: noEpicGroup(projectId),
                expandable: true,
                expanded: open,
                count: tree.noEpic.length,
            });
            if (open) {
                for (const story of tree.noEpic) pushStory(story, base + 1, key, null);
                if (options.addRows) {
                    rows.push(addRow('addStory', `addStory:none:${projectId}`, base + 1, projectId, key, null));
                }
            }
        }

        if (tree.unplanned.length > 0) {
            const key = `unplanned:${projectId}`;
            const open = expanded.has(unplannedGroup(projectId));
            rows.push({
                key,
                kind: 'unplanned',
                depth: base,
                projectId,
                parentKey: projectKey,
                parentId: null,
                id: unplannedGroup(projectId),
                expandable: true,
                expanded: open,
                count: tree.unplanned.length,
            });
            if (open) {
                for (const task of tree.unplanned) pushTask(task, base + 1, key, null);
                if (options.addRows) {
                    rows.push(addRow('addTask', `addTask:none:${projectId}`, base + 1, projectId, key, null));
                }
            }
        }
    }

    return rows;
}

function addRow(
    kind: 'addStory' | 'addTask',
    key: string,
    depth: number,
    projectId: string,
    parentKey: string,
    parentId: string | null,
    edge?: string,
): VisibleRow {
    return {
        key,
        kind,
        depth,
        projectId,
        parentKey,
        parentId,
        id: key,
        expandable: false,
        expanded: false,
        edge,
    };
}

// ── Moves ──────────────────────────────────────────────────────────────────

/**
 * Where a row is going: under which parent, and next to which sibling. A null
 * `anchorId` appends to the end of the parent's group.
 */
export interface BacklogMove {
    kind: ItemKind;
    id: string;
    projectId: string;
    /** Epic id for a story, story id for a task; null for none. Always null for an epic. */
    parentId: string | null;
    anchorId: string | null;
    position: 'before' | 'after';
}

/** How a drop target should look while a row hovers over it. */
export type DropMode = 'before' | 'after' | 'into';

/**
 * Turns "row a was dropped on row b" into a move, or null when that drop means
 * nothing — an epic dropped on a task, a task dropped on an epic, anything
 * across projects. The legal drops:
 *
 * - **epic** on an epic, or anywhere inside one → beside that epic
 * - **story** on a story → beside it, under the same epic; on an epic or the
 *   "No epic" heading → last in that group; on a task → beside the task's story
 * - **task** on a task → beside it, under the same story; on a story or the
 *   "Tasks without a story" heading → last in that group
 *
 * "Beside" is after when the row travelled down the list and before when it
 * travelled up, which is where the row visibly sat under the pointer.
 */
export function resolveDrop(rows: VisibleRow[], activeKey: string, overKey: string): BacklogMove | null {
    if (activeKey === overKey) return null;
    const activeIndex = rows.findIndex((row) => row.key === activeKey);
    const overIndex = rows.findIndex((row) => row.key === overKey);
    if (activeIndex < 0 || overIndex < 0) return null;
    const active = rows[activeIndex];
    let over = rows[overIndex];
    if (!isItem(active) || active.projectId !== over.projectId) return null;

    const byKey = new Map(rows.map((row) => [row.key, row]));
    const position: 'before' | 'after' = activeIndex < overIndex ? 'after' : 'before';
    const base = { kind: active.kind, id: active.id, projectId: active.projectId };

    if (active.kind === 'epic') {
        // Anywhere inside an epic's block counts as that epic.
        while (over && over.kind !== 'epic') over = byKey.get(over.parentKey ?? '') as VisibleRow;
        if (!over || over.key === active.key) return null;
        return { ...base, parentId: null, anchorId: over.id, position };
    }

    if (active.kind === 'story') {
        if (over.kind === 'task' || over.kind === 'addTask') {
            const story = byKey.get(over.parentKey ?? '');
            if (!story || story.kind !== 'story') return null;
            if (story.key === active.key) return null;
            return { ...base, parentId: story.parentId, anchorId: story.id, position: 'after' };
        }
        if (over.kind === 'story') return { ...base, parentId: over.parentId, anchorId: over.id, position };
        if (over.kind === 'epic') return { ...base, parentId: over.id, anchorId: null, position: 'after' };
        if (over.kind === 'noEpic') return { ...base, parentId: null, anchorId: null, position: 'after' };
        if (over.kind === 'addStory') return { ...base, parentId: over.parentId, anchorId: null, position: 'after' };
        return null;
    }

    // A task.
    if (over.kind === 'task') return { ...base, parentId: over.parentId, anchorId: over.id, position };
    if (over.kind === 'story') return { ...base, parentId: over.id, anchorId: null, position: 'after' };
    if (over.kind === 'unplanned') return { ...base, parentId: null, anchorId: null, position: 'after' };
    if (over.kind === 'addTask') return { ...base, parentId: over.parentId, anchorId: null, position: 'after' };
    return null;
}

/** How to draw the row being hovered, for a move `resolveDrop` produced. */
export function dropModeFor(move: BacklogMove, overRow: VisibleRow): DropMode {
    if (move.anchorId === null) return 'into';
    return move.anchorId === overRow.id ? move.position : 'after';
}

/**
 * The move one step up or down among a row's siblings (Alt+↑ / Alt+↓), or null
 * at either end. Siblings are the visible rows of the same kind under the same
 * parent — a row hidden by a filter is not a step anybody can see.
 */
export function stepMove(rows: VisibleRow[], key: string, direction: -1 | 1): BacklogMove | null {
    const row = rows.find((candidate) => candidate.key === key);
    if (!row || !isItem(row)) return null;
    const siblings = rows.filter(
        (candidate) =>
            candidate.kind === row.kind &&
            candidate.projectId === row.projectId &&
            candidate.parentKey === row.parentKey,
    );
    const index = siblings.findIndex((candidate) => candidate.key === key);
    const target = siblings[index + direction];
    if (!target) return null;
    return {
        kind: row.kind,
        id: row.id,
        projectId: row.projectId,
        parentId: row.kind === 'epic' ? null : row.parentId,
        anchorId: target.id,
        position: direction < 0 ? 'before' : 'after',
    };
}

type Row = { id: string; project_id?: string };

/** The rows of one kind that share a parent, in the order the page holds them. */
function groupOf(data: BacklogData, move: Pick<BacklogMove, 'kind' | 'projectId' | 'parentId'>): Row[] {
    const inProject = (row: Row) => (row.project_id ?? move.projectId) === move.projectId;
    if (move.kind === 'epic') return data.epics.filter(inProject);
    if (move.kind === 'story') {
        return data.stories.filter((story) => inProject(story) && (story.epic_id ?? null) === move.parentId);
    }
    return data.tasks.filter((task) => inProject(task) && (task.user_story_id ?? null) === move.parentId);
}

/**
 * The target group's whole order after the move — what the order endpoints
 * take. Worked out from the full data, not the visible rows, so a group with
 * filtered-out members keeps them in place rather than pushing them to the end.
 */
export function orderedIdsFor(data: BacklogData, move: BacklogMove): string[] {
    const ids = groupOf(data, move)
        .map((row) => row.id)
        .filter((id) => id !== move.id);
    if (move.anchorId === null) return [...ids, move.id];
    const at = ids.indexOf(move.anchorId);
    if (at < 0) return [...ids, move.id];
    ids.splice(move.position === 'before' ? at : at + 1, 0, move.id);
    return ids;
}

/** Whether a move would change anything: same parent and same order is a no-op. */
export function isNoOp(data: BacklogData, move: BacklogMove): boolean {
    const current = currentParentOf(data, move);
    if (current === undefined || current !== move.parentId) return false;
    const before = groupOf(data, move).map((row) => row.id);
    const after = orderedIdsFor(data, move);
    return before.length === after.length && before.every((id, index) => id === after[index]);
}

function currentParentOf(data: BacklogData, move: BacklogMove): string | null | undefined {
    if (move.kind === 'epic') return data.epics.some((epic) => epic.id === move.id) ? null : undefined;
    if (move.kind === 'story') {
        const story = data.stories.find((row) => row.id === move.id);
        return story ? (story.epic_id ?? null) : undefined;
    }
    const task = data.tasks.find((row) => row.id === move.id);
    return task ? (task.user_story_id ?? null) : undefined;
}

/**
 * The data as it will be once the server has the move — applied straight away
 * so the row lands where it was dropped instead of snapping back for a round
 * trip. The page reloads after the write either way; this is only the interim.
 */
export function applyMove(data: BacklogData, move: BacklogMove): BacklogData {
    const order = orderedIdsFor(data, move);
    const rank = new Map(order.map((id, index) => [id, index]));

    const reorder = <T extends Row>(list: T[], reparent: (row: T) => T, inGroup: (row: T) => boolean): T[] => {
        const moved = list.map((row) => (row.id === move.id ? reparent(row) : row));
        const members = moved.filter(inGroup).sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
        // The group lands together where its first member was. Rows of other
        // groups keep their order; the tree only reads order within a group.
        const firstSlot = moved.findIndex(inGroup);
        const out = moved.filter((row) => !inGroup(row));
        out.splice(firstSlot < 0 ? out.length : Math.min(firstSlot, out.length), 0, ...members);
        return out;
    };

    const inProject = (row: Row) => (row.project_id ?? move.projectId) === move.projectId;

    if (move.kind === 'epic') {
        return { ...data, epics: reorder(data.epics, (row) => row, (row) => inProject(row)) };
    }
    if (move.kind === 'story') {
        return {
            ...data,
            stories: reorder(
                data.stories,
                (row) => ({ ...row, epic_id: move.parentId }),
                (row) => inProject(row) && (row.epic_id ?? null) === move.parentId,
            ),
        };
    }
    return {
        ...data,
        tasks: reorder(
            data.tasks,
            (row) => ({ ...row, user_story_id: move.parentId }),
            (row) => inProject(row) && (row.user_story_id ?? null) === move.parentId,
        ),
    };
}
