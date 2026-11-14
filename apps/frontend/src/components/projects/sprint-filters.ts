/**
 * Filters for the sprint detail page. The page already holds every task in the
 * sprint, so this narrows that list in the browser and writes the same choices
 * into the query string — a link is the view.
 *
 * Two filters the request named are not here, because the task has nowhere to
 * read them: a work-item type (ProjectTask has none; ProjectType belongs to the
 * project) and blocked / dependencies (no such relation). Carry-in is
 * `carried_in`, attached by the task list from SprintTask.carried_to_sprint_id.
 */

import { addCalendarDays, tenantDateOnly } from '@/lib/created-range';
import { numberConditionParam, type NumberCondition, type NumberConditionOp } from '@/lib/number-condition';
import { columnKeyOf, matchesSprintSearch, type SprintCardTask } from './sprint-cards';
import { NO_LANE, hours, laneKeyOf } from './sprint-table';

export const DUE_PRESETS = ['overdue', 'today', 'week'] as const;
export const TIME_FLAGS = ['over', 'none', 'no-estimate'] as const;
export const UPDATED_PRESETS = ['d2', 'd3', 'd7'] as const;
export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

export type DuePreset = (typeof DUE_PRESETS)[number];
export type TimeFlag = (typeof TIME_FLAGS)[number];
export type UpdatedPreset = (typeof UPDATED_PRESETS)[number];
export type SprintPriority = (typeof PRIORITIES)[number];

/** Which dimension a count ignores, so a tick shows how many it would add. */
export type SprintFilterDimension =
    | 'q'
    | 'assignee'
    | 'status'
    | 'hideDone'
    | 'priority'
    | 'due'
    | 'time'
    | 'hours'
    | 'labels'
    | 'carried'
    | 'updated';

export interface SprintFilterState {
    q: string;
    /** `me`, `unassigned`, `user:<id>` or `employee:<id>`. Any of them. */
    assignee: string[];
    /** Status name keys (`columnKeyOf`). Any of them. */
    status: string[];
    hideDone: boolean;
    priority: string[];
    /** Any of these, or a task inside `dueFrom`/`dueTo` when that is set too. */
    due: DuePreset[];
    dueFrom: string;
    dueTo: string;
    /** Any of these. The logged-hours condition is separate and combines with them. */
    time: TimeFlag[];
    hours: NumberCondition | null;
    /** Label ids. A task with any of them. */
    labels: string[];
    /** '' is either; the task list's `carried_in` flag. */
    carried: '' | 'yes' | 'no';
    /**
     * "No change in N days" — last update at least N days ago. Several of them
     * keep a task that meets any, which is the same as the shortest gap.
     * A from/to range is an alternative to the presets, not a further cut.
     */
    updated: UpdatedPreset[];
    updatedFrom: string;
    updatedTo: string;
}

export const EMPTY_SPRINT_FILTERS: SprintFilterState = {
    q: '',
    assignee: [],
    status: [],
    hideDone: false,
    priority: [],
    due: [],
    dueFrom: '',
    dueTo: '',
    time: [],
    hours: null,
    labels: [],
    carried: '',
    updated: [],
    updatedFrom: '',
    updatedTo: '',
};

export interface SprintFilterContext {
    /** Workspace calendar day, `YYYY-MM-DD`. */
    today: string;
    /** The signed-in user, so `me` can name their tasks. Null until `/auth/me` answers. */
    userId: string | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ASSIGNEE = /^(?:me|unassigned|user:\S+|employee:\S+)$/;

const OWNED = [
    'q',
    'assignee',
    'status',
    'hideDone',
    'priority',
    'due',
    'dueFrom',
    'dueTo',
    'time',
    'hours',
    'label',
    'carried',
    'updated',
    'updatedFrom',
    'updatedTo',
] as const;

const UPDATED_DAYS: Record<UpdatedPreset, number> = { d2: 2, d3: 3, d7: 7 };

function isDuePreset(value: string): value is DuePreset {
    return (DUE_PRESETS as readonly string[]).includes(value);
}
function isTimeFlag(value: string): value is TimeFlag {
    return (TIME_FLAGS as readonly string[]).includes(value);
}
function isUpdatedPreset(value: string): value is UpdatedPreset {
    return (UPDATED_PRESETS as readonly string[]).includes(value);
}
function isPriority(value: string): value is SprintPriority {
    return (PRIORITIES as readonly string[]).includes(value);
}

function readList(params: URLSearchParams, key: string): string[] {
    return params
        .getAll(key)
        .flatMap((value) => value.split(','))
        .map((value) => value.trim())
        .filter(Boolean);
}

function readDay(params: URLSearchParams, key: string): string {
    const value = params.get(key)?.slice(0, 10) ?? '';
    return DAY.test(value) ? value : '';
}

/** `gt:4`, `between:1,8` — the same spelling the list number filter sends. */
export function parseHoursParam(raw: string | null): NumberCondition | null {
    if (!raw) return null;
    const between = /^between:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(raw);
    if (between) {
        return { op: 'between', value: Number(between[1]), to: Number(between[2]) };
    }
    const simple = /^(gt|lt|eq):(-?\d+(?:\.\d+)?)$/.exec(raw);
    if (!simple) return null;
    const value = Number(simple[2]);
    if (!Number.isFinite(value)) return null;
    return { op: simple[1] as NumberConditionOp, value };
}

export function parseSprintFilters(params: URLSearchParams): SprintFilterState {
    const carried = params.get('carried');
    const hide = params.get('hideDone');
    return {
        q: (params.get('q') ?? '').slice(0, 200),
        assignee: readList(params, 'assignee').filter((value) => ASSIGNEE.test(value)),
        status: readList(params, 'status').filter((value) => value.length <= 80),
        hideDone: hide === '1' || hide === 'true',
        priority: readList(params, 'priority').filter(isPriority),
        due: readList(params, 'due').filter(isDuePreset),
        dueFrom: readDay(params, 'dueFrom'),
        dueTo: readDay(params, 'dueTo'),
        time: readList(params, 'time').filter(isTimeFlag),
        hours: parseHoursParam(params.get('hours')),
        labels: readList(params, 'label').filter((value) => value.length <= 80),
        carried: carried === 'yes' || carried === 'no' ? carried : '',
        updated: readList(params, 'updated').filter(isUpdatedPreset),
        updatedFrom: readDay(params, 'updatedFrom'),
        updatedTo: readDay(params, 'updatedTo'),
    };
}

function appendAll(params: URLSearchParams, key: string, values: readonly string[]) {
    for (const value of values) params.append(key, value);
}

/**
 * The query string for `filters`, keeping any param this page does not own
 * (so a later `?task=` on the same URL is not wiped). Empty filters contribute
 * nothing.
 */
export function sprintFiltersToQuery(current: URLSearchParams, filters: SprintFilterState): string {
    const next = new URLSearchParams();
    const owned = new Set<string>(OWNED);
    for (const [key, value] of current.entries()) {
        if (!owned.has(key)) next.append(key, value);
    }
    const q = filters.q.trim();
    if (q) next.set('q', q);
    appendAll(next, 'assignee', filters.assignee);
    appendAll(next, 'status', filters.status);
    if (filters.hideDone) next.set('hideDone', '1');
    appendAll(next, 'priority', filters.priority);
    appendAll(next, 'due', filters.due);
    if (filters.dueFrom) next.set('dueFrom', filters.dueFrom);
    if (filters.dueTo) next.set('dueTo', filters.dueTo);
    appendAll(next, 'time', filters.time);
    const hoursParam = numberConditionParam(filters.hours);
    if (hoursParam) next.set('hours', hoursParam);
    appendAll(next, 'label', filters.labels);
    if (filters.carried) next.set('carried', filters.carried);
    appendAll(next, 'updated', filters.updated);
    if (filters.updatedFrom) next.set('updatedFrom', filters.updatedFrom);
    if (filters.updatedTo) next.set('updatedTo', filters.updatedTo);
    return next.toString();
}

/** Monday–Sunday of the week `today` sits in, as calendar days. */
export function weekBounds(today: string): { from: string; to: string } {
    const [year, month, day] = today.split('-').map(Number);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    const from = addCalendarDays(today, weekday === 0 ? -6 : 1 - weekday);
    return { from, to: addCalendarDays(from, 6) };
}

/** A date column, or the date half of an ISO timestamp. Not shifted into a zone. */
export function dueDay(value: string | null | undefined): string | null {
    if (!value) return null;
    const head = value.slice(0, 10);
    return DAY.test(head) ? head : null;
}

/** A timestamp's calendar day in the workspace zone. */
export function updatedDay(value: string | null | undefined): string | null {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return tenantDateOnly(parsed);
}

function daysBetween(earlier: string, later: string): number {
    const [y1, m1, d1] = earlier.split('-').map(Number);
    const [y2, m2, d2] = later.split('-').map(Number);
    return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

function inDays(day: string | null, from: string, to: string): boolean {
    if (!day) return false;
    if (from && day < from) return false;
    if (to && day > to) return false;
    return Boolean(from || to);
}

export function matchesDuePreset(task: SprintCardTask, preset: DuePreset, today: string): boolean {
    const day = dueDay(task.due_date);
    if (!day) return false;
    if (preset === 'overdue') return day < today && task.status?.category !== 'DONE';
    if (preset === 'today') return day === today;
    const week = weekBounds(today);
    return day >= week.from && day <= week.to;
}

export function matchesUpdatedPreset(task: SprintCardTask, preset: UpdatedPreset, today: string): boolean {
    const day = updatedDay(task.updated_at);
    if (!day) return false;
    return daysBetween(day, today) >= UPDATED_DAYS[preset];
}

function estimateMissing(task: SprintCardTask): boolean {
    return task.estimate_hours == null || task.estimate_hours === '';
}

export function matchesTimeFlag(task: SprintCardTask, flag: TimeFlag): boolean {
    const logged = hours(task.logged_hours);
    if (flag === 'none') return logged === 0;
    if (flag === 'no-estimate') return estimateMissing(task);
    if (estimateMissing(task)) return false;
    const estimate = Number(task.estimate_hours);
    return Number.isFinite(estimate) && logged > estimate;
}

function matchesHours(logged: number, condition: NumberCondition | null): boolean {
    if (!condition) return true;
    if (condition.op === 'gt') return logged > condition.value;
    if (condition.op === 'lt') return logged < condition.value;
    if (condition.op === 'eq') return logged === condition.value;
    const upper = condition.to ?? condition.value;
    const low = Math.min(condition.value, upper);
    const high = Math.max(condition.value, upper);
    return logged >= low && logged <= high;
}

function matchesAssignee(task: SprintCardTask, selected: readonly string[], userId: string | null): boolean {
    if (selected.length === 0) return true;
    const key = laneKeyOf(task, 'assignee');
    return selected.some((value) => {
        if (value === 'me') return userId != null && key === `user:${userId}`;
        if (value === 'unassigned') return key === NO_LANE;
        return key === value;
    });
}

function on(omit: SprintFilterDimension | undefined, dimension: SprintFilterDimension): boolean {
    return omit !== dimension;
}

/** Presets and a from/to range are alternatives: a task may match either. */
function matchesAlternative(presetHit: boolean, rangeHit: boolean, hasPresets: boolean, hasRange: boolean): boolean {
    if (hasPresets && hasRange) return presetHit || rangeHit;
    if (hasPresets) return presetHit;
    return rangeHit;
}

export function taskMatchesSprintFilters(
    task: SprintCardTask,
    filters: SprintFilterState,
    ctx: SprintFilterContext,
    omit?: SprintFilterDimension,
): boolean {
    if (on(omit, 'q') && !matchesSprintSearch(task, filters.q)) return false;
    if (on(omit, 'assignee') && !matchesAssignee(task, filters.assignee, ctx.userId)) return false;
    if (on(omit, 'status') && filters.status.length > 0) {
        const key = task.status ? columnKeyOf(task.status.name) : '';
        if (!filters.status.includes(key)) return false;
    }
    if (on(omit, 'hideDone') && filters.hideDone && task.status?.category === 'DONE') return false;
    if (on(omit, 'priority') && filters.priority.length > 0 && !filters.priority.includes(task.priority ?? '')) {
        return false;
    }
    if (on(omit, 'due')) {
        const hasRange = Boolean(filters.dueFrom || filters.dueTo);
        if (filters.due.length > 0 || hasRange) {
            const presetHit = filters.due.some((preset) => matchesDuePreset(task, preset, ctx.today));
            const rangeHit = hasRange && inDays(dueDay(task.due_date), filters.dueFrom, filters.dueTo);
            if (!matchesAlternative(presetHit, rangeHit, filters.due.length > 0, hasRange)) return false;
        }
    }
    if (on(omit, 'time') && filters.time.length > 0 && !filters.time.some((flag) => matchesTimeFlag(task, flag))) {
        return false;
    }
    if (on(omit, 'hours') && !matchesHours(hours(task.logged_hours), filters.hours)) return false;
    if (on(omit, 'labels') && filters.labels.length > 0) {
        const ids = new Set((task.labels ?? []).map((entry) => entry.label.id));
        if (!filters.labels.some((id) => ids.has(id))) return false;
    }
    if (on(omit, 'carried')) {
        if (filters.carried === 'yes' && task.carried_in !== true) return false;
        if (filters.carried === 'no' && task.carried_in === true) return false;
    }
    if (on(omit, 'updated')) {
        const hasRange = Boolean(filters.updatedFrom || filters.updatedTo);
        if (filters.updated.length > 0 || hasRange) {
            const presetHit = filters.updated.some((preset) => matchesUpdatedPreset(task, preset, ctx.today));
            const rangeHit = hasRange && inDays(updatedDay(task.updated_at), filters.updatedFrom, filters.updatedTo);
            if (!matchesAlternative(presetHit, rangeHit, filters.updated.length > 0, hasRange)) return false;
        }
    }
    return true;
}

export function filterSprintTasks(
    tasks: readonly SprintCardTask[],
    filters: SprintFilterState,
    ctx: SprintFilterContext,
    omit?: SprintFilterDimension,
): SprintCardTask[] {
    return tasks.filter((task) => taskMatchesSprintFilters(task, filters, ctx, omit));
}

/**
 * Who a task composed into this sprint lands on.
 *
 * One named person (or only Me) keeps the new task inside the slice on screen.
 * Only Unassigned leaves it with nobody. Anything wider — nobody picked, or
 * several people — lands on the signed-in user, which is what an unfiltered
 * sprint already did.
 */
export function composerAssigneeKey(selected: readonly string[], userId: string | null): string {
    const holders = selected.filter((key) => key.startsWith('user:') || key.startsWith('employee:'));
    if (selected.length === 1 && selected[0] === 'unassigned') return '';
    if (holders.length === 1 && selected.every((key) => key === holders[0] || key === 'me')) return holders[0];
    return userId ? `user:${userId}` : '';
}
