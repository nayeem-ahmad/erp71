import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { NotificationsService } from '../notifications/notifications.service';

export enum ActivityType {
    CREATED = 'CREATED',
    RENAMED = 'RENAMED',
    STATUS_CHANGED = 'STATUS_CHANGED',
    ASSIGNED = 'ASSIGNED',
    PRIORITY_CHANGED = 'PRIORITY_CHANGED',
    DATES_CHANGED = 'DATES_CHANGED',
    LABELS_CHANGED = 'LABELS_CHANGED',
    RE_ESTIMATED = 'RE_ESTIMATED',
}

export interface RecordActivity {
    tenantId: string;
    taskId: string;
    projectId: string;
    type: ActivityType;
    /** Before/after payload. Never a rendered sentence — see the model comment. */
    data?: Record<string, unknown>;
    actorId?: string | null;
}

const ACTIVITY_INCLUDE = {
    actor: { select: { id: true, name: true, email: true } },
} as const;

/**
 * The task feed, its watchers, and the fan-out between them.
 *
 * Kept apart from `ProjectTasksService` because every write path there calls
 * into it and none of them should be able to fail *because of it* — a task move
 * that succeeded must not report failure over an unwritten audit row or an
 * undelivered notification. Everything here is best-effort and logged.
 */
@Injectable()
export class ProjectActivityService {
    private readonly logger = new Logger(ProjectActivityService.name);

    constructor(
        private readonly db: DatabaseService,
        private readonly notifications: NotificationsService,
    ) {}

    /**
     * Never throws. The feed is a record of work that already happened; losing a
     * row is worth strictly less than failing the operation it describes.
     */
    async record(input: RecordActivity) {
        try {
            return await this.db.projectTaskActivity.create({
                data: {
                    tenant_id: input.tenantId,
                    task_id: input.taskId,
                    project_id: input.projectId,
                    type: input.type as never,
                    data: (input.data ?? undefined) as never,
                    actor_id: input.actorId ?? null,
                },
            });
        } catch (error) {
            this.logger.warn(
                `Could not record ${input.type} on task ${input.taskId}: ${String(error)}`,
            );
            return null;
        }
    }

    async list(tenantId: string, taskId: string) {
        return this.db.projectTaskActivity.findMany({
            where: { tenant_id: tenantId, task_id: taskId },
            orderBy: { created_at: 'desc' },
            include: ACTIVITY_INCLUDE,
            take: 100,
        });
    }

    // ── Watchers ───────────────────────────────────────────────────────────

    async listWatchers(tenantId: string, taskId: string) {
        return this.db.projectTaskWatcher.findMany({
            where: { tenant_id: tenantId, task_id: taskId },
            include: { user: { select: { id: true, name: true, email: true } } },
            orderBy: { created_at: 'asc' },
        });
    }

    /**
     * Idempotent. Used both by the explicit Watch button and by the implicit
     * paths — creating a task, being assigned one, commenting on one — so it has
     * to tolerate being called for someone who already watches.
     */
    async watch(tenantId: string, taskId: string, userId: string) {
        if (!userId) return null;
        try {
            return await this.db.projectTaskWatcher.upsert({
                where: { task_id_user_id: { task_id: taskId, user_id: userId } },
                create: { tenant_id: tenantId, task_id: taskId, user_id: userId },
                update: {},
            });
        } catch (error) {
            this.logger.warn(`Could not add watcher ${userId} to ${taskId}: ${String(error)}`);
            return null;
        }
    }

    async unwatch(tenantId: string, taskId: string, userId: string) {
        const existing = await this.db.projectTaskWatcher.findFirst({
            where: { tenant_id: tenantId, task_id: taskId, user_id: userId },
            select: { task_id: true },
        });
        if (!existing) throw new NotFoundException('Not watching this task');

        await this.db.projectTaskWatcher.delete({
            where: { task_id_user_id: { task_id: taskId, user_id: userId } },
        });
        return { success: true };
    }

    /**
     * Notifies everyone watching except whoever caused it — telling someone
     * about their own action is how a notification bell stops being read.
     */
    async notifyWatchers(input: {
        tenantId: string;
        taskId: string;
        actorId?: string | null;
        title: string;
        body: string;
        link?: string;
    }) {
        try {
            const watchers = await this.db.projectTaskWatcher.findMany({
                where: { tenant_id: input.tenantId, task_id: input.taskId },
                select: { user_id: true },
            });

            const recipients = watchers
                .map((w) => w.user_id)
                .filter((userId) => userId !== input.actorId);

            await Promise.all(
                recipients.map((userId) =>
                    this.notifications.create(
                        input.tenantId,
                        userId,
                        'PROJECT_TASK',
                        input.title,
                        input.body,
                        input.link,
                    ),
                ),
            );
            return recipients.length;
        } catch (error) {
            this.logger.warn(`Could not notify watchers of ${input.taskId}: ${String(error)}`);
            return 0;
        }
    }
}
