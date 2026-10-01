import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { ProjectAccessService, ProjectViewer } from './project-access.service';
import { composeTaskKey, parseTaskKey } from './url-keys/task-key';
import { paginate } from '../common/pagination.dto';
import { createdAtRange } from '../common/created-range.util';
import { runImport, type ImportResult } from '../common/import.util';
import { resolveOrderBy, type SortableMap } from '../common/sort.util';
import { RemainingHoursService, RemainingSource } from './remaining-hours.service';
import { ProjectSettingsService } from './project-settings.service';
import { ActivityType, ProjectActivityService } from './project-activity.service';
import { BoardColumnsService, pickColumnForStatus } from './board-columns.service';
import { syncStoryStatuses } from './story-status.util';
import { BurndownRecorder } from './burndown-recorder.service';
import { SprintMembershipService } from './sprint-membership.service';
import {
    CreateChecklistItemDto,
    CreateTaskDto,
    ListTasksDto,
    MoveTaskDto,
    ProjectPriorityDto,
    UpdateChecklistItemDto,
    UpdateTaskDto,
} from './project.dto';
import {
    importDate,
    importEnum,
    importNumber,
    importText,
    lookup,
    nameIndex,
    requiredText,
} from './project-import.util';

const TASK_SORTABLE: SortableMap = {
    title: (dir) => ({ title: dir }),
    priority: (dir) => ({ priority: dir }),
    due_date: (dir) => ({ due_date: dir }),
    created_at: (dir) => ({ created_at: dir }),
    sort_order: (dir) => ({ sort_order: dir }),
};

/**
 * The tasks a sprint's list shows: those in it now, plus those whose stay in it
 * ended other than by removal — done there, carried on, or returned to the
 * backlog when it completed. So a completed sprint still lists the work it was
 * committed to, and a task taken out mid-sprint drops out as it always did.
 *
 * Current members are matched on `sprint_id`, not on an open history row, so
 * the list is right even for tasks that joined before history was recorded.
 */
function inSprint(sprintId: string) {
    return {
        OR: [
            { sprint_id: sprintId },
            {
                sprintMemberships: {
                    some: {
                        sprint_id: sprintId,
                        removed_at: { not: null },
                        outcome: { in: ['DONE', 'CARRIED_OVER', 'RETURNED_TO_BACKLOG'] },
                    },
                },
            },
        ],
    };
}

/** A task's latest stay in one sprint — a task re-added after removal has two. */
function membershipIn(sprintId: string) {
    return {
        where: { sprint_id: sprintId },
        orderBy: { added_at: 'desc' },
        take: 1,
        select: {
            outcome: true,
            removed_at: true,
            remaining_at_close: true,
            carried_to: { select: { id: true, name: true } },
        },
    } as const;
}

function withSprintMembership(task: TaskRow): TaskRow {
    const { sprintMemberships, ...rest } = task as TaskRow & { sprintMemberships?: unknown[] };
    return { ...rest, sprintMembership: sprintMemberships?.[0] ?? null } as TaskRow;
}

/** How many readings the list sparkline draws. Enough for a shape, not a chart. */
const TREND_POINTS = 10;

const TASK_INCLUDE = {
    project: { select: { id: true, code: true, name: true, short_name: true } },
    status: { select: { id: true, name: true, category: true, sort_order: true } },
    assignee: { select: { id: true, name: true, email: true } },
    assigneeEmployee: { select: { id: true, name: true } },
    milestone: { select: { id: true, name: true } },
    userStory: { select: { id: true, reference: true, code: true, title: true, status: true } },
    sprint: { select: { id: true, name: true, status: true } },
    checklistItems: { orderBy: { sort_order: 'asc' } },
    labels: { include: { label: true } },
    _count: { select: { subtasks: true, comments: true } },
} as const;

@Injectable()
export class ProjectTasksService {
    constructor(
        private readonly db: DatabaseService,
        private readonly remaining: RemainingHoursService,
        private readonly settings: ProjectSettingsService,
        private readonly activity: ProjectActivityService,
        private readonly access: ProjectAccessService,
        private readonly boardColumns: BoardColumnsService,
        private readonly burndown: BurndownRecorder,
        private readonly membership: SprintMembershipService,
    ) {}

    /**
     * `ERP-1`, `ERP-2`, … within one project. Taken from the highest reference
     * rather than a count so deleting ERP-2 does not hand its number to the
     * next task written — two tasks called ERP-2 would make every older note
     * about one of them wrong. Same rule user stories follow.
     */
    async nextReference(projectId: string, client: Prisma.TransactionClient = this.db): Promise<number> {
        const last = await client.projectTask.findFirst({
            where: { project_id: projectId },
            orderBy: { reference: 'desc' },
            select: { reference: true },
        });
        return (last?.reference ?? 0) + 1;
    }

    /**
     * A task by `<code>-<reference>`, or by a code its project used to have.
     *
     * Every lookup is tenant-scoped: project codes are unique per tenant, not
     * globally — two tenants each hold a `PRJ-0002` in production — so an
     * unscoped resolve would answer with another workspace's task.
     */
    async resolveTaskKey(tenantId: string, key: string) {
        const parsed = parseTaskKey(key);
        if (!parsed) return null;

        let project = await this.db.project.findFirst({
            where: { tenant_id: tenantId, code: parsed.code, deleted_at: null },
            select: { id: true, code: true },
        });
        let moved = false;

        if (!project) {
            const past = await this.db.projectCodeHistory.findFirst({
                where: { tenant_id: tenantId, code: parsed.code },
                select: { project_id: true },
            });
            if (!past) return null;

            project = await this.db.project.findUnique({
                where: { id: past.project_id },
                select: { id: true, code: true },
            });
            if (!project) return null;
            moved = true;
        }

        const task = await this.db.projectTask.findFirst({
            where: { project_id: project.id, reference: parsed.reference, deleted_at: null },
            select: { id: true, reference: true },
        });
        if (!task) return null;

        return {
            taskId: task.id,
            currentKey: composeTaskKey(project.code, task.reference),
            moved,
        };
    }

    async list(viewer: ProjectViewer, query: ListTasksDto) {
        const tenantId = viewer.tenantId;
        const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
        const page = Math.max(query.page ?? 1, 1);

        const created = createdAtRange(query.createdFrom, query.createdTo, viewer.timezone);

        const where: Record<string, unknown> = {
            tenant_id: tenantId,
            deleted_at: null,
            ...(query.projectId ? { project_id: query.projectId } : {}),
            ...(query.assigneeId ? { assignee_id: query.assigneeId } : {}),
            ...(query.assigneeEmployeeId ? { assignee_employee_id: query.assigneeEmployeeId } : {}),
            // Both columns at once, because a task is held if either one names
            // somebody. Spread after the two above so that when a caller sends an
            // assignee *and* this flag, the flag wins rather than the pair
            // silently combining into a query that can never match.
            ...(query.unassigned === 'true'
                ? { assignee_id: null, assignee_employee_id: null }
                : {}),
            ...(query.priority ? { priority: query.priority } : {}),
            ...(created ? { created_at: created } : {}),
            ...(query.statusId ? { status_id: query.statusId } : {}),
            ...(query.statusCategory
                ? { status: { category: query.statusCategory.toUpperCase() } }
                : {}),
            ...(query.milestoneId ? { milestone_id: query.milestoneId } : {}),
            ...(query.userStoryId ? { user_story_id: query.userStoryId } : {}),
            // Spread after the id for the reason `unassigned` is spread after
            // the assignee columns: a caller sending both meant the flag.
            ...(query.noUserStory === 'true' ? { user_story_id: null } : {}),
            ...(query.labelId ? { labels: { some: { label_id: query.labelId } } } : {}),
        };
        if (query.backlogOnly === 'true') where.sprint_id = null;
        else if (query.sprintId) where.AND = [inSprint(query.sprintId)];

        const search = query.search?.trim();
        if (search) where.title = { contains: search, mode: 'insensitive' };

        // The cross-project Tasks page reads every task in the tenant, so this
        // is where a private project's work would otherwise leak in full —
        // title, assignee, hours and all — to someone who cannot open it. It is
        // also where a narrow viewer's own-records scope has to bite, since the
        // page's assignee filter is theirs to clear.
        // Merged rather than spread so a filter added above can never be
        // overwritten by, or overwrite, this one.
        const scoped = ProjectAccessService.merge(where, await this.access.taskFilter(viewer));

        const [items, total] = await Promise.all([
            this.db.projectTask.findMany({
                where: scoped as never,
                orderBy: resolveOrderBy(query.sortBy, query.sortDir, TASK_SORTABLE, [
                    { sort_order: 'asc' },
                    { created_at: 'asc' },
                ]) as never,
                skip: (page - 1) * limit,
                take: limit,
                include: (query.sprintId
                    ? { ...TASK_INCLUDE, sprintMemberships: membershipIn(query.sprintId) }
                    : TASK_INCLUDE) as never,
            }),
            this.db.projectTask.count({ where: scoped as never }),
        ]);

        const rows = query.sprintId ? (items as TaskRow[]).map(withSprintMembership) : items;
        const withLogged = await this.attachLoggedHours(tenantId, rows as TaskRow[]);
        const withTrend = await this.attachRemainingTrend(tenantId, withLogged as TaskRow[]);
        return paginate(withTrend, total, page, limit);
    }

    /**
     * The last few remaining-hours readings per task, oldest first, for the
     * sparkline in the list's Remaining column.
     *
     * **One query for the whole page, whatever its length.** The obvious
     * implementation — a `findMany` per row — is an N+1 that grows with the page
     * size, and the naive single query (every log row for these tasks, trimmed
     * in JS) is unbounded: one task worked for a year would return thousands of
     * rows to draw fifty pixels. A window function does the trimming in the
     * database, so the cost is `page size × TREND_POINTS` rows and one round
     * trip.
     *
     * Tasks with fewer than two readings get no array at all — a single point
     * has no shape, and the column shows the figure alone.
     */
    private async attachRemainingTrend(tenantId: string, tasks: TaskRow[]) {
        const ids = tasks.map((task) => task.id);
        if (ids.length === 0) return tasks;

        const rows = await this.db.$queryRaw<{ task_id: string; new_hours: string }[]>`
            SELECT task_id, new_hours
            FROM (
                SELECT task_id,
                       new_hours,
                       changed_at,
                       row_number() OVER (
                           PARTITION BY task_id ORDER BY changed_at DESC
                       ) AS rn
                FROM project_task_remaining_logs
                WHERE tenant_id = ${tenantId}
                  AND task_id IN (${Prisma.join(ids)})
            ) ranked
            WHERE rn <= ${TREND_POINTS}
            ORDER BY task_id, changed_at ASC
        `;

        const byTask = new Map<string, number[]>();
        for (const row of rows) {
            const points = byTask.get(row.task_id) ?? [];
            points.push(Number(row.new_hours));
            byTask.set(row.task_id, points);
        }

        return tasks.map((task) => {
            const trend = byTask.get(task.id);
            return trend && trend.length > 1 ? { ...task, remaining_trend: trend } : task;
        });
    }

    /**
     * Everyone who holds at least one task the viewer can see — the options for
     * the Tasks page's assignee filter.
     *
     * Drawn from the tasks themselves rather than from the tenant roster
     * (`/projects/member-candidates`) for two reasons: that endpoint is gated on
     * MANAGE_PROJECTS, which someone who may only *view* the list has no reason
     * to hold, and a roster would offer dozens of people whose every selection
     * returns nothing. Scoped through the same visibility filter as the list, so
     * a private project cannot leak who is working on it.
     */
    async listAssignees(viewer: ProjectViewer) {
        const base = ProjectAccessService.merge(
            { tenant_id: viewer.tenantId, deleted_at: null },
            await this.access.taskFilter(viewer),
        );

        // groupBy rather than a distinct findMany: the DISTINCT runs in the
        // database, so this stays two index reads instead of loading every task row
        // in the workspace to dedupe in memory. It is reached through a plainly
        // typed reference because groupBy infers its result from the whole argument
        // object, and the visibility filter is a `Record<string, unknown>` that no
        // Prisma `where` type accepts — passing it in collapses that inference into
        // a circular-reference error rather than a useful complaint.
        const groupTasksBy = this.db.projectTask.groupBy as unknown as (
            args: { by: string[]; where: Record<string, unknown> },
        ) => Promise<Record<string, string | null>[]>;

        const [userRows, employeeRows] = await Promise.all([
            groupTasksBy({ by: ['assignee_id'], where: { ...base, assignee_id: { not: null } } }),
            groupTasksBy({
                by: ['assignee_employee_id'],
                where: { ...base, assignee_employee_id: { not: null } },
            }),
        ]);

        const userIds = userRows.map((row) => row.assignee_id).filter((id): id is string => !!id);
        const employeeIds = employeeRows
            .map((row) => row.assignee_employee_id)
            .filter((id): id is string => !!id);

        const [users, employees] = await Promise.all([
            userIds.length
                ? (this.db.user.findMany({
                      where: { id: { in: userIds } },
                      select: { id: true, name: true, email: true },
                      orderBy: { email: 'asc' },
                  }) as Promise<{ id: string; name: string | null; email: string }[]>)
                : Promise.resolve([]),
            employeeIds.length
                ? (this.db.employee.findMany({
                      where: { id: { in: employeeIds } },
                      select: { id: true, name: true, employee_code: true },
                      orderBy: { name: 'asc' },
                  }) as Promise<{ id: string; name: string; employee_code: string | null }[]>)
                : Promise.resolve([]),
        ]);

        // The same `key` space the task detail panel's picker uses, so one select
        // can offer both kinds of assignee without two parallel value lists.
        return [
            ...users.map((user) => ({
                key: `user:${user.id}`,
                userId: user.id,
                name: user.name || user.email,
                hint: user.email,
                noLogin: false,
            })),
            ...employees.map((employee) => ({
                key: `employee:${employee.id}`,
                employeeId: employee.id,
                name: employee.name,
                hint: employee.employee_code ?? undefined,
                noLogin: true,
            })),
        ];
    }

    async findOne(viewer: ProjectViewer, taskId: string) {
        const tenantId = viewer.tenantId;
        const task = await this.db.projectTask.findFirst({
            where: {
                id: taskId,
                tenant_id: tenantId,
                deleted_at: null,
                ...(await this.access.taskFilter(viewer)),
            } as never,
            include: {
                ...TASK_INCLUDE,
                // What the task card shows beyond a list row: the epic its story
                // belongs to, who filed it, and whether the viewer watches it.
                // Here rather than in TASK_INCLUDE, which every list and board
                // shares, so a column of fifty cards does not pay for them.
                userStory: {
                    select: {
                        id: true,
                        reference: true,
                        code: true,
                        title: true,
                        status: true,
                        epic: { select: { id: true, code: true, title: true } },
                    },
                },
                creator: { select: { id: true, name: true, email: true } },
                // Only the viewer's own row. It answers the one question the
                // card's Watch button asks, without a second request, and the
                // count below covers everyone else.
                watchers: { where: { user_id: viewer.userId }, select: { user_id: true } },
                _count: {
                    select: { subtasks: true, comments: true, attachments: true, watchers: true },
                },
                subtasks: {
                    where: { deleted_at: null },
                    orderBy: { reference: 'asc' },
                    include: { status: { select: { id: true, name: true, category: true } } },
                },
                timeEntries: {
                    orderBy: { work_date: 'desc' },
                    include: { user: { select: { id: true, name: true } } },
                },
                // Every sprint it was attempted in, the current one included.
                sprintMemberships: {
                    orderBy: { added_at: 'asc' },
                    select: {
                        added_at: true,
                        removed_at: true,
                        outcome: true,
                        sprint: { select: { id: true, name: true, status: true } },
                    },
                },
            } as never,
        });
        if (!task) throw new NotFoundException('Task not found');
        // The viewer's watcher row is folded into a flag rather than returned:
        // a `watchers` array holding one person would read as the whole list.
        const { watchers, sprintMemberships, ...row } = task as TaskRow & {
            watchers?: unknown[];
            sprintMemberships?: unknown[];
        };
        const [withLogged] = await this.attachLoggedHours(tenantId, [row as TaskRow]);
        return {
            ...withLogged,
            sprintHistory: sprintMemberships ?? [],
            viewer_watching: Array.isArray(watchers) && watchers.length > 0,
        };
    }

    async create(viewer: ProjectViewer, dto: CreateTaskDto) {
        const tenantId = viewer.tenantId;
        const userId = viewer.userId;
        await this.assertProject(viewer, dto.projectId);
        const statusId = dto.statusId
            ? (await this.assertStatus(tenantId, dto.statusId, dto.projectId)).id
            : (await this.settings.defaultTaskStatus(tenantId, dto.projectId)).id;

        if (dto.parentTaskId) {
            const parent = await this.assertTask(viewer, dto.parentTaskId);
            // One level only: a subtask of a subtask makes rollups ambiguous
            // and the board has nowhere to draw it.
            if (parent.parent_task_id) {
                throw new BadRequestException('A subtask cannot have subtasks of its own.');
            }
        }
        if (dto.userStoryId) await this.assertUserStory(tenantId, dto.userStoryId, dto.projectId);
        if (dto.sprintId) await this.assertSprint(tenantId, dto.sprintId);

        const sortOrder = await this.nextSortOrder(tenantId, dto.projectId, statusId);
        const estimate = dto.estimateHours ?? null;
        // An unstarted task's remaining is its estimate — the only defensible
        // opening position, and it gives the burndown something to start from.
        const opening = dto.remainingHours ?? estimate;

        const reference = await this.nextReference(dto.projectId);
        const task = await this.db.projectTask.create({
            data: {
                tenant_id: tenantId,
                project_id: dto.projectId,
                reference,
                // Bottom of its Backlog group: references only grow, and a
                // groomed group is renumbered from 0.
                backlog_order: reference,
                title: dto.title.trim(),
                description: dto.description?.trim() || null,
                status_id: statusId,
                priority: (dto.priority ?? 'MEDIUM') as never,
                // `|| null`, not `?? null`: the dialog sends `''` for a link the
                // user left empty, and an empty string is not a UUID a FK column
                // will take.
                assignee_id: dto.assigneeId || null,
                assignee_employee_id: dto.assigneeEmployeeId || null,
                milestone_id: dto.milestoneId || null,
                user_story_id: dto.userStoryId || null,
                parent_task_id: dto.parentTaskId || null,
                start_date: dto.startDate ? new Date(dto.startDate) : null,
                due_date: dto.dueDate ? new Date(dto.dueDate) : null,
                cover_color: (dto.coverColor ?? null) as never,
                estimate_hours: estimate,
                sort_order: sortOrder,
                created_by: userId,
            },
        });

        // Through the membership service, not the create, so the task's sprint
        // history opens with it.
        if (dto.sprintId) await this.membership.moveTasks(this.db, tenantId, [task.id], dto.sprintId, 'REMOVED');
        if (dto.labelIds?.length) await this.setLabels(tenantId, task.id, dto.labelIds);
        await syncStoryStatuses(this.db as never, tenantId, [dto.userStoryId]);

        await this.activity.record({
            tenantId,
            taskId: task.id,
            projectId: dto.projectId,
            type: ActivityType.CREATED,
            actorId: userId,
        });
        // Whoever made it, and whoever it landed on, hear about it by default —
        // a watch list nobody is ever added to is a feature nobody uses.
        await this.activity.watch(tenantId, task.id, userId);
        if (dto.assigneeId) await this.activity.watch(tenantId, task.id, dto.assigneeId);

        if (opening != null) {
            await this.remaining.write({
                tenantId,
                taskId: task.id,
                projectId: dto.projectId,
                sprintId: dto.sprintId || null,
                previousHours: null,
                newHours: opening,
                source: RemainingSource.TASK_CREATED,
                userId,
            });
        }
        // A task with no hours still raises the sprint's open-task count.
        await this.burndown.record(tenantId, [dto.sprintId], 'TASK_ADDED', task.id);

        return this.findOne(viewer, task.id);
    }

    /**
     * Spreadsheet import for tasks.
     *
     * The columns are the words a person already uses — a project code, a board
     * column's name, a colleague's email — not the ids the API takes, so every
     * lookup the file can name is loaded once here and each row is resolved
     * against it. A value matching nothing fails that row by name and leaves
     * the rest of the file to import.
     *
     * Rows go through `create`/`update` rather than straight to Prisma, so an
     * imported task opens with the same remaining hours, activity entry and
     * watchers as one typed into the form. A task is recognised by its title
     * within its project, which is also what `skip` skips and `upsert` updates.
     */
    async importRows(
        viewer: ProjectViewer,
        rows: Record<string, unknown>[],
        mode: 'skip' | 'upsert',
    ): Promise<ImportResult> {
        const tenantId = viewer.tenantId;
        // Only the projects this viewer may open, so an import cannot reach a
        // project the list would never have shown them.
        const projects = await this.db.project.findMany({
            where: {
                tenant_id: tenantId,
                deleted_at: null,
                ...(await this.access.projectFilter(viewer)),
            } as never,
            select: { id: true, code: true, short_name: true, name: true },
        });
        const statuses = await this.db.projectTaskStatus.findMany({
            where: { tenant_id: tenantId, is_active: true },
            select: { id: true, name: true, project_id: true },
        });
        const members = await this.db.tenantUser.findMany({
            where: { tenant_id: tenantId },
            select: { user: { select: { id: true, name: true, email: true } } },
        });

        const projectIndex = nameIndex(
            projects,
            (project) => [project.code, project.short_name, project.name],
            (project) => project.id,
        );
        const assigneeIndex = nameIndex(
            members,
            ({ user }) => [user.email, user.name],
            ({ user }) => user.id,
        );

        /**
         * A column of that name on that project, or — for the tenant-wide
         * statuses that predate per-project boards — one belonging to no
         * project at all.
         */
        const statusFor = (projectId: string, name: string): string => {
            const wanted = name.toLowerCase();
            const match =
                statuses.find(
                    (s) => s.project_id === projectId && s.name.trim().toLowerCase() === wanted,
                )
                ?? statuses.find(
                    (s) => s.project_id === null && s.name.trim().toLowerCase() === wanted,
                );
            if (!match) throw new Error(`no board column named "${name}" on that project`);
            return match.id;
        };

        return runImport<TaskImportRow>(rows, mode, tenantId, {
            requiredFields: ['project', 'title'],
            castRow: (raw) => {
                const projectId = lookup(
                    projectIndex,
                    requiredText(raw.project, 'Project'),
                    'no project matches',
                );
                const status = importText(raw.status);
                const assignee = importText(raw.assignee);
                return {
                    projectId,
                    title: requiredText(raw.title, 'Title'),
                    description: importText(raw.description),
                    statusId: status ? statusFor(projectId, status) : null,
                    priority: importEnum(
                        raw.priority,
                        Object.values(ProjectPriorityDto),
                        'Priority',
                    ),
                    assigneeId: assignee
                        ? lookup(assigneeIndex, assignee, 'no team member matches')
                        : null,
                    startDate: importDate(raw.startDate, 'Start date'),
                    dueDate: importDate(raw.dueDate, 'Due date'),
                    estimateHours: importNumber(raw.estimateHours, 'Estimate hours'),
                };
            },
            dedupeKeys: (row) => [`title:${row.projectId}:${row.title.toLowerCase()}`],
            describeDedupeKey: () => 'title on the same project',
            findDuplicate: async (row) => {
                const existing = await this.db.projectTask.findFirst({
                    where: {
                        tenant_id: tenantId,
                        project_id: row.projectId,
                        deleted_at: null,
                        title: { equals: row.title, mode: 'insensitive' },
                    },
                    select: { id: true },
                });
                return existing?.id ?? null;
            },
            create: async (row) => {
                await this.create(viewer, {
                    projectId: row.projectId,
                    title: row.title,
                    ...taskFieldsFrom(row),
                } as CreateTaskDto);
            },
            // A blank cell leaves the stored value alone rather than clearing
            // it: a file carrying three columns is an update to those three,
            // not an instruction to empty everything it does not mention.
            update: async (id, row) => {
                await this.update(viewer, id, {
                    title: row.title,
                    ...taskFieldsFrom(row),
                } as UpdateTaskDto);
            },
        });
    }

    async update(viewer: ProjectViewer, taskId: string, dto: UpdateTaskDto) {
        const tenantId = viewer.tenantId;
        const userId = viewer.userId;
        const task = await this.assertTask(viewer, taskId);
        // Null for an ordinary edit — including one that names the project the
        // task is already in.
        const move = await this.planMove(viewer, task, dto);
        const projectId = move?.projectId ?? task.project_id;

        let statusId = task.status_id;
        let completedAt = task.completed_at;
        let becameDone = false;
        let becameUndone = false;

        // A move always changes the column, since every project has columns of
        // its own; it takes the one the plan matched unless the request named one.
        const nextStatus =
            dto.statusId && dto.statusId !== task.status_id
                ? await this.assertStatus(tenantId, dto.statusId, projectId)
                : (move?.status ?? null);
        if (nextStatus && nextStatus.id !== task.status_id) {
            statusId = nextStatus.id;
            const wasDone = task.status?.category === 'DONE';
            const isDone = nextStatus.category === 'DONE';
            becameDone = !wasDone && isDone;
            becameUndone = wasDone && !isDone;
            if (becameDone) completedAt = new Date();
            if (becameUndone) completedAt = null;
        }

        if (dto.userStoryId) await this.assertUserStory(tenantId, dto.userStoryId, projectId);
        if (dto.sprintId) await this.assertSprint(tenantId, dto.sprintId);

        const data = {
            ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
            ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
            ...(statusId !== task.status_id ? { status_id: statusId, completed_at: completedAt } : {}),
            ...(dto.priority !== undefined ? { priority: dto.priority as never } : {}),
            ...(dto.assigneeId !== undefined ? { assignee_id: dto.assigneeId || null } : {}),
            ...(dto.assigneeEmployeeId !== undefined
                ? { assignee_employee_id: dto.assigneeEmployeeId || null }
                : {}),
            ...(dto.milestoneId !== undefined ? { milestone_id: dto.milestoneId || null } : {}),
            ...(dto.userStoryId !== undefined ? { user_story_id: dto.userStoryId || null } : {}),
            ...(dto.startDate !== undefined
                ? { start_date: dto.startDate ? new Date(dto.startDate) : null }
                : {}),
            ...(dto.dueDate !== undefined ? { due_date: dto.dueDate ? new Date(dto.dueDate) : null } : {}),
            ...(dto.coverColor !== undefined
                ? { cover_color: (dto.coverColor || null) as never }
                : {}),
            ...(dto.estimateHours !== undefined ? { estimate_hours: dto.estimateHours ?? null } : {}),
        };

        const moved = move
            ? await this.db.$transaction((tx) => this.applyMove(tx, tenantId, task, move, data, statusId))
            : null;
        if (!moved) await this.db.projectTask.update({ where: { id: taskId }, data });
        // Scope first, before any hours move, so the chart shows the task
        // joining (or leaving) as its own step rather than folding it into
        // whatever re-estimate follows.
        if (dto.sprintId !== undefined && (dto.sprintId || null) !== task.sprint_id) {
            await this.membership.moveTasks(this.db, tenantId, [taskId], dto.sprintId || null, 'REMOVED');
            await this.burndown.record(tenantId, [task.sprint_id], 'TASK_REMOVED', taskId);
            await this.burndown.record(tenantId, [dto.sprintId], 'TASK_ADDED', taskId);
        }

        if (dto.labelIds !== undefined) await this.setLabels(tenantId, taskId, dto.labelIds);
        if (statusId !== task.status_id || dto.userStoryId !== undefined || moved) {
            // Both ends: the story it left loses a task, the one it joined gains
            // one. A move takes the task and its subtasks out of their stories.
            await syncStoryStatuses(this.db as never, tenantId, [
                task.user_story_id,
                dto.userStoryId,
                ...(moved?.leftStoryIds ?? []),
            ]);
        }

        await this.recordUpdateActivity(tenantId, userId, task, dto, statusId, projectId);
        if (moved) {
            await this.recordMove(tenantId, userId, task, projectId, moved.reference, nextStatus?.name ?? null);
            await this.bindBoards(tenantId, moved.taskIds, projectId);
        }

        const previous = task.remaining_hours == null ? null : Number(task.remaining_hours);
        const sprintId = dto.sprintId !== undefined ? dto.sprintId || null : task.sprint_id;

        // An explicit re-estimate wins over the status-derived write, so a
        // caller that does both in one request gets the number it asked for.
        if (dto.remainingHours !== undefined) {
            await this.remaining.write({
                tenantId,
                taskId,
                projectId,
                sprintId,
                previousHours: previous,
                newHours: dto.remainingHours,
                source: RemainingSource.RE_ESTIMATED,
                note: dto.remainingNote ?? null,
                userId,
            });
        } else if (becameDone || becameUndone) {
            await this.burnDoneCrossing({
                tenantId,
                userId,
                taskId,
                projectId,
                sprintId,
                previousHours: previous,
                estimateHours:
                    dto.estimateHours ?? (task.estimate_hours == null ? null : Number(task.estimate_hours)),
                becameDone,
            });
        } else if (previous == null && dto.estimateHours != null) {
            // Estimated after it was created: `create` only opens remaining
            // when an estimate arrives with the task, so a task estimated later
            // (on the form, or by an import updating it) sat with no remaining
            // at all — invisible to the burndown and the sprint's totals. It
            // opens now, on the reopen rule: the estimate less what is already
            // logged, and nothing left on a task that is done.
            const done = task.status?.category === 'DONE';
            const logged = done ? 0 : await this.loggedHours(tenantId, taskId);
            await this.remaining.write({
                tenantId,
                taskId,
                projectId,
                sprintId,
                previousHours: null,
                newHours: done ? 0 : Math.max(dto.estimateHours - logged, 0),
                source: RemainingSource.RE_ESTIMATED,
                userId,
            });
        } else if (dto.estimateHours != null && task.status?.category !== 'DONE') {
            // Remaining nobody has touched since it opened still equals the
            // estimate, so a changed estimate carries it along. Once time is
            // logged or someone re-estimates, remaining is its own number and an
            // estimate change leaves it alone.
            const oldEstimate = task.estimate_hours == null ? null : Number(task.estimate_hours);
            if (oldEstimate != null && previous === oldEstimate) {
                await this.remaining.write({
                    tenantId,
                    taskId,
                    projectId,
                    sprintId,
                    previousHours: previous,
                    newHours: dto.estimateHours,
                    source: RemainingSource.RE_ESTIMATED,
                    userId,
                });
            }
        }

        // A subtask that crossed into or out of Done on the way — only possible
        // when the new project has no column of its kind — burns by the same
        // rule its parent does.
        for (const crossing of moved?.crossings ?? []) {
            await this.burnDoneCrossing({ tenantId, userId, projectId, ...crossing });
        }

        // A Done crossing with no hours left to burn writes no remaining row,
        // yet still changes the open-task count. A no-op edit records nothing:
        // the recorder skips a point that repeats the last.
        await this.burndown.record(tenantId, [task.sprint_id, sprintId], 'STATUS_CHANGED', taskId);

        return this.findOne(viewer, taskId);
    }

    /**
     * Where a task goes when it changes project, worked out before anything is
     * written, so every check that can refuse the move runs first.
     *
     * The column is matched the way a board places a project's statuses — by
     * name, then by category — so "In Progress" stays in progress and a
     * finished task stays finished. Only a project with no column of the kind
     * falls back to its default one.
     */
    private async planMove(
        viewer: ProjectViewer,
        task: { project_id: string; parent_task_id: string | null; status?: MovableStatus | null },
        dto: UpdateTaskDto,
    ): Promise<ProjectMove | null> {
        if (!dto.projectId || dto.projectId === task.project_id) return null;
        // One level of subtasks, and the parent's card composes each subtask's
        // key from its own project — so a subtask lives where its parent does.
        if (task.parent_task_id) throw new BadRequestException('A subtask moves with its parent task.');
        await this.assertProject(viewer, dto.projectId);

        const columns = await this.settings.listTaskStatuses(viewer.tenantId, false, dto.projectId);
        if (columns.length === 0) throw new BadRequestException('That project has no board columns.');
        const fallback = columns.find((column) => column.is_default) ?? columns[0];
        const columnFor = (status: MovableStatus | null | undefined) => {
            const id = status ? pickColumnForStatus(columns, status) : null;
            return columns.find((column) => column.id === id) ?? fallback;
        };

        return { projectId: dto.projectId, status: columnFor(task.status), columnFor };
    }

    /**
     * The writes of a move, in one transaction: the task and its subtasks
     * renumbered into the new project, and every row carrying a copy of their
     * project re-pointed at it — the hours logged on them, a clock running on
     * one, the remaining-hours log, the feed, comments and attachments. Half a
     * move would report hours under a project the task has left, and stopping
     * a running clock would log them there too.
     *
     * The task's story and milestone belong to the project it is leaving, so
     * they go — unless the request sent a story, which was checked against the
     * new project.
     */
    private async applyMove(
        tx: Prisma.TransactionClient,
        tenantId: string,
        task: { id: string },
        move: ProjectMove,
        data: Prisma.ProjectTaskUncheckedUpdateInput,
        statusId: string,
    ) {
        const reference = await this.nextReference(move.projectId, tx);
        await tx.projectTask.update({
            where: { id: task.id },
            data: {
                user_story_id: null,
                milestone_id: null,
                ...data,
                project_id: move.projectId,
                reference,
                // The bottom of its Backlog group and of its column, as a new
                // task would land.
                backlog_order: reference,
                sort_order: await this.nextSortOrder(tenantId, move.projectId, statusId, tx),
            },
        });

        // Deleted ones too: a subtask is always in its parent's project.
        const subtasks = await tx.projectTask.findMany({
            where: { tenant_id: tenantId, parent_task_id: task.id },
            orderBy: { reference: 'asc' },
            select: {
                id: true,
                user_story_id: true,
                sprint_id: true,
                estimate_hours: true,
                remaining_hours: true,
                completed_at: true,
                status: { select: { id: true, name: true, category: true } },
            },
        });

        const crossings: DoneCrossing[] = [];
        for (const [index, subtask] of subtasks.entries()) {
            const column = move.columnFor(subtask.status);
            const wasDone = subtask.status?.category === 'DONE';
            const isDone = column.category === 'DONE';
            if (wasDone !== isDone) {
                crossings.push({
                    taskId: subtask.id,
                    sprintId: subtask.sprint_id,
                    previousHours: subtask.remaining_hours == null ? null : Number(subtask.remaining_hours),
                    estimateHours: subtask.estimate_hours == null ? null : Number(subtask.estimate_hours),
                    becameDone: isDone,
                });
            }
            await tx.projectTask.update({
                where: { id: subtask.id },
                data: {
                    project_id: move.projectId,
                    reference: reference + index + 1,
                    backlog_order: reference + index + 1,
                    status_id: column.id,
                    sort_order: await this.nextSortOrder(tenantId, move.projectId, column.id, tx),
                    user_story_id: null,
                    milestone_id: null,
                    ...(wasDone !== isDone ? { completed_at: isDone ? new Date() : null } : {}),
                },
            });
        }

        const taskIds = [task.id, ...subtasks.map((subtask) => subtask.id)];
        const rows = { where: { tenant_id: tenantId, task_id: { in: taskIds } }, data: { project_id: move.projectId } };
        await tx.projectTimeEntry.updateMany(rows);
        await tx.projectTimer.updateMany(rows);
        await tx.projectTaskRemainingLog.updateMany(rows);
        await tx.projectTaskActivity.updateMany(rows);
        await tx.projectComment.updateMany(rows);
        await tx.projectAttachment.updateMany(rows);

        return {
            reference,
            taskIds,
            crossings,
            leftStoryIds: subtasks.map((subtask) => subtask.user_story_id),
        };
    }

    /**
     * The feed's account of a move: one line carrying both keys, since the key
     * is what people will go looking for, and a column change only when the
     * task landed in a differently named column — the new project's "To Do" is
     * a copy of the old one, not news.
     */
    private async recordMove(
        tenantId: string,
        userId: string,
        task: { id: string; project_id: string; reference: number; title: string; status?: MovableStatus | null },
        projectId: string,
        reference: number,
        statusName: string | null,
    ) {
        const projects = await this.db.project.findMany({
            where: { tenant_id: tenantId, id: { in: [task.project_id, projectId] } },
            select: { id: true, code: true, name: true },
        });
        const from = projects.find((project) => project.id === task.project_id);
        const to = projects.find((project) => project.id === projectId);
        const toKey = to ? composeTaskKey(to.code, reference) : null;
        const base = { tenantId, taskId: task.id, projectId, actorId: userId };

        await this.activity.record({
            ...base,
            type: ActivityType.PROJECT_CHANGED,
            data: {
                from: from ? composeTaskKey(from.code, task.reference) : null,
                to: toKey,
                fromProject: from?.name ?? null,
                toProject: to?.name ?? null,
            },
        });

        const fromStatus = task.status?.name ?? null;
        if (statusName !== fromStatus) {
            await this.activity.record({
                ...base,
                type: ActivityType.STATUS_CHANGED,
                data: { from: fromStatus, to: statusName },
            });
        }

        await this.activity.notifyWatchers({
            tenantId,
            taskId: task.id,
            actorId: userId,
            title: task.title,
            body: `Moved to ${to?.name ?? 'another project'} as ${toKey ?? 'a new task'}`,
            link: `/projects/${projectId}`,
        });
    }

    /**
     * A board holds cards from any project and places each by its status, and
     * the new project's statuses may be bound on none of the boards the card is
     * on. Binding them — what adding a card from that project would have done —
     * keeps the card in its column instead of dropping it to Unsorted.
     */
    private async bindBoards(tenantId: string, taskIds: string[], projectId: string) {
        const cards = await this.db.boardTask.findMany({
            where: { tenant_id: tenantId, task_id: { in: taskIds } },
            select: { board_id: true },
        });
        for (const boardId of new Set(cards.map((card) => card.board_id))) {
            await this.boardColumns.bindProject(tenantId, boardId, projectId);
        }
    }

    /**
     * What a column change owes the remaining-hours log when it crosses into or
     * out of Done. Finishing a task means no hours left on it, whatever the last
     * estimate said — without this the burndown never reaches zero. Reopening
     * one leaves its estimate less what is already logged.
     */
    private async burnDoneCrossing({
        becameDone,
        estimateHours,
        ...write
    }: DoneCrossing & { tenantId: string; userId: string; projectId: string }) {
        if (becameDone) {
            await this.remaining.write({ ...write, newHours: 0, source: RemainingSource.TASK_COMPLETED });
            return;
        }
        const logged = await this.loggedHours(write.tenantId, write.taskId);
        await this.remaining.write({
            ...write,
            newHours: Math.max((estimateHours ?? 0) - logged, 0),
            source: RemainingSource.TASK_REOPENED,
        });
    }

    /**
     * Drag-and-drop. The card's new column and index arrive together; every
     * other card in the target column is renumbered so the order is stable
     * integers rather than ever-shrinking fractions.
     */
    async move(viewer: ProjectViewer, taskId: string, dto: MoveTaskDto) {
        const tenantId = viewer.tenantId;
        const userId = viewer.userId;
        const task = await this.assertTask(viewer, taskId);
        const status = await this.assertStatus(tenantId, dto.statusId, task.project_id);
        if (dto.sprintId) await this.assertSprint(tenantId, dto.sprintId);

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
                                  ...(isDone && !wasDone ? { completed_at: new Date() } : {}),
                                  ...(!isDone && wasDone ? { completed_at: null } : {}),
                              }
                            : {}),
                    },
                });
            }
            // Dragging a card between sprint lanes changes its sprint.
            await this.membership.moveTasks(tx, tenantId, [taskId], sprintId, 'REMOVED');
        });

        if (sprintId !== task.sprint_id) {
            await this.burndown.record(tenantId, [task.sprint_id], 'TASK_REMOVED', taskId);
            await this.burndown.record(tenantId, [sprintId], 'TASK_ADDED', taskId);
        }

        if (status.id !== task.status_id) {
            await syncStoryStatuses(this.db as never, tenantId, [task.user_story_id]);
            await this.activity.record({
                tenantId,
                taskId,
                projectId: task.project_id,
                type: ActivityType.STATUS_CHANGED,
                data: { from: task.status?.name ?? null, to: status.name },
                actorId: userId,
            });
            await this.activity.notifyWatchers({
                tenantId,
                taskId,
                actorId: userId,
                title: task.title,
                body: `Moved to ${status.name}`,
                link: `/projects/${task.project_id}`,
            });
        }

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
        await this.burndown.record(tenantId, [task.sprint_id, sprintId], 'STATUS_CHANGED', taskId);

        return this.findOne(viewer, taskId);
    }

    async remove(viewer: ProjectViewer, taskId: string) {
        const task = await this.assertTask(viewer, taskId);
        await this.db.projectTask.update({
            where: { id: taskId },
            data: { deleted_at: new Date() },
        });
        // A deleted task leaves its sprint, so the history says so rather than
        // keeping an open row for a task nobody can see.
        await this.membership.moveTasks(this.db, viewer.tenantId, [taskId], null, 'REMOVED');
        await syncStoryStatuses(this.db as never, viewer.tenantId, [task.user_story_id]);
        await this.burndown.record(viewer.tenantId, [task.sprint_id], 'TASK_REMOVED', taskId);
        return { success: true };
    }

    /**
     * "Delete selected" on the Tasks page, in one round trip.
     *
     * The page used to fire one `DELETE /project-tasks/:id` per selected row.
     * With the platform's default throttle at 20 requests a minute per address
     * — and not raised in production — a selection past twenty rows spent the
     * whole budget and the rest came back `429`, which the page reported as
     * "could not be deleted": a half-finished delete dressed up as a failure.
     *
     * Invisible and already-deleted ids are *skipped*, not raised: unlike the
     * single-task route there is no one task the caller asked for, and failing
     * the whole batch over one row somebody else deleted a second earlier would
     * throw away the rest of the work. The count of each comes back so the page
     * can say what actually happened.
     */
    async bulkRemove(viewer: ProjectViewer, taskIds: string[]) {
        // Deduped so the counts below describe tasks rather than list entries: a
        // repeated id is one delete, and `requested - deleted` must not report a
        // skip that never existed.
        const ids = [...new Set(taskIds)];

        const where = ProjectAccessService.merge(
            { id: { in: ids }, tenant_id: viewer.tenantId, deleted_at: null },
            await this.access.taskFilter(viewer),
        );

        const affected = await this.db.projectTask.findMany({
            where: where as never,
            select: { id: true, user_story_id: true, sprint_id: true },
        });
        const { count } = await this.db.projectTask.updateMany({
            where: where as never,
            data: { deleted_at: new Date() },
        });
        await this.membership.moveTasks(
            this.db,
            viewer.tenantId,
            affected.filter((row) => row.sprint_id).map((row) => row.id),
            null,
            'REMOVED',
        );
        await syncStoryStatuses(
            this.db as never,
            viewer.tenantId,
            affected.map((row) => row.user_story_id),
        );
        await this.burndown.record(
            viewer.tenantId,
            affected.map((row) => row.sprint_id),
            'TASK_REMOVED',
        );

        return { success: true, deleted: count, skipped: ids.length - count };
    }

    async remainingHistory(viewer: ProjectViewer, taskId: string) {
        const tenantId = viewer.tenantId;
        await this.assertTask(viewer, taskId);
        return this.remaining.history(tenantId, taskId);
    }

    // ── Checklist ──────────────────────────────────────────────────────────

    async addChecklistItem(viewer: ProjectViewer, taskId: string, dto: CreateChecklistItemDto) {
        const tenantId = viewer.tenantId;
        await this.assertTask(viewer, taskId);
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

    async updateChecklistItem(viewer: ProjectViewer, itemId: string, dto: UpdateChecklistItemDto) {
        await this.assertChecklistItem(viewer, itemId);
        return this.db.projectTaskChecklistItem.update({
            where: { id: itemId },
            data: {
                ...(dto.text !== undefined ? { text: dto.text.trim() } : {}),
                ...(dto.isDone !== undefined ? { is_done: dto.isDone } : {}),
                ...(dto.sortOrder !== undefined ? { sort_order: dto.sortOrder } : {}),
            },
        });
    }

    /**
     * One row per thing that actually changed, so the feed reads as a list of
     * edits rather than "updated the task" repeated forever. `data` carries the
     * before/after values; the sentence is composed client-side so it translates.
     */
    private async recordUpdateActivity(
        tenantId: string,
        userId: string,
        task: TaskForActivity,
        dto: UpdateTaskDto,
        statusId: string,
        /** Where the task is now — the project a move just took it to. */
        projectId: string,
    ) {
        const base = { tenantId, taskId: task.id, projectId, actorId: userId };
        const moved = projectId !== task.project_id;

        if (dto.title !== undefined && dto.title.trim() !== task.title) {
            await this.activity.record({
                ...base,
                type: ActivityType.RENAMED,
                data: { from: task.title, to: dto.title.trim() },
            });
        }

        // A move's column change is `recordMove`'s to describe: it lands in the
        // new project's copy of the column more often than not.
        if (!moved && dto.statusId !== undefined && statusId !== task.status_id) {
            const [from, to] = await Promise.all([
                this.statusName(tenantId, task.status_id),
                this.statusName(tenantId, statusId),
            ]);
            await this.activity.record({
                ...base,
                type: ActivityType.STATUS_CHANGED,
                data: { from, to },
            });
        }

        if (
            (dto.assigneeId !== undefined && (dto.assigneeId || null) !== task.assignee_id) ||
            (dto.assigneeEmployeeId !== undefined &&
                (dto.assigneeEmployeeId || null) !== task.assignee_employee_id)
        ) {
            const to = await this.assigneeName(
                tenantId,
                dto.assigneeId ?? null,
                dto.assigneeEmployeeId ?? null,
            );
            await this.activity.record({ ...base, type: ActivityType.ASSIGNED, data: { to } });

            if (dto.assigneeId) {
                await this.activity.watch(tenantId, task.id, dto.assigneeId);
                await this.activity.notifyWatchers({
                    tenantId,
                    taskId: task.id,
                    actorId: userId,
                    title: task.title,
                    body: `Assigned to ${to ?? 'nobody'}`,
                    link: `/projects/${projectId}`,
                });
            }
        }

        if (dto.priority !== undefined && dto.priority !== task.priority) {
            await this.activity.record({
                ...base,
                type: ActivityType.PRIORITY_CHANGED,
                data: { from: task.priority, to: dto.priority },
            });
        }

        if (dto.startDate !== undefined || dto.dueDate !== undefined) {
            await this.activity.record({
                ...base,
                type: ActivityType.DATES_CHANGED,
                data: {
                    ...(dto.startDate !== undefined ? { start: dto.startDate || null } : {}),
                    ...(dto.dueDate !== undefined ? { due: dto.dueDate || null } : {}),
                },
            });
        }

        if (dto.labelIds !== undefined) {
            await this.activity.record({
                ...base,
                type: ActivityType.LABELS_CHANGED,
                data: { count: dto.labelIds.length },
            });
        }

        if (dto.remainingHours !== undefined) {
            await this.activity.record({
                ...base,
                type: ActivityType.RE_ESTIMATED,
                data: {
                    from: task.remaining_hours == null ? null : Number(task.remaining_hours),
                    to: dto.remainingHours,
                },
            });
        }
    }

    private async statusName(tenantId: string, statusId: string) {
        const status = await this.db.projectTaskStatus.findFirst({
            where: { id: statusId, tenant_id: tenantId },
            select: { name: true },
        });
        return status?.name ?? null;
    }

    private async assigneeName(
        tenantId: string,
        userId: string | null,
        employeeId: string | null,
    ) {
        if (userId) {
            const user = await this.db.user.findFirst({
                where: { id: userId },
                select: { name: true, email: true },
            });
            return user?.name ?? user?.email ?? null;
        }
        if (employeeId) {
            const employee = await this.db.employee.findFirst({
                where: { id: employeeId, tenant_id: tenantId },
                select: { name: true },
            });
            return employee?.name ?? null;
        }
        return null;
    }

    /**
     * Replaces a task's whole label set. Every id is checked against this
     * tenant first — the join table has no tenant column of its own to trust,
     * so an unchecked id would let one tenant tag with another's label.
     */
    private async setLabels(tenantId: string, taskId: string, labelIds: string[]) {
        const unique = [...new Set(labelIds)];

        if (unique.length > 0) {
            const known = await this.db.projectLabel.count({
                where: { tenant_id: tenantId, id: { in: unique } },
            });
            if (known !== unique.length) throw new BadRequestException('Unknown label');
        }

        await this.db.$transaction([
            this.db.projectTaskLabel.deleteMany({ where: { task_id: taskId } }),
            ...(unique.length > 0
                ? [
                      this.db.projectTaskLabel.createMany({
                          data: unique.map((labelId) => ({
                              tenant_id: tenantId,
                              task_id: taskId,
                              label_id: labelId,
                          })),
                      }),
                  ]
                : []),
        ]);
    }

    /**
     * Re-sequences the entire checklist in one transaction. Takes every item id
     * rather than a moved pair so a partial write cannot leave two items sharing
     * a `sort_order`.
     */
    async reorderChecklist(viewer: ProjectViewer, taskId: string, itemIds: string[]) {
        const tenantId = viewer.tenantId;
        await this.assertTask(viewer, taskId);

        const existing = await this.db.projectTaskChecklistItem.findMany({
            where: { task_id: taskId, tenant_id: tenantId },
            select: { id: true },
        });
        const known = new Set(existing.map((item) => item.id));

        if (
            itemIds.length !== known.size ||
            new Set(itemIds).size !== itemIds.length ||
            itemIds.some((id) => !known.has(id))
        ) {
            throw new BadRequestException(
                'The new order must list every checklist item on this task exactly once',
            );
        }

        await this.db.$transaction(
            itemIds.map((id, index) =>
                this.db.projectTaskChecklistItem.update({
                    where: { id },
                    data: { sort_order: index },
                }),
            ),
        );

        return this.db.projectTaskChecklistItem.findMany({
            where: { task_id: taskId, tenant_id: tenantId },
            orderBy: { sort_order: 'asc' },
        });
    }

    async removeChecklistItem(viewer: ProjectViewer, itemId: string) {
        await this.assertChecklistItem(viewer, itemId);
        await this.db.projectTaskChecklistItem.delete({ where: { id: itemId } });
        return { success: true };
    }

    /**
     * A checklist item is addressed by its own id, with no task in the URL, so
     * the visibility of the project it hangs off has to be resolved through two
     * hops rather than assumed from the route.
     */
    private async assertChecklistItem(viewer: ProjectViewer, itemId: string) {
        const filter = await this.access.taskFilter(viewer);
        const item = await this.db.projectTaskChecklistItem.findFirst({
            where: {
                id: itemId,
                tenant_id: viewer.tenantId,
                ...(Object.keys(filter).length ? { task: filter } : {}),
            } as never,
            select: { id: true },
        });
        if (!item) throw new NotFoundException('Checklist item not found');
        return item;
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

    private async nextSortOrder(
        tenantId: string,
        projectId: string,
        statusId: string,
        client: Prisma.TransactionClient = this.db,
    ) {
        const last = await client.projectTask.findFirst({
            where: { tenant_id: tenantId, project_id: projectId, status_id: statusId, deleted_at: null },
            orderBy: { sort_order: 'desc' },
            select: { sort_order: true },
        });
        return (last?.sort_order ?? -1) + 1;
    }

    /**
     * The chokepoint every single-task route goes through, which is why the
     * visibility filter lives here rather than being repeated per method: a
     * task in a project the viewer cannot open is reported missing, not
     * forbidden.
     */
    async assertTask(viewer: ProjectViewer, taskId: string) {
        const task = await this.db.projectTask.findFirst({
            where: {
                id: taskId,
                tenant_id: viewer.tenantId,
                deleted_at: null,
                ...(await this.access.taskFilter(viewer)),
            } as never,
            include: { status: { select: { id: true, name: true, category: true } } },
        });
        if (!task) throw new NotFoundException('Task not found');
        return task;
    }

    private async assertProject(viewer: ProjectViewer, projectId: string) {
        return this.access.assertProjectVisible(viewer, projectId);
    }

    /**
     * Columns belong to a project as of Phase 3L, so a status id from another
     * board is not merely wrong, it would put the card somewhere nobody can see
     * it. Checked whenever the caller knows which project it should belong to.
     */
    private async assertStatus(tenantId: string, statusId: string, projectId?: string) {
        const status = await this.db.projectTaskStatus.findFirst({
            where: { id: statusId, tenant_id: tenantId },
            select: { id: true, name: true, category: true, project_id: true },
        });
        if (!status) throw new NotFoundException('Board column not found');
        if (projectId && status.project_id && status.project_id !== projectId) {
            throw new BadRequestException('That column belongs to a different project.');
        }
        return status;
    }

    /**
     * A story belongs to exactly one project, so a task can only join one of
     * its own project's stories. Unlike a sprint — which is tenant-level and
     * open to any project's work — a story is the requirement *this* project is
     * delivering, and a card filed under another project's story would be
     * counted into a backlog nobody looking at this board can see.
     */
    private async assertUserStory(tenantId: string, storyId: string, projectId: string) {
        const story = await this.db.projectUserStory.findFirst({
            where: { id: storyId, tenant_id: tenantId },
            select: { id: true, project_id: true },
        });
        if (!story) throw new NotFoundException('User story not found');
        if (story.project_id !== projectId) {
            throw new BadRequestException('That user story belongs to a different project.');
        }
        return story;
    }

    /**
     * A sprint is tenant-level, so a task from any project may join it. The old
     * same-project check was removed with `Sprint.project_id` — the tenant scope
     * below is now the only thing that matters.
     */
    private async assertSprint(tenantId: string, sprintId: string) {
        const sprint = await this.db.sprint.findFirst({
            where: { id: sprintId, tenant_id: tenantId },
            select: { id: true },
        });
        if (!sprint) throw new NotFoundException('Sprint not found');
        return sprint;
    }
}

/** One row of a task import file, after every name in it has become an id. */
interface TaskImportRow {
    projectId: string;
    title: string;
    description: string | null;
    statusId: string | null;
    priority: ProjectPriorityDto | null;
    assigneeId: string | null;
    startDate: string | null;
    dueDate: string | null;
    estimateHours: number | null;
}

/**
 * The optional half of an imported row, as the create and update DTOs want it.
 * Absent keys are what both paths read as "not mentioned in this file".
 */
function taskFieldsFrom(row: TaskImportRow) {
    return {
        ...(row.description !== null ? { description: row.description } : {}),
        ...(row.statusId !== null ? { statusId: row.statusId } : {}),
        ...(row.priority !== null ? { priority: row.priority } : {}),
        ...(row.assigneeId !== null ? { assigneeId: row.assigneeId } : {}),
        ...(row.startDate !== null ? { startDate: row.startDate } : {}),
        ...(row.dueDate !== null ? { dueDate: row.dueDate } : {}),
        ...(row.estimateHours !== null ? { estimateHours: row.estimateHours } : {}),
    };
}

interface TaskRow {
    id: string;
    status_id?: string;
    [key: string]: unknown;
}

/** A column as a move reads it: enough to match it by name, then by kind. */
interface MovableStatus {
    id: string;
    name: string;
    category: string;
}

/** A move, planned: where to, the column the task lands in, and the rule that chose it. */
interface ProjectMove {
    projectId: string;
    status: MovableStatus;
    columnFor: (status: MovableStatus | null | undefined) => MovableStatus;
}

/** A task whose column changed across Done on a move, and what it burns from. */
interface DoneCrossing {
    taskId: string;
    sprintId: string | null;
    previousHours: number | null;
    estimateHours: number | null;
    becameDone: boolean;
}

/**
 * The precise shape the activity recorder needs. `TaskRow` is deliberately
 * loose (an index signature for the logged-hours merge), which makes every
 * field `unknown` — no use to a function that has to compare before and after.
 */
interface TaskForActivity {
    id: string;
    project_id: string;
    title: string;
    status_id: string;
    priority: string;
    assignee_id: string | null;
    assignee_employee_id: string | null;
    remaining_hours: unknown;
}
