/**
 * Shapes and pure helpers shared by the board page and its card. Kept out of
 * the page component so the date and filter rules can be tested directly —
 * they are the parts most likely to be quietly wrong.
 */

import { addCalendarDays, tenantDateOnly } from '@/lib/created-range';
import type { NumberCondition } from '@/lib/number-condition';
import { inDayRange, matchesNumber } from './work-list-filters';
import { matchesTimeFlag, matchesUpdatedPreset } from './sprint-filters';

export type ProjectLabelColor = 'GRAY' | 'BLUE' | 'EMERALD' | 'AMBER' | 'RED' | 'PURPLE';

export interface ProjectLabel {
    id: string;
    name: string;
    color: ProjectLabelColor;
    sort_order?: number;
}

export const LABEL_COLORS: ProjectLabelColor[] = [
    'GRAY',
    'BLUE',
    'EMERALD',
    'AMBER',
    'RED',
    'PURPLE',
];

/**
 * Written out as whole class strings because Tailwind scans source text — a
 * template like `bg-${color}-100` produces nothing at build time.
 *
 * These are chips carrying tenant data, not UI accents, so the one-accent rule
 * does not apply; the point of a label is that it is distinguishable at a
 * glance. The palette is fixed and small for exactly that reason.
 */
export const LABEL_CLASS: Record<ProjectLabelColor, string> = {
    GRAY: 'bg-gray-100 text-gray-700',
    BLUE: 'bg-blue-100 text-blue-700',
    EMERALD: 'bg-emerald-100 text-emerald-700',
    AMBER: 'bg-amber-100 text-amber-700',
    RED: 'bg-red-100 text-red-700',
    PURPLE: 'bg-purple-100 text-purple-700',
};

export function labelClass(color: string | undefined): string {
    return LABEL_CLASS[(color ?? 'GRAY') as ProjectLabelColor] ?? LABEL_CLASS.GRAY;
}

/** The join row the API returns, unwrapped. */
export function labelsOf(task: Pick<BoardTask, 'labels'>): ProjectLabel[] {
    return (task.labels ?? []).map((row) => row.label).filter(Boolean);
}

export interface BoardProject {
    id: string;
    code: string;
    name: string;
    /** Optional abbreviation; the card falls back to `code` without it. */
    short_name?: string | null;
}

export interface BoardSprint {
    id: string;
    name: string;
    /** `PLANNED` / `ACTIVE` / `COMPLETED`. */
    status: string;
}

export interface BoardTask {
    id: string;
    title: string;
    description?: string | null;
    priority: string;
    project?: BoardProject | null;
    labels?: { label: ProjectLabel }[];
    cover_color?: ProjectLabelColor | null;
    start_date?: string | null;
    due_date?: string | null;
    completed_at?: string | null;
    remaining_hours?: string | null;
    estimate_hours?: string | null;
    logged_hours?: number;
    assignee?: { id: string; name?: string | null; email: string; avatar_url?: string | null } | null;
    // Phase 2 made an employee without a login assignable. Everything that asks
    // "who is this for" has to read both or those tasks look unassigned.
    assigneeEmployee?: { id: string; name?: string | null } | null;
    /** The story the task delivers a piece of — what the story swimlanes group by. */
    userStory?: { id: string; code: string; title: string } | null;
    /** The bare column — on every card, whether or not the relation below was loaded. */
    sprint_id?: string | null;
    /** For the sprint filter's options, which are named off the cards. */
    sprint?: BoardSprint | null;
    checklistItems?: { id: string; is_done: boolean }[];
    _count?: { subtasks?: number; comments?: number } | null;
    status_id: string;
    /** The card's own column, for the "hide done" filter — loaded with the card. */
    status?: { id: string; name: string; category: string } | null;
    /** The last time the task changed, for the "last updated" filter. */
    updated_at?: string | null;
    /** When the task was raised, for the "created" filter. */
    created_at?: string | null;
}

export interface BoardColumn {
    id: string;
    name: string;
    category: string;
    /** Advisory: over-limit is marked, never blocked. NULL means no limit. */
    wip_limit?: number | null;
    tasks: BoardTask[];
}

/**
 * Counted against the *unfiltered* column. A filter narrowing the view to two
 * cards must not make a column of twelve look within a limit of three.
 */
export function isOverWip(column: BoardColumn | undefined): boolean {
    if (!column?.wip_limit) return false;
    return column.tasks.length > column.wip_limit;
}

/** A cover only reads as a cover in the label palette's strong tones. */
export const COVER_CLASS: Record<ProjectLabelColor, string> = {
    GRAY: 'bg-gray-400',
    BLUE: 'bg-blue-500',
    EMERALD: 'bg-emerald-500',
    AMBER: 'bg-amber-500',
    RED: 'bg-red-500',
    PURPLE: 'bg-purple-500',
};

export function coverClass(color: string | null | undefined): string | null {
    if (!color) return null;
    return COVER_CLASS[color as ProjectLabelColor] ?? null;
}

/** Local calendar day as YYYY-MM-DD, to compare against a `@db.Date` string. */
export function dayKey(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
}

function shiftedDayKey(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return dayKey(d);
}

export type DueState = 'done' | 'overdue' | 'today' | 'soon' | 'later';

/**
 * Compared as date strings rather than Date objects: `due_date` is a `@db.Date`
 * serialised at UTC midnight, so `new Date(due) < new Date()` calls a task due
 * today overdue for anyone east of UTC — which is everyone here.
 */
export function dueStateOf(dueDate?: string | null, completedAt?: string | null): DueState | null {
    if (!dueDate) return null;
    if (completedAt) return 'done';

    const due = dueDate.slice(0, 10);
    const today = dayKey(new Date());
    if (due < today) return 'overdue';
    if (due === today) return 'today';
    return due <= shiftedDayKey(2) ? 'soon' : 'later';
}

/**
 * What a card shows for its project. The short name is the point of the field,
 * but it is optional, so the code — which every project has — is the fallback,
 * and the full name is left for the tooltip.
 */
export function projectLabelOf(project: BoardProject | null | undefined): string | null {
    if (!project) return null;
    return project.short_name?.trim() || project.code || project.name || null;
}

export function initialsOf(name: string): string {
    return name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0] ?? '')
        .join('')
        .toUpperCase();
}

export function assigneeNameOf(task: BoardTask): string | null {
    return task.assignee?.name ?? task.assignee?.email ?? task.assigneeEmployee?.name ?? null;
}

/**
 * One key space for both assignee columns, so the filter is a single select
 * rather than two that can contradict each other.
 */
export function assigneeKeyOf(task: BoardTask): string {
    if (task.assignee) return `user:${task.assignee.id}`;
    if (task.assigneeEmployee) return `employee:${task.assigneeEmployee.id}`;
    return 'none';
}

/** A filter's choice: the id it narrows by, and the name it shows. */
export interface FilterOption {
    key: string;
    label: string;
}

export type AssigneeOption = FilterOption;

/**
 * Built from the cards on the board rather than from the project roster: you
 * can only usefully filter by someone who actually holds a card here, and it
 * saves a request.
 */
export function assigneeOptionsFrom(columns: BoardColumn[]): AssigneeOption[] {
    const byKey = new Map<string, string>();
    for (const column of columns) {
        for (const task of column.tasks) {
            const name = assigneeNameOf(task);
            if (name) byKey.set(assigneeKeyOf(task), name);
        }
    }
    return [...byKey.entries()]
        .map(([key, label]) => ({ key, label }))
        .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * The projects with a card on the board, for the project filter. From the cards
 * for the same reason the assignee options are: a project with nothing here is
 * a filter that can only ever empty the board.
 */
export function projectOptionsFrom(tasks: BoardTask[]): FilterOption[] {
    const byId = new Map<string, string>();
    for (const task of tasks) {
        if (task.project) byId.set(task.project.id, task.project.name || projectLabelOf(task.project) || '');
    }
    return [...byId.entries()]
        .map(([key, label]) => ({ key, label }))
        .sort((a, b) => a.label.localeCompare(b.label));
}

/** Which sprint a card is in, from the relation when it was loaded and the bare id when not. */
export function sprintIdOf(task: Pick<BoardTask, 'sprint' | 'sprint_id'>): string | null {
    return task.sprint?.id ?? task.sprint_id ?? null;
}

export interface SprintOption extends FilterOption {
    status: string;
}

/** The running sprint first — it is the one a board is filtered to most — then planned, then finished. */
const SPRINT_STATUS_RANK: Record<string, number> = { ACTIVE: 0, PLANNED: 1, COMPLETED: 2 };

/**
 * The sprints holding a card on the board, for the sprint filter. Names compare
 * numerically, so "Sprint 9" sorts before "Sprint 10" rather than after it.
 */
export function sprintOptionsFrom(tasks: BoardTask[]): SprintOption[] {
    const byId = new Map<string, BoardSprint>();
    for (const task of tasks) {
        if (task.sprint) byId.set(task.sprint.id, task.sprint);
    }
    return [...byId.values()]
        .sort(
            (a, b) =>
                (SPRINT_STATUS_RANK[a.status] ?? 3) - (SPRINT_STATUS_RANK[b.status] ?? 3) ||
                a.name.localeCompare(b.name, undefined, { numeric: true }),
        )
        .map((sprint) => ({ key: sprint.id, label: sprint.name, status: sprint.status }));
}

export interface StoryOption extends FilterOption {
    /** `OTB-3`, so two similarly titled stories can be told apart in the list. */
    code: string;
}

/**
 * The user stories holding a card on the board, for the story filter — built
 * from the cards, like the sprint options, so the filter can only offer a
 * story that is actually here. Ordered by code, which reads in the order the
 * team wrote them rather than alphabetically by title.
 */
export function storyOptionsFrom(tasks: BoardTask[]): StoryOption[] {
    const byId = new Map<string, StoryOption>();
    for (const task of tasks) {
        if (task.userStory && !byId.has(task.userStory.id)) {
            byId.set(task.userStory.id, {
                key: task.userStory.id,
                label: task.userStory.title,
                code: task.userStory.code,
            });
        }
    }
    return [...byId.values()].sort((a, b) =>
        a.code.localeCompare(b.code, undefined, { numeric: true }),
    );
}

/** A label with a card here. A tenant label no card carries would only empty the board. */
export function labelOptionsFrom(tasks: BoardTask[]): ProjectLabel[] {
    const byId = new Map<string, ProjectLabel>();
    for (const task of tasks) {
        for (const label of labelsOf(task)) {
            if (!byId.has(label.id)) byId.set(label.id, label);
        }
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type BoardPriority = (typeof PRIORITIES)[number];

export const STATUS_CATEGORIES = ['TODO', 'IN_PROGRESS', 'DONE'] as const;
export type StatusCategory = (typeof STATUS_CATEGORIES)[number];

/**
 * The due presets the Tasks list offers, plus "no due date" — which that list
 * reaches through its dated presets but a board is often swept for. The three
 * shared ones mean exactly what they mean there, so a filter picked on the list
 * and the same one picked here hide the same cards.
 */
export const DUE_PRESETS = ['overdue', 'today', 'week'] as const;
export type DuePreset = (typeof DUE_PRESETS)[number];
export const BOARD_DUE_PRESETS = [...DUE_PRESETS, 'none'] as const;
export type BoardDuePreset = (typeof BOARD_DUE_PRESETS)[number];

export const TIME_FLAGS = ['over', 'none', 'no-estimate'] as const;
export type TimeFlag = (typeof TIME_FLAGS)[number];

export const UPDATED_PRESETS = ['d2', 'd3', 'd7'] as const;
export type UpdatedPreset = (typeof UPDATED_PRESETS)[number];

/** Which dimension a count ignores, so a tick can say how many it would add. */
export type BoardFilterDimension =
    | 'text'
    | 'assignee'
    | 'status'
    | 'hideDone'
    | 'priority'
    | 'due'
    | 'project'
    | 'sprint'
    | 'story'
    | 'label'
    | 'time'
    | 'hours'
    | 'updated'
    | 'created';

/**
 * What a card can be narrowed by. Every dimension is multi-valued — "High or
 * Urgent", "Ravi and Sumaiya", three labels — because a board is scanned for a
 * slice of the work, and one value at a time was the limitation this replaces.
 * Empty means "any", the same spelling the Tasks list uses, so the two read the
 * same way even though the board applies them in the browser.
 *
 * `assignees` is deliberately `[]` (anyone), not the Tasks list's default of
 * "me": a board is a shared artefact, and opening it on only your own cards
 * would read as a board that had lost most of them.
 */
export interface BoardFilters {
    /** Free text, matched across everything a card carries. See `matchesText`. */
    text: string;
    /** `me`, `unassigned`, `user:<id>` or `employee:<id>`. Any of them. */
    assignees: string[];
    statusCategories: string[];
    /** Cards that are already finished are hidden — the list's own toggle. */
    hideDone: boolean;
    priorities: string[];
    due: BoardDuePreset[];
    dueFrom: string;
    dueTo: string;
    /** Project ids. No `none`: every task belongs to a project. */
    projectIds: string[];
    /** Sprint ids, plus `none` for the cards in no sprint. */
    sprintIds: string[];
    /** Story ids, plus `none` for the cards under no story. */
    storyIds: string[];
    /** Label ids, plus `none` for the cards with no label at all. */
    labelIds: string[];
    time: TimeFlag[];
    hours: NumberCondition | null;
    updated: UpdatedPreset[];
    updatedFrom: string;
    updatedTo: string;
    createdFrom: string;
    createdTo: string;
}

export const NO_FILTERS: BoardFilters = {
    text: '',
    assignees: [],
    statusCategories: [],
    hideDone: false,
    priorities: [],
    due: [],
    dueFrom: '',
    dueTo: '',
    projectIds: [],
    sprintIds: [],
    storyIds: [],
    labelIds: [],
    time: [],
    hours: null,
    updated: [],
    updatedFrom: '',
    updatedTo: '',
    createdFrom: '',
    createdTo: '',
};

export function hasActiveFilter(filters: BoardFilters): boolean {
    return (
        filters.text.trim() !== '' ||
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

/**
 * Everything on a card worth searching, as one lower-cased string: its title
 * and description, the project it belongs to (code, short name and full name,
 * because a card only shows one of the three), whoever holds it, its sprint,
 * its story and its labels.
 *
 * Description is included even though the card may not be showing it — someone
 * searching for a phrase they wrote in a task means the task, not the part of
 * it that happens to be on screen.
 */
function haystackOf(task: BoardTask): string {
    return [
        task.title,
        task.description ?? '',
        task.project?.code ?? '',
        task.project?.short_name ?? '',
        task.project?.name ?? '',
        assigneeNameOf(task) ?? '',
        task.sprint?.name ?? '',
        task.userStory?.code ?? '',
        task.userStory?.title ?? '',
        ...labelsOf(task).map((label) => label.name),
    ]
        .join(' ')
        .toLowerCase();
}

/**
 * Every word has to match, in any field and in any order — so "login alp"
 * finds the login card in project ALP, which a single-substring match would
 * not. Nothing is ranked: the board has an order of its own and reordering it
 * by relevance would move cards out from under the reader's cursor.
 */
export function matchesText(task: BoardTask, text: string): boolean {
    const terms = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return true;

    const haystack = haystackOf(task);
    return terms.every((term) => haystack.includes(term));
}

/** The story a card delivers, from the relation the board loads with the card. */
export function storyIdOf(task: BoardTask): string | null {
    return task.userStory?.id ?? null;
}

/** A finished card: its column says so, or it was marked done in the panel. */
function isDone(task: BoardTask): boolean {
    return task.status?.category === 'DONE' || Boolean(task.completed_at);
}

function inList(selected: readonly string[], value: string | null | undefined): boolean {
    if (selected.length === 0) return true;
    return selected.some((choice) => (choice === 'none' ? value == null : choice === value));
}

function matchesAssignees(task: BoardTask, selected: readonly string[], userId: string | null): boolean {
    if (selected.length === 0) return true;
    const key = assigneeKeyOf(task);
    return selected.some((choice) => {
        if (choice === 'me') return userId != null && key === `user:${userId}`;
        // The board's own name for "nobody" is `none`; the Tasks page calls it
        // `unassigned`. Both are accepted so neither chip is a dead option.
        if (choice === 'unassigned' || choice === 'none') return key === 'none';
        return key === choice;
    });
}

function matchesDuePreset(task: BoardTask, preset: BoardDuePreset, today: string): boolean {
    if (preset === 'none') return !task.due_date;
    if (!task.due_date) return false;

    const day = task.due_date.slice(0, 10);
    // A finished card is not chased, however old its date is.
    if (preset === 'overdue') return !isDone(task) && day < today;
    if (preset === 'today') return day === today;
    // The board's "this week" has always meant the seven days ahead rather than
    // the calendar week the Tasks list uses — a board is read forward, and a
    // card due next Monday is this week's work even on a Friday.
    return day >= today && day <= addCalendarDays(today, 7);
}

/** Presets and a from/to range are alternatives: a card may match either. */
function matchesAlternatives(
    task: BoardTask,
    presets: readonly BoardDuePreset[],
    from: string,
    to: string,
    today: string,
): boolean {
    const hasRange = Boolean(from || to);
    if (presets.length === 0 && !hasRange) return true;
    const presetHit = presets.some((preset) => matchesDuePreset(task, preset, today));
    const rangeHit = hasRange && inDayRange(task.due_date, from, to, false);
    return presetHit || rangeHit;
}

/**
 * Whether a card survives every filter that is set. All the dimensions combine
 * as AND, and the choices inside one as OR — the same rule the Tasks list's
 * server applies, so a filter reads the same in both places.
 *
 * `userId` is how the assignee filter spells "me"; without it, "me" matches
 * nobody rather than everybody.
 *
 * `omit` drops one dimension, which is how an option's count is worked out: a
 * tick has to say how many cards it would add, so the count for "High" cannot
 * itself be narrowed by the priority filter that is already on High.
 */
export function matchesFilters(
    task: BoardTask,
    filters: BoardFilters,
    userId: string | null = null,
    omit?: BoardFilterDimension,
): boolean {
    const today = tenantDateOnly();
    const on = (dimension: BoardFilterDimension) => omit !== dimension;

    if (on('text') && !matchesText(task, filters.text)) return false;
    if (on('assignee') && !matchesAssignees(task, filters.assignees, userId)) return false;
    if (on('status') && filters.statusCategories.length > 0) {
        const category = task.status?.category;
        if (!category || !filters.statusCategories.includes(category)) return false;
    }
    if (on('hideDone') && filters.hideDone && isDone(task)) return false;
    if (on('priority') && filters.priorities.length > 0 && !filters.priorities.includes(task.priority)) {
        return false;
    }
    if (on('due') && !matchesAlternatives(task, filters.due, filters.dueFrom, filters.dueTo, today)) {
        return false;
    }
    if (on('project') && filters.projectIds.length > 0 && !filters.projectIds.includes(task.project?.id ?? '')) {
        return false;
    }
    if (on('sprint') && !inList(filters.sprintIds, sprintIdOf(task))) return false;
    if (on('story') && !inList(filters.storyIds, storyIdOf(task))) return false;
    if (
        on('label') &&
        filters.labelIds.length > 0 &&
        !filters.labelIds.some((id) =>
            id === 'none' ? labelsOf(task).length === 0 : labelsOf(task).some((label) => label.id === id),
        )
    ) {
        return false;
    }
    if (on('time') && filters.time.length > 0 && !filters.time.some((flag) => matchesTimeFlag(task, flag))) {
        return false;
    }
    if (
        on('hours') &&
        !matchesNumber(task.logged_hours == null ? 0 : Number(task.logged_hours), filters.hours)
    ) {
        return false;
    }
    if (on('updated') && (filters.updated.length > 0 || filters.updatedFrom || filters.updatedTo)) {
        const presetHit = filters.updated.some((preset) => matchesUpdatedPreset(task, preset, today));
        const rangeHit =
            Boolean(filters.updatedFrom || filters.updatedTo) &&
            inDayRange(task.updated_at, filters.updatedFrom, filters.updatedTo, true);
        if (!presetHit && !rangeHit) return false;
    }
    if (on('created') && !inDayRange(task.created_at, filters.createdFrom, filters.createdTo, true)) {
        return false;
    }
    return true;
}

/**
 * `keep` names cards that stay whatever the filters say — the ones the reader
 * has just composed, which would otherwise vanish the moment they were saved.
 */
export function applyFilters(
    columns: BoardColumn[],
    filters: BoardFilters,
    keep?: ReadonlySet<string>,
    userId: string | null = null,
): BoardColumn[] {
    if (!hasActiveFilter(filters)) return columns;
    return columns.map((column) => ({
        ...column,
        tasks: column.tasks.filter(
            (task) => keep?.has(task.id) || matchesFilters(task, filters, userId),
        ),
    }));
}

/**
 * The cards of one dimension as `omit` leaves them — what an option's count is
 * worked out from. `dimension` is the filter being counted, so the count shows
 * what ticking that one option would add to the board as it stands.
 */
export function cardsMatching(
    tasks: readonly BoardTask[],
    filters: BoardFilters,
    dimension: BoardFilterDimension,
    userId: string | null = null,
): BoardTask[] {
    return tasks.filter((task) => matchesFilters(task, filters, userId, dimension));
}

/**
 * Exposed for the filter bar's counts: the same due rule `matchesFilters`
 * applies, so a count and the tick that follows it cannot disagree.
 */
export function matchesDuePresetForCount(task: BoardTask, preset: BoardDuePreset): boolean {
    return matchesDuePreset(task, preset, tenantDateOnly());
}

/** The time rule, exposed for the filter bar's counts — see `matchesDuePresetForCount`. */
export function matchesTimeFlagForCount(task: BoardTask, flag: TimeFlag): boolean {
    return matchesTimeFlag(task, flag);
}

export function countTasks(columns: BoardColumn[]): number {
    return columns.reduce((total, column) => total + column.tasks.length, 0);
}

/** How a column's cards can be reordered in one go, from its `…` menu. */
export const CARD_SORTS = ['due', 'priority', 'title', 'assignee'] as const;
export type CardSort = (typeof CARD_SORTS)[number];

/** Most urgent first, which is the order every one of these sorts reads in. */
const PRIORITY_RANK: Record<string, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

/**
 * Sorts an absent value last, by standing in a string that compares after any
 * real one. A card with no due date is not a card due at the beginning of
 * time, and sweeping the undated to the top would bury exactly the cards this
 * sort is reached for.
 */
const orLast = (value: string | null | undefined): string => value || '\uffff';
const rank = (priority: string): number => PRIORITY_RANK[priority] ?? PRIORITY_RANK.LOW;

const COMPARE: Record<CardSort, (a: BoardTask, b: BoardTask) => number> = {
    // Compared as date strings, the way `dueStateOf` above compares them: a
    // `@db.Date` arrives serialised at UTC midnight, so the leading ten
    // characters are the calendar day and the rest is noise.
    due: (a, b) => orLast(a.due_date?.slice(0, 10)).localeCompare(orLast(b.due_date?.slice(0, 10))),
    priority: (a, b) => rank(a.priority) - rank(b.priority),
    title: (a, b) => a.title.localeCompare(b.title),
    assignee: (a, b) =>
        orLast(assigneeNameOf(a)).localeCompare(orLast(assigneeNameOf(b))),
};

/**
 * A column's cards in the order a sort puts them, as a new array — the caller
 * sends the resulting ids to the server, which stores the order rather than
 * the rule. A board keeps a hand-made order the moment it is dragged, so a
 * stored rule would fight the next drag; this is a one-off tidy, like sorting
 * a spreadsheet column.
 *
 * Ties keep their current relative order (`Array.prototype.sort` is stable),
 * so sorting by priority twice does not shuffle the cards that share one.
 */
export function sortCards(tasks: BoardTask[], by: CardSort): BoardTask[] {
    return [...tasks].sort(COMPARE[by]);
}
