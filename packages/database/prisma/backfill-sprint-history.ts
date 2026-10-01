/**
 * Rebuilds sprint history and burndown points for sprints that ran before
 * either was recorded.
 *
 * Why these exist
 * ---------------
 * Until 2026-10-01 a task kept only its current sprint, completing a sprint
 * dropped its unfinished tasks to the backlog with no trace, and the burndown
 * kept one snapshot per day. `SprintTask` (a row per task per sprint) and
 * `SprintBurndownPoint` (a point per change) start empty, so without this:
 *
 *   - an active sprint's task list is fine (it reads `sprint_id`), but its
 *     tasks show no "Sprints" history on the card;
 *   - a completed sprint lists only its Done tasks — its carried work is
 *     invisible;
 *   - every chart starts at the deploy.
 *
 * What it writes
 * --------------
 * `ProjectTaskRemainingLog` rows already carry the sprint each change happened
 * in, which is the only record of what a completed sprint once held. From it
 * (logic and its tests in `apps/backend/src/projects/sprint-backfill.util.ts`):
 *
 *   - **History.** An open row for every task in a planned/active sprint; a
 *     closed row for every task a completed sprint held — `DONE` for those
 *     still pointing at it, `RETURNED_TO_BACKLOG` for those that left. A task
 *     carried out of a completed sprint that never had a log row (no estimate,
 *     no time) cannot be recovered; it held no hours, so no chart changes.
 *   - **Points.** For each active/completed sprint, one point per log row with
 *     the running totals, plus a `BACKFILLED` point for each old daily snapshot
 *     on a day with no log row. Only before the sprint's earliest existing
 *     point, so live points recorded since the deploy are not duplicated.
 *
 * Idempotent: rows and points already present are skipped, so a second run
 * writes nothing. Deleted tasks are left out.
 *
 * Report-only by default. Read the summary, then re-run with --apply.
 *
 * Usage:
 *   npx tsx prisma/backfill-sprint-history.ts                   # report, all tenants
 *   npx tsx prisma/backfill-sprint-history.ts --tenant=<id>     # report, one tenant
 *   npx tsx prisma/backfill-sprint-history.ts --apply           # write
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../.env') });

import { PrismaClient } from '@prisma/client';
import { historyRows, replayPoints } from '../../../apps/backend/src/projects/sprint-backfill.util';

const prisma = new PrismaClient();
const TAG = '[backfill-sprint-history]';

async function main() {
    const apply = process.argv.includes('--apply');
    const tenantArg = process.argv.find((arg) => arg.startsWith('--tenant='));
    const tenantId = tenantArg ? tenantArg.slice('--tenant='.length) : undefined;
    const scope = tenantId ? { tenant_id: tenantId } : {};

    const sprints = await prisma.sprint.findMany({
        where: scope,
        select: { id: true, tenant_id: true, name: true, status: true, start_date: true, end_date: true },
        orderBy: [{ tenant_id: 'asc' }, { start_date: 'asc' }],
    });
    const sprintIds = sprints.map((sprint) => sprint.id);

    const [logs, tasks, existing, snapshots, earliestPoints] = await Promise.all([
        prisma.projectTaskRemainingLog.findMany({
            where: { ...scope, sprint_id: { in: sprintIds } },
            select: { task_id: true, sprint_id: true, new_hours: true, source: true, changed_at: true },
        }),
        prisma.projectTask.findMany({
            where: {
                ...scope,
                deleted_at: null,
                OR: [{ sprint_id: { in: sprintIds } }, { remainingLogs: { some: { sprint_id: { in: sprintIds } } } }],
            },
            select: { id: true, sprint_id: true },
        }),
        prisma.sprintTask.findMany({
            where: scope,
            select: { sprint_id: true, task_id: true, removed_at: true },
        }),
        prisma.sprintSnapshot.findMany({
            where: { ...scope, sprint_id: { in: sprintIds } },
            orderBy: { snapshot_date: 'asc' },
        }),
        prisma.sprintBurndownPoint.groupBy({
            by: ['sprint_id'],
            where: { ...scope, sprint_id: { in: sprintIds } },
            _min: { recorded_at: true },
        }),
    ]);

    const rows = historyRows({
        sprints: sprints.map((sprint) => ({
            id: sprint.id,
            tenantId: sprint.tenant_id,
            status: sprint.status,
            startDate: sprint.start_date,
            endDate: sprint.end_date,
        })),
        tasks: tasks.map((task) => ({ id: task.id, sprintId: task.sprint_id })),
        logs: logs.map((log) => ({
            taskId: log.task_id,
            sprintId: log.sprint_id as string,
            hours: Number(log.new_hours),
            changedAt: log.changed_at,
        })),
        existingOpenTaskIds: new Set(existing.filter((row) => !row.removed_at).map((row) => row.task_id)),
        existingPairs: new Set(existing.map((row) => `${row.sprint_id}:${row.task_id}`)),
    });

    const earliest = new Map(earliestPoints.map((row) => [row.sprint_id, row._min.recorded_at]));
    const pointsBySprint = new Map<string, ReturnType<typeof replayPoints>>();
    for (const sprint of sprints) {
        if (sprint.status === 'PLANNED') continue;
        const points = replayPoints({
            logs: logs
                .filter((log) => log.sprint_id === sprint.id)
                .map((log) => ({
                    taskId: log.task_id,
                    hours: Number(log.new_hours),
                    source: log.source,
                    changedAt: log.changed_at,
                })),
            snapshots: snapshots
                .filter((row) => row.sprint_id === sprint.id)
                .map((row) => ({
                    date: row.snapshot_date.toISOString().slice(0, 10),
                    remaining: Number(row.remaining_hours),
                    committed: Number(row.committed_hours),
                    taskCount: row.task_count,
                    doneTaskCount: row.done_task_count,
                })),
            before: earliest.get(sprint.id) ?? undefined,
        });
        if (points.length > 0) pointsBySprint.set(sprint.id, points);
    }

    console.log(`${TAG} ${apply ? 'APPLY' : 'REPORT ONLY (pass --apply to write)'}`);
    console.log(`  ${sprints.length} sprint(s) scanned`);
    for (const sprint of sprints) {
        const open = rows.filter((row) => row.sprintId === sprint.id && !row.removedAt).length;
        const closed = rows.filter((row) => row.sprintId === sprint.id && row.removedAt);
        const carried = closed.filter((row) => row.outcome === 'RETURNED_TO_BACKLOG').length;
        const points = pointsBySprint.get(sprint.id)?.length ?? 0;
        if (open + closed.length + points === 0) continue;
        console.log(
            `    ${sprint.name} (${sprint.status}, tenant ${sprint.tenant_id}): ` +
                `${open} open row(s), ${closed.length} closed row(s) (${carried} returned to backlog), ${points} point(s)`,
        );
    }
    const pointTotal = [...pointsBySprint.values()].reduce((total, points) => total + points.length, 0);
    console.log(`  Total: ${rows.length} history row(s), ${pointTotal} burndown point(s)`);

    if (!apply) return;

    // Open rows one at a time: the partial unique index refuses a second open
    // row for a task, and a task that moved between the scan and now must not
    // fail the whole batch.
    let written = 0;
    let skipped = 0;
    const closedRows = rows.filter((row) => row.removedAt);
    for (let i = 0; i < closedRows.length; i += 500) {
        const { count } = await prisma.sprintTask.createMany({ data: closedRows.slice(i, i + 500).map(toRow) });
        written += count;
    }
    for (const row of rows.filter((candidate) => !candidate.removedAt)) {
        try {
            await prisma.sprintTask.create({ data: toRow(row) });
            written += 1;
        } catch {
            skipped += 1;
        }
    }

    let pointsWritten = 0;
    for (const [sprintId, points] of pointsBySprint) {
        const tenant = sprints.find((sprint) => sprint.id === sprintId)!.tenant_id;
        const { count } = await prisma.sprintBurndownPoint.createMany({
            data: points.map((point) => ({
                tenant_id: tenant,
                sprint_id: sprintId,
                recorded_at: point.recordedAt,
                remaining_hours: point.remaining,
                committed_hours: point.committed,
                task_count: point.taskCount,
                done_task_count: point.doneTaskCount,
                cause: point.cause,
                task_id: point.taskId,
            })),
        });
        pointsWritten += count;
    }

    console.log(
        `${TAG} Wrote ${written} history row(s)${skipped ? ` (${skipped} skipped: task already had an open row)` : ''} ` +
            `and ${pointsWritten} burndown point(s).`,
    );
}

function toRow(row: ReturnType<typeof historyRows>[number]) {
    return {
        tenant_id: row.tenantId,
        sprint_id: row.sprintId,
        task_id: row.taskId,
        added_at: row.addedAt,
        removed_at: row.removedAt,
        outcome: row.outcome,
        remaining_at_close: row.remainingAtClose,
    };
}

main()
    .catch((error) => {
        console.error(`${TAG} Failed:`, error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
