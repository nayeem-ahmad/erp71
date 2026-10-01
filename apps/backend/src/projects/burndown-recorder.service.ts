import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { round2 } from './burndown.util';

/** Mirrors the `BurndownCause` enum, so callers need not import Prisma's. */
export type BurndownCauseName =
    | 'STARTED'
    | 'WORK_LOGGED'
    | 'RE_ESTIMATED'
    | 'TASK_ADDED'
    | 'TASK_REMOVED'
    | 'STATUS_CHANGED'
    | 'COMPLETED'
    | 'BACKFILLED';

export interface BurndownFigures {
    remaining_hours: number;
    committed_hours: number;
    task_count: number;
    done_task_count: number;
}

/** Sprint-level causes that always mark the chart, even when no figure moved. */
const ALWAYS_RECORDED: ReadonlySet<BurndownCauseName> = new Set(['STARTED', 'COMPLETED']);

/**
 * Writes a burndown point every time an active sprint's totals change.
 *
 * Each point is the sprint's *full* totals at that moment, recomputed from its
 * tasks rather than adjusted by a delta. That is what lets `record` swallow its
 * own failures: a point that did not get written leaves a gap, never a wrong
 * running total, and the next change writes the right figures again.
 *
 * Replaces `SprintSnapshotService`, which kept one row per day and overwrote
 * it on every change, so the chart could not show what happened within a day.
 */
@Injectable()
export class BurndownRecorder {
    private readonly logger = new Logger(BurndownRecorder.name);

    constructor(private readonly db: DatabaseService) {}

    /** Which cause a remaining-hours log source amounts to on the chart. */
    static causeForSource(source: string): BurndownCauseName {
        switch (source) {
            case 'TIME_LOGGED':
            case 'TIME_ENTRY_DELETED':
                return 'WORK_LOGGED';
            case 'TASK_COMPLETED':
            case 'TASK_REOPENED':
                return 'STATUS_CHANGED';
            // A task's opening hours only ever land as it is created, which in
            // a sprint is the task joining it.
            case 'TASK_CREATED':
                return 'TASK_ADDED';
            default:
                return 'RE_ESTIMATED';
        }
    }

    /** The sprint's figures as they stand right now. */
    async computeCurrent(tenantId: string, sprintId: string): Promise<BurndownFigures> {
        const tasks = await this.db.projectTask.findMany({
            where: { tenant_id: tenantId, sprint_id: sprintId, deleted_at: null },
            select: {
                id: true,
                estimate_hours: true,
                remaining_hours: true,
                status: { select: { category: true } },
            },
        });

        return {
            remaining_hours: round2(tasks.reduce((total, t) => total + num(t.remaining_hours), 0)),
            committed_hours: round2(tasks.reduce((total, t) => total + num(t.estimate_hours), 0)),
            task_count: tasks.length,
            done_task_count: tasks.filter((t) => t.status?.category === 'DONE').length,
        };
    }

    /**
     * Records a point for each running sprint named, after a change that may
     * have moved its totals. Called *after* the write, outside any transaction,
     * because it reads through the root client and would not see an
     * uncommitted change.
     *
     * Only ACTIVE sprints: a planned one has no burndown yet, and a completed
     * one's last point was written as it closed. A point identical to the
     * latest is skipped — renaming a task must not add a dot to the chart.
     * Never throws.
     */
    async record(
        tenantId: string,
        sprintIds: Array<string | null | undefined>,
        cause: BurndownCauseName,
        taskId: string | null = null,
    ): Promise<void> {
        const ids = [...new Set(sprintIds.filter((id): id is string => !!id))];
        if (ids.length === 0) return;
        try {
            const active = await this.db.sprint.findMany({
                where: { tenant_id: tenantId, id: { in: ids }, status: 'ACTIVE' as never },
                select: { id: true },
            });
            for (const sprint of active) {
                const figures = await this.computeCurrent(tenantId, sprint.id);
                if (!ALWAYS_RECORDED.has(cause) && (await this.repeatsLatest(sprint.id, figures))) continue;
                await this.db.sprintBurndownPoint.create({
                    data: {
                        tenant_id: tenantId,
                        sprint_id: sprint.id,
                        ...figures,
                        cause: cause as never,
                        task_id: taskId,
                    },
                });
            }
        } catch (error) {
            this.logger.error(
                `Burndown point failed for ${ids.join(', ')} (${cause})`,
                error instanceof Error ? error.stack : String(error),
            );
        }
    }

    private async repeatsLatest(sprintId: string, figures: BurndownFigures): Promise<boolean> {
        const latest = await this.db.sprintBurndownPoint.findFirst({
            where: { sprint_id: sprintId },
            orderBy: { recorded_at: 'desc' },
            select: { remaining_hours: true, committed_hours: true, task_count: true, done_task_count: true },
        });
        if (!latest) return false;
        return (
            num(latest.remaining_hours) === figures.remaining_hours &&
            num(latest.committed_hours) === figures.committed_hours &&
            latest.task_count === figures.task_count &&
            latest.done_task_count === figures.done_task_count
        );
    }
}

function num(value: unknown): number {
    if (value == null) return 0;
    return Number(value);
}
