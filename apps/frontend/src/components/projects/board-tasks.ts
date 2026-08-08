/**
 * Shapes and pure helpers shared by the board page and its card. Kept out of
 * the page component so the date and filter rules can be tested directly —
 * they are the parts most likely to be quietly wrong.
 */

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
    assignee?: { id: string; name?: string | null; email: string } | null;
    // Phase 2 made an employee without a login assignable. Everything that asks
    // "who is this for" has to read both or those tasks look unassigned.
    assigneeEmployee?: { id: string; name?: string | null } | null;
    checklistItems?: { id: string; is_done: boolean }[];
    _count?: { subtasks?: number; comments?: number } | null;
    status_id: string;
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

export interface AssigneeOption {
    key: string;
    label: string;
}

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

export type DueFilter = 'all' | 'overdue' | 'today' | 'week' | 'none';

export interface BoardFilters {
    assignee: string;
    priority: string;
    due: DueFilter;
    label: string;
}

export const NO_FILTERS: BoardFilters = {
    assignee: 'all',
    priority: 'all',
    due: 'all',
    label: 'all',
};

export function hasActiveFilter(filters: BoardFilters): boolean {
    return (
        filters.assignee !== 'all' ||
        filters.priority !== 'all' ||
        filters.due !== 'all' ||
        filters.label !== 'all'
    );
}

function matchesDue(task: BoardTask, due: DueFilter): boolean {
    if (due === 'all') return true;
    if (due === 'none') return !task.due_date;
    if (!task.due_date) return false;

    const key = task.due_date.slice(0, 10);
    const today = dayKey(new Date());
    // A completed task is not chased, however old its date is.
    if (due === 'overdue') return !task.completed_at && key < today;
    if (due === 'today') return key === today;
    return key >= today && key <= shiftedDayKey(7);
}

export function matchesFilters(task: BoardTask, filters: BoardFilters): boolean {
    if (filters.assignee !== 'all' && assigneeKeyOf(task) !== filters.assignee) return false;
    if (filters.priority !== 'all' && task.priority !== filters.priority) return false;
    if (filters.label === 'none' && labelsOf(task).length > 0) return false;
    if (
        filters.label !== 'all' &&
        filters.label !== 'none' &&
        !labelsOf(task).some((label) => label.id === filters.label)
    ) {
        return false;
    }
    return matchesDue(task, filters.due);
}

export function applyFilters(columns: BoardColumn[], filters: BoardFilters): BoardColumn[] {
    if (!hasActiveFilter(filters)) return columns;
    return columns.map((column) => ({
        ...column,
        tasks: column.tasks.filter((task) => matchesFilters(task, filters)),
    }));
}

export function countTasks(columns: BoardColumn[]): number {
    return columns.reduce((total, column) => total + column.tasks.length, 0);
}
