import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ProjectAccessService, ProjectViewer } from './project-access.service';
import { composeTaskKey } from './url-keys/task-key';
import { syncStoryStatuses } from './story-status.util';

/**
 * One project's whole backlog — epics, the stories under them, the tasks under
 * those — in a single read, for the Backlog tree.
 *
 * Returned flat, each row carrying its parent's id, rather than nested: the
 * page folds it into a tree, recomputes the rollups as rows move, and would
 * only have to flatten a nested answer again to do either. Three queries and a
 * time-entry sum, instead of one list call per level per parent.
 *
 * Subtasks are left out. They are a piece of their parent task's work, shown in
 * the task's own panel; the backlog is about scope, and a subtask adds rows to
 * it without adding any.
 */
@Injectable()
export class ProjectBacklogService {
    constructor(
        private readonly db: DatabaseService,
        private readonly access: ProjectAccessService,
    ) {}

    async get(viewer: ProjectViewer, projectId: string) {
        const tenantId = viewer.tenantId;
        await this.access.assertProjectVisible(viewer, projectId);
        const project = await this.db.project.findFirst({
            where: { id: projectId, tenant_id: tenantId, deleted_at: null },
            select: { id: true, code: true, name: true, short_name: true },
        });
        if (!project) throw new NotFoundException('Project not found');

        // Self-healing: a story written before its status followed its tasks,
        // or touched by a path that bypasses the task service, is put right the
        // first time anyone looks at the backlog it sits in.
        const storyIds = await this.db.projectUserStory.findMany({
            where: { tenant_id: tenantId, project_id: projectId },
            select: { id: true },
        });
        await syncStoryStatuses(this.db as never, tenantId, storyIds.map((story) => story.id));

        const [epics, stories, tasks] = await Promise.all([
            this.db.projectEpic.findMany({
                where: { tenant_id: tenantId, project_id: projectId },
                orderBy: [{ sort_order: 'asc' }, { reference: 'asc' }],
                select: {
                    id: true,
                    code: true,
                    title: true,
                    description: true,
                    status: true,
                    priority: true,
                    color: true,
                    start_date: true,
                    target_date: true,
                    sort_order: true,
                },
            }),
            this.db.projectUserStory.findMany({
                where: { tenant_id: tenantId, project_id: projectId },
                orderBy: [{ sort_order: 'asc' }, { reference: 'asc' }],
                select: {
                    id: true,
                    code: true,
                    title: true,
                    as_a: true,
                    i_want: true,
                    so_that: true,
                    acceptance_criteria: true,
                    status: true,
                    priority: true,
                    story_points: true,
                    epic_id: true,
                    sort_order: true,
                },
            }),
            this.db.projectTask.findMany({
                where: ProjectAccessService.merge(
                    { tenant_id: tenantId, project_id: projectId, deleted_at: null, parent_task_id: null },
                    await this.access.taskFilter(viewer),
                ) as never,
                // A task's `sort_order` is its place in a board column, which
                // says nothing about its place under a story — reference order
                // is at least the order they were written in.
                orderBy: [{ reference: 'asc' }],
                select: {
                    id: true,
                    reference: true,
                    title: true,
                    user_story_id: true,
                    priority: true,
                    due_date: true,
                    estimate_hours: true,
                    remaining_hours: true,
                    status: { select: { id: true, name: true, category: true } },
                    assignee: { select: { id: true, name: true } },
                    assigneeEmployee: { select: { id: true, name: true } },
                    sprint: { select: { id: true, name: true } },
                    _count: { select: { subtasks: { where: { deleted_at: null } } } },
                },
            }),
        ]);

        const logged = tasks.length
            ? await this.db.projectTimeEntry.groupBy({
                  by: ['task_id'],
                  where: { tenant_id: tenantId, task_id: { in: tasks.map((task) => task.id) } },
                  _sum: { hours: true },
              })
            : [];
        const loggedByTask = new Map(logged.map((row) => [row.task_id, Number(row._sum.hours ?? 0)]));

        return {
            project,
            epics,
            stories,
            tasks: tasks.map((task) => ({
                ...task,
                key: composeTaskKey(project.code, task.reference),
                estimate_hours: task.estimate_hours == null ? null : Number(task.estimate_hours),
                remaining_hours: task.remaining_hours == null ? null : Number(task.remaining_hours),
                logged_hours: loggedByTask.get(task.id) ?? 0,
            })),
        };
    }
}
