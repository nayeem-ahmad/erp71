/**
 * The sprint page's card view: its status columns, its search, and where a
 * dropped card lands. Pure, like `sprint-table.ts`, so the merging rules can be
 * tested without a page.
 *
 * A sprint spans projects and every project owns its own board columns (3L),
 * so there is no single list of statuses to draw. Columns are merged by
 * *name*: "In Review" in two projects is one column here, holding each
 * project's own status. A card dropped into a column moves to its project's
 * status of that name — and a project without one cannot take the card, which
 * is refused rather than guessed at.
 */

import type { SprintTask } from './sprint-table';

export interface ProjectStatusColumn {
    id: string;
    name: string;
    category: string;
    sort_order?: number;
    is_active?: boolean;
}

export interface StatusColumn {
    /** The merged name, lower-cased — what a drop target carries. */
    key: string;
    name: string;
    category: string;
    /** Each project's own status id for this column. */
    statusIds: Record<string, string>;
}

/** Richer than `SprintTask`: the fields a card shows beyond the table's. */
export interface SprintCardTask extends SprintTask {
    description?: string | null;
    priority?: string;
    due_date?: string | null;
    completed_at?: string | null;
    cover_color?: string | null;
    sort_order?: number;
    labels?: { label: { id: string; name: string; color: string } }[];
    _count?: { subtasks?: number; comments?: number } | null;
}

const CATEGORY_RANK: Record<string, number> = { TODO: 0, IN_PROGRESS: 1, DONE: 2 };

export const columnKeyOf = (name: string) => name.trim().toLowerCase();

/**
 * One column per status name across the sprint's projects, To Do → In Progress
 * → Done and each project's own order inside that. A task's own status is
 * always included — a column retired since would otherwise hide the cards
 * still sitting in it.
 */
export function buildStatusColumns(
    tasks: SprintTask[],
    projectColumns: Record<string, ProjectStatusColumn[]>,
): StatusColumn[] {
    const merged = new Map<string, StatusColumn & { rank: number; order: number }>();

    const add = (projectId: string | undefined, status: ProjectStatusColumn) => {
        const key = columnKeyOf(status.name);
        let column = merged.get(key);
        if (!column) {
            column = {
                key,
                name: status.name.trim(),
                category: status.category,
                statusIds: {},
                rank: CATEGORY_RANK[status.category] ?? 1,
                order: status.sort_order ?? Number.MAX_SAFE_INTEGER,
            };
            merged.set(key, column);
        } else {
            column.order = Math.min(column.order, status.sort_order ?? Number.MAX_SAFE_INTEGER);
        }
        if (projectId && !column.statusIds[projectId]) column.statusIds[projectId] = status.id;
    };

    for (const [projectId, statuses] of Object.entries(projectColumns)) {
        for (const status of statuses) {
            if (status.is_active === false) continue;
            add(projectId, status);
        }
    }
    for (const task of tasks) {
        if (task.status) add(task.project?.id, task.status);
    }

    return [...merged.values()]
        .sort((a, b) => a.rank - b.rank || a.order - b.order || a.name.localeCompare(b.name))
        .map(({ key, name, category, statusIds }) => ({ key, name, category, statusIds }));
}

/** The cards of each column, by key, in the order the projects keep them. */
export function tasksByColumn(tasks: SprintCardTask[]): Record<string, SprintCardTask[]> {
    const out: Record<string, SprintCardTask[]> = {};
    for (const task of tasks) {
        if (!task.status) continue;
        (out[columnKeyOf(task.status.name)] ??= []).push(task);
    }
    for (const list of Object.values(out)) {
        list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    }
    return out;
}

/**
 * Every word must match, in any field and any order — the board's rule — over
 * what a sprint reader would search by: title, description, project, story,
 * status, assignee and labels.
 */
export function matchesSprintSearch(task: SprintCardTask, text: string): boolean {
    const terms = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return true;
    const haystack = [
        task.title,
        task.description ?? '',
        task.project?.code ?? '',
        task.project?.name ?? '',
        task.userStory?.code ?? '',
        task.userStory?.title ?? '',
        task.status?.name ?? '',
        task.assignee?.name ?? task.assignee?.email ?? '',
        task.assigneeEmployee?.name ?? '',
        ...(task.labels ?? []).map((entry) => entry.label.name),
    ]
        .join(' ')
        .toLowerCase();
    return terms.every((term) => haystack.includes(term));
}

/**
 * The `sortOrder` to send when `task` is dropped at `index` among `visible`.
 *
 * The server orders a task among its own project's cards in the target status,
 * and this column mixes projects, so the neighbour that counts is the nearest
 * card *of the same project* above the drop — land just after it — or failing
 * that, the nearest below — land just before it. With neither, the top.
 */
export function sortOrderForDrop(
    task: SprintCardTask,
    targetStatusId: string,
    visible: SprintCardTask[],
    index: number,
): number {
    const others = visible.filter((card) => card.id !== task.id);
    const sameProject = (card: SprintCardTask) => card.project?.id === task.project?.id;
    // A card moving down its own status leaves a gap above where it lands,
    // which the server closes before inserting — so its old slot is not counted.
    const shift = (card: SprintCardTask) =>
        task.status?.id === targetStatusId && (task.sort_order ?? 0) < (card.sort_order ?? 0) ? 1 : 0;

    for (let i = Math.min(index, others.length) - 1; i >= 0; i -= 1) {
        const card = others[i];
        if (sameProject(card)) return Math.max((card.sort_order ?? 0) + 1 - shift(card), 0);
    }
    for (let i = index; i < others.length; i += 1) {
        const card = others[i];
        if (sameProject(card)) return Math.max((card.sort_order ?? 0) - shift(card), 0);
    }
    return 0;
}
