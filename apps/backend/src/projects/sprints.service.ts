import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AssetsService } from '../assets/assets.service';
import {
    NO_BACKGROUND,
    uploadBackgroundImage,
    withoutStorageKey,
    type BackgroundImageUpload,
} from './background-image.util';
import { ProjectAccessService, ProjectViewer } from './project-access.service';
import { BurndownRecorder } from './burndown-recorder.service';
import { buildBurndownSeries, toDateKey } from './burndown.util';
import { composeTaskKey } from './url-keys/task-key';
import {
    AssignStoriesToSprintDto,
    AssignTasksToSprintDto,
    CreateSprintDto,
    UpdateSprintDto,
} from './project.dto';

/** Where an uploaded sprint background lands. Per tenant, like a board's. */
/** One point on a sprint's burndown, as the chart reads it. */
export interface BurndownTimelinePoint {
    at: string;
    remaining: number;
    committed: number;
    open: number;
    /** Null on the synthetic "now" point appended while the sprint runs. */
    cause: string | null;
    task: { id: string; code: string | null; title: string } | null;
}

export function sprintBackgroundFolder(tenantId: string): string {
    return `${tenantId}/project-sprints`;
}

@Injectable()
export class SprintsService {
    constructor(
        private readonly db: DatabaseService,
        private readonly burndownRecorder: BurndownRecorder,
        private readonly access: ProjectAccessService,
        private readonly assets: AssetsService,
    ) {}

    /**
     * Every sprint in the tenant. Sprints are no longer scoped to a project, so
     * `projectId` filters by *participation* — sprints holding at least one task
     * from that project — rather than by ownership, which no longer exists.
     */
    /**
     * Note what is *not* filtered by visibility here: the hour totals. A sprint
     * is a tenant-level commitment and its burndown is a single shared number —
     * a per-viewer total would mean two people reading the same chart and
     * disagreeing about whether the sprint is on track, and the snapshot rows
     * behind `burndown()` are precomputed and cannot be re-derived per viewer
     * anyway. What a private project must not leak is its *identity*, so the
     * `projects` span below is filtered and the totals are left whole.
     */
    async list(viewer: ProjectViewer, projectId?: string) {
        const tenantId = viewer.tenantId;
        if (projectId) await this.access.assertProjectVisible(viewer, projectId);
        // Visibility only, deliberately not the record scope: this filter feeds
        // the `projects` span below, which is about a project's *identity*
        // rather than whose rows are in it. Narrowing it would make a sprint
        // look like it spanned only the projects the viewer holds a task on,
        // which is a different claim from the one the column makes.
        const visible = await this.access.relatedFilter(viewer);

        const participating = projectId
            ? (await this.db.projectTask.findMany({
                where: {
                    tenant_id: tenantId,
                    project_id: projectId,
                    deleted_at: null,
                    sprint_id: { not: null },
                },
                select: { sprint_id: true },
                distinct: ['sprint_id'],
            })).map((row) => row.sprint_id as string)
            : null;

        const sprints = await this.db.sprint.findMany({
            where: {
                tenant_id: tenantId,
                ...(participating ? { id: { in: participating } } : {}),
            },
            orderBy: [{ start_date: 'desc' }],
            include: { _count: { select: { tasks: true } } },
        });

        // Hour totals per sprint in one grouped query rather than one per row.
        const totals = await this.db.projectTask.groupBy({
            by: ['sprint_id'],
            where: {
                tenant_id: tenantId,
                deleted_at: null,
                sprint_id: { not: null },
            },
            _sum: { estimate_hours: true, remaining_hours: true },
        });
        const bySprint = new Map(
            totals.map((t) => [
                t.sprint_id,
                {
                    estimated: Number(t._sum.estimate_hours ?? 0),
                    remaining: Number(t._sum.remaining_hours ?? 0),
                },
            ]),
        );

        // Which projects a sprint spans is now derived from its tasks — there is
        // no column for it — so it is resolved here once rather than by every
        // caller re-querying.
        const spans = sprints.length === 0 ? [] : await this.db.projectTask.findMany({
            where: {
                tenant_id: tenantId,
                deleted_at: null,
                sprint_id: { in: sprints.map((s) => s.id) },
                ...visible,
            } as never,
            select: { sprint_id: true, project: { select: { id: true, code: true, name: true } } },
            distinct: ['sprint_id', 'project_id'],
        });
        const projectsBySprint = new Map<string, { id: string; code: string; name: string }[]>();
        for (const row of spans) {
            const list = projectsBySprint.get(row.sprint_id as string) ?? [];
            list.push(row.project);
            projectsBySprint.set(row.sprint_id as string, list);
        }

        return sprints.map((sprint) => ({
            ...withoutStorageKey(sprint),
            estimated_hours: bySprint.get(sprint.id)?.estimated ?? 0,
            remaining_hours: bySprint.get(sprint.id)?.remaining ?? 0,
            projects: projectsBySprint.get(sprint.id) ?? [],
        }));
    }

    async findOne(tenantId: string, sprintId: string) {
        return withoutStorageKey(await this.assertSprint(tenantId, sprintId));
    }

    async create(tenantId: string, dto: CreateSprintDto) {
        const start = new Date(dto.startDate);
        const end = new Date(dto.endDate);
        if (end < start) throw new BadRequestException('A sprint cannot end before it starts.');

        return this.db.sprint.create({
            data: {
                tenant_id: tenantId,
                name: dto.name.trim(),
                goal: dto.goal?.trim() || null,
                start_date: start,
                end_date: end,
            },
        });
    }

    async update(tenantId: string, sprintId: string, dto: UpdateSprintDto) {
        const sprint = await this.assertSprint(tenantId, sprintId);

        const start = dto.startDate ? new Date(dto.startDate) : sprint.start_date;
        const end = dto.endDate ? new Date(dto.endDate) : sprint.end_date;
        if (end < start) throw new BadRequestException('A sprint cannot end before it starts.');

        if (dto.status === 'ACTIVE' && sprint.status !== 'ACTIVE') {
            await this.assertNoOtherActive(tenantId, sprintId);
        }

        // One background, as on a board: a colour retires the image, file and all.
        const replacingImage = dto.backgroundColor !== undefined && Boolean(sprint.background_image_key);

        const updated = await this.db.sprint.update({
            where: { id: sprintId },
            data: {
                ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
                ...(dto.goal !== undefined ? { goal: dto.goal?.trim() || null } : {}),
                ...(dto.startDate !== undefined ? { start_date: start } : {}),
                ...(dto.endDate !== undefined ? { end_date: end } : {}),
                ...(dto.status !== undefined ? { status: dto.status as never } : {}),
                ...(dto.backgroundColor !== undefined
                    ? { ...NO_BACKGROUND, background_color: dto.backgroundColor }
                    : {}),
            },
        });

        // After the row, as on a board: a failed delete strands a file, while
        // the reverse leaves a sprint pointing at an image that is gone.
        if (replacingImage) await this.assets.deleteFile(sprint.background_image_key!, 'image');
        return withoutStorageKey(updated);
    }

    /** Upload an image and hang it behind the sprint's card view. See `BoardsService.setBackgroundImage`. */
    async setBackgroundImage(tenantId: string, sprintId: string, dto: BackgroundImageUpload) {
        const sprint = await this.assertSprint(tenantId, sprintId);
        const stored = await uploadBackgroundImage(this.assets, sprintBackgroundFolder(tenantId), dto);

        const updated = await this.db.sprint.update({
            where: { id: sprintId },
            data: {
                ...NO_BACKGROUND,
                background_image_url: stored.url,
                background_image_key: stored.publicId,
            },
        });

        const previousKey = sprint.background_image_key;
        if (previousKey && previousKey !== stored.publicId) {
            await this.assets.deleteFile(previousKey, 'image');
        }
        return withoutStorageKey(updated);
    }

    /** Back to the plain sprint: all three columns cleared, and the file with them. */
    async clearBackground(tenantId: string, sprintId: string) {
        const sprint = await this.assertSprint(tenantId, sprintId);
        const updated = await this.db.sprint.update({
            where: { id: sprintId },
            data: NO_BACKGROUND,
        });
        if (sprint.background_image_key) {
            await this.assets.deleteFile(sprint.background_image_key, 'image');
        }
        return withoutStorageKey(updated);
    }

    /**
     * Starting a sprint takes a snapshot immediately, so day one has a point
     * and the burndown has something to anchor its ideal line to.
     */
    async start(tenantId: string, sprintId: string) {
        const sprint = await this.assertSprint(tenantId, sprintId);
        if (sprint.status === 'COMPLETED') {
            throw new BadRequestException('That sprint is already complete.');
        }
        await this.assertNoOtherActive(tenantId, sprintId);

        const updated = await this.db.sprint.update({
            where: { id: sprintId },
            data: { status: 'ACTIVE' as never },
        });
        await this.burndownRecorder.record(tenantId, [sprintId], 'STARTED');
        return withoutStorageKey(updated);
    }

    /**
     * Completing a sprint snapshots one last time, then returns unfinished
     * tasks to the backlog. They keep their remaining hours — the work did not
     * evaporate because the sprint ended — and their log rows keep pointing at
     * the sprint they burned in.
     */
    async complete(tenantId: string, sprintId: string) {
        const sprint = await this.assertSprint(tenantId, sprintId);
        await this.burndownRecorder.record(tenantId, [sprintId], 'COMPLETED');

        const carried = await this.db.projectTask.findMany({
            where: {
                tenant_id: tenantId,
                sprint_id: sprintId,
                deleted_at: null,
                status: { category: { not: 'DONE' } },
            },
            select: { id: true },
        });

        await this.db.projectTask.updateMany({
            where: { id: { in: carried.map((t) => t.id) } },
            data: { sprint_id: null },
        });

        const updated = await this.db.sprint.update({
            where: { id: sprintId },
            data: { status: 'COMPLETED' as never },
        });
        return { ...withoutStorageKey(updated), carried_over: carried.length };
    }

    /**
     * Tasks may come from any project — that is the point of a tenant-level
     * sprint — but only from a project this viewer can open. Filtered rather
     * than refused: `updateMany` silently skipping an id someone cannot see is
     * the same answer as "no such task", which is what the id deserves.
     */
    async assignTasks(viewer: ProjectViewer, sprintId: string, dto: AssignTasksToSprintDto) {
        const tenantId = viewer.tenantId;
        await this.assertSprint(tenantId, sprintId);
        const where = {
            tenant_id: tenantId,
            id: { in: dto.taskIds },
            deleted_at: null,
            ...(await this.access.taskFilter(viewer)),
        } as never;
        // Any sprint these tasks are leaving loses them from its burndown.
        const leaving = await this.db.projectTask.findMany({ where, select: { sprint_id: true } });
        const result = await this.db.projectTask.updateMany({ where, data: { sprint_id: sprintId } });
        await this.burndownRecorder.record(tenantId, leaving.map((task) => task.sprint_id), 'TASK_REMOVED');
        await this.burndownRecorder.record(tenantId, [sprintId], 'TASK_ADDED');
        return { assigned: result.count };
    }

    /**
     * Commits a story by committing its open work: every task filed under it
     * that is not DONE and not already promised to another sprint. A story has
     * no hours of its own (see `ProjectUserStory`), so there is nothing else a
     * sprint could hold of it. Tasks in another sprint are left where they are —
     * taking them would silently shrink a plan somebody else made.
     */
    async assignStories(viewer: ProjectViewer, sprintId: string, dto: AssignStoriesToSprintDto) {
        const tenantId = viewer.tenantId;
        await this.assertSprint(tenantId, sprintId);
        if (dto.storyIds.length === 0) return { assigned: 0 };
        const result = await this.db.projectTask.updateMany({
            where: {
                tenant_id: tenantId,
                user_story_id: { in: dto.storyIds },
                sprint_id: null,
                deleted_at: null,
                status: { category: { not: 'DONE' } },
                ...(await this.access.taskFilter(viewer)),
            } as never,
            data: { sprint_id: sprintId },
        });
        await this.burndownRecorder.record(tenantId, [sprintId], 'TASK_ADDED');
        return { assigned: result.count };
    }

    async removeTasks(viewer: ProjectViewer, sprintId: string, dto: AssignTasksToSprintDto) {
        const tenantId = viewer.tenantId;
        await this.assertSprint(tenantId, sprintId);
        const result = await this.db.projectTask.updateMany({
            where: {
                tenant_id: tenantId,
                sprint_id: sprintId,
                id: { in: dto.taskIds },
                ...(await this.access.taskFilter(viewer)),
            } as never,
            data: { sprint_id: null },
        });
        await this.burndownRecorder.record(tenantId, [sprintId], 'TASK_REMOVED');
        return { removed: result.count };
    }

    async remove(tenantId: string, sprintId: string) {
        await this.assertSprint(tenantId, sprintId);
        await this.db.projectTask.updateMany({
            where: { tenant_id: tenantId, sprint_id: sprintId },
            data: { sprint_id: null },
        });
        await this.db.sprint.delete({ where: { id: sprintId } });
        return { success: true };
    }

    /**
     * Every recorded point, plus the ideal line and the live totals.
     *
     * Points are the stored change-by-change totals (`SprintBurndownPoint`).
     * While the sprint runs, the live figures are appended as a final point
     * when they differ from the last stored one, so the line always reaches
     * "now" even if the latest point failed to write.
     *
     * The ideal line is anchored to the committed total at the first point —
     * the scope the sprint started with — not today's, which would hide the
     * overrun the chart exists to show.
     */
    async burndown(tenantId: string, sprintId: string) {
        const sprint = await this.assertSprint(tenantId, sprintId);
        const [rows, current] = await Promise.all([
            this.db.sprintBurndownPoint.findMany({
                where: { tenant_id: tenantId, sprint_id: sprintId },
                orderBy: { recorded_at: 'asc' },
                include: {
                    task: {
                        select: { id: true, reference: true, title: true, project: { select: { code: true } } },
                    },
                },
            }),
            this.burndownRecorder.computeCurrent(tenantId, sprintId),
        ]);

        const points: BurndownTimelinePoint[] = rows.map((row) => ({
            at: row.recorded_at.toISOString(),
            remaining: Number(row.remaining_hours),
            committed: Number(row.committed_hours),
            open: Math.max(row.task_count - row.done_task_count, 0),
            cause: row.cause as string,
            task: row.task
                ? {
                      id: row.task.id,
                      code: row.task.project?.code ? composeTaskKey(row.task.project.code, row.task.reference) : null,
                      title: row.task.title,
                  }
                : null,
        }));

        const live: BurndownTimelinePoint = {
            at: new Date().toISOString(),
            remaining: current.remaining_hours,
            committed: current.committed_hours,
            open: Math.max(current.task_count - current.done_task_count, 0),
            cause: null,
            task: null,
        };
        const last = points[points.length - 1];
        if (
            sprint.status === 'ACTIVE' &&
            (!last || last.remaining !== live.remaining || last.committed !== live.committed || last.open !== live.open)
        ) {
            points.push(live);
        }

        const anchor = points[0]?.committed ?? current.committed_hours;
        const ideal = buildBurndownSeries({
            startDate: sprint.start_date,
            endDate: sprint.end_date,
            snapshots: new Map([[toDateKey(sprint.start_date), { remaining: anchor, committed: anchor }]]),
        }).map((day) => ({ date: day.date, value: day.ideal, isWorkingDay: day.isWorkingDay }));

        return {
            sprint: {
                id: sprint.id,
                name: sprint.name,
                goal: sprint.goal,
                status: sprint.status,
                start_date: sprint.start_date,
                end_date: sprint.end_date,
            },
            current,
            ideal,
            points,
        };
    }

    /** The whole row, storage key included — for this service's own use, never a response. */
    private async assertSprint(tenantId: string, sprintId: string) {
        const sprint = await this.db.sprint.findFirst({
            where: { id: sprintId, tenant_id: tenantId },
        });
        if (!sprint) throw new NotFoundException('Sprint not found');
        return sprint;
    }

    /**
     * One active sprint per TENANT. Was per project; a sprint no longer belongs
     * to one, so the tenant is the only scope left — and more than one active
     * sprint makes "the active sprint" (which the board and burndown both lean
     * on) ambiguous.
     */
    private async assertNoOtherActive(tenantId: string, exceptId: string) {
        const active = await this.db.sprint.findFirst({
            where: {
                tenant_id: tenantId,
                status: 'ACTIVE' as never,
                id: { not: exceptId },
            },
            select: { id: true, name: true },
        });
        if (active) {
            throw new ConflictException(
                `"${active.name}" is already running. Complete it before starting another sprint.`,
            );
        }
    }
}
