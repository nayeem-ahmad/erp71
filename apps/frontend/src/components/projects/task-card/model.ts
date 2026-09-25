import { dayKey, type ProjectLabel, type ProjectLabelColor } from '@/components/projects/board-tasks';

/** The five records a card carries, as the bottom tab strip names them. */
export type RecordTab = 'comments' | 'activity' | 'time' | 'remaining' | 'attachments';

export interface RemainingLog {
    id: string;
    previous_hours?: string | null;
    new_hours: string;
    delta: string;
    source: string;
    note?: string | null;
    changed_at: string;
    user?: { id: string; name?: string | null; email: string } | null;
}

export interface TimeEntry {
    id: string;
    work_date: string;
    hours: string;
    note?: string | null;
    user?: { id: string; name?: string | null } | null;
}

export interface ChecklistItem {
    id: string;
    text: string;
    is_done: boolean;
    sort_order: number;
}

export interface Task {
    id: string;
    /**
     * 1-based within the project. The key people say is
     * `<project code>-<reference>`, composed by `taskKeyOf` below.
     */
    reference?: number;
    title: string;
    description?: string | null;
    estimate_hours?: string | null;
    remaining_hours?: string | null;
    logged_hours?: number;
    start_date?: string | null;
    due_date?: string | null;
    project?: { id: string; code: string; name: string } | null;
    status?: { id: string; name: string; category: string };
    priority?: string;
    assignee?: { id: string; name?: string | null; email: string } | null;
    // Phase 2 made an employee without a login assignable, so "who holds this"
    // is two columns and anything that reads one has to read the other.
    assigneeEmployee?: { id: string; name?: string | null } | null;
    userStory?: {
        id: string;
        reference: number;
        code: string;
        title: string;
        /** The epic the story sits under. `findOne` only. */
        epic?: { id: string; code: string; title: string } | null;
    } | null;
    /** Both come from `TASK_INCLUDE` and were previously discarded here. */
    sprint?: { id: string; name: string; status?: string } | null;
    milestone?: { id: string; name: string } | null;
    labels?: { label: ProjectLabel }[];
    checklistItems?: ChecklistItem[];
    cover_color?: ProjectLabelColor | null;
    timeEntries?: TimeEntry[];
    /** Soft-deleted subtasks already left out, with their columns. `findOne` only. */
    subtasks?: SubtaskRow[];
    created_at?: string;
    updated_at?: string;
    completed_at?: string | null;
    /** Who filed it. `findOne` only. */
    creator?: { id: string; name?: string | null; email: string } | null;
    /** Whether the person reading the card watches it. `findOne` only. */
    viewer_watching?: boolean;
    /**
     * From `TASK_INCLUDE` (comments, subtasks), widened by `findOne` with
     * attachments and watchers — the counts the tab strip and the Watch
     * button show without fetching the lists behind them.
     */
    _count?: { comments?: number; subtasks?: number; attachments?: number; watchers?: number };
}

/** A subtask as the card lists it: enough to name it and say where it is. */
export interface SubtaskRow {
    id: string;
    reference?: number;
    title: string;
    status?: { id: string; name: string; category: string } | null;
}

/** A sprint the task can be moved into. Tenant-wide — see the fetch below. */
export interface SprintOption {
    id: string;
    name: string;
    status?: string;
}

/** A row of the project's backlog — the options for the story picker. */
export interface StoryOption {
    id: string;
    reference: number;
    code: string;
    title: string;
}

/** A row of the project roster, which is where the assignee options come from. */
export interface ProjectMemberRow {
    id: string;
    user?: { id: string; name?: string | null; email: string } | null;
    employee?: { id: string; name: string } | null;
}

export interface AssigneeOption {
    value: string;
    label: string;
}

/** `@db.Date` arrives as an ISO instant; a date input wants YYYY-MM-DD. */
export const dateInputValue = (value?: string | null) => (value ? value.slice(0, 10) : '');

export const num = (value: unknown): number => (value == null ? 0 : Number(value));

/**
 * `PRJ-0002-15` — the backend's `composeTaskKey` rule, applied to what every
 * task read already carries. Null while either half is missing, so nothing
 * prints a half-key like `PRJ-0002-undefined`.
 */
export const taskKeyOf = (
    reference: number | null | undefined,
    project: { code: string } | null | undefined,
): string | null => (project?.code && reference != null ? `${project.code}-${reference}` : null);

/** The unit an `Intl.RelativeTimeFormat` should speak in, and how many of it. */
function relativeParts(ms: number): [number, Intl.RelativeTimeFormatUnit] {
    // Zero seconds reads "now"; zero minutes reads "this minute", which is
    // not what anyone calls a comment they just posted.
    if (Math.abs(ms) < 45_000) return [0, 'second'];
    const minutes = Math.round(ms / 60_000);
    if (Math.abs(minutes) < 60) return [minutes, 'minute'];
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return [hours, 'hour'];
    const days = Math.round(hours / 24);
    if (Math.abs(days) < 30) return [days, 'day'];
    const months = Math.round(days / 30);
    if (Math.abs(months) < 12) return [months, 'month'];
    return [Math.round(days / 365), 'year'];
}

/**
 * "2 hours ago", "in 3 days", in the reader's language. `Intl` carries the
 * phrasing for every locale the app ships, so no catalogue needs a copy of it.
 */
export function relativeTime(iso: string | null | undefined, locale: string, now = Date.now()): string {
    if (!iso) return '';
    const at = new Date(iso).getTime();
    if (Number.isNaN(at)) return '';
    const [count, unit] = relativeParts(at - now);
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(count, unit);
}

/**
 * Whole calendar days from today until a `@db.Date`, negative once it has
 * passed. Compared as day strings for the reason `dueStateOf` gives: the value
 * is UTC midnight, and reading it as an instant makes today's due date
 * overdue for anyone east of UTC.
 */
export function daysUntil(dateOnly: string, today: Date = new Date()): number {
    const toUtc = (key: string) => Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));
    return Math.round((toUtc(dateOnly.slice(0, 10)) - toUtc(dayKey(today))) / 86_400_000);
}

/** "today", "tomorrow", "in 5 days", "3 days ago" — for a due date. */
export function relativeDay(dateOnly: string, locale: string, today: Date = new Date()): string {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(daysUntil(dateOnly, today), 'day');
}
export const today = () => new Date().toISOString().slice(0, 10);
export const EMPTY_TIME_FORM = () => ({ hours: '', workDate: today(), note: '', remaining: '' });

/**
 * Whether a write's response is the task itself. `PATCH /project-tasks/:id`
 * answers with one, but nothing in the type system says so — and a response
 * that is not a task must fall back to re-reading the card rather than blanking
 * it.
 */
export const isTask = (value: unknown): value is Task =>
    typeof value === 'object' && value !== null && typeof (value as Task).id === 'string';

export interface Attachment {
    id: string;
    file_url: string;
    file_name: string;
    mime_type?: string | null;
    file_size?: number | null;
    created_at: string;
    creator?: { id: string; name?: string | null; email: string } | null;
}
