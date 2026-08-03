import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ProjectActivityService } from './project-activity.service';
import { CreateCommentDto, UpdateCommentDto } from './project.dto';

const COMMENT_INCLUDE = {
    user: { select: { id: true, name: true, email: true } },
} as const;

/**
 * `ProjectComment` has been in the schema since Phase 1 with a DTO written for
 * it and no service or controller behind it. This is that service.
 *
 * Comments are not recorded as activity rows: the panel merges the two streams
 * by timestamp, so a row per comment would draw every comment twice.
 */
@Injectable()
export class ProjectCommentsService {
    constructor(
        private readonly db: DatabaseService,
        private readonly activity: ProjectActivityService,
    ) {}

    async list(tenantId: string, taskId: string) {
        await this.assertTask(tenantId, taskId);
        return this.db.projectComment.findMany({
            where: { tenant_id: tenantId, task_id: taskId },
            orderBy: { created_at: 'desc' },
            include: COMMENT_INCLUDE,
        });
    }

    async create(tenantId: string, userId: string, taskId: string, dto: CreateCommentDto) {
        const task = await this.assertTask(tenantId, taskId);

        const comment = await this.db.projectComment.create({
            data: {
                tenant_id: tenantId,
                task_id: taskId,
                project_id: task.project_id,
                user_id: userId,
                body: dto.body.trim(),
            },
            include: COMMENT_INCLUDE,
        });

        // Notify first, then subscribe: otherwise the author is in the watcher
        // set by the time the fan-out reads it and gets told about their own
        // comment — the actor filter alone would cover it, but the ordering
        // makes the intent explicit and survives a refactor of that filter.
        await this.activity.notifyWatchers({
            tenantId,
            taskId,
            actorId: userId,
            title: task.title,
            body: comment.body.slice(0, 140),
            link: `/projects/${task.project_id}/board`,
        });
        await this.activity.watch(tenantId, taskId, userId);

        return comment;
    }

    /** Your own comment only — an audit trail nobody else can rewrite. */
    async update(tenantId: string, userId: string, commentId: string, dto: UpdateCommentDto) {
        const comment = await this.assertOwnComment(tenantId, userId, commentId);
        return this.db.projectComment.update({
            where: { id: comment.id },
            data: { body: dto.body.trim() },
            include: COMMENT_INCLUDE,
        });
    }

    async remove(tenantId: string, userId: string, commentId: string) {
        const comment = await this.assertOwnComment(tenantId, userId, commentId);
        await this.db.projectComment.delete({ where: { id: comment.id } });
        return { success: true };
    }

    private async assertTask(tenantId: string, taskId: string) {
        const task = await this.db.projectTask.findFirst({
            where: { id: taskId, tenant_id: tenantId, deleted_at: null },
            select: { id: true, project_id: true, title: true },
        });
        if (!task) throw new NotFoundException('Task not found');
        return task;
    }

    private async assertOwnComment(tenantId: string, userId: string, commentId: string) {
        const comment = await this.db.projectComment.findFirst({
            where: { id: commentId, tenant_id: tenantId },
            select: { id: true, user_id: true },
        });
        if (!comment) throw new NotFoundException('Comment not found');
        if (comment.user_id !== userId) {
            throw new ForbiddenException('You can only change your own comments.');
        }
        return comment;
    }
}
