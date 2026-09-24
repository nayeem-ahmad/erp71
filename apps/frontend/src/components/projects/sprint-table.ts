/**
 * The sprint table's arithmetic: swimlanes, column totals and the key stats
 * beside it. Pure, like `board-lanes.ts`, so the grouping and the sums can be
 * tested without a page to render.
 */

import type { BurndownPoint } from './BurndownChart';

export type SprintLaneMode = 'none' | 'assignee' | 'story';

export const SPRINT_LANE_MODES: readonly SprintLaneMode[] = ['none', 'assignee', 'story'];

/** The lane for a task with nobody on it, or no story. Always the last one. */
export const NO_LANE = 'none';

export interface SprintTask {
    id: string;
    title: string;
    estimate_hours?: string | number | null;
    remaining_hours?: string | number | null;
    logged_hours?: number | null;
    status?: { id: string; name: string; category: string } | null;
    project?: { id: string; code: string; name: string } | null;
    assignee?: { id: string; name?: string | null; email: string } | null;
    assigneeEmployee?: { id: string; name?: string | null } | null;
    userStory?: { id: string; code: string; title: string } | null;
}

export interface SprintLane {
    key: string;
    /** The person's name or the story's title. Null for `NO_LANE`, which the page names. */
    title: string | null;
    /** The story's code, `OTB-3`, on a story lane. */
    code?: string;
    tasks: SprintTask[];
}

export const hours = (value: unknown): number => (value == null ? 0 : Number(value) || 0);

export function assigneeNameOf(task: SprintTask): string | null {
    return task.assignee?.name ?? task.assignee?.email ?? task.assigneeEmployee?.name ?? null;
}

export function laneKeyOf(task: SprintTask, mode: SprintLaneMode): string {
    if (mode === 'story') return task.userStory ? `story:${task.userStory.id}` : NO_LANE;
    if (task.assignee) return `user:${task.assignee.id}`;
    if (task.assigneeEmployee) return `employee:${task.assigneeEmployee.id}`;
    return NO_LANE;
}

/** `OTB-2` before `OTB-10`, which a plain string compare gets backwards. */
const byCode = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/**
 * Tasks split into lanes, keeping each task's order inside its lane. With no
 * mode there is one lane holding everything, so the page renders one shape.
 */
export function groupSprintTasks(tasks: SprintTask[], mode: SprintLaneMode): SprintLane[] {
    if (mode === 'none') return [{ key: 'all', title: null, tasks }];

    const lanes = new Map<string, SprintLane>();
    for (const task of tasks) {
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
                tasks: [],
            };
            lanes.set(key, lane);
        }
        lane.tasks.push(task);
    }

    return [...lanes.values()].sort((a, b) => {
        if (a.key === NO_LANE) return 1;
        if (b.key === NO_LANE) return -1;
        if (mode === 'story') return byCode(a.code ?? '', b.code ?? '');
        return (a.title ?? '').localeCompare(b.title ?? '');
    });
}

export interface HourTotals {
    estimate: number;
    spent: number;
    remaining: number;
}

export function sumHours(tasks: SprintTask[]): HourTotals {
    const total = tasks.reduce(
        (acc, task) => ({
            estimate: acc.estimate + hours(task.estimate_hours),
            spent: acc.spent + hours(task.logged_hours),
            remaining: acc.remaining + hours(task.remaining_hours),
        }),
        { estimate: 0, spent: 0, remaining: 0 },
    );
    return {
        estimate: round2(total.estimate),
        spent: round2(total.spent),
        remaining: round2(total.remaining),
    };
}

/**
 * Per-day totals across `tasks`. A day where no task has a reading is `null`,
 * not zero: it is a future day or one before anything was estimated, and a
 * total of `0` would read as a finished sprint.
 */
export function dayTotals(
    tasks: SprintTask[],
    daily: Record<string, (number | null)[]>,
    dayCount: number,
): (number | null)[] {
    return Array.from({ length: dayCount }, (_, i) => {
        let seen = false;
        let sum = 0;
        for (const task of tasks) {
            const value = daily[task.id]?.[i];
            if (value == null) continue;
            seen = true;
            sum += value;
        }
        return seen ? round2(sum) : null;
    });
}

export interface SprintStats extends HourTotals {
    taskCount: number;
    doneCount: number;
    /** Share of the estimate no longer remaining, 0–100. */
    progress: number;
    /** Working days from today to the end, today included. */
    workingDaysLeft: number;
    /**
     * Ideal minus actual remaining for today, from the burndown. Positive is
     * ahead of the line. Null when today has no reading to compare.
     */
    variance: number | null;
}

export function sprintStats(
    tasks: SprintTask[],
    series: BurndownPoint[],
    todayKey: string,
): SprintStats {
    const totals = sumHours(tasks);
    const doneCount = tasks.filter((task) => task.status?.category === 'DONE').length;
    const progress =
        totals.estimate > 0
            ? Math.round(Math.min(Math.max((totals.estimate - totals.remaining) / totals.estimate, 0), 1) * 100)
            : 0;
    const workingDaysLeft = series.filter((point) => point.isWorkingDay && point.date >= todayKey).length;
    const today = series.find((point) => point.date === todayKey);
    const variance =
        today && today.ideal != null && today.actual != null ? round2(today.ideal - today.actual) : null;

    return { ...totals, taskCount: tasks.length, doneCount, progress, workingDaysLeft, variance };
}

/** Today as a `YYYY-MM-DD` key in UTC — the form the sprint API's days use. */
export function todayKey(now = new Date()): string {
    return now.toISOString().slice(0, 10);
}

export function round2(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}
