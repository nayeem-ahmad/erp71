import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { eachDate, fromDateKey, round2, toDateKey } from './burndown.util';

export interface SnapshotFigures {
    remaining_hours: number;
    committed_hours: number;
    completed_hours: number;
    task_count: number;
    done_task_count: number;
}

/**
 * Writes and rebuilds the daily burndown points.
 *
 * A snapshot is a cache, not the source of truth: every figure it holds is
 * derivable from `ProjectTaskRemainingLog`, so a night the cron missed can be
 * recomputed rather than leaving a permanent hole in the chart.
 */
@Injectable()
export class SprintSnapshotService {
    constructor(private readonly db: DatabaseService) {}

    /**
     * Figures as they stand right now. Used by the nightly cron for "today".
     */
    async computeCurrent(tenantId: string, sprintId: string): Promise<SnapshotFigures> {
        const tasks = await this.db.projectTask.findMany({
            where: { tenant_id: tenantId, sprint_id: sprintId, deleted_at: null },
            select: {
                id: true,
                estimate_hours: true,
                remaining_hours: true,
                status: { select: { category: true } },
            },
        });

        const remaining = tasks.reduce((total, t) => total + num(t.remaining_hours), 0);
        const committed = tasks.reduce((total, t) => total + num(t.estimate_hours), 0);
        const done = tasks.filter((t) => t.status?.category === 'DONE');

        return {
            remaining_hours: round2(remaining),
            committed_hours: round2(committed),
            completed_hours: round2(Math.max(committed - remaining, 0)),
            task_count: tasks.length,
            done_task_count: done.length,
        };
    }

    /**
     * Figures as at the end of a past day, replayed from the remaining-hours
     * log: for each task, the newest log row on or before that date.
     *
     * Two figures are honestly weaker on the replay path than on the live one.
     * `task_count`/`done_task_count` come from tasks that had *any* log row by
     * that date, and completion is inferred from remaining reaching zero —
     * because the log covers hours only. Reconstructing them exactly needs
     * sprint-membership and DONE-transition histories, which Phase 1 does not
     * keep (open question 5 in the scope doc).
     */
    async computeFromLog(
        tenantId: string,
        sprintId: string,
        dateKey: string,
    ): Promise<SnapshotFigures> {
        const cutoff = fromDateKey(dateKey);
        cutoff.setUTCDate(cutoff.getUTCDate() + 1); // end of that day

        const logs = await this.db.projectTaskRemainingLog.findMany({
            where: {
                tenant_id: tenantId,
                sprint_id: sprintId,
                changed_at: { lt: cutoff },
            },
            orderBy: { changed_at: 'asc' },
            select: { task_id: true, new_hours: true },
        });

        const latestByTask = new Map<string, number>();
        for (const log of logs) latestByTask.set(log.task_id, num(log.new_hours));

        const remaining = [...latestByTask.values()].reduce((a, b) => a + b, 0);
        const done = [...latestByTask.values()].filter((h) => h === 0).length;

        // Committed is the opening figure of each task — its first logged
        // value — so adding a task mid-sprint raises the line rather than
        // silently flattening it.
        const openings = new Map<string, number>();
        for (const log of logs) {
            if (!openings.has(log.task_id)) openings.set(log.task_id, num(log.new_hours));
        }
        const committed = [...openings.values()].reduce((a, b) => a + b, 0);

        return {
            remaining_hours: round2(remaining),
            committed_hours: round2(committed),
            completed_hours: round2(Math.max(committed - remaining, 0)),
            task_count: latestByTask.size,
            done_task_count: done,
        };
    }

    /** Idempotent: re-running for the same day overwrites rather than doubling. */
    async writeSnapshot(
        tenantId: string,
        sprintId: string,
        dateKey: string,
        figures: SnapshotFigures,
    ) {
        return this.db.sprintSnapshot.upsert({
            where: {
                sprint_id_snapshot_date: {
                    sprint_id: sprintId,
                    snapshot_date: fromDateKey(dateKey),
                },
            },
            create: {
                tenant_id: tenantId,
                sprint_id: sprintId,
                snapshot_date: fromDateKey(dateKey),
                ...figures,
            },
            update: figures,
        });
    }

    async snapshotToday(tenantId: string, sprintId: string, today = new Date()) {
        const figures = await this.computeCurrent(tenantId, sprintId);
        return this.writeSnapshot(tenantId, sprintId, toDateKey(today), figures);
    }

    /**
     * Fills every day of a sprint up to today from the log. Days that already
     * have a snapshot are left alone unless `overwrite` is set, so a rebuild
     * does not discard figures the cron captured live.
     */
    async rebuild(
        tenantId: string,
        sprintId: string,
        options: { overwrite?: boolean; today?: Date } = {},
    ) {
        const sprint = await this.db.sprint.findFirst({
            where: { id: sprintId, tenant_id: tenantId },
            select: { start_date: true, end_date: true },
        });
        if (!sprint) return { written: 0, skipped: 0 };

        const today = options.today ?? new Date();
        const lastDay = sprint.end_date < today ? sprint.end_date : today;
        const days = eachDate(sprint.start_date, lastDay);

        const existing = await this.db.sprintSnapshot.findMany({
            where: { tenant_id: tenantId, sprint_id: sprintId },
            select: { snapshot_date: true },
        });
        const have = new Set(existing.map((s) => toDateKey(s.snapshot_date)));

        let written = 0;
        let skipped = 0;
        for (const day of days) {
            if (have.has(day) && !options.overwrite) {
                skipped += 1;
                continue;
            }
            const figures = await this.computeFromLog(tenantId, sprintId, day);
            await this.writeSnapshot(tenantId, sprintId, day, figures);
            written += 1;
        }
        return { written, skipped };
    }
}

function num(value: unknown): number {
    if (value == null) return 0;
    return Number(value);
}
