import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { paginate } from '../common/pagination.dto';
import { resolveOrderBy, type SortableMap } from '../common/sort.util';
import { RemainingHoursService, RemainingSource } from './remaining-hours.service';
import { ProjectSettingsService } from './project-settings.service';
import {
    CreateChecklistItemDto,
    CreateTaskDto,
    ListTasksDto,
    MoveTaskDto,
    UpdateChecklistItemDto,
    UpdateTaskDto,
} from './project.dto';

const TASK_SORTABLE: SortableMap = {
    title: (dir) => ({ title: dir }),
    priority: (dir) => ({ priority: dir }),
    due_date: (dir) => ({ due_date: dir }),
    created_at: (dir) => ({ created_at: dir }),
    sort_order: (dir) => ({ sort_order: dir }),
};

const TASK_INCLUDE = {
    project: { select: { id: true, code: true, name: true } },
    status: { select: { id: true, name: true, category: true, sort_order: true } },
    assignee: { select: { id: true, name: true, email: true } },
    milestone: { select: { id: true, name: true } },
    sprint: { select: { id: true, name: true, status: true } },
    checklistItems: { orderBy: { sort_order: 'asc' } },
    _count: { select: { subtasks: true, comments: true } },
} as const;

@Injectable()
export class ProjectTasksService {
    constructor(
        private readonly db: DatabaseService,
        private readonly remaining: RemainingHoursService,
        private readonly settings: ProjectSettingsService,
    ) {}

    async list(tenantId: string, query: ListTasksDto) {
        const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
        const page = Math.max(query.page ?? 1, 1);

        const where: Record<string, unknown> = {
            tenant_id: tenantId,
            deleted_at: null,
            ...(query.projectId ? { project_id: query.projectId } : {}),
            ...(query.assigneeId ? { assignee_id: query.assigneeId } : {}),
            ...(query.milestoneId ? { milestone_id: query.milestoneId } : {}),
        };
        if (query.backlogOnly === 'true') where.sprint_id = null;
        else if (query.sprintId) where.sprint_id = query.sprintId;

        const search = query.search?.trim();
        if (search) where.title = { contains: search, mode: 'insensitive' };

        const [items, total] = await Promise.all([
            this.db.projectTask.findMany({
                where: where as never,
                orderBy: resolveOrderBy(query.sortBy, query.sortDir, TASK_SORTABLE, [
                    { sort_order: 'asc' },
                    { created_at: 'asc' },
                ]) as never,
                skip: (page - 1) * limit,
                take: limit,
                include: TASK_INCLUDE as never,
            }),
            this.db.projectTask.count({ where: where as never }),
        ]);

        const withLogged = await this.attachLoggedHours(tenantId, items as TaskRow[]);
        return paginate(withLogged, total, page, limit);
    }

    /**
     * Every non-deleted task of a project grouped by board column. One query
     * for the columns and one for the tasks — the board must not fan out per
     * column, which is what makes a kanban view slow as soon as it is useful.
     */
    async board(tenantId: string, projectId: string, sprintId?: string) {
        const columns = await this.settings.listTaskStatuses(tenantId, false);
        const tasks = await this.db.projectTask.findMany({
            where: {
                tenant_id: tenantId,
                project_id: projectId,
                deleted_at: null,
                ...(sprintId ? { sprint_id: sprintId } : {}),
            },
            orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
            include: TASK_INCLUDE as never,
        });

        const withLogged = await this.attachLoggedHours(tenantId, tasks as TaskRow[]);
        return {
            columns: columns.map((column) => ({
                ...column,
                tasks: withLogged.filter((t) => t.status_id === column.id),
            })),
        };
    }

    async findOne(tenantId: string, taskId: string) {
        const task = await this.db.projectTask.findFirst({
            where: { id: taskId, tenant_id: tenantId, deleted_at: null },
            include: {
                ...TASK_INCLUDE,
                subtasks: {
                    where: { deleted_at: null },
                    include: { status: { select: { id: true, name: true, category: true } } },
                },
                timeEntries: {
                    orderBy: { work_date: 'desc' },
                    include: { user: { select: { id: true, name: true } } },
                },
            } as never,
        });
        if (!task) throw new NotFoundException('Task not found');
        const [withLogged] = await this.attachLoggedHours(tenantId, [task as TaskRow]);
        return withLogged;
    }

    async create(tenantId: string, userId: string, dto: CreateTaskDto) {
        await this.assertProject(tenantId, dto.projectId);
        const statusId = dto.statusId
            ? (await this.assertStatus(tenantId, dto.statusId)).id
            : (await this.settings.defaultTaskStatus(tenantId)).id;

        if (dto.parentTaskId) {
            const parent = await this.assertTask(tenantId, dto.parentTaskId);
            // One level only: a subtask of a subtask makes rollups ambiguous
            // and the board has nowhere to draw it.
            if (parent.parent_task_id) {
                throw new BadRequestException('A subtask cannot have subtasks of its own.');
            }
        }
        if (dto.sprintId) await this.assertSprint(tenantId, dto.sprintId, dto.projectId);

        const sortOrder = await this.nextSortOrder(tenantId, dto.projectId, statusId);
        const estimate = dto.estimateHours ?? null;
        // An unstarted task's remaining is its estimate — the only defensible
        // opening position, and it gives the burndown something to start from.
        const opening = dto.remainingHours ?? estimate;

        const task = await this.db.projectTask.create({
            data: {
                tenant_id: tenantId,
                project_id: dto.projectId,
                title: dto.title.trim(),
                description: dto.description?.trim() || null,
                status_id: statusId,
                priority: (dto.priority ?? 'MEDIUM') as never,
                assignee_id: dto.assigneeId ?? null,
                milestone_id: dto.milestoneId ?? null,
                sprint_id: dto.sprintId ?? null,
                parent_task_id: dto.parentTaskId ?? null,
                due_date: dto.dueDate ? new Date(dto.dueDate) : null,
                estimate_hours: estimate,
                sort_order: sortOrder,
                created_by: userId,
            },
        });

        if (opening != null) {
            await this.remaining.write({
                tenantId,
                taskId: task.id,
                projectId: dto.projectId,
                sprintId: dto.sprintId ?? null,
                previousHours: null,
                newHours: opening,
                source: RemainingSource.TASK_CREATED,
                userId,
            });
        }

        return this.findOne(tenantId, task.id);
    }

    async update(tenantId: string, userId: string, taskId: string, dto: UpdateTaskDto) {
        const task = await this.assertTask(tenantId, taskId);

        let statusId = task.status_id;
        let completedAt = task.completed_at;
        let becameDone = false;
        let becameUndone = false;

        if (dto.statusId && dto.statusId !== task.status_id) {
            const status = await this.assertStatus(tenantId, dto.statusId);
            statusId = status.id;
            const wasDone = task.status?.category === 'DONE';
            const isDone = status.category === 'DONE';
            becameDone = !wasDone && isDone;
            becameUndone = wasDone && !isDone;
            if (becameDone) completedAt = new Date();
            if (becameUndone) completedAt = null;
        }

        if (dto.sprintId) await this.assertSprint(tenantId, dto.sprintId, task.project_id);

        await this.db.projectTask.update({
            where: { id: taskId },
            data: {
                ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
                ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
                ...(dto.statusId !== undefined ? { status_id: statusId, completed_at: completedAt } : {}),
                ...(dto.priority !== undefined ? { priority: dto.priority as never } : {}),
                ...(dto.assigneeId !== undefined ? { assignee_id: dto.assigneeId || null } : {}),
                ...(dto.milestoneId !== undefined ? { milestone_id: dto.milestoneId || null } : {}),
                ...(dto.sprintId !== undefined ? { sprint_id: dto.sprintId || null } : {}),
                ...(dto.dueDate !== undefined ? { due_date: dto.dueDate ? new Date(dto.dueDate) : null } : {}),
                ...(dto.estimateHours !== undefined ? { estimate_hours: dto.estimateHours ?? null } : {}),
            },
        });

        const previous = task.remaining_hours == null ? null : Number(task.remaining_hours);
        const sprintId = dto.sprintId !== undefined ? dto.sprintId || null : task.sprint_id;

        // An explicit re-estimate wins over the status-derived write, so a
        // caller that does both in one request gets the number it asked for.
        if (dto.remainingHours !== undefined) {
            await this.remaining.write({
                tenantId,
                taskId,
                projectId: task.project_id,
                sprintId,
                previousHours: previous,
                newHours: dto.remainingHours,
                source: RemainingSource.RE_ESTIMATED,
                note: dto.remainingNote ?? null,
                userId,
            });
        } else if (becameDone) {
            // Finishing a task means no hours left on it, whatever the last
            // estimate said. Without this the burndown never reaches zero.
            await this.remaining.write({
                tenantId,
                taskId,
                projectId: task.project_id,
                sprintId,
                previousHours: previous,
                newHours: 0,
                source: RemainingSource.TASK_COMPLETED,
                userId,
            });
        } else if (becameUndone) {
            const logged = await this.loggedHours(tenantId, taskId);
            const estimate =
                dto.estimateHours ?? (task.estimate_hours == null ? null : Number(task.estimate_hours));
            await this.remaining.write({
                tenantId,
                taskId,
                projectId: task.project_id,
                sprintId,
                previousHours: previous,
                newHours: Math.max((estimate ?? 0) - logged, 0),
                source: RemainingSource.TASK_REOPENED,
                userId,
            });
        }

        return this.findOne(tenantId, taskId);
    }

    /**
     * Drag-and-drop. The card's new column and index arrive together; every
     * other card in the target column is renumbered so the order is stable
     * integers rather than ever-shrinking fractions.
     */
    async move(tenantId: string, userId: string, taskId: string, dto: MoveTaskDto) {
        const task = await this.assertTask(tenantId, taskId);
        const status = await this.assertStatus(tenantId, dto.statusId);
        if (dto.sprintId) await this.assertSprint(tenantId, dto.sprintId, task.project_id);

        const sprintId = dto.clearSprint ? null : (dto.sprintId ?? task.sprint_id);
        const wasDone = task.status?.category === 'DONE';
        const isDone = status.category === 'DONE';

        await this.db.$transaction(async (tx) => {
            const siblings = await tx.projectTask.findMany({
                where: {
                    tenant_id: tenantId,
                    project_id: task.project_id,
                    status_id: status.id,
                    deleted_at: null,
                    id: { not: taskId },
                },
                orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
                select: { id: true },
            });

            const index = Math.min(Math.max(dto.sortOrder, 0), siblings.length);
            const ordered = [...siblings.slice(0, index), { id: taskId }, ...siblings.slice(index)];

            for (let i = 0; i < ordered.length; i += 1) {
                await tx.projectTask.update({
                    where: { id: ordered[i].id },
                    data: {
                        sort_order: i,
                        ...(ordered[i].id === taskId
                            ? {
                                  status_id: status.id,
                                  sprint_id: sprintId,
                                  ...(isDone && !wasDone ? { completed_at: new Date() } : {}),
                                  ...(!isDone && wasDone ? { completed_at: null } : {}),
                              }
                            : {}),
                    },
                });
            }
        });

        // Dragging a card into or out of a Done column is a status change like
        // any other, so it burns the same way.
        const previous = task.remaining_hours == null ? null : Number(task.remaining_hours);
        if (isDone && !wasDone) {
            await this.remaining.write({
                tenantId,
                taskId,
                projectId: task.project_id,
                sprintId,
                previousHours: previous,
                newHours: 0,
                source: RemainingSource.TASK_COMPLETED,
                userId,
            });
        } else if (!isDone && wasDone) {
            const logged = await this.loggedHours(tenantId, taskId);
            const estimate = task.estimate_hours == null ? null : Number(task.estimate_hours);
            await this.remaining.write({
                tenantId,
                taskId,
                projectId: task.project_id,
                sprintId,
                previousHours: previous,
                newHours: Math.max((estimate ?? 0) - logged, 0),
                source: RemainingSource.TASK_REOPENED,
                userId,
            });
        }

        return this.findOne(tenantId, taskId);
    }

    async remove(tenantId: string, taskId: string) {
        await this.assertTask(tenantId, taskId);
        await this.db.projectTask.update({
            where: { id: taskId },
            data: { deleted_at: new Date() },
        });
        return { success: true };
    }

    async remainingHistory(tenantId: string, taskId: string) {
        await this.assertTask(tenantId, taskId);
        return this.remaining.history(tenantId, taskId);
    }

    // ── Checklist ──────────────────────────────────────────────────────────

    async addChecklistItem(tenantId: string, taskId: string, dto: CreateChecklistItemDto) {
        await this.assertTask(tenantId, taskId);
        const count = await this.db.projectTaskChecklistItem.count({ where: { task_id: taskId } });
        return this.db.projectTaskChecklistItem.create({
            data: {
                tenant_id: tenantId,
                task_id: taskId,
                text: dto.text.trim(),
                sort_order: count,
            },
        });
    }

    async updateChecklistItem(tenantId: string, itemId: string, dto: UpdateChecklistItemDto) {
        const item = await this.db.projectTaskChecklistItem.findFirst({
            where: { id: itemId, tenant_id: tenantId },
            select: { id: true },
        });
        if (!item) throw new NotFoundException('Checklist item not found');
        return this.db.projectTaskChecklistItem.update({
            where: { id: itemId },
            data: {
                ...(dto.text !== undefined ? { text: dto.text.trim() } : {}),
                ...(dto.isDone !== undefined ? { is_done: dto.isDone } : {}),
                ...(dto.sortOrder !== undefined ? { sort_order: dto.sortOrder } : {}),
            },
        });
    }

    async removeChecklistItem(tenantId: string, itemId: string) {
        const item = await this.db.projectTaskChecklistItem.findFirst({
            where: { id: itemId, tenant_id: tenantId },
            select: { id: true },
        });
        if (!item) throw new NotFoundException('Checklist item not found');
        await this.db.projectTaskChecklistItem.delete({ where: { id: itemId } });
        return { success: true };
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    /**
     * Logged hours are derived, never stored on the task — a stored copy is one
     * more thing to keep in step with the time entries that define it.
     */
    private async attachLoggedHours(tenantId: string, tasks: TaskRow[]) {
        if (tasks.length === 0) return [];
        const totals = await this.db.projectTimeEntry.groupBy({
            by: ['task_id'],
            where: { tenant_id: tenantId, task_id: { in: tasks.map((t) => t.id) } },
            _sum: { hours: true },
        });
        const byTask = new Map(totals.map((t) => [t.task_id, Number(t._sum.hours ?? 0)]));
        return tasks.map((task) => ({ ...task, logged_hours: byTask.get(task.id) ?? 0 }));
    }

    private async loggedHours(tenantId: string, taskId: string): Promise<number> {
        const total = await this.db.projectTimeEntry.aggregate({
            where: { tenant_id: tenantId, task_id: taskId },
            _sum: { hours: true },
        });
        return Number(total._sum.hours ?? 0);
    }

    private async nextSortOrder(tenantId: string, projectId: string, statusId: string) {
        const last = await this.db.projectTask.findFirst({
            where: { tenant_id: tenantId, project_id: projectId, status_id: statusId, deleted_at: null },
            orderBy: { sort_order: 'desc' },
            select: { sort_order: true },
        });
        return (last?.sort_order ?? -1) + 1;
    }

    async assertTask(tenantId: string, taskId: string) {
        const task = await this.db.projectTask.findFirst({
            where: { id: taskId, tenant_id: tenantId, deleted_at: null },
            include: { status: { select: { id: true, category: true } } },
        });
        if (!task) throw new NotFoundException('Task not found');
        return task;
    }

    private async assertProject(tenantId: string, projectId: string) {
        const project = await this.db.project.findFirst({
            where: { id: projectId, tenant_id: tenantId, deleted_at: null },
            select: { id: true },
        });
        if (!project) throw new NotFoundException('Project not found');
        return project;
    }

    private async assertStatus(tenantId: string, statusId: string) {
        const status = await this.db.projectTaskStatus.findFirst({
            where: { id: statusId, tenant_id: tenantId },
            select: { id: true, category: true },
        });
        if (!status) throw new NotFoundException('Board column not found');
        return status;
    }

    private async assertSprint(tenantId: string, sprintId: string, projectId: string) {
        const sprint = await this.db.sprint.findFirst({
            where: { id: sprintId, tenant_id: tenantId },
            select: { id: true, project_id: true },
        });
        if (!sprint) throw new NotFoundException('Sprint not found');
        if (sprint.project_id !== projectId) {
            throw new BadRequestException('That sprint belongs to a different project.');
        }
        return sprint;
    }
}

interface TaskRow {
    id: string;
    status_id?: string;
    [key: string]: unknown;
}
