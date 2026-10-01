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
import { SprintMembershipService } from './sprint-membership.service';
import { buildBurndownSeries, toDateKey } from './burndown.util';
import { composeTaskKey } from './url-keys/task-key';
import {
    AssignStoriesToSprintDto,
    AssignTasksToSprintDto,
    CompleteSprintDto,
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
        private readonly membership: SprintMembershipService,
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
        if (dto.status !== undefined) {
            // A status set here would skip what start and complete do: the
            // first burndown point, closing the history, carrying work over.
            throw new BadRequestException(
                'Change a sprint\'s status with POST /sprints/:id/start or /complete.',
            );
        }

        const start = dto.startDate ? new Date(dto.startDate) : sprint.start_date;
        const end = dto.endDate ? new Date(dto.endDate) : sprint.end_date;
        if (end < start) throw new BadRequestException('A sprint cannot end before it starts.');

        // One background, as on a board: a colour retires the image, file and all.
        const replacingImage = dto.backgroundColor !== undefined && Boolean(sprint.background_image_key);

        const updated = await this.db.sprint.update({
            where: { id: sprintId },
            data: {
                ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
                ...(dto.goal !== undefined ? { goal: dto.goal?.trim() || null } : {}),
                ...(dto.startDate !== undefined ? { start_date: start } : {}),
                ...(dto.endDate !== undefined ? { end_date: end } : {}),
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
     * Closes the sprint and decides where its unfinished work goes — the
     * backlog (the default, and all this ever did), a planned sprint, or a new
     * one created here. One transaction, so a sprint is never completed with
     * its tasks half-moved.
     *
     * Done tasks stay in the sprint they were finished in. Every task's
     * `SprintTask` row closes with how its stay ended, which is what lets the
     * completed sprint list its carried tasks afterwards and a task show every
     * sprint it was attempted in. Remaining hours carry unchanged — the work
     * did not evaporate because the sprint ended — and log rows keep pointing
     * at the sprint they burned in.
     */
    async complete(tenantId: string, sprintId: string, dto: CompleteSprintDto = {}) {
        const sprint = await this.assertSprint(tenantId, sprintId);
        if (sprint.status === 'COMPLETED') {
            throw new ConflictException('That sprint is already complete.');
        }
        const carryTo = dto.carryTo ?? { kind: 'backlog' as const };
        if (carryTo.kind === 'sprint') await this.assertCarryTarget(tenantId, sprintId, carryTo.sprintId!);
        if (carryTo.kind === 'new' && new Date(carryTo.endDate!) < new Date(carryTo.startDate!)) {
            throw new BadRequestException('A sprint cannot end before it starts.');
        }

        if (carryTo.kind === 'new' && carryTo.start) await this.assertNoOtherActive(tenantId, sprintId);

        // Read now, while the work is still in it, so the last point shows what
        // was left undone; written only after the completion commits, so a
        // completion that fails leaves no COMPLETED marker on a running sprint.
        const finalFigures = await this.burndownRecorder.computeCurrent(tenantId, sprintId);

        const at = new Date();
        const { updated, carried, target } = await this.db.$transaction(async (tx) => {
            // Conditional, so two people completing at once cannot both run it.
            const closed = await tx.sprint.updateMany({
                where: { id: sprintId, tenant_id: tenantId, status: { not: 'COMPLETED' as never } },
                data: { status: 'COMPLETED' as never },
            });
            if (closed.count === 0) throw new ConflictException('That sprint is already complete.');

            const tasks = await tx.projectTask.findMany({
                where: { tenant_id: tenantId, sprint_id: sprintId, deleted_at: null },
                select: { id: true, status: { select: { category: true } } },
            });
            const done = tasks.filter((task) => task.status?.category === 'DONE').map((task) => task.id);
            const unfinished = tasks.filter((task) => task.status?.category !== 'DONE').map((task) => task.id);

            await this.membership.closeInPlace(tx, tenantId, sprintId, done, 'DONE', at);

            // Nothing unfinished means nothing to carry, so no sprint is made
            // for it even when one was asked for.
            let next: { id: string; name: string; status: string } | null = null;
            if (unfinished.length > 0 && carryTo.kind === 'new') {
                next = await tx.sprint.create({
                    data: {
                        tenant_id: tenantId,
                        name: carryTo.name!.trim(),
                        goal: carryTo.goal?.trim() || null,
                        start_date: new Date(carryTo.startDate!),
                        end_date: new Date(carryTo.endDate!),
                    },
                    select: { id: true, name: true, status: true },
                });
            } else if (unfinished.length > 0 && carryTo.kind === 'sprint') {
                next = await tx.sprint.findFirst({
                    where: { id: carryTo.sprintId, tenant_id: tenantId, status: 'PLANNED' as never },
                    select: { id: true, name: true, status: true },
                });
                if (!next) throw new BadRequestException('Carry the work to a planned sprint.');
            }

            await this.membership.moveTasks(
                tx,
                tenantId,
                unfinished,
                next?.id ?? null,
                next ? 'CARRIED_OVER' : 'RETURNED_TO_BACKLOG',
                { at },
            );

            if (next && carryTo.kind === 'new' && carryTo.start) {
                const running = await tx.sprint.findFirst({
                    where: { tenant_id: tenantId, status: 'ACTIVE' as never, id: { not: next.id } },
                    select: { name: true },
                });
                if (running) {
                    throw new ConflictException(
                        `"${running.name}" is already running. Complete it before starting another sprint.`,
                    );
                }
                next = await tx.sprint.update({
                    where: { id: next.id },
                    data: { status: 'ACTIVE' as never },
                    select: { id: true, name: true, status: true },
                });
            }

            const row = await tx.sprint.findFirst({ where: { id: sprintId, tenant_id: tenantId } });
            return { updated: row!, carried: unfinished.length, target: next };
        });

        if (sprint.status === 'ACTIVE') {
            await this.burndownRecorder.recordFigures(tenantId, sprintId, finalFigures, 'COMPLETED');
        }
        if (target?.status === 'ACTIVE') await this.burndownRecorder.record(tenantId, [target.id], 'STARTED');
        return {
            ...withoutStorageKey(updated),
            carried_over: carried,
            carried_to: target ? { id: target.id, name: target.name } : null,
        };
    }

    /**
     * Tasks may come from any project — that is the point of a tenant-level
     * sprint — but only from a project this viewer can open. Filtered rather
     * than refused: an id someone cannot see is skipped, the same answer as
     * "no such task", which is what the id deserves.
     */
    async assignTasks(viewer: ProjectViewer, sprintId: string, dto: AssignTasksToSprintDto) {
        const tenantId = viewer.tenantId;
        await this.assertOpenSprint(tenantId, sprintId);
        const reachable = await this.db.projectTask.findMany({
            where: {
                tenant_id: tenantId,
                id: { in: dto.taskIds },
                deleted_at: null,
                ...(await this.access.taskFilter(viewer)),
            } as never,
            select: { id: true },
        });
        const { moved, leftSprintIds } = await this.membership.moveTasks(
            this.db,
            tenantId,
            reachable.map((task) => task.id),
            sprintId,
            'REMOVED',
        );
        // Any sprint these tasks left loses them from its burndown.
        await this.burndownRecorder.record(tenantId, leftSprintIds, 'TASK_REMOVED');
        await this.burndownRecorder.record(tenantId, [sprintId], 'TASK_ADDED');
        return { assigned: moved };
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
        await this.assertOpenSprint(tenantId, sprintId);
        if (dto.storyIds.length === 0) return { assigned: 0 };
        const open = await this.db.projectTask.findMany({
            where: {
                tenant_id: tenantId,
                user_story_id: { in: dto.storyIds },
                sprint_id: null,
                deleted_at: null,
                status: { category: { not: 'DONE' } },
                ...(await this.access.taskFilter(viewer)),
            } as never,
            select: { id: true },
        });
        const { moved } = await this.membership.moveTasks(
            this.db,
            tenantId,
            open.map((task) => task.id),
            sprintId,
            'REMOVED',
        );
        await this.burndownRecorder.record(tenantId, [sprintId], 'TASK_ADDED');
        return { assigned: moved };
    }

    async removeTasks(viewer: ProjectViewer, sprintId: string, dto: AssignTasksToSprintDto) {
        const tenantId = viewer.tenantId;
        await this.assertOpenSprint(tenantId, sprintId);
        const inSprint = await this.db.projectTask.findMany({
            where: {
                tenant_id: tenantId,
                sprint_id: sprintId,
                id: { in: dto.taskIds },
                ...(await this.access.taskFilter(viewer)),
            } as never,
            select: { id: true },
        });
        const { moved } = await this.membership.moveTasks(
            this.db,
            tenantId,
            inSprint.map((task) => task.id),
            null,
            'REMOVED',
        );
        await this.burndownRecorder.record(tenantId, [sprintId], 'TASK_REMOVED');
        return { removed: moved };
    }

    /** Its history goes with it: `SprintTask` rows cascade on the sprint. */
    async remove(tenantId: string, sprintId: string) {
        await this.assertSprint(tenantId, sprintId);
        const inSprint = await this.db.projectTask.findMany({
            where: { tenant_id: tenantId, sprint_id: sprintId },
            select: { id: true },
        });
        await this.membership.moveTasks(this.db, tenantId, inSprint.map((task) => task.id), null, 'REMOVED');
        await this.db.sprint.delete({ where: { id: sprintId } });
        return { success: true };
    }

    /**
     * Every recorded point, plus the ideal line and the live totals.
     *
     * Points are the stored change-by-change totals (`SprintBurndownPoint`).
     * While the sprint runs, the live figures are appended as a final point,
     * so the line always reaches "now" — flat after a quiet spell, and right
     * even if the latest point failed to write.
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
        // Always, even when nothing moved since the last point: the line has
        // to reach "now", or three quiet days read as a chart that stopped.
        if (sprint.status === 'ACTIVE') points.push(live);

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
     * A completed sprint's membership is history: nothing joins or leaves it
     * afterwards. The UI already hides the controls; this is the server's word.
     */
    private async assertOpenSprint(tenantId: string, sprintId: string) {
        const sprint = await this.assertSprint(tenantId, sprintId);
        if (sprint.status === 'COMPLETED') {
            throw new BadRequestException('That sprint is complete; its tasks can no longer change.');
        }
        return sprint;
    }

    /** Where a completing sprint may send its unfinished work: a planned sprint, not itself. */
    private async assertCarryTarget(tenantId: string, fromSprintId: string, targetId: string) {
        const target = await this.db.sprint.findFirst({
            where: { id: targetId, tenant_id: tenantId },
            select: { id: true, status: true },
        });
        if (!target || target.id === fromSprintId || target.status !== 'PLANNED') {
            throw new BadRequestException('Carry the work to a planned sprint.');
        }
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
