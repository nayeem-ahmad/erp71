import { Injectable } from '@nestjs/common';
import type { DatabaseService } from '../database/database.service';

/** Mirrors the `SprintTaskOutcome` enum. */
export type SprintTaskOutcomeName = 'DONE' | 'CARRIED_OVER' | 'RETURNED_TO_BACKLOG' | 'REMOVED';

/** The root client or a transaction's — `moveTasks` runs inside either. */
export type MembershipClient = Pick<DatabaseService, 'projectTask' | 'sprintTask'> & {
    /** Present on the root client only; a transaction's client has none. */
    $transaction?: DatabaseService['$transaction'];
};

interface TaskRow {
    id: string;
    sprint_id: string | null;
    remaining_hours: unknown;
}

/**
 * The only writer of `ProjectTask.sprint_id`.
 *
 * Every change to a task's sprint closes its open `SprintTask` row and opens
 * one for the sprint it joins, so a task's history of sprints cannot drift from
 * its current one. `sprint-membership.service.spec.ts` scans the module for any
 * other code assigning the column, because a history with a bypass is not a
 * history.
 *
 * Takes the client as an argument rather than injecting it so it runs inside
 * a caller's transaction (the board move, project delete, completing a
 * sprint) as easily as outside one.
 */
@Injectable()
export class SprintMembershipService {
    /**
     * Moves tasks into `toSprintId` (or the backlog, when null). Tasks already
     * there are left alone. The rows of the sprints they leave close as
     * `closeAs`; a carried task's row also names the sprint it went to.
     */
    async moveTasks(
        client: MembershipClient,
        tenantId: string,
        taskIds: string[],
        toSprintId: string | null,
        closeAs: SprintTaskOutcomeName,
        opts: { at?: Date } = {},
    ): Promise<{ moved: number; leftSprintIds: string[] }> {
        const ids = [...new Set(taskIds)];
        if (ids.length === 0) return { moved: 0, leftSprintIds: [] };
        // Read, close, re-point and open as one unit. Apart, two moves racing
        // for the same task could leave `sprint_id` rewritten with no open row
        // to match it — or the reverse.
        if (client.$transaction) {
            return client.$transaction((tx) =>
                this.moveTasks(tx as unknown as MembershipClient, tenantId, ids, toSprintId, closeAs, opts),
            );
        }

        const rows = (await client.projectTask.findMany({
            where: { tenant_id: tenantId, id: { in: ids } },
            select: { id: true, sprint_id: true, remaining_hours: true },
        })) as TaskRow[];
        const moving = rows.filter((row) => row.sprint_id !== toSprintId);
        if (moving.length === 0) return { moved: 0, leftSprintIds: [] };

        const at = opts.at ?? new Date();
        const carriedTo = closeAs === 'CARRIED_OVER' ? toSprintId : null;
        // Every moving task's open row closes, whatever `sprint_id` says: an
        // open row left behind by anything (a crash, the backfill racing a
        // move) would otherwise block the task from ever joining a sprint again,
        // since the one-open-row index refuses the new one.
        await this.close(client, tenantId, moving, closeAs, at, carriedTo);

        const movingIds = moving.map((row) => row.id);
        await client.projectTask.updateMany({
            where: { tenant_id: tenantId, id: { in: movingIds } },
            data: { sprint_id: toSprintId },
        });
        if (toSprintId) {
            await client.sprintTask.createMany({
                data: movingIds.map((taskId) => ({
                    tenant_id: tenantId,
                    sprint_id: toSprintId,
                    task_id: taskId,
                    added_at: at,
                })),
            });
        }

        const left = moving.map((row) => row.sprint_id).filter((id): id is string => !!id);
        return { moved: moving.length, leftSprintIds: [...new Set(left)] };
    }

    /**
     * Closes the rows of tasks that stay in the sprint — a Done task when its
     * sprint completes keeps `sprint_id`, since that is where it was finished.
     */
    async closeInPlace(
        client: MembershipClient,
        tenantId: string,
        sprintId: string,
        taskIds: string[],
        outcome: SprintTaskOutcomeName,
        at: Date = new Date(),
    ): Promise<number> {
        if (taskIds.length === 0) return 0;
        const rows = (await client.projectTask.findMany({
            where: { tenant_id: tenantId, id: { in: [...new Set(taskIds)] }, sprint_id: sprintId },
            select: { id: true, sprint_id: true, remaining_hours: true },
        })) as TaskRow[];
        await this.close(client, tenantId, rows, outcome, at, null);
        return rows.length;
    }

    /**
     * One write per distinct remaining figure rather than one per task: a
     * sprint's tasks mostly close at 0 (done) or at a handful of values, so
     * completing a fifty-task sprint is a few queries, not fifty.
     */
    private async close(
        client: MembershipClient,
        tenantId: string,
        rows: TaskRow[],
        outcome: SprintTaskOutcomeName,
        at: Date,
        carriedTo: string | null,
    ) {
        const byRemaining = new Map<number | null, string[]>();
        for (const row of rows) {
            const remaining = row.remaining_hours == null ? null : Number(row.remaining_hours);
            byRemaining.set(remaining, [...(byRemaining.get(remaining) ?? []), row.id]);
        }
        for (const [remaining, ids] of byRemaining) {
            await client.sprintTask.updateMany({
                where: { tenant_id: tenantId, task_id: { in: ids }, removed_at: null },
                data: {
                    removed_at: at,
                    outcome: outcome as never,
                    remaining_at_close: remaining,
                    carried_to_sprint_id: carriedTo,
                },
            });
        }
    }
}
