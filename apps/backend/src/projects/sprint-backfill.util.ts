/**
 * Pure replay logic for `packages/database/prisma/backfill-sprint-history.ts`,
 * kept here so it is tested with the rest of the module. No Prisma, no clock.
 *
 * Before `SprintTask` and `SprintBurndownPoint` existed, a sprint kept one
 * snapshot per day and a task kept only its current sprint. Both are rebuilt
 * from `ProjectTaskRemainingLog`, whose rows already carry the sprint each
 * change happened in — which is the only record of which tasks a completed
 * sprint once held.
 */

export type BurndownCauseName =
    | 'STARTED'
    | 'WORK_LOGGED'
    | 'RE_ESTIMATED'
    | 'TASK_ADDED'
    | 'TASK_REMOVED'
    | 'STATUS_CHANGED'
    | 'COMPLETED'
    | 'BACKFILLED';

/** Which cause a remaining-hours log source amounts to on the chart. */
export function burndownCauseForSource(source: string): BurndownCauseName {
    switch (source) {
        case 'TIME_LOGGED':
        case 'TIME_ENTRY_DELETED':
            return 'WORK_LOGGED';
        case 'TASK_COMPLETED':
        case 'TASK_REOPENED':
            return 'STATUS_CHANGED';
        // A task's opening hours only ever land as it is created, which in a
        // sprint is the task joining it.
        case 'TASK_CREATED':
            return 'TASK_ADDED';
        default:
            return 'RE_ESTIMATED';
    }
}

/**
 * 23:50 Dhaka — when the retired nightly cron took its snapshot — as a UTC
 * offset from midnight UTC of the same date. Dhaka has no DST.
 */
const SNAPSHOT_TIME_UTC = 'T17:50:00.000Z';
/** 23:59 Dhaka: the end of a sprint's last day. */
const END_OF_DAY_UTC = 'T17:59:00.000Z';

export interface ReplayLog {
    taskId: string;
    hours: number;
    source: string;
    changedAt: Date;
}

export interface ReplaySnapshot {
    /** `YYYY-MM-DD` */
    date: string;
    remaining: number;
    committed: number;
    taskCount: number;
    doneTaskCount: number;
}

export interface ReplayedPoint {
    recordedAt: Date;
    remaining: number;
    committed: number;
    taskCount: number;
    doneTaskCount: number;
    cause: BurndownCauseName;
    taskId: string | null;
}

/**
 * One sprint's burndown points: one per remaining-log row, with the running
 * totals, plus one `BACKFILLED` point for each daily snapshot whose day has no
 * log row at all. Points at or after `before` are dropped — those are the live
 * ones recorded since the deploy.
 *
 * Two figures are weaker than a live point's, as they were on the daily
 * replay: task counts cover only tasks that had a log row, and "done" is
 * inferred from remaining reaching zero. `committed` is the larger of the
 * latest snapshot's figure (the true sum of estimates, which the log knows
 * nothing about) and the sum of each task's opening figure (which catches a
 * task that joined after that snapshot).
 *
 * Known limit: a task that joined the sprint without a log row there (estimated
 * in the backlog, then assigned) is missing from log points but counted in a
 * snapshot point, so a backfilled line can dip on log days and rise on snapshot
 * days. The old data never recorded when tasks joined, so it cannot be fixed
 * here; live points recorded since the release do not have the problem.
 */
export function replayPoints(input: {
    logs: ReplayLog[];
    snapshots: ReplaySnapshot[];
    before?: Date;
}): ReplayedPoint[] {
    const logs = [...input.logs].sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime());
    const snapshots = [...input.snapshots].sort((a, b) => a.date.localeCompare(b.date));

    const latest = new Map<string, number>();
    const opening = new Map<string, number>();
    const points: ReplayedPoint[] = [];
    const daysWithLogs = new Set<string>();

    for (const log of logs) {
        latest.set(log.taskId, log.hours);
        if (!opening.has(log.taskId)) opening.set(log.taskId, log.hours);
        const day = dhakaDay(log.changedAt);
        daysWithLogs.add(day);

        const snapshot = lastOnOrBefore(snapshots, day);
        const values = [...latest.values()];
        points.push({
            recordedAt: log.changedAt,
            remaining: round2(sum(values)),
            // The larger of the two: a snapshot's committed is the true sum of
            // estimates, but it is stale once a task joins after it was taken.
            committed: round2(Math.max(snapshot?.committed ?? 0, sum([...opening.values()]))),
            taskCount: latest.size,
            doneTaskCount: values.filter((hours) => hours === 0).length,
            cause: burndownCauseForSource(log.source),
            taskId: log.taskId,
        });
    }

    for (const snapshot of snapshots) {
        if (daysWithLogs.has(snapshot.date)) continue;
        points.push({
            recordedAt: new Date(`${snapshot.date}${SNAPSHOT_TIME_UTC}`),
            remaining: round2(snapshot.remaining),
            committed: round2(snapshot.committed),
            taskCount: snapshot.taskCount,
            doneTaskCount: snapshot.doneTaskCount,
            cause: 'BACKFILLED',
            taskId: null,
        });
    }

    return points
        .filter((point) => !input.before || point.recordedAt.getTime() < input.before.getTime())
        .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
}

export interface HistorySprint {
    id: string;
    tenantId: string;
    status: string;
    startDate: Date;
    endDate: Date;
}

export interface HistoryRow {
    tenantId: string;
    sprintId: string;
    taskId: string;
    addedAt: Date;
    removedAt: Date | null;
    outcome: 'DONE' | 'RETURNED_TO_BACKLOG' | null;
    remainingAtClose: number | null;
}

/**
 * `SprintTask` rows for what happened before they were recorded.
 *
 * - **Planned/active sprint:** an open row for each task in it now. Skipped
 *   for a task that already has an open row — one that moved after the deploy
 *   has its real row, and a second would break the one-open-row index.
 * - **Completed sprint:** a closed row for each task in it now (`DONE` — the
 *   old `complete` kept only Done tasks there) and each task that has log rows
 *   in it but has since left (`RETURNED_TO_BACKLOG`, which is all the old
 *   `complete` ever did with unfinished work). Closed at the end of its last
 *   day; `remaining_at_close` is the task's last log figure in that sprint.
 *
 * `added_at` is the task's first log row in the sprint, else the sprint's
 * start. Pairs already recorded are skipped, so a second run adds nothing.
 * Callers pass non-deleted tasks only.
 */
export function historyRows(input: {
    sprints: HistorySprint[];
    tasks: Array<{ id: string; sprintId: string | null }>;
    logs: Array<{ taskId: string; sprintId: string; hours: number; changedAt: Date }>;
    existingOpenTaskIds: Set<string>;
    existingPairs: Set<string>;
}): HistoryRow[] {
    const live = new Set(input.tasks.map((task) => task.id));
    const first = new Map<string, Date>();
    const last = new Map<string, { at: Date; hours: number }>();
    for (const log of input.logs) {
        if (!live.has(log.taskId)) continue;
        const key = `${log.sprintId}:${log.taskId}`;
        const seenFirst = first.get(key);
        if (!seenFirst || log.changedAt < seenFirst) first.set(key, log.changedAt);
        const seenLast = last.get(key);
        if (!seenLast || log.changedAt >= seenLast.at) last.set(key, { at: log.changedAt, hours: log.hours });
    }

    const rows: HistoryRow[] = [];
    for (const sprint of input.sprints) {
        const current = input.tasks.filter((task) => task.sprintId === sprint.id).map((task) => task.id);
        const addedAt = (taskId: string) => first.get(`${sprint.id}:${taskId}`) ?? sprint.startDate;

        if (sprint.status !== 'COMPLETED') {
            for (const taskId of current) {
                if (input.existingOpenTaskIds.has(taskId)) continue;
                if (input.existingPairs.has(`${sprint.id}:${taskId}`)) continue;
                rows.push({
                    tenantId: sprint.tenantId,
                    sprintId: sprint.id,
                    taskId,
                    addedAt: addedAt(taskId),
                    removedAt: null,
                    outcome: null,
                    remainingAtClose: null,
                });
            }
            continue;
        }

        const fromLogs = [...first.keys()]
            .filter((key) => key.startsWith(`${sprint.id}:`))
            .map((key) => key.slice(sprint.id.length + 1));
        const removedAt = new Date(`${sprint.endDate.toISOString().slice(0, 10)}${END_OF_DAY_UTC}`);
        for (const taskId of new Set([...current, ...fromLogs])) {
            if (input.existingPairs.has(`${sprint.id}:${taskId}`)) continue;
            rows.push({
                tenantId: sprint.tenantId,
                sprintId: sprint.id,
                taskId,
                addedAt: addedAt(taskId),
                removedAt,
                outcome: current.includes(taskId) ? 'DONE' : 'RETURNED_TO_BACKLOG',
                remainingAtClose: last.get(`${sprint.id}:${taskId}`)?.hours ?? null,
            });
        }
    }
    return rows;
}

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

/**
 * The Dhaka calendar day of an instant — the day the retired snapshots were
 * keyed by. A UTC day would file a 03:00 Dhaka edit under the day before.
 */
function dhakaDay(at: Date): string {
    return new Date(at.getTime() + DHAKA_OFFSET_MS).toISOString().slice(0, 10);
}

function lastOnOrBefore(snapshots: ReplaySnapshot[], day: string): ReplaySnapshot | undefined {
    let found: ReplaySnapshot | undefined;
    for (const snapshot of snapshots) {
        if (snapshot.date > day) break;
        found = snapshot;
    }
    return found;
}

function sum(values: number[]): number {
    return values.reduce((total, value) => total + value, 0);
}

function round2(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}
