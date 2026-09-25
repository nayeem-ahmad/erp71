import type { ProjectLabel, ProjectLabelColor } from '@/components/projects/board-tasks';

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
    userStory?: { id: string; reference: number; code: string; title: string } | null;
    /** Both come from `TASK_INCLUDE` and were previously discarded here. */
    sprint?: { id: string; name: string; status?: string } | null;
    milestone?: { id: string; name: string } | null;
    labels?: { label: ProjectLabel }[];
    checklistItems?: ChecklistItem[];
    cover_color?: ProjectLabelColor | null;
    timeEntries?: TimeEntry[];
    /** From `TASK_INCLUDE`; lets the collapsed feed say how much it holds. */
    _count?: { comments?: number; subtasks?: number };
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
