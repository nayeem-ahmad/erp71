import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

/**
 * Why a task's remaining hours changed. Mirrors the Prisma enum; kept as a
 * local const so callers do not each import the generated client.
 */
export const RemainingSource = {
    TASK_CREATED: 'TASK_CREATED',
    TIME_LOGGED: 'TIME_LOGGED',
    RE_ESTIMATED: 'RE_ESTIMATED',
    TASK_COMPLETED: 'TASK_COMPLETED',
    TASK_REOPENED: 'TASK_REOPENED',
    TIME_ENTRY_DELETED: 'TIME_ENTRY_DELETED',
} as const;
export type RemainingSource = (typeof RemainingSource)[keyof typeof RemainingSource];

export interface RemainingWrite {
    tenantId: string;
    taskId: string;
    projectId: string;
    /**
     * The sprint the task is in *at this moment*. Denormalised onto the log row
     * so moving the task to another sprint later cannot rewrite where its hours
     * actually burned.
     */
    sprintId?: string | null;
    previousHours: number | null;
    newHours: number;
    source: RemainingSource;
    timeEntryId?: string | null;
    note?: string | null;
    userId?: string | null;
}

/** Minimal shape of a Prisma transaction client, so callers can pass `tx`. */
type Db = Pick<DatabaseService, 'projectTask' | 'projectTaskRemainingLog'>;

/**
 * The only writer of `ProjectTask.remaining_hours`.
 *
 * Every change to the column is paired with a `ProjectTaskRemainingLog` row in
 * the same transaction. Nothing else in the module may assign to the column —
 * `remaining-hours.service.spec.ts` asserts that by scanning the module's
 * source, because a history with a bypass is not a history.
 */
@Injectable()
export class RemainingHoursService {
    constructor(private readonly db: DatabaseService) {}

    /**
     * The value to offer after logging `hours` against a task. Only ever a
     * suggestion: a task can absorb hours and be no closer to done, which is
     * exactly the case a derived `estimate - logged` would erase.
     */
    static suggestAfterTimeLog(remaining: number | null, hours: number): number {
        if (remaining == null) return 0;
        return round2(Math.max(remaining - hours, 0));
    }

    /**
     * Writes the column and its log row together. A write that does not change
     * the value records nothing — an untouched task should not litter the
     * history, and a no-op row would flatten nothing but read as an event.
     */
    async write(write: RemainingWrite, client?: Db): Promise<boolean> {
        const db = (client ?? this.db) as Db;
        const previous = write.previousHours;
        const next = round2(write.newHours);

        if (previous != null && round2(previous) === next) return false;

        await db.projectTask.update({
            where: { id: write.taskId },
            data: { remaining_hours: next },
        });

        await db.projectTaskRemainingLog.create({
            data: {
                tenant_id: write.tenantId,
                task_id: write.taskId,
                project_id: write.projectId,
                sprint_id: write.sprintId ?? null,
                previous_hours: previous ?? null,
                new_hours: next,
                delta: round2(next - (previous ?? 0)),
                source: write.source as never,
                time_entry_id: write.timeEntryId ?? null,
                note: write.note ?? null,
                changed_by: write.userId ?? null,
            },
        });
        return true;
    }

    /** History for one task, newest first. */
    async history(tenantId: string, taskId: string) {
        return this.db.projectTaskRemainingLog.findMany({
            where: { tenant_id: tenantId, task_id: taskId },
            orderBy: { changed_at: 'desc' },
            include: { user: { select: { id: true, name: true, email: true } } },
        });
    }
}

export function round2(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}
