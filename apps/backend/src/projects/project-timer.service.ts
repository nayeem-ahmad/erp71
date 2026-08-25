import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ProjectAccessService, ProjectViewer } from './project-access.service';
import { RemainingHoursService, RemainingSource } from './remaining-hours.service';
import { StartTimerDto, StopTimerDto, UpdateTimerDto } from './project.dto';
import {
    dhakaTimeOfDay,
    hoursBetween,
    lastInstantAt,
    spanTimes,
    workDateFor,
} from './project-time-span.util';
import { liveTagIds } from './project-time-tags.util';

/**
 * The smallest figure a `Decimal(8, 2)` column can hold, and the floor every
 * stop is recorded at.
 *
 * `hoursBetween` rounds a sitting of a few seconds to zero, and stopping always
 * writes a row (see the class comment), so without this the shortest sittings
 * would be stored as a literal `0.00` — which reads on a timesheet as "nothing
 * happened" rather than as the short sitting it was.
 */
const MIN_LOGGED_HOURS = 0.01;

/**
 * The running clock.
 *
 * Two rules carry the whole feature.
 *
 * **The start time is the server's**, never a figure posted by the client — a
 * closed browser, a slept phone or a second device all have to be able to pick
 * the same timer back up. It can be *corrected* afterwards by the person the
 * clock belongs to (`update`), because the common case is remembering the timer
 * an hour after starting the work; what it can never be is stated at `start`,
 * where a client clock minutes out of true would silently become the record.
 *
 * **Stopping always writes the entry.** The overlap that would refuse a manual
 * entry is reported as a warning here and written anyway, and a sitting of a
 * few seconds is written at {@link MIN_LOGGED_HOURS} rather than thrown away.
 * A stop that records nothing leaves somebody hunting for an entry that was
 * never written, which is worse than a row they can edit or delete — and the
 * discard button beside STOP is already the way to say "that was a misclick",
 * stated rather than guessed at from a duration.
 */
@Injectable()
export class ProjectTimerService {
    constructor(
        private readonly db: DatabaseService,
        private readonly remaining: RemainingHoursService,
        private readonly access: ProjectAccessService,
    ) {}

    /** The caller's running timer, or null. Never anyone else's. */
    async current(viewer: ProjectViewer) {
        const timer = await this.db.projectTimer.findFirst({
            where: { tenant_id: viewer.tenantId, user_id: viewer.userId },
            include: {
                task: { select: { id: true, title: true } },
                project: { select: { id: true, code: true, name: true } },
            },
        });
        if (!timer) return null;
        return this.hydrate(viewer.tenantId, timer);
    }

    async start(viewer: ProjectViewer, dto: StartTimerDto) {
        const running = await this.db.projectTimer.findFirst({
            where: { tenant_id: viewer.tenantId, user_id: viewer.userId },
            include: { task: { select: { title: true } } },
        });
        // Refused rather than silently stopping the old one: writing an hour
        // log as a side effect of pressing start on a different task is the
        // kind of helpfulness nobody can audit afterwards. The UI shows STOP
        // while a timer runs, so this is a race guard rather than a dead end.
        if (running) {
            throw new ConflictException(
                `A timer is already running on "${running.task?.title ?? 'a task'}". Stop it first.`,
            );
        }

        const task = await this.loadTask(viewer, dto.taskId);
        const tagIds = await liveTagIds(this.db, viewer.tenantId, dto.tagIds);

        const timer = await this.db.projectTimer.create({
            data: {
                tenant_id: viewer.tenantId,
                user_id: viewer.userId,
                task_id: task.id,
                project_id: task.project_id,
                note: dto.note?.trim() || null,
                tag_ids: tagIds,
            },
            include: {
                task: { select: { id: true, title: true } },
                project: { select: { id: true, code: true, name: true } },
            },
        });
        return this.hydrate(viewer.tenantId, timer);
    }

    /**
     * Note, tags and the start time, all editable while the clock runs.
     *
     * The start arrives as a Dhaka `HH:mm` — the same shape the manual entry
     * form takes — and resolves to the last instant that read it, so nobody has
     * to name a date to say "I actually started at nine". See
     * {@link lastInstantAt} for what that costs and why it is the right reading.
     */
    async update(viewer: ProjectViewer, dto: UpdateTimerDto) {
        const timer = await this.requireRunning(viewer);

        let startedAt: Date | null = null;
        if (dto.startTime !== undefined) {
            // `Date.now()` rather than `new Date()` for the same reason
            // `hydrate` reads it: it is the one clock in this file a test can
            // hold still.
            startedAt = lastInstantAt(new Date(Date.now()), dto.startTime);
            // The DTO's pattern already rejects anything but `HH:mm`; this is
            // the belt to its braces, and keeps the method safe to call from
            // anywhere that is not behind the pipe.
            if (!startedAt) {
                throw new BadRequestException('Give the start time as HH:mm.');
            }
        }

        const updated = await this.db.projectTimer.update({
            where: { id: timer.id },
            data: {
                ...(dto.note !== undefined ? { note: dto.note?.trim() || null } : {}),
                ...(startedAt ? { started_at: startedAt } : {}),
                ...(dto.tagIds !== undefined
                    ? { tag_ids: await liveTagIds(this.db, viewer.tenantId, dto.tagIds) }
                    : {}),
            },
            include: {
                task: { select: { id: true, title: true } },
                project: { select: { id: true, code: true, name: true } },
            },
        });
        return this.hydrate(viewer.tenantId, updated);
    }

    /**
     * Stops the clock and writes the hour log, in one transaction with the
     * timer's deletion — a stop that recorded the entry and left the timer
     * running would double-count the same sitting on the next stop.
     *
     * There is no duration below which this records nothing: see the class
     * comment.
     */
    async stop(viewer: ProjectViewer, dto: StopTimerDto = {}) {
        const timer = await this.requireRunning(viewer);
        const endedAt = new Date();

        const hours = Math.max(hoursBetween(timer.started_at, endedAt), MIN_LOGGED_HOURS);
        // The Dhaka day the clock *started* on, not the day it stopped: a
        // sitting that runs past midnight belongs to the evening it began in,
        // which is also how somebody reading their own timesheet reads it.
        const workDate = workDateFor(timer.started_at);

        const task = await this.loadTask(viewer, timer.task_id);
        const overlap = await this.findOverlap(
            viewer,
            timer.started_at,
            endedAt,
            null,
        );

        const tagIds = await liveTagIds(this.db, viewer.tenantId, timer.tag_ids);
        const note = (dto.note ?? timer.note)?.trim() || null;

        const entry = await this.db.$transaction(async (tx) => {
            const created = await tx.projectTimeEntry.create({
                data: {
                    tenant_id: viewer.tenantId,
                    task_id: timer.task_id,
                    project_id: timer.project_id,
                    user_id: viewer.userId,
                    work_date: workDate,
                    hours,
                    started_at: timer.started_at,
                    ended_at: endedAt,
                    note,
                    ...(tagIds.length
                        ? {
                              tags: {
                                  create: tagIds.map((tagId) => ({
                                      tenant_id: viewer.tenantId,
                                      tag_id: tagId,
                                  })),
                              },
                          }
                        : {}),
                },
                include: {
                    user: { select: { id: true, name: true, email: true } },
                    task: { select: { id: true, title: true } },
                    project: { select: { id: true, code: true, name: true } },
                    tags: { include: { tag: true } },
                },
            });
            await tx.projectTimer.delete({ where: { id: timer.id } });
            return created;
        });

        const previous = task.remaining_hours == null ? null : Number(task.remaining_hours);
        await this.remaining.write({
            tenantId: viewer.tenantId,
            taskId: task.id,
            projectId: task.project_id,
            sprintId: task.sprint_id,
            previousHours: previous,
            newHours:
                dto.remainingHours ?? RemainingHoursService.suggestAfterTimeLog(previous, hours),
            source:
                dto.remainingHours === undefined
                    ? RemainingSource.TIME_LOGGED
                    : RemainingSource.RE_ESTIMATED,
            timeEntryId: entry.id,
            userId: viewer.userId,
        });

        return {
            entry: { ...entry, ...spanTimes(entry.started_at, entry.ended_at) },
            // Reported rather than refused: see the class comment. The row is
            // written either way and the UI warns instead of blocking.
            overlap: overlap
                ? { id: overlap.id, taskTitle: overlap.task?.title ?? null }
                : null,
        };
    }

    /** Throws the clock away without recording anything. */
    async discard(viewer: ProjectViewer) {
        const timer = await this.requireRunning(viewer);
        await this.db.projectTimer.delete({ where: { id: timer.id } });
        return { success: true };
    }

    private async requireRunning(viewer: ProjectViewer) {
        const timer = await this.db.projectTimer.findFirst({
            where: { tenant_id: viewer.tenantId, user_id: viewer.userId },
        });
        if (!timer) throw new NotFoundException('No timer is running.');
        return timer;
    }

    /**
     * The task, checked against what this viewer is allowed to see. A private
     * project's task must not become startable just because somebody guessed
     * its id.
     */
    private async loadTask(viewer: ProjectViewer, taskId: string) {
        const task = await this.db.projectTask.findFirst({
            where: {
                id: taskId,
                tenant_id: viewer.tenantId,
                deleted_at: null,
                ...(await this.access.relatedFilter(viewer)),
            } as never,
            select: { id: true, project_id: true, sprint_id: true, remaining_hours: true },
        });
        if (!task) throw new NotFoundException('Task not found');
        return task;
    }

    private async findOverlap(
        viewer: ProjectViewer,
        startedAt: Date,
        endedAt: Date,
        excludeId: string | null,
    ) {
        return this.db.projectTimeEntry.findFirst({
            where: {
                tenant_id: viewer.tenantId,
                user_id: viewer.userId,
                ...(excludeId ? { id: { not: excludeId } } : {}),
                started_at: { not: null, lt: endedAt },
                ended_at: { gt: startedAt },
            },
            select: { id: true, task: { select: { title: true } } },
        });
    }

    private async hydrate(
        tenantId: string,
        timer: {
            id: string;
            task_id: string;
            project_id: string;
            started_at: Date;
            note: string | null;
            tag_ids: string[];
            task?: { id: string; title: string } | null;
            project?: { id: string; code: string; name: string } | null;
        },
    ) {
        const tags = timer.tag_ids.length
            ? await this.db.projectTimeTag.findMany({
                  where: { tenant_id: tenantId, id: { in: timer.tag_ids } },
                  orderBy: [{ sort_order: 'asc' }],
              })
            : [];
        return {
            id: timer.id,
            task: timer.task ?? null,
            project: timer.project ?? null,
            started_at: timer.started_at,
            // The Dhaka wall clock the start reads as, so the field that edits
            // it needs no timezone arithmetic of its own — the same courtesy
            // `spanTimes` does a stored entry.
            start_time: dhakaTimeOfDay(timer.started_at),
            // The client renders a ticking clock from this rather than from its
            // own `Date.now()` against a parsed timestamp, so a device whose
            // clock is minutes out still shows the elapsed time the server will
            // eventually record.
            elapsed_seconds: Math.max(
                0,
                Math.floor((Date.now() - timer.started_at.getTime()) / 1000),
            ),
            note: timer.note,
            tags,
        };
    }
}

