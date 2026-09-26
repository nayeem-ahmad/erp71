import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ProjectAccessService, ProjectViewer } from './project-access.service';
import { ProjectTasksService } from './project-tasks.service';
import { ProjectStoriesService } from './project-stories.service';
import { ProjectEpicsService } from './project-epics.service';
import { composeTaskKey } from './url-keys/task-key';
import { syncStoryStatuses } from './story-status.util';
import {
    BulkBacklogScopeDto,
    BulkBacklogTasksDto,
    EpicStatusDto,
    ProjectPriorityDto,
    ReorderBacklogScopeDto,
    ReorderBacklogTasksDto,
    UpdateEpicDto,
    UpdateTaskDto,
    UpdateUserStoryDto,
    UserStoryStatusDto,
} from './project.dto';

const EPIC_SELECT = {
    id: true,
    project_id: true,
    code: true,
    title: true,
    description: true,
    status: true,
    priority: true,
    color: true,
    start_date: true,
    target_date: true,
    sort_order: true,
} as const;

const STORY_SELECT = {
    id: true,
    project_id: true,
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
} as const;

const TASK_SELECT = {
    id: true,
    project_id: true,
    reference: true,
    title: true,
    user_story_id: true,
    priority: true,
    due_date: true,
    estimate_hours: true,
    remaining_hours: true,
    backlog_order: true,
    status: { select: { id: true, name: true, category: true } },
    assignee: { select: { id: true, name: true } },
    assigneeEmployee: { select: { id: true, name: true } },
    sprint: { select: { id: true, name: true } },
    _count: { select: { subtasks: { where: { deleted_at: null } } } },
} as const;

const PROJECT_SELECT = { id: true, code: true, name: true, short_name: true } as const;

export interface BulkOutcome {
    updated: number;
    /** Rows the action could not be applied to, each with the server's reason. */
    skipped: { id: string; reason: string }[];
}

/**
 * The Backlog tree: epics, the stories under them, the tasks under those.
 *
 * Reads are returned flat, each row carrying its parent's id, rather than
 * nested: the page folds them into a tree, recomputes the rollups as rows move,
 * and would only have to flatten a nested answer again to do either.
 *
 * Writes come in two kinds. Reordering is this service's own — a drop sends the
 * whole order of the group it landed in. Everything else (bulk status, priority,
 * re-parenting, delete) goes row by row through the task, story and epic
 * services' own `update`/`remove`, so a bulk change burns remaining hours,
 * records activity, re-derives story status and checks access exactly as a
 * single change does, rather than being a second, subtly different write path.
 *
 * Subtasks are left out throughout. They are a piece of their parent task's
 * work, shown in the task's own panel; the backlog is about scope.
 */
@Injectable()
export class ProjectBacklogService {
    constructor(
        private readonly db: DatabaseService,
        private readonly access: ProjectAccessService,
        private readonly tasks: ProjectTasksService,
        private readonly stories: ProjectStoriesService,
        private readonly epics: ProjectEpicsService,
    ) {}

    /** One project's backlog, everything in it. */
    async get(viewer: ProjectViewer, projectId: string) {
        const tenantId = viewer.tenantId;
        await this.access.assertProjectVisible(viewer, projectId);
        const project = await this.db.project.findFirst({
            where: { id: projectId, tenant_id: tenantId, deleted_at: null },
            select: PROJECT_SELECT,
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

        const rows = await this.read(viewer, [project], { unplanned: true });
        return { project, ...rows };
    }

    /**
     * Every visible project's scope at once, for the cross-project Epics and
     * User stories screens. Only projects that have an epic or a story are
     * included, and only tasks filed under a story: a project's unplanned work
     * is that project's business, and across forty projects it would bury the
     * scope this view exists to show.
     */
    async list(viewer: ProjectViewer) {
        const tenantId = viewer.tenantId;
        const projects = await this.db.project.findMany({
            where: {
                tenant_id: tenantId,
                deleted_at: null,
                OR: [{ epics: { some: {} } }, { userStories: { some: {} } }],
                ...(await this.access.projectFilter(viewer)),
            } as never,
            orderBy: { code: 'asc' },
            select: PROJECT_SELECT,
        });
        const rows = await this.read(viewer, projects, { unplanned: false });
        return { projects, ...rows };
    }

    private async read(
        viewer: ProjectViewer,
        projects: { id: string; code: string }[],
        options: { unplanned: boolean },
    ) {
        const tenantId = viewer.tenantId;
        const projectIds = projects.map((project) => project.id);
        if (projectIds.length === 0) return { epics: [], stories: [], tasks: [] };
        const scope = { tenant_id: tenantId, project_id: { in: projectIds } };

        const [epics, stories, tasks] = await Promise.all([
            this.db.projectEpic.findMany({
                where: scope,
                orderBy: [{ sort_order: 'asc' }, { reference: 'asc' }],
                select: EPIC_SELECT,
            }),
            this.db.projectUserStory.findMany({
                where: scope,
                orderBy: [{ sort_order: 'asc' }, { reference: 'asc' }],
                select: STORY_SELECT,
            }),
            this.db.projectTask.findMany({
                where: ProjectAccessService.merge(
                    {
                        ...scope,
                        deleted_at: null,
                        parent_task_id: null,
                        ...(options.unplanned ? {} : { user_story_id: { not: null } }),
                    },
                    await this.access.taskFilter(viewer),
                ) as never,
                // `backlog_order` first; tasks nobody has arranged all share 0
                // and fall back to the order they were written in.
                orderBy: [{ backlog_order: 'asc' }, { reference: 'asc' }],
                select: TASK_SELECT,
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
        const codeOf = new Map(projects.map((project) => [project.id, project.code]));

        return {
            epics,
            stories,
            tasks: tasks.map((task) => ({
                ...task,
                key: composeTaskKey(codeOf.get(task.project_id) ?? '', task.reference),
                estimate_hours: task.estimate_hours == null ? null : Number(task.estimate_hours),
                remaining_hours: task.remaining_hours == null ? null : Number(task.remaining_hours),
                logged_hours: loggedByTask.get(task.id) ?? 0,
            })),
        };
    }

    // ── Reordering ─────────────────────────────────────────────────────────

    /**
     * An epic or story dropped somewhere in the tree. A story may change epic
     * on the way (`parentId`); an epic has no parent to change.
     *
     * The group's new order is written as 0..n over the ids that really are
     * that group's members — an id from elsewhere is ignored rather than
     * dragged in, so a stale page cannot move a row it did not mean to.
     */
    async reorderScope(viewer: ProjectViewer, projectId: string, dto: ReorderBacklogScopeDto) {
        const tenantId = viewer.tenantId;
        await this.access.assertProjectVisible(viewer, projectId);

        if (dto.kind === 'epic') {
            if (dto.parentId) throw new BadRequestException('An epic cannot be moved under anything.');
            await this.assertInProject('epic', tenantId, projectId, dto.id);
            const members = await this.db.projectEpic.findMany({
                where: { tenant_id: tenantId, project_id: projectId },
                select: { id: true },
            });
            await this.writeOrder('epic', members, dto.orderedIds);
            return { success: true };
        }

        const story = await this.assertInProject('story', tenantId, projectId, dto.id);
        let epicId = story.epic_id ?? null;
        if (dto.parentId !== undefined && dto.parentId !== epicId) {
            // Through the story service, so the epic is checked to be in the
            // same project exactly as the story form checks it.
            await this.stories.update(viewer, dto.id, { epicId: dto.parentId ?? '' } as UpdateUserStoryDto);
            epicId = dto.parentId ?? null;
        }
        const members = await this.db.projectUserStory.findMany({
            where: { tenant_id: tenantId, project_id: projectId, epic_id: epicId },
            select: { id: true },
        });
        await this.writeOrder('story', members, dto.orderedIds);
        return { success: true };
    }

    /**
     * A task dropped under a story (or out of every story). Changing story goes
     * through the task service so the story statuses at both ends follow.
     */
    async reorderTasks(viewer: ProjectViewer, projectId: string, dto: ReorderBacklogTasksDto) {
        const tenantId = viewer.tenantId;
        await this.access.assertProjectVisible(viewer, projectId);
        const task = await this.tasks.assertTask(viewer, dto.id);
        if (task.project_id !== projectId) throw new NotFoundException('Task not found');
        if (task.parent_task_id) {
            throw new BadRequestException('A subtask moves with its parent task.');
        }

        let storyId = task.user_story_id ?? null;
        if (dto.parentId !== undefined && dto.parentId !== storyId) {
            await this.tasks.update(viewer, dto.id, { userStoryId: dto.parentId ?? '' } as UpdateTaskDto);
            storyId = dto.parentId ?? null;
        }

        const members = await this.db.projectTask.findMany({
            where: ProjectAccessService.merge(
                {
                    tenant_id: tenantId,
                    project_id: projectId,
                    user_story_id: storyId,
                    parent_task_id: null,
                    deleted_at: null,
                },
                await this.access.taskFilter(viewer),
            ) as never,
            select: { id: true },
        });
        await this.writeOrder('task', members, dto.orderedIds);
        return { success: true };
    }

    private async writeOrder(
        kind: 'epic' | 'story' | 'task',
        members: { id: string }[],
        orderedIds: string[],
    ) {
        const allowed = new Set(members.map((member) => member.id));
        const ordered = [...new Set(orderedIds)].filter((id) => allowed.has(id));
        // Members the page did not list (created since it loaded, or hidden
        // from this viewer) keep their relative order after the listed ones.
        const rest = members.map((member) => member.id).filter((id) => !ordered.includes(id));
        const all = [...ordered, ...rest];

        await this.db.$transaction(
            all.map((id, index) => {
                if (kind === 'epic') return this.db.projectEpic.update({ where: { id }, data: { sort_order: index } });
                if (kind === 'story') {
                    return this.db.projectUserStory.update({ where: { id }, data: { sort_order: index } });
                }
                return this.db.projectTask.update({ where: { id }, data: { backlog_order: index } });
            }) as never,
        );
    }

    private async assertInProject(kind: 'epic' | 'story', tenantId: string, projectId: string, id: string) {
        const row =
            kind === 'epic'
                ? await this.db.projectEpic.findFirst({
                      where: { id, tenant_id: tenantId, project_id: projectId },
                      select: { id: true },
                  })
                : await this.db.projectUserStory.findFirst({
                      where: { id, tenant_id: tenantId, project_id: projectId },
                      select: { id: true, epic_id: true },
                  });
        if (!row) throw new NotFoundException(kind === 'epic' ? 'Epic not found' : 'User story not found');
        return row as { id: string; epic_id?: string | null };
    }

    // ── Bulk actions ───────────────────────────────────────────────────────

    /**
     * One action over a selection of epics or stories, applied row by row. A
     * row that refuses (a story status its tasks contradict, an epic in another
     * project) is reported back and the rest still go through — failing the
     * whole selection over one row would throw away the others.
     */
    async bulkScope(viewer: ProjectViewer, projectId: string, dto: BulkBacklogScopeDto): Promise<BulkOutcome> {
        await this.access.assertProjectVisible(viewer, projectId);
        const value = dto.value ?? null;

        if (dto.action === 'priority') assertEnum(value, Object.values(ProjectPriorityDto), 'priority');
        if (dto.action === 'status') {
            assertEnum(
                value,
                Object.values(dto.kind === 'epic' ? EpicStatusDto : UserStoryStatusDto),
                'status',
            );
        }
        if (dto.action === 'epic' && dto.kind !== 'story') {
            throw new BadRequestException('Only a story can be moved to an epic.');
        }

        return this.eachRow(dto.ids, async (id) => {
            await this.assertInProject(dto.kind, viewer.tenantId, projectId, id);
            if (dto.action === 'delete') {
                if (dto.kind === 'epic') await this.epics.remove(viewer, id);
                else await this.stories.remove(viewer, id);
                return;
            }
            if (dto.kind === 'epic') {
                const patch: Partial<UpdateEpicDto> =
                    dto.action === 'priority' ? { priority: value as never } : { status: value as never };
                await this.epics.update(viewer, id, patch as UpdateEpicDto);
                return;
            }
            const patch: Partial<UpdateUserStoryDto> =
                dto.action === 'priority'
                    ? { priority: value as never }
                    : dto.action === 'status'
                      ? { status: value as never }
                      : { epicId: value ?? '' };
            await this.stories.update(viewer, id, patch as UpdateUserStoryDto);
        });
    }

    async bulkTasks(viewer: ProjectViewer, projectId: string, dto: BulkBacklogTasksDto): Promise<BulkOutcome> {
        await this.access.assertProjectVisible(viewer, projectId);
        const value = dto.value ?? null;

        if (dto.action === 'delete') {
            // The task service's own bulk delete: one round trip, visibility
            // applied, invisible ids skipped. Restricted to this project here.
            const inProject = await this.db.projectTask.findMany({
                where: { id: { in: dto.ids }, tenant_id: viewer.tenantId, project_id: projectId },
                select: { id: true },
            });
            const ids = inProject.map((row) => row.id);
            const result = ids.length ? await this.tasks.bulkRemove(viewer, ids) : { deleted: 0 };
            const kept = new Set(ids);
            return {
                updated: result.deleted,
                skipped: dto.ids.filter((id) => !kept.has(id)).map((id) => ({ id, reason: 'Task not found' })),
            };
        }

        let patch: Partial<UpdateTaskDto>;
        if (dto.action === 'priority') {
            assertEnum(value, Object.values(ProjectPriorityDto), 'priority');
            patch = { priority: value as never };
        } else if (dto.action === 'status') {
            if (!value) throw new BadRequestException('Choose a column.');
            patch = { statusId: value };
        } else if (dto.action === 'story') {
            patch = { userStoryId: value ?? '' };
        } else {
            patch = assigneePatch(value);
        }

        return this.eachRow(dto.ids, async (id) => {
            const task = await this.tasks.assertTask(viewer, id);
            if (task.project_id !== projectId) throw new NotFoundException('Task not found');
            await this.tasks.update(viewer, id, patch as UpdateTaskDto);
        });
    }

    private async eachRow(ids: string[], apply: (id: string) => Promise<void>): Promise<BulkOutcome> {
        const outcome: BulkOutcome = { updated: 0, skipped: [] };
        // Sequential on purpose: each row is several writes, and interleaving
        // twenty of them would only contend for the same story rows.
        for (const id of [...new Set(ids)]) {
            try {
                await apply(id);
                outcome.updated += 1;
            } catch (error) {
                outcome.skipped.push({
                    id,
                    reason: error instanceof Error ? error.message : 'Could not be updated',
                });
            }
        }
        return outcome;
    }
}

function assertEnum(value: string | null, allowed: string[], field: string) {
    if (!value || !allowed.includes(value)) {
        throw new BadRequestException(`Unknown ${field} "${value ?? ''}".`);
    }
}

/**
 * `user:<id>` / `employee:<id>` — the keys the task list already uses for an
 * assignee option — onto the pair of columns a task stores, clearing the other
 * so a task never ends up assigned to both.
 */
function assigneePatch(value: string | null): Partial<UpdateTaskDto> {
    if (!value) return { assigneeId: '', assigneeEmployeeId: '' };
    const [kind, id] = value.split(':');
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw new BadRequestException('Unknown assignee.');
    if (kind === 'user') return { assigneeId: id, assigneeEmployeeId: '' };
    if (kind === 'employee') return { assigneeEmployeeId: id, assigneeId: '' };
    throw new BadRequestException('Unknown assignee.');
}
