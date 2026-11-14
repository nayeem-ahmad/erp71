/**
 * The extra where-clauses for `GET /project-tasks`.
 *
 * The scalar params (`assigneeId`, `priority`, `projectId`, `sprintId`, …)
 * keep the shape they have always had. The comma lists are what the Tasks
 * page sends once somebody ticks more than one, and they combine with an OR
 * inside the dimension and an AND across dimensions. A list that is not a
 * sprint still matches the current `sprint_id`, not the membership history
 * the sprint page reads — that history stays on the singular `sprintId`.
 */

import { calendarDateRange, createdAtRange } from '../common/created-range.util';
import { addCalendarDays, zonedDateString } from '../common/tenant-time.util';
import { csv, csvIds, csvOf, equalityOrIn, parseNumberParam, type NumberParam } from './list-query.util';
import type { ListTasksDto } from './project.dto';

export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export const STATUS_CATEGORIES = ['TODO', 'IN_PROGRESS', 'DONE'] as const;
export const DUE_PRESETS = ['overdue', 'today', 'week'] as const;
export const TIME_FLAGS = ['over', 'none', 'no-estimate'] as const;
export const UPDATED_PRESETS = ['d2', 'd3', 'd7'] as const;

const UPDATED_DAYS: Record<(typeof UPDATED_PRESETS)[number], number> = { d2: 2, d3: 3, d7: 7 };

/** No real task has this id, so an empty time match returns no rows. */
export const NO_TASK = '00000000-0000-0000-0000-000000000000';

export type TaskListOmit =
    | 'project'
    | 'assignee'
    | 'priority'
    | 'status'
    | 'label'
    | 'sprint'
    | 'story'
    | 'epic'
    | 'due'
    | 'updated'
    | 'created'
    | 'time'
    | 'hideDone';

export interface AssigneePick {
    users: string[];
    employees: string[];
    unassigned: boolean;
}

export function parseAssigneeList(raw: string | undefined): AssigneePick {
    const users: string[] = [];
    const employees: string[] = [];
    let unassigned = false;
    for (const token of csv(raw)) {
        if (token === 'unassigned') unassigned = true;
        else if (token.startsWith('user:') && csvIds(token.slice(5)).length) users.push(token.slice(5));
        else if (token.startsWith('employee:') && csvIds(token.slice(9)).length) employees.push(token.slice(9));
    }
    return { users, employees, unassigned };
}

/** Monday–Sunday of the week `today` sits in. */
export function weekBounds(today: string): { from: string; to: string } {
    const [year, month, day] = today.split('-').map(Number);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    const from = addCalendarDays(today, weekday === 0 ? -6 : 1 - weekday);
    return { from, to: addCalendarDays(from, 6) };
}

function dayDate(day: string): Date {
    return new Date(`${day}T00:00:00.000Z`);
}

function pushAnd(where: Record<string, unknown>, clause: Record<string, unknown> | null) {
    if (!clause) return;
    const existing = where.AND;
    const and = Array.isArray(existing) ? existing : existing ? [existing] : [];
    where.AND = [...and, clause];
}

function assigneeClause(pick: AssigneePick): Record<string, unknown> | null {
    const ors: Record<string, unknown>[] = [];
    if (pick.users.length) ors.push({ assignee_id: equalityOrIn(pick.users) });
    if (pick.employees.length) ors.push({ assignee_employee_id: equalityOrIn(pick.employees) });
    if (pick.unassigned) ors.push({ assignee_id: null, assignee_employee_id: null });
    if (ors.length === 0) return null;
    if (ors.length === 1) return ors[0];
    return { OR: ors };
}

function dueClause(presets: readonly string[], from: string, to: string, today: string): Record<string, unknown> | null {
    const ors: Record<string, unknown>[] = [];
    if (presets.includes('overdue')) {
        ors.push({
            due_date: { lt: dayDate(today) },
            status: { category: { not: 'DONE' } },
        });
    }
    if (presets.includes('today')) ors.push({ due_date: dayDate(today) });
    if (presets.includes('week')) {
        const week = weekBounds(today);
        const range = calendarDateRange(week.from, week.to);
        if (range) ors.push({ due_date: range });
    }
    const range = calendarDateRange(from, to);
    if (range) ors.push({ due_date: range });
    if (ors.length === 0) return null;
    if (ors.length === 1) return ors[0];
    return { OR: ors };
}

function updatedClause(
    presets: readonly string[],
    from: string,
    to: string,
    today: string,
    zone: string | undefined,
): Record<string, unknown> | null {
    const ors: Record<string, unknown>[] = [];
    const days = presets
        .filter((preset): preset is keyof typeof UPDATED_DAYS => preset in UPDATED_DAYS)
        .map((preset) => UPDATED_DAYS[preset]);
    if (days.length) {
        // Any of the gaps is the shortest one: "2 days or 7 days" is "at least 2".
        const stale = createdAtRange(undefined, addCalendarDays(today, -Math.min(...days)), zone);
        if (stale) ors.push({ updated_at: stale });
    }
    const range = createdAtRange(from, to, zone);
    if (range) ors.push({ updated_at: range });
    if (ors.length === 0) return null;
    if (ors.length === 1) return ors[0];
    return { OR: ors };
}

/**
 * The task-list `where`, before the access filter is merged in.
 *
 * `timeIds` is the set of tasks the logged-hours / time-vs-estimate filter
 * already resolved (null when that filter is off, or when a count is ignoring
 * it). An empty set matches nothing.
 */
export function buildTaskListWhere(
    tenantId: string,
    query: ListTasksDto,
    zone: string | undefined,
    timeIds: string[] | null,
    omit?: TaskListOmit,
    now: Date = new Date(),
): Record<string, unknown> {
    const today = zonedDateString(now, zone ?? 'UTC');
    const created = omit === 'created' ? undefined : createdAtRange(query.createdFrom, query.createdTo, zone);
    const priorities = omit === 'priority' ? [] : csvOf(query.priorities, PRIORITIES);
    const categories = omit === 'status' ? [] : csvOf(query.statusCategories, STATUS_CATEGORIES);
    const projects = omit === 'project' ? [] : csvIds(query.projectIds);
    const labels = omit === 'label' ? [] : csvIds(query.labelIds);
    const sprints = omit === 'sprint' ? [] : [...csvIds(query.sprintIds), ...csv(query.sprintIds).filter((v) => v === 'none')];
    const stories = omit === 'story' ? [] : [...csvIds(query.storyIds), ...csv(query.storyIds).filter((v) => v === 'none')];
    const epics = omit === 'epic' ? [] : [...csvIds(query.epicIds), ...csv(query.epicIds).filter((v) => v === 'none')];
    const useAssigneeList = omit !== 'assignee' && Boolean(query.assignees);

    const where: Record<string, unknown> = {
        tenant_id: tenantId,
        deleted_at: null,
        ...(projects.length
            ? { project_id: equalityOrIn(projects) }
            : query.projectId && omit !== 'project'
              ? { project_id: query.projectId }
              : {}),
        ...(!useAssigneeList && query.assigneeId && omit !== 'assignee' ? { assignee_id: query.assigneeId } : {}),
        ...(!useAssigneeList && query.assigneeEmployeeId && omit !== 'assignee'
            ? { assignee_employee_id: query.assigneeEmployeeId }
            : {}),
        ...(!useAssigneeList && query.unassigned === 'true' && omit !== 'assignee'
            ? { assignee_id: null, assignee_employee_id: null }
            : {}),
        ...(priorities.length
            ? { priority: equalityOrIn(priorities) }
            : query.priority && omit !== 'priority'
              ? { priority: query.priority }
              : {}),
        ...(created ? { created_at: created } : {}),
        ...(query.statusId && omit !== 'status' ? { status_id: query.statusId } : {}),
        ...(categories.length
            ? {}
            : query.statusCategory && omit !== 'status'
              ? { status: { category: query.statusCategory.toUpperCase() } }
              : {}),
        ...(query.milestoneId ? { milestone_id: query.milestoneId } : {}),
        ...(stories.length
            ? {}
            : query.userStoryId && omit !== 'story'
              ? { user_story_id: query.userStoryId }
              : {}),
        ...(!stories.length && query.noUserStory === 'true' && omit !== 'story' ? { user_story_id: null } : {}),
        ...(labels.length
            ? { labels: { some: { label_id: equalityOrIn(labels) } } }
            : query.labelId && omit !== 'label'
              ? { labels: { some: { label_id: query.labelId } } }
              : {}),
    };

    if (query.backlogOnly === 'true' && omit !== 'sprint') where.sprint_id = null;
    else if (query.sprintId && omit !== 'sprint') pushAnd(where, inSprintShape(query.sprintId));

    const search = query.search?.trim();
    if (search) where.title = { contains: search, mode: 'insensitive' };

    if (useAssigneeList) pushAnd(where, assigneeClause(parseAssigneeList(query.assignees)));
    if (categories.length && omit !== 'status') {
        pushAnd(where, { status: { category: equalityOrIn(categories) } });
    }
    if (omit !== 'hideDone' && (query.hideDone === 'true' || query.hideDone === '1')) {
        pushAnd(where, { status: { category: { not: 'DONE' } } });
    }
    if (omit !== 'due') {
        pushAnd(where, dueClause(csvOf(query.due, DUE_PRESETS), query.dueFrom ?? '', query.dueTo ?? '', today));
    }
    if (omit !== 'updated') {
        pushAnd(
            where,
            updatedClause(csvOf(query.updated, UPDATED_PRESETS), query.updatedFrom ?? '', query.updatedTo ?? '', today, zone),
        );
    }
    if (sprints.length && omit !== 'sprint') {
        const ids = sprints.filter((id) => id !== 'none');
        const ors: Record<string, unknown>[] = [];
        if (ids.length) ors.push({ sprint_id: equalityOrIn(ids) });
        if (sprints.includes('none')) ors.push({ sprint_id: null });
        pushAnd(where, ors.length === 1 ? ors[0] : { OR: ors });
    }
    if (stories.length && omit !== 'story') {
        const ids = stories.filter((id) => id !== 'none');
        const ors: Record<string, unknown>[] = [];
        if (ids.length) ors.push({ user_story_id: equalityOrIn(ids) });
        if (stories.includes('none')) ors.push({ user_story_id: null });
        pushAnd(where, ors.length === 1 ? ors[0] : { OR: ors });
    }
    if (epics.length && omit !== 'epic') {
        const ids = epics.filter((id) => id !== 'none');
        const ors: Record<string, unknown>[] = [];
        if (ids.length) ors.push({ userStory: { epic_id: equalityOrIn(ids) } });
        if (epics.includes('none')) ors.push({ userStory: { epic_id: null } });
        pushAnd(where, ors.length === 1 ? ors[0] : { OR: ors });
    }
    if (omit !== 'time' && timeIds) {
        pushAnd(where, { id: { in: timeIds.length ? timeIds : [NO_TASK] } });
    }
    return where;
}

/** The sprint-page membership clause, kept here so the list builder can append it. */
function inSprintShape(sprintId: string): Record<string, unknown> {
    return {
        OR: [
            { sprint_id: sprintId },
            {
                sprintMemberships: {
                    some: {
                        sprint_id: sprintId,
                        removed_at: { not: null },
                        outcome: { in: ['DONE', 'CARRIED_OVER', 'RETURNED_TO_BACKLOG'] },
                    },
                },
            },
        ],
    };
}

export function timeFlagsOf(query: ListTasksDto): string[] {
    return csvOf(query.time, TIME_FLAGS);
}

export function hoursOf(query: ListTasksDto): NumberParam | null {
    return parseNumberParam(query.hours);
}

/** One preset's due clause, for a count that ignores the other due choices. */
export function duePresetClause(preset: string, today: string): Record<string, unknown> | null {
    return dueClause([preset], '', '', today);
}

export function updatedPresetClause(preset: string, today: string, zone: string | undefined): Record<string, unknown> | null {
    return updatedClause([preset], '', '', today, zone);
}
